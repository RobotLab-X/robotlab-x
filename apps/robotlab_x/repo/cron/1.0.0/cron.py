# unmanaged
"""CronService — scheduled message publisher.

Each cron service instance holds a list of jobs. A job is a triplet
``(cron-expression, target-topic, payload)`` plus a few flags. The
service runs a 1-second tick loop; whenever a job's next-fire time is
reached the payload is published to the target topic.

Wire contract
-------------

  /cron/{id}/state    retained  — {jobs: [...]}, full snapshot
  /cron/{id}/fired              — {job_id, topic, ts}, every time a job fires
  /cron/{id}/control            — actions (see @service_method list)

Schedule format is the standard 5-field cron expression
``minute hour day-of-month month day-of-week``, parsed by croniter. All
jobs evaluate against system local time. Sub-minute cadence is supported
through the extended ``*/N`` syntax in the minute field — croniter's
job, not ours. Anything finer than 1s is not supported (tick is 1s).
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from typing import Any, Dict, List, Optional

from croniter import croniter  # type: ignore[import-untyped]
from pydantic import BaseModel, Field
from rlx_bus import ServiceConfig
from robotlab_x.framework import Service, service_method


logger = logging.getLogger(__name__)


class CronJob(BaseModel):
    """One scheduled task. Persisted inside CronConfig.jobs."""
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12],
                    description="Stable identifier across edits/restarts")
    name: str = Field("", description="Human label for the UI")
    schedule: str = Field(..., description="5-field cron expression, e.g. '*/5 * * * *'")
    topic: str = Field(..., description="Absolute target topic, e.g. '/servo/servo-1/control'")
    payload: Any = Field(None, description="JSON-serializable payload to publish")
    enabled: bool = Field(True, description="Disabled jobs are skipped by the tick loop")
    retained: bool = Field(False, description="Publish as retained (last value sticks)")
    # Runtime state — recomputed each tick, not user-edited but persisted so the
    # UI can show 'last' across restarts.
    last_run: Optional[float] = Field(None, description="Epoch seconds of most recent fire")
    last_error: Optional[str] = Field(None, description="Last error if a fire failed")


class CronConfig(ServiceConfig):
    """Cron service config.

    jobs is the authoritative list. Editing through @service_method
    handlers (add_job, remove_job, …) mutates this and calls save_config().
    """
    jobs: List[CronJob] = Field(default_factory=list)


class CronService(Service):
    """Scheduled publisher. See module docstring for the wire contract."""

    config_class = CronConfig
    publishes = ["state", "fired"]

    _tick_task: Optional[asyncio.Task] = None
    _control_task: Optional[asyncio.Task] = None
    _iters: Dict[str, croniter]  # job_id → croniter cursor positioned past last fire

    # ─── lifecycle ───────────────────────────────────────────────────
    async def on_start(self) -> None:
        self._iters = {}
        self._rebuild_iters(now=time.time())
        await self._publish_state()
        self._tick_task = asyncio.create_task(self._tick_loop())
        self._control_task = asyncio.create_task(self._control_loop())

    async def on_stop(self) -> None:
        for task in (self._tick_task, self._control_task):
            if task is not None and not task.done():
                task.cancel()
        await asyncio.gather(
            *(t for t in (self._tick_task, self._control_task) if t is not None),
            return_exceptions=True,
        )

    # ─── @service_method actions ─────────────────────────────────────
    @service_method("add_job", publishes=["state"])
    def add_job(
        self,
        schedule: str,
        topic: str,
        payload: Any = None,
        name: str = "",
        enabled: bool = True,
        retained: bool = False,
    ) -> Dict[str, Any]:
        """Add a new job. Validates the cron expression up front so bad
        schedules don't poison the tick loop."""
        if not croniter.is_valid(schedule):
            raise ValueError(f"invalid cron expression: {schedule!r}")
        if not isinstance(topic, str) or not topic.startswith("/"):
            raise ValueError(f"topic must be an absolute path, got {topic!r}")
        job = CronJob(
            schedule=schedule, topic=topic, payload=payload, name=name,
            enabled=bool(enabled), retained=bool(retained),
        )
        self.config.jobs.append(job)
        self.save_config()
        self._iters[job.id] = croniter(job.schedule, time.time())
        self._publish_state_sync()
        return {"job": job.model_dump()}

    @service_method("update_job", publishes=["state"])
    def update_job(
        self,
        id: str,
        schedule: Optional[str] = None,
        topic: Optional[str] = None,
        payload: Any = "__keep__",
        name: Optional[str] = None,
        enabled: Optional[bool] = None,
        retained: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """Partial update — only the fields passed are changed. ``payload``
        is sentinel-defaulted so callers can explicitly set it to None
        without ambiguity."""
        job = self._find_job(id)
        if schedule is not None:
            if not croniter.is_valid(schedule):
                raise ValueError(f"invalid cron expression: {schedule!r}")
            job.schedule = schedule
            self._iters[job.id] = croniter(job.schedule, time.time())
        if topic is not None:
            if not isinstance(topic, str) or not topic.startswith("/"):
                raise ValueError(f"topic must be an absolute path, got {topic!r}")
            job.topic = topic
        if payload != "__keep__":
            job.payload = payload
        if name is not None:
            job.name = name
        if enabled is not None:
            job.enabled = bool(enabled)
        if retained is not None:
            job.retained = bool(retained)
        self.save_config()
        self._publish_state_sync()
        return {"job": job.model_dump()}

    @service_method("remove_job", publishes=["state"])
    def remove_job(self, id: str) -> Dict[str, Any]:
        before = len(self.config.jobs)
        self.config.jobs = [j for j in self.config.jobs if j.id != id]
        if len(self.config.jobs) == before:
            raise KeyError(f"no job with id={id!r}")
        self._iters.pop(id, None)
        self.save_config()
        self._publish_state_sync()
        return {"removed": id}

    @service_method("enable_job", publishes=["state"])
    def enable_job(self, id: str) -> Dict[str, Any]:
        self._find_job(id).enabled = True
        self.save_config()
        self._publish_state_sync()
        return {"id": id, "enabled": True}

    @service_method("disable_job", publishes=["state"])
    def disable_job(self, id: str) -> Dict[str, Any]:
        self._find_job(id).enabled = False
        self.save_config()
        self._publish_state_sync()
        return {"id": id, "enabled": False}

    @service_method("run_job_now", publishes=["state", "fired"])
    def run_job_now(self, id: str) -> Dict[str, Any]:
        """Manual trigger — publishes the job's payload immediately
        without affecting the regular schedule."""
        job = self._find_job(id)
        self._fire(job, time.time())
        self._publish_state_sync()
        return {"id": id, "fired": True}

    @service_method("list_jobs")
    def list_jobs(self) -> Dict[str, Any]:
        return {"jobs": [j.model_dump() for j in self.config.jobs]}

    # ─── internals ───────────────────────────────────────────────────
    def _find_job(self, id: str) -> CronJob:
        for j in self.config.jobs:
            if j.id == id:
                return j
        raise KeyError(f"no job with id={id!r}")

    def _rebuild_iters(self, now: float) -> None:
        """Re-create the per-job croniter cursors. Called from on_start
        and after any structural change (add/remove). The base for each
        cursor is ``now``, so freshly-added jobs don't immediately fire
        from a long-past instant."""
        self._iters = {}
        for j in self.config.jobs:
            try:
                self._iters[j.id] = croniter(j.schedule, now)
            except Exception:  # noqa: BLE001
                # Bad schedule (e.g. legacy data) — leave out, log; the
                # job stays in the list so the user can fix it via UI.
                logger.exception("cron %s: bad schedule on job %s: %r",
                                 self.proxy_id, j.id, j.schedule)

    def _job_next_run(self, job_id: str) -> Optional[float]:
        """Peek the upcoming fire time for ``job_id`` without consuming."""
        it = self._iters.get(job_id)
        if it is None:
            return None
        try:
            # croniter exposes .get_current()/get_next(); use get_next(ret_type=float)
            # with the side effect of advancing, then reset. Easier to use the
            # underlying clone.
            cur = it.get_current(float)
            return croniter(self.config.jobs[0].schedule, cur).get_next(float) if False else cur
        except Exception:  # noqa: BLE001
            return None

    def _next_run_for(self, job: CronJob) -> Optional[float]:
        """Compute the next fire time for display purposes (doesn't
        advance the live cursor)."""
        try:
            return croniter(job.schedule, time.time()).get_next(float)
        except Exception:  # noqa: BLE001
            return None

    def _snapshot(self) -> Dict[str, Any]:
        jobs = []
        for j in self.config.jobs:
            d = j.model_dump()
            d["next_run"] = self._next_run_for(j) if j.enabled else None
            jobs.append(d)
        return {"jobs": jobs}

    async def _publish_state(self) -> None:
        self.publish("state", self._snapshot(), retained=True)

    def _publish_state_sync(self) -> None:
        self.publish("state", self._snapshot(), retained=True)

    def _fire(self, job: CronJob, now: float) -> None:
        """Publish the job's payload to its topic. Catches and records
        per-job errors so one bad job doesn't take the whole loop down."""
        try:
            # Service.publish resolves topic_remap automatically — a remap
            # configured on this cron service redirects ALL its jobs'
            # outputs (useful for canary/test routing).
            self.publish(job.topic, job.payload, retained=job.retained)
            job.last_run = now
            job.last_error = None
            self.publish("fired", {"job_id": job.id, "name": job.name,
                                   "topic": job.topic, "ts": now})
        except Exception as exc:  # noqa: BLE001
            logger.exception("cron %s: job %s fire failed", self.proxy_id, job.id)
            job.last_error = f"{type(exc).__name__}: {exc}"

    async def _tick_loop(self) -> None:
        """1 Hz check for due jobs. Sub-second granularity isn't
        supported; cron itself can't go finer than minute, and the
        croniter extension to seconds is opt-in and not used here."""
        stop = self._stop_event
        assert stop is not None
        while not stop.is_set():
            try:
                await self._tick_once()
            except Exception:  # noqa: BLE001
                logger.exception("cron %s: tick raised", self.proxy_id)
            try:
                await asyncio.wait_for(stop.wait(), timeout=1.0)
                return
            except asyncio.TimeoutError:
                continue

    async def _tick_once(self) -> None:
        """Fire every job whose next-time is now in the past.

        croniter cursors are stateful: ``get_next()`` advances past the
        returned time. We use ``get_prev()`` style — compute next, and
        if it's ≤ now, fire and advance. Repeating handles catch-up
        when the loop slept longer than expected.
        """
        now = time.time()
        changed = False
        for job in list(self.config.jobs):
            if not job.enabled:
                continue
            it = self._iters.get(job.id)
            if it is None:
                continue
            # Peek without advancing using a separate iter starting from
            # the cursor's current base.
            try:
                cur_base = it.get_current(float)
            except Exception:  # noqa: BLE001
                continue
            peek = croniter(job.schedule, cur_base).get_next(float)
            while peek <= now:
                # Fire + advance the live cursor
                self._fire(job, now)
                changed = True
                # Advance: re-base from peek and recompute
                it = croniter(job.schedule, peek)
                self._iters[job.id] = it
                cur_base = peek
                peek = croniter(job.schedule, cur_base).get_next(float)
        if changed:
            self._publish_state_sync()
            self.save_config()

    async def _control_loop(self) -> None:
        await self.run_control_loop()
