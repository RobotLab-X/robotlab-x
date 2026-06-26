# unmanaged
"""Data-flow links between services — service layer (derived projection).

Backs the generated ``link`` router (resource_slug "links", method list).
There is NO ``link`` table — the records are computed fresh from two
sources and normalized into one shape the Composer canvas draws as
"routes":

  * OBSERVED — the live bus topology (who currently publishes a topic vs
    who subscribes to it). Ground truth, but only for running services.
  * DECLARED — each proxy's persisted ``service_config`` bindings, so a
    link shows even while its services are stopped (intent, not just
    observation). Two binding shapes are recognized today:
      - input subscription: a nested ``input_source.topic`` (e.g.
        motor_control channels driven by /joystick/<id>/input)
      - capability binding: a ``controller_id`` (+ ``controller_type``)
        reference (e.g. servo→arduino, motor_control→sabertooth)

A link is keyed by (source_proxy, source_topic, target_proxy, target_sink)
and merged across sources: ``origin`` is "declared", "observed", or
"both". This is the seam future phases hang off (live flow stats,
direction, topic inspector) — they enrich the same record shape.

  GET /v1/links            → get_all_link   (the derived route list)

``?workspace=<id>`` optionally restricts the result to proxies in that
workspace; otherwise every known link is returned and the UI filters to
its node set.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Set, Tuple

from database.factory import get_database_client
from fastapi import HTTPException, Request

from robotlab_x.runtime.bus import get_bus

logger = logging.getLogger(__name__)


# ─── topic / proxy parsing ────────────────────────────────────────────


def _proxy_from_topic(topic: str) -> Optional[Tuple[str, str]]:
    """Service topics follow ``/<type>/<proxy_id>/<suffix>`` — the
    publisher owns its ``/<type>/<proxy_id>`` namespace. Return
    ``(type, proxy_id)`` for such a topic, else None (absolute/foreign
    topics with no clear owning proxy are skipped for the first cut)."""
    if not isinstance(topic, str):
        return None
    parts = [p for p in topic.split("/") if p != ""]
    if len(parts) < 3:
        return None
    return parts[0], parts[1]


def _looks_like_topic(value: Any) -> bool:
    return isinstance(value, str) and value.startswith("/") and value.count("/") >= 3


# ─── declared-binding extraction ──────────────────────────────────────

# Config keys that hold a proxy's OWN identity, never a reference to
# another service — excluded from the "value is a known proxy id ⇒
# reference" heuristic so a service doesn't link to itself.
_SELF_ID_KEYS = {"id", "proxy_id", "name"}


def _sink_label(key: str) -> str:
    """Human-ish slot label from a binding key: ``servo_proxy_id`` →
    ``servo``, ``controller_id`` → ``controller``."""
    for suffix in ("_proxy_id", "_id"):
        if key.endswith(suffix):
            return key[: -len(suffix)] or key
    return key


def _walk_config(
    node: Any,
    consumer_id: str,
    known: Set[str],
    out: Dict[Tuple, Dict[str, Any]],
    channel_ctx: Optional[str] = None,
) -> None:
    """Recursively scan a proxy's service_config for binding shapes.
    ``consumer_id`` is the proxy whose config we're walking; ``known`` is
    the set of valid proxy ids; ``out`` accumulates links keyed by their
    identity. ``channel_ctx`` carries the nearest enclosing label (channel
    ``id``, ``joint``, ``name``) used as the target_sink."""
    if isinstance(node, dict):
        # Nearest contextual label for sinks (a channel id, a joint name…).
        ctx = channel_ctx
        for key in ("joint", "id", "name"):
            v = node.get(key)
            if isinstance(v, str) and v:
                ctx = v
                break

        # Capability / reference binding: ANY config value equal to a known
        # proxy id is a reference to that service (e.g. controller_id,
        # servo_proxy_id, serial_proxy_id). Data/commands flow
        # consumer → referenced service, so source = this consumer. One
        # normalized rule covers every service type's binding-field name.
        for k, v in node.items():
            if k in _SELF_ID_KEYS:
                continue
            if isinstance(v, str) and v in known and v != consumer_id:
                _add(out, source=consumer_id, topic=None, target=v,
                     sink=ctx or _sink_label(k), kind="capability", origin="declared")

        # Input subscription: a nested topic this proxy consumes. Data
        # flows publisher(topic owner) → this consumer.
        topic = node.get("topic")
        if _looks_like_topic(topic):
            owner = _proxy_from_topic(topic)
            if owner and owner[1] in known and owner[1] != consumer_id:
                _add(out, source=owner[1], topic=topic, target=consumer_id,
                     sink=ctx, kind="input", origin="declared")

        for v in node.values():
            _walk_config(v, consumer_id, known, out, ctx)
    elif isinstance(node, list):
        for item in node:
            _walk_config(item, consumer_id, known, out, channel_ctx)


# ─── link accumulation ────────────────────────────────────────────────


def _key(source: str, topic: Optional[str], target: str, sink: Optional[str]) -> Tuple:
    return (source, topic, target, sink)


def _id(source: str, topic: Optional[str], target: str, sink: Optional[str]) -> str:
    src = source + (f"/{topic}" if topic else "")
    dst = target + (f"/{sink}" if sink else "")
    return f"{src}->{dst}"


def _add(out: Dict[Tuple, Dict[str, Any]], *, source: str, topic: Optional[str],
         target: str, sink: Optional[str], kind: str, origin: str) -> None:
    k = _key(source, topic, target, sink)
    existing = out.get(k)
    if existing is None:
        out[k] = {
            "id": _id(source, topic, target, sink),
            "source_proxy_id": source,
            "source_topic": topic,
            "target_proxy_id": target,
            "target_sink": sink,
            "kind": kind,
            "origin": origin,
        }
        return
    # Merge: declared + observed of the same edge → "both".
    if existing["origin"] != origin:
        existing["origin"] = "both"
    # A concrete topic/kind from either source wins over None/generic.
    if topic and not existing.get("source_topic"):
        existing["source_topic"] = topic
    if kind == "input" and existing.get("kind") != "input":
        existing["kind"] = "input"


# ─── observed (live bus) extraction ───────────────────────────────────


def _observed(known: Set[str], out: Dict[Tuple, Dict[str, Any]]) -> None:
    """Fold live bus topology into ``out``. For each active topic, the
    source is the proxy that owns the topic namespace; targets are the
    service subscribers on it."""
    for detail in get_bus().list_topics_detail():
        topic = detail.get("name")
        owner = _proxy_from_topic(topic)
        if not owner or owner[1] not in known:
            continue
        source = owner[1]
        for sub in detail.get("subscribers") or []:
            if sub.get("kind") != "service":
                continue
            target = sub.get("proxy_id")
            if not target or target == source or target not in known:
                continue
            _add(out, source=source, topic=topic, target=target,
                 sink=None, kind="input", origin="observed")


# ─── public API ───────────────────────────────────────────────────────


def get_all_link(user: dict, request: Request) -> List[Dict[str, Any]]:
    """GET /v1/links — derived route list (declared ∪ observed)."""
    db = get_database_client()
    if db is None:
        return []
    proxies = db.get_all_items("service_proxy") or []
    known: Set[str] = {p["id"] for p in proxies if p.get("id")}

    workspace_id = None
    try:
        workspace_id = request.query_params.get("workspace") if request else None
    except Exception:  # noqa: BLE001
        workspace_id = None
    if workspace_id:
        ws = db.get_item("workspace", workspace_id)
        if ws:
            # The runtime workspace computes its membership dynamically
            # (the raw row's service_proxy_ids is null) — hydrate it the
            # same way the workspace service does, else scoping wrongly
            # zeroes out every link.
            from robotlab_x.services.workspace_service import _hydrate_runtime_membership
            ws = _hydrate_runtime_membership(db, dict(ws))
            scope = set(ws.get("service_proxy_ids") or [])
            known = {pid for pid in known if pid in scope}

    out: Dict[Tuple, Dict[str, Any]] = {}

    # Declared bindings from each proxy's persisted config.
    for proxy in proxies:
        pid = proxy.get("id")
        if not pid or pid not in known:
            continue
        cfg = proxy.get("service_config")
        if isinstance(cfg, dict):
            _walk_config(cfg, pid, known, out)

    # Observed live edges.
    _observed(known, out)

    # Drop any edge whose endpoints fell outside the (possibly
    # workspace-scoped) known set — _walk_config already guards source
    # for inputs, but a declared capability target could be out of scope.
    return [
        link for link in out.values()
        if link["source_proxy_id"] in known and link["target_proxy_id"] in known
    ]


# ─── interactive create / delete ──────────────────────────────────────
# Writes go to the consumer's persisted ``service_config`` — the SAME
# store the service wizard + service methods use — then broadcast a
# ``config_state`` so a running service picks the change up live. We do
# NOT invent a parallel link table: a link IS a config binding, and the
# projection above re-derives it on the next list.
#
# Scope boundary (deliberate): interactive CREATE is uniform only for
# top-level capability bindings (e.g. servo→arduino: set controller_type
# + controller_id at the config root). Channel/input bindings
# (motor_control) need rich per-binding params (motor index, field,
# index, scale) that a canvas drag can't supply, so their CREATE lives in
# the service's own panel. DELETE is generic for every kind — we re-match
# the binding that produced the link and null it.


def _proxy_type(proxy: Dict[str, Any]) -> Optional[str]:
    mid = proxy.get("service_meta_id") or ""
    return mid.split("@", 1)[0] if "@" in mid else (proxy.get("name") or None)


def _meta_caps(db, proxy: Dict[str, Any], field: str) -> Set[str]:
    """``implements`` or ``requires`` capability set for a proxy's type."""
    mid = proxy.get("service_meta_id")
    meta = db.get_item("service_meta", mid) if mid else None
    vals = (meta or {}).get(field) or []
    return {v for v in vals if isinstance(v, str)}


