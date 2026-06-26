# unmanaged
"""CronService unit tests.

Verifies:
  * add_job validates cron expression + topic format
  * remove_job, enable/disable, update_job round-trip
  * run_job_now publishes the payload to the configured topic
  * tick_once fires only enabled jobs whose schedule is due
  * a remap on the cron service redirects every job's output

A real Bus + isolated module-level singleton (via monkeypatching
``runtime.bus._default_bus``) is used so the publish path is exercised
end-to-end without spinning up the full backend.
"""
from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import MagicMock

import pytest

# Cron service lives in repo/cron/1.0.0/cron.py — make it importable.
_CRON_DIR = Path(__file__).resolve().parents[1] / "repo" / "cron" / "1.0.0"
if str(_CRON_DIR) not in sys.path:
    sys.path.insert(0, str(_CRON_DIR))


@pytest.fixture
def fresh_bus(monkeypatch):
    from robotlab_x.runtime.bus import Bus
    from robotlab_x.runtime import bus as bus_mod
    bus = Bus()
    monkeypatch.setattr(bus_mod, "_default_bus", bus)
    return bus


@pytest.fixture
def svc(fresh_bus, monkeypatch):
    """A CronService bound to a clean bus + no-op save_config."""
    from cron import CronService
    from robotlab_x.framework.service import ServiceMetadata
    meta = ServiceMetadata(
        proxy_id="cron-1",
        service_meta_id="cron@1.0.0",
        type_name="cron",
        type_version="1.0.0",
        tags=[],
        singleton=False,
    )
    s = CronService(meta=meta, config={})
    monkeypatch.setattr(s, "save_config", lambda: None)
    # Initialize the _iters dict that on_start would normally create
    s._iters = {}
    return s


# ─────────────────────────────────────────────────────────────────────
# add_job
# ─────────────────────────────────────────────────────────────────────


def test_add_job_validates_cron_expression(svc):
    with pytest.raises(ValueError, match="invalid cron expression"):
        svc.add_job(schedule="nonsense", topic="/x")


def test_add_job_requires_absolute_topic(svc):
    with pytest.raises(ValueError, match="absolute path"):
        svc.add_job(schedule="* * * * *", topic="relative")


def test_add_job_persists(svc):
    result = svc.add_job(schedule="*/5 * * * *", topic="/dest", payload={"x": 1}, name="every-5m")
    assert result["job"]["schedule"] == "*/5 * * * *"
    assert result["job"]["topic"] == "/dest"
    assert result["job"]["payload"] == {"x": 1}
    assert result["job"]["name"] == "every-5m"
    assert result["job"]["enabled"] is True
    assert len(svc.config.jobs) == 1


def test_add_job_assigns_unique_ids(svc):
    a = svc.add_job(schedule="* * * * *", topic="/a")
    b = svc.add_job(schedule="* * * * *", topic="/b")
    assert a["job"]["id"] != b["job"]["id"]


# ─────────────────────────────────────────────────────────────────────
# remove / enable / disable / update
# ─────────────────────────────────────────────────────────────────────


def test_remove_job(svc):
    j = svc.add_job(schedule="* * * * *", topic="/a")["job"]
    svc.remove_job(j["id"])
    assert svc.config.jobs == []


def test_remove_unknown_job_raises(svc):
    with pytest.raises(KeyError):
        svc.remove_job("does-not-exist")


def test_enable_disable_round_trip(svc):
    j = svc.add_job(schedule="* * * * *", topic="/a")["job"]
    assert svc.config.jobs[0].enabled is True
    svc.disable_job(j["id"])
    assert svc.config.jobs[0].enabled is False
    svc.enable_job(j["id"])
    assert svc.config.jobs[0].enabled is True


def test_update_job_partial(svc):
    j = svc.add_job(schedule="* * * * *", topic="/a", payload=1, name="orig")["job"]
    svc.update_job(id=j["id"], name="new-name")
    assert svc.config.jobs[0].name == "new-name"
    assert svc.config.jobs[0].topic == "/a"  # unchanged
    assert svc.config.jobs[0].payload == 1


def test_update_job_validates_new_schedule(svc):
    j = svc.add_job(schedule="* * * * *", topic="/a")["job"]
    with pytest.raises(ValueError):
        svc.update_job(id=j["id"], schedule="bogus")


def test_update_job_can_clear_payload(svc):
    """Default sentinel '__keep__' lets the caller distinguish 'leave it'
    from 'set to None'."""
    j = svc.add_job(schedule="* * * * *", topic="/a", payload={"x": 1})["job"]
    svc.update_job(id=j["id"], payload=None)
    assert svc.config.jobs[0].payload is None


