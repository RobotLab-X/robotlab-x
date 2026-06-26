# unmanaged
"""Run logger — writes step + tool_call events to disk AND publishes
them to the bus so the UI can subscribe live.

Disk layout (one folder per run):
  <workspace>/runs/<timestamp>-<workflow>-<short_id>/
    input.json          run inputs + workflow ref
    context.md          rendered model context at run start
    steps.jsonl         one StepRecord per line
    tool_calls.jsonl    one ToolCallRecord per line
    result.md           terminal state — success body or failure reason
    errors.log          unstructured stderr for catastrophic failures

Bus topics (all retained):
  /brain/{id}/runs/{run_id}              run summary (one message, replaced as state evolves)
  /brain/{id}/runs/{run_id}/steps        appended events, not retained
  /brain/{id}/runs/{run_id}/tool_calls   appended events, not retained
  /brain/{id}/runs/{run_id}/result       terminal result body

The disk + bus paths are independent — a run survives even if the bus
client is mid-reconnect, and a fresh bus subscriber can fetch the
retained summary without re-reading the filesystem.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from brain.schemas import RunRecord, StepRecord, ToolCallRecord


logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_segment(s: str) -> str:
    """Reduce a string to characters safe in a path segment."""
    return "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in s)


def make_run_dir(workspace_dir: Path, workflow: str, short_id: str) -> Path:
    """Create + return the run dir under ``workspace/runs/``."""
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S")
    name = f"{ts}-{_safe_segment(workflow)}-{_safe_segment(short_id)}"
    out = workspace_dir / "runs" / name
    out.mkdir(parents=True, exist_ok=True)
    return out


class RunLogger:
    """Tied to one run. Use ``log_step()`` / ``log_tool_call()`` /
    ``log_result()`` from the workflow engine."""

    def __init__(
        self,
        *,
        run_dir: Path,
        publish: Callable[[str, Any], None],
        bus_prefix: str,
    ):
        self.run_dir = run_dir
        self._publish = publish
        self._prefix = bus_prefix.rstrip("/")

    # ─── one-shot files ────────────────────────────────────────────

    def write_input(self, payload: Dict[str, Any]) -> None:
        (self.run_dir / "input.json").write_text(json.dumps(payload, indent=2, default=str))
        self._emit_file_change("input.json", "created")

    def write_context(self, body: str) -> None:
        (self.run_dir / "context.md").write_text(body)
        self._emit_file_change("context.md", "created")

    def write_tools(self, tools: list) -> None:
        """Persist the filtered tool catalog brain offered to the
        LLM for this run. Constant for the run (allowed_tools is
        static + the workflow's allow rules don't change mid-run)
        — written once at run start. Useful when debugging "why
        didn't the model call X?" — the answer is often that X
        wasn't in the catalog this workflow saw."""
        path = self.run_dir / "tools.json"
        path.write_text(json.dumps(tools, indent=2, default=str))
        self._emit_file_change("tools.json", "created")

    def log_request(self, payload: Dict[str, Any]) -> None:
        """Append the EXACT request the engine sent to the adapter
        on one turn. Captures messages (growing across turns as
        tool results get threaded), the model id used, and any
        per-call overrides. The provider's wire body is built from
        this by the adapter; capturing here means we have a
        provider-agnostic record of what the engine intended to
        send. Pair with ``steps.jsonl`` (which has ``response_raw``)
        for a full request/response audit trail."""
        line = json.dumps(payload, default=str)
        path = self.run_dir / "requests.jsonl"
        first_write = not path.is_file()
        with open(path, "a") as f:
            f.write(line + "\n")
        self._emit_file_change("requests.jsonl", "created" if first_write else "modified")

    # ─── append-only event streams ─────────────────────────────────

    def log_step(self, rec: StepRecord) -> None:
        line = rec.model_dump_json()
        path = self.run_dir / "steps.jsonl"
        first_write = not path.is_file()
        with open(path, "a") as f:
            f.write(line + "\n")
        self._safe_publish(f"{self._prefix}/steps", rec.model_dump())
        self._emit_file_change("steps.jsonl", "created" if first_write else "modified")

    def log_tool_call(self, rec: ToolCallRecord) -> None:
        line = rec.model_dump_json()
        path = self.run_dir / "tool_calls.jsonl"
        first_write = not path.is_file()
        with open(path, "a") as f:
            f.write(line + "\n")
        self._safe_publish(f"{self._prefix}/tool_calls", rec.model_dump())
        self._emit_file_change("tool_calls.jsonl", "created" if first_write else "modified")

    def log_error(self, msg: str) -> None:
        path = self.run_dir / "errors.log"
        first_write = not path.is_file()
        with open(path, "a") as f:
            f.write(f"{_now_iso()} {msg}\n")
        self._emit_file_change("errors.log", "created" if first_write else "modified")

    # ─── terminal state ────────────────────────────────────────────

    def write_summary(self, run: RunRecord) -> None:
        """Replace the retained summary on the bus + update on disk."""
        self._safe_publish(self._prefix, run.model_dump(), retained=True)
        path = self.run_dir / "summary.json"
        first_write = not path.is_file()
        path.write_text(run.model_dump_json(indent=2))
        self._emit_file_change("summary.json", "created" if first_write else "modified")

    def write_result(self, body: str, *, status: str) -> None:
        (self.run_dir / "result.md").write_text(body)
        self._safe_publish(f"{self._prefix}/result", {"status": status, "body": body}, retained=True)
        self._emit_file_change("result.md", "created")

    # ─── stone F: file-change events ───────────────────────────────

    def _emit_file_change(self, filename: str, kind: str) -> None:
        """Publish ``/brain/<proxy_id>/files/changed`` for one of our
        run-dir writes. The workspace-relative path is computed from
        the run_dir name (a stable id), so the UI's tree refresh +
        auto-reload knows exactly which leaf moved.

        We never raise from this path — a missed event is just a UX
        cost (operator hits Refresh)."""
        # Prefix shape: /brain/<proxy_id>/runs/<run_id>
        parts = self._prefix.split("/")
        if len(parts) < 3 or parts[1] != "brain":
            return
        proxy_id = parts[2]
        rel_path = f"runs/{self.run_dir.name}/{filename}"
        payload: Dict[str, Any] = {"path": rel_path, "kind": kind}
        full = self.run_dir / filename
        if kind in ("created", "modified") and full.is_file():
            try:
                payload["mtime"] = full.stat().st_mtime
            except OSError:
                pass
        try:
            self._publish(f"/brain/{proxy_id}/files/changed", payload)
        except Exception:  # noqa: BLE001
            logger.debug("run_logger: file-change publish failed for %s", rel_path)

    # ─── internals ─────────────────────────────────────────────────

    def _safe_publish(self, topic: str, payload: Any, *, retained: bool = False) -> None:
        try:
            self._publish(topic, payload, retained=retained)
        except TypeError:
            # Some publish signatures don't accept the retained kwarg —
            # fall back to positional.
            try:
                self._publish(topic, payload)
            except Exception:  # noqa: BLE001
                logger.exception("run_logger: bus publish to %s failed (continuing on disk)", topic)
        except Exception:  # noqa: BLE001
            logger.exception("run_logger: bus publish to %s failed (continuing on disk)", topic)