def _persist_config(db, proxy_id: str, row: Dict[str, Any], cfg: Dict[str, Any]) -> None:
    """Write the mutated service_config back + broadcast config_state so a
    live service reloads (mirrors discovery._handle_config_patch)."""
    row["service_config"] = cfg
    db.update_item("service_proxy", proxy_id, row, include_nulls=True)
    try:
        get_bus().publish_sync(f"/service_proxy/{proxy_id}/config_state", cfg, retained=True)
    except Exception:  # noqa: BLE001
        logger.debug("link_service: config_state broadcast failed for %s", proxy_id, exc_info=True)


def _clear_binding(cfg: Any, *, kind: str, target: str, topic: Optional[str], sink: Optional[str]) -> bool:
    """Recursively null the binding that produced a link. Returns True if
    anything was cleared. Matches by VALUE (controller_id / topic), not
    position, so it's safe across config reshuffles."""
    changed = False
    if isinstance(cfg, dict):
        if kind == "capability":
            # Null ANY reference field pointing at the target (controller_id,
            # servo_proxy_id, …) — mirrors the generalized extractor.
            for k, v in list(cfg.items()):
                if k in _SELF_ID_KEYS or v != target:
                    continue
                cfg[k] = None
                changed = True
                # controller_id carries companion fields; clear them too.
                if k == "controller_id":
                    cfg["controller_type"] = None
                    cfg["attached"] = False
        if kind == "input":
            src = cfg.get("input_source")
            if isinstance(src, dict) and (topic is None or src.get("topic") == topic):
                if sink is None or cfg.get("id") == sink:
                    cfg["input_source"] = None
                    changed = True
        for v in cfg.values():
            if _clear_binding(v, kind=kind, target=target, topic=topic, sink=sink):
                changed = True
    elif isinstance(cfg, list):
        for item in cfg:
            if _clear_binding(item, kind=kind, target=target, topic=topic, sink=sink):
                changed = True
    return changed


