# unmanaged
"""PythonService — bus-driven Python script runner.

Wraps the existing ``runtime/script_runner.py`` so script execution is
addressable through the bus instead of only via the
``POST /v1/script/{id}/run`` HTTP endpoint.

Bus topics
----------

  /python/{id}/state    retained — {scripts: [...], recent_runs: [...]}
  /python/{id}/output             — {run_id, stream: 'stdout'|'stderr'|'meta',
                                     line/event/...}; one msg per script line
  /python/{id}/result             — {run_id, exit_code, duration_ms, ts}
                                    published when a run finishes (or times out)
  /python/{id}/control            — incoming @service_method actions

Shares storage with the legacy Scripts page (the ``script`` TinyDB
table) — scripts created there appear here, and vice versa.

Security model — identical to ``runtime/script_runner.py``: subprocess
with full backend privileges, time-limited, killed via process-group.
Admin role gates this whole service through the framework's normal
auth path.
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import Any, Dict, List, Optional

from rlx_bus import ServiceConfig
from robotlab_x.framework import Service, service_method


logger = logging.getLogger(__name__)


DEFAULT_TIMEOUT_S = 5.0
RECENT_RUNS_LIMIT = 20


class PythonConfig(ServiceConfig):
    """Per-instance config. Empty by design — scripts live in the
    shared ``script`` table, not in this service's config. Inherits
    ``topic_remap`` so e.g. ``/python/python-1/output`` can be aliased
    to a workspace-wide canonical topic.
    """
    pass


class PythonService(Service):
    """Bus-facing wrapper around script_runner. See module docstring."""

    config_class = PythonConfig
    publishes = ["state", "output", "result"]

    def __init__(self, meta, config) -> None:
        super().__init__(meta, config)
        self._recent_runs: List[Dict[str, Any]] = []
        self._control_task: Optional[asyncio.Task] = None
        self._catalog_refresh_task: Optional[asyncio.Task] = None

    # ─── lifecycle ───────────────────────────────────────────────────
    async def on_start(self) -> None:
        await self._publish_state()
        self._control_task = asyncio.create_task(self._control_loop())
        # Republish state every 5s so the UI sees newly-saved scripts
        # from the legacy /scripts page without us having to subscribe
        # to TinyDB change events (TinyDB doesn't have any).
        self._catalog_refresh_task = asyncio.create_task(self._catalog_refresh_loop())

    async def on_stop(self) -> None:
        for task in (self._control_task, self._catalog_refresh_task):
            if task is not None and not task.done():
                task.cancel()
        await asyncio.gather(
            *(t for t in (self._control_task, self._catalog_refresh_task) if t is not None),
            return_exceptions=True,
        )

    # ─── DB helpers ──────────────────────────────────────────────────
    def _db(self):
        """Lazy DB lookup — same pattern as Service.save_config so the
        service still loads when DB is briefly unavailable during boot."""
        try:
            from database.factory import get_database_client
        except Exception:  # noqa: BLE001
            return None
        return get_database_client()

    def _list_scripts(self, include_body: bool = True) -> List[Dict[str, Any]]:
        """List scripts. ``include_body=False`` strips the source for
        catalog views where size matters; default ``True`` so the
        view_full's editor can populate without a follow-up roundtrip.
        Body sizes are bounded by the editor anyway."""
        db = self._db()
        if db is None:
            return []
        rows = db.get_all_items("script") or []
        if include_body:
            return [dict(r) for r in rows]
        return [{k: v for k, v in r.items() if k != "body"} for r in rows]

    def _get_script_row(self, identifier: str) -> Optional[Dict[str, Any]]:
        """Look up by id first, then by name. Returns the raw row."""
        db = self._db()
        if db is None:
            return None
        row = db.get_item("script", identifier)
        if row:
            return row
        for r in db.get_all_items("script") or []:
            if r.get("name") == identifier:
                return r
        return None

    # ─── state ───────────────────────────────────────────────────────
    def _snapshot(self) -> Dict[str, Any]:
        return {
            "scripts": self._list_scripts(),
            "recent_runs": list(self._recent_runs),
        }

    async def _publish_state(self) -> None:
        self.publish("state", self._snapshot(), retained=True)

    async def _catalog_refresh_loop(self) -> None:
        """Periodic state republish so newly-saved scripts surface in
        the UI even when they came in via the /scripts page (which
        doesn't notify us)."""
        stop = self._stop_event
        assert stop is not None
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=5.0)
                return
            except asyncio.TimeoutError:
                pass
            try:
                await self._publish_state()
            except Exception:  # noqa: BLE001
                logger.exception("python %s: catalog refresh raised", self.proxy_id)

    # ─── @service_method actions ─────────────────────────────────────
    @service_method("list_scripts")
    def list_scripts(self) -> Dict[str, Any]:
        return {"scripts": self._list_scripts()}

    @service_method("get_script")
    def get_script(self, id: str) -> Dict[str, Any]:
        """Returns the full row including body, by id or by name."""
        row = self._get_script_row(id)
        if row is None:
            raise KeyError(f"no script with id/name={id!r}")
        return {"script": row}

    @service_method("save_script", publishes=["state"])
    def save_script(self, name: str, body: str, id: Optional[str] = None) -> Dict[str, Any]:
        """Create or update a script. If ``id`` is given, updates that
        row; otherwise creates with a new uuid."""
        from datetime import datetime, timezone
        db = self._db()
        if db is None:
            raise RuntimeError("database unavailable")
        now = datetime.now(timezone.utc).isoformat()
        if id:
            existing = db.get_item("script", id)
            if not existing:
                raise KeyError(f"no script with id={id!r}")
            row = {**existing, "name": name, "body": body, "updated_at": now}
            db.update_item("script", id, row, include_nulls=True)
        else:
            new_id = uuid.uuid4().hex[:12]
            row = {
                "id": new_id, "name": name, "body": body, "language": "python",
                "created_at": now, "updated_at": now,
            }
            db.insert_item("script", new_id, row)
        # Don't wait on the periodic refresh — publish immediately when
        # a loop is running. Sync callers (tests, REPL) just rely on
        # the next periodic tick.
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._publish_state())
        except RuntimeError:
            pass
        return {"script": row}

    @service_method("rename_script", publishes=["state"])
    def rename_script(self, id: str, new_name: str) -> Dict[str, Any]:
        """Update only the name. Cheaper than save_script when the body
        hasn't changed (the IDE's per-tab rename affordance hits this)."""
        from datetime import datetime, timezone
        db = self._db()
        if db is None:
            raise RuntimeError("database unavailable")
        row = self._get_script_row(id)
        if row is None:
            raise KeyError(f"no script with id/name={id!r}")
        row["name"] = new_name
        row["updated_at"] = datetime.now(timezone.utc).isoformat()
        db.update_item("script", row["id"], row, include_nulls=True)
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._publish_state())
        except RuntimeError:
            pass
        return {"script": row}

    @service_method("duplicate_script", publishes=["state"])
    def duplicate_script(self, id: str, new_name: Optional[str] = None) -> Dict[str, Any]:
        """Copy a script under a new uuid + (optionally) new name.
        Default name is the source name with ' (copy)' appended."""
        from datetime import datetime, timezone
        db = self._db()
        if db is None:
            raise RuntimeError("database unavailable")
        src = self._get_script_row(id)
        if src is None:
            raise KeyError(f"no script with id/name={id!r}")
        now = datetime.now(timezone.utc).isoformat()
        new_id = uuid.uuid4().hex[:12]
        row = {
            "id": new_id,
            "name": new_name or f"{src.get('name', 'script')} (copy)",
            "body": src.get("body", ""),
            "language": src.get("language", "python"),
            "created_at": now,
            "updated_at": now,
        }
        db.insert_item("script", new_id, row)
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._publish_state())
        except RuntimeError:
            pass
        return {"script": row}

    @service_method("search_scripts")
    def search_scripts(self, query: str, in_body: bool = True) -> Dict[str, Any]:
        """Case-insensitive substring search on name (always) + body
        (if ``in_body`` is True). Returns the matching rows with the
        full body for previewing. The IDE filters client-side too —
        this method exists so external callers (cron, other services)
        can search without pulling the whole catalog."""
        q = (query or "").strip().lower()
        if not q:
            return {"scripts": [], "query": query}
        matches: List[Dict[str, Any]] = []
        for r in self._list_scripts(include_body=True):
            name = (r.get("name") or "").lower()
            body = (r.get("body") or "").lower() if in_body else ""
            if q in name or (in_body and q in body):
                matches.append(r)
        return {"scripts": matches, "query": query}

    @service_method("delete_script", publishes=["state"])
    def delete_script(self, id: str) -> Dict[str, Any]:
        db = self._db()
        if db is None:
            raise RuntimeError("database unavailable")
        row = self._get_script_row(id)
        if not row:
            raise KeyError(f"no script with id/name={id!r}")
        db.delete_item("script", row["id"])
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._publish_state())
        except RuntimeError:
            pass
        return {"deleted": row["id"]}

    @service_method("run_script", publishes=["output", "result", "state"])
    def run_script(self, id: str, timeout: float = DEFAULT_TIMEOUT_S) -> Dict[str, Any]:
        """Execute a saved script by id or name. Returns the run_id
        immediately; output streams on /python/{proxy}/output, final
        result on /python/{proxy}/result."""
        row = self._get_script_row(id)
        if row is None:
            raise KeyError(f"no script with id/name={id!r}")
        body = row.get("body") or ""
        return self._spawn_run(
            script_name=row.get("name") or row.get("id") or "anonymous",
            body=body,
            timeout=float(timeout),
            script_id=row.get("id"),
        )

    @service_method("run_inline", publishes=["output", "result", "state"])
    def run_inline(
        self, body: str, name: str = "inline", timeout: float = DEFAULT_TIMEOUT_S,
    ) -> Dict[str, Any]:
        """Execute an ad-hoc script body without saving. Useful for cron
        jobs that want to run a one-liner without a DB entry."""
        if not isinstance(body, str) or not body.strip():
            raise ValueError("body must be a non-empty string")
        return self._spawn_run(script_name=name, body=body, timeout=float(timeout))

    # ─── run plumbing ────────────────────────────────────────────────
    def _spawn_run(
        self,
        script_name: str,
        body: str,
        timeout: float,
        script_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Hand off to script_runner with our own output topic + track
        the run in recent_runs so the UI can show history."""
        from robotlab_x.runtime import script_runner

        output_topic = self.topic("output")
        run_id = script_runner.run_in_background(
            script_id or script_name,
            body,
            timeout=timeout,
            output_topic=output_topic,
        )

        # Record the run start
        started_at = time.time()
        entry = {
            "run_id": run_id,
            "script_name": script_name,
            "script_id": script_id,
            "started_at": started_at,
            "status": "running",
            "timeout_s": timeout,
        }
        self._recent_runs.insert(0, entry)
        del self._recent_runs[RECENT_RUNS_LIMIT:]

        # Subscribe a one-shot watcher to /python/{id}/output that
        # catches the trailing 'end' meta event from script_runner and
        # republishes a clean /result frame + updates the run record.
        # ``get_running_loop`` is the correct API for 3.12+ — explicit
        # about needing an active loop. Production callers reach this
        # via the bus control loop, which always runs on the service's
        # asyncio loop; tests must use @pytest.mark.asyncio to provide
        # one. Sync-context callers (with no loop) get a clear error
        # rather than the deprecated get_event_loop() falling back to a
        # fresh-but-orphan loop.
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            # No loop — skip the watcher + state republish but still
            # return the run_id. The run itself runs in script_runner's
            # daemon thread so it works regardless.
            return {"run_id": run_id, "script_name": script_name, "timeout_s": timeout}
        loop.create_task(self._await_run_end(run_id, started_at))
        loop.create_task(self._publish_state())
        return {"run_id": run_id, "script_name": script_name, "timeout_s": timeout}

    async def _await_run_end(self, run_id: str, started_at: float) -> None:
        """Listen on /output until we see this run's terminal event.

        script_runner publishes three meta events: ``start`` (begin),
        optionally ``timeout`` (kill-issued), and always ``end`` OR
        ``error`` as the final word. The timeout event is informational
        — an ``end`` event with the killed process's exit code follows
        right after — so we only terminate on ``end``|``error`` and
        carry the prior timeout flag forward into the result.
        """
        timed_out = False
        async for msg in self.subscribe_iter(
            "output", subscriber_id=f"python-{self.proxy_id}-run-{run_id}",
        ):
            payload = msg.payload if isinstance(msg.payload, dict) else {}
            if payload.get("run_id") != run_id:
                continue
            if payload.get("stream") != "meta":
                continue
            event = payload.get("event")
            if event == "timeout":
                timed_out = True
                continue
            if event not in ("end", "error"):
                continue
            exit_code = payload.get("exit_code")
            duration_ms = int((time.time() - started_at) * 1000)
            status = "error" if event == "error" else (
                "timeout" if timed_out else "completed"
            )
            for entry in self._recent_runs:
                if entry["run_id"] == run_id:
                    entry["status"] = status
                    entry["exit_code"] = exit_code
                    entry["duration_ms"] = duration_ms
                    entry["finished_at"] = time.time()
                    break
            self.publish("result", {
                "run_id": run_id, "status": status, "exit_code": exit_code,
                "duration_ms": duration_ms,
            })
            await self._publish_state()
            return

    # ─── control loop ────────────────────────────────────────────────
    async def _control_loop(self) -> None:
        await self.run_control_loop()
