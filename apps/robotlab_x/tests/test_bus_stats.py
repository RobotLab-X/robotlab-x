# unmanaged
"""Bus publish-rate instrumentation + the /bus/stats digest math.

The live-flow overlay needs a per-topic publish RATE. The bus now counts
publishes per topic; bus_stats.compute_rates diffs two snapshots into Hz.
"""
from __future__ import annotations

from robotlab_x.runtime import bus_stats
from robotlab_x.runtime.bus import Bus


# ─── bus publish counter ──────────────────────────────────────────────


def test_publish_counts_increment():
    b = Bus()
    for _ in range(3):
        b.publish_sync("/a/a-1/state", {"x": 1})
    b.publish_sync("/a/a-1/heartbeat", {"ts": 0})
    counts = b.publish_counts()
    assert counts["/a/a-1/state"] == 3
    assert counts["/a/a-1/heartbeat"] == 1


def test_publish_counts_snapshot_is_a_copy():
    b = Bus()
    b.publish_sync("/t", 1)
    snap = b.publish_counts()
    b.publish_sync("/t", 2)
    assert snap["/t"] == 1   # snapshot frozen at capture time


# ─── digest rate math ─────────────────────────────────────────────────


def test_compute_rates_basic():
    prev = {"/x": 10, "/y": 5}
    cur = {"/x": 70, "/y": 5, "/z": 2}
    rates = bus_stats.compute_rates(prev, cur, elapsed=1.0)
    assert rates["/x"] == 60.0      # 60 publishes in 1s
    assert rates["/z"] == 2.0       # new topic counted from 0
    assert "/y" not in rates        # unchanged → omitted


def test_compute_rates_scales_by_elapsed():
    rates = bus_stats.compute_rates({"/x": 0}, {"/x": 30}, elapsed=2.0)
    assert rates["/x"] == 15.0


def test_compute_rates_excludes_own_topic():
    rates = bus_stats.compute_rates({}, {bus_stats.STATS_TOPIC: 100}, elapsed=1.0)
    assert rates == {}


def test_compute_rates_guards_zero_elapsed():
    # No division-by-zero on a degenerate interval.
    rates = bus_stats.compute_rates({"/x": 0}, {"/x": 1}, elapsed=0.0)
    assert rates["/x"] > 0