def process_link_request(payload: Dict[str, Any], user: dict, request: Request) -> Dict[str, Any]:
    """POST /v1/links-request {action: create|delete, …}.

    create (capability only): {source_proxy_id (consumer), target_proxy_id
            (controller)} — binds the consumer to the controller by setting
            its top-level controller_type/controller_id, validated against
            requires/implements.
    delete: {source_proxy_id, target_proxy_id, kind, source_topic?,
            target_sink?} — clears the matching binding on the consumer.
    Returns {"metadata": {...}, "records": <refreshed link list>}."""
    db = get_database_client()
    if db is None:
        raise HTTPException(503, "database unavailable")
    action = (payload or {}).get("action")
    source = (payload or {}).get("source_proxy_id")
    target = (payload or {}).get("target_proxy_id")
    if not source or not target:
        raise HTTPException(400, "source_proxy_id and target_proxy_id are required")

    if action == "create":
        kind = (payload or {}).get("kind") or "capability"
        if kind != "capability":
            raise HTTPException(400, "interactive create supports kind='capability' only; "
                                     "configure input/channel bindings from the service's panel")
        consumer = db.get_item("service_proxy", source)
        controller = db.get_item("service_proxy", target)
        if not consumer or not controller:
            raise HTTPException(404, "source or target proxy not found")
        # Validate the capability contract: controller implements something
        # the consumer requires.
        shared = _meta_caps(db, consumer, "requires") & _meta_caps(db, controller, "implements")
        if not shared:
            raise HTTPException(400, f"{_proxy_type(controller)} does not implement a capability "
                                     f"{_proxy_type(consumer)} requires")
        cfg = dict(consumer.get("service_config") or {})
        if "channels" in cfg:
            raise HTTPException(400, f"{_proxy_type(consumer)} uses per-channel controller bindings; "
                                     "add the binding from its panel")
        cfg["controller_type"] = _proxy_type(controller)
        cfg["controller_id"] = target
        _persist_config(db, source, consumer, cfg)
        meta = {"status": "success", "action": "create", "kind": "capability",
                "source_proxy_id": source, "target_proxy_id": target,
                "capability": sorted(shared)[0]}

    elif action == "delete":
        kind = (payload or {}).get("kind") or "input"
        topic = (payload or {}).get("source_topic")
        sink = (payload or {}).get("target_sink")
        # The consumer holds the binding: for capability it's the source
        # (it references the controller); for input it's the target (it
        # subscribes to the source's topic).
        consumer_id = source if kind == "capability" else target
        consumer = db.get_item("service_proxy", consumer_id)
        if not consumer:
            raise HTTPException(404, f"proxy {consumer_id} not found")
        cfg = dict(consumer.get("service_config") or {})
        cleared = _clear_binding(cfg, kind=kind,
                                 target=target if kind == "capability" else source,
                                 topic=topic, sink=sink)
        if cleared:
            _persist_config(db, consumer_id, consumer, cfg)
        meta = {"status": "success", "action": "delete", "kind": kind,
                "source_proxy_id": source, "target_proxy_id": target, "cleared": cleared}

    else:
        raise HTTPException(400, f"unknown action {action!r} (expected create|delete)")

    return {"metadata": meta, "records": get_all_link(user, request)}
