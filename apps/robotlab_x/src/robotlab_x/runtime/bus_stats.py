# unmanaged
"""Bus-stats digest — a throttled per-topic publish-rate feed.

The Composer's live-flow overlay needs to know which data routes are
*actively* carrying traffic and how fast — but the UI must never see
per-message traffic (a 60Hz joystick would melt a React render loop).

So this runs ONE background thread that, once per ``INTERVAL`` second,
diffs the bus's cumulative publish counters and publishes a single
retained digest on ``/bus/stats``:

    {"ts": <float>, "interval": <float>, "rates": {"<topic>": <hz>, ...}}

Only topics with a non-zero rate this window are included (keeps the
payload small + the UI's map sparse). The UI holds one subscription to
``/bus/stats`` and maps topic → hz onto its route edges. Retained so a
late subscriber (page reload) gets the latest digest immediately.

Mirrors the discovery listener's daemon-thread shape; lives off the
request path entirely.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Dict, Optional

from robotlab_x.runtime.bus import get_bus

logger = logging.getLogger(__name__)

INTERVAL = 1.0          # seconds between digests
STATS_TOPIC = "/bus/stats"

_thread: Optional[threading.Thread] = None
_stop = threading.Event()


def compute_rates(prev: Dict[str, int], cur: Dict[str, int], elapsed: float) -> Dict[str, float]:
    """Per-topic publish rate (Hz) from two cumulative-count snapshots.
    Only topics that advanced this window are returned; the digest's own
    topic is excluded so it can't self-amplify."""
    elapsed = max(1e-6, elapsed)
    rates: Dict[str, float] = {}
    for topic, count in cur.items():
        if topic == STATS_TOPIC:
            continue
        delta = count - prev.get(topic, 0)
        if delta > 0:
            rates[topic] = round(delta / elapsed, 2)
    return rates


def _loop() -> None:
    bus = get_bus()
    prev: Dict[str, int] = bus.publish_counts()
    last = time.time()
    while not _stop.is_set():
        if _stop.wait(timeout=INTERVAL):
            return
        now = time.time()
        elapsed = now - last
        cur = bus.publish_counts()
        rates = compute_rates(prev, cur, elapsed)
        prev = cur
        last = now
        try:
            bus.publish_sync(STATS_TOPIC, {"ts": now, "interval": elapsed, "rates": rates}, retained=True)
        except Exception:  # noqa: BLE001
            logger.debug("bus_stats: digest publish failed", exc_info=True)


def start() -> None:
    """Spin up the digest thread. Idempotent."""
    global _thread
    if _thread is not None and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="rlx-bus-stats", daemon=True)
    _thread.start()
    logger.info("bus_stats: publishing %s every %.1fs", STATS_TOPIC, INTERVAL)