# ─────────────────────────────────────────────────────────────────────
# run_job_now — payload reaches the topic
# ─────────────────────────────────────────────────────────────────────


def test_run_job_now_publishes_payload(svc, fresh_bus):
    j = svc.add_job(schedule="* * * * *", topic="/cron-test/destination",
                    payload={"msg": "hello"})["job"]

    captured: List[Any] = []
    async def consume():
        async for msg in fresh_bus.subscribe("/cron-test/destination", "sink"):
            captured.append(msg.payload)
            return

    loop = asyncio.new_event_loop()
    try:
        task = loop.create_task(consume())
        loop.run_until_complete(asyncio.sleep(0.01))
        svc.run_job_now(j["id"])
        loop.run_until_complete(asyncio.wait_for(task, timeout=1.0))
    finally:
        loop.close()

    assert captured == [{"msg": "hello"}]
    assert svc.config.jobs[0].last_run is not None
    assert svc.config.jobs[0].last_error is None


def test_fire_records_error_on_publish_failure(svc, monkeypatch):
    """A bad publish should record last_error on the job, not propagate.
    Exercises _fire directly so the state-republish (which also calls
    publish) doesn't get in the way."""
    j = svc.add_job(schedule="* * * * *", topic="/x")["job"]
    # Force only the next publish to raise — leave state publishes alone.
    monkeypatch.setattr(svc, "publish",
                        MagicMock(side_effect=RuntimeError("boom")))
    svc._fire(svc.config.jobs[0], time.time())
    job = svc.config.jobs[0]
    assert job.last_error and "boom" in job.last_error
    assert job.last_run is None  # last_run only set on successful publish


# ─────────────────────────────────────────────────────────────────────
# tick_once — fires only enabled, due jobs
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_tick_once_fires_due_job(svc, fresh_bus, monkeypatch):
    """Job scheduled '* * * * *' becomes due every minute. With a base
    that's in the past, tick should fire it once and advance the
    cursor."""
    # Add a job WITHOUT priming the iter (so we control the base).
    j = svc.add_job(schedule="* * * * *", topic="/tick-test")["job"]
    # Reset the iter to a base in the past so it's due immediately.
    from croniter import croniter
    past = time.time() - 120  # two minutes ago
    svc._iters[j["id"]] = croniter("* * * * *", past)

    fires: List[Any] = []
    monkeypatch.setattr(svc, "_fire",
                        MagicMock(side_effect=lambda job, now: fires.append((job.id, now))))

    await svc._tick_once()
    # Cursor advanced past the due slot
    assert len(fires) >= 1
    assert fires[0][0] == j["id"]


@pytest.mark.asyncio
async def test_tick_once_skips_disabled(svc, fresh_bus, monkeypatch):
    j = svc.add_job(schedule="* * * * *", topic="/tick-test", enabled=False)["job"]
    from croniter import croniter
    svc._iters[j["id"]] = croniter("* * * * *", time.time() - 120)

    fires: List[Any] = []
    monkeypatch.setattr(svc, "_fire",
                        MagicMock(side_effect=lambda job, now: fires.append((job.id, now))))

    await svc._tick_once()
    assert fires == []


# ─────────────────────────────────────────────────────────────────────
# topic_remap on the cron service redirects all jobs
# ─────────────────────────────────────────────────────────────────────


def test_topic_remap_redirects_job_output(svc, fresh_bus):
    """A remap configured on the cron service rewrites the destination
    topic of every job — same Service.resolve_topic that handles state."""
    svc.config = svc.config.merge_dict({"topic_remap": {"/dest": "/redirected"}})
    j = svc.add_job(schedule="* * * * *", topic="/dest", payload="hi")["job"]

    captured: List[Any] = []
    async def consume():
        async for msg in fresh_bus.subscribe("/redirected", "sink"):
            captured.append(msg.payload)
            return

    loop = asyncio.new_event_loop()
    try:
        task = loop.create_task(consume())
        loop.run_until_complete(asyncio.sleep(0.01))
        svc.run_job_now(j["id"])
        loop.run_until_complete(asyncio.wait_for(task, timeout=1.0))
    finally:
        loop.close()
    assert captured == ["hi"]


# ─────────────────────────────────────────────────────────────────────
# Config schema
# ─────────────────────────────────────────────────────────────────────


def test_cron_config_defaults():
    from cron import CronConfig
    c = CronConfig()
    assert c.jobs == []
    assert c.topic_remap == {}


def test_cron_config_serializes_jobs():
    from cron import CronConfig, CronJob
    c = CronConfig(jobs=[CronJob(schedule="* * * * *", topic="/x")])
    d = c.model_dump()
    assert isinstance(d["jobs"], list)
    assert d["jobs"][0]["schedule"] == "* * * * *"
