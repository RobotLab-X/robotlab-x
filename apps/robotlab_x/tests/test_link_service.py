# unmanaged
"""Derived data-flow links (the Composer "routes" projection).

link_service has no table — it derives links from (a) each proxy's
persisted service_config bindings and (b) the live bus topology, merged
into one normalized shape. These cover the extraction + merge logic
deterministically with a fake DB and a fake bus snapshot.
"""
from __future__ import annotations

from typing import Any, Dict, List

import pytest

from robotlab_x.services import link_service


class FakeDB:
    def __init__(self, proxies: List[Dict[str, Any]], workspaces=None, metas=None) -> None:
        self._proxies = {p["id"]: p for p in proxies}
        self._workspaces = workspaces or {}
        self._metas = metas or {}
        self.updated: List[tuple] = []

    def get_all_items(self, table: str):
        return list(self._proxies.values()) if table == "service_proxy" else []

    def get_item(self, table: str, key: str):
        if table == "workspace":
            return self._workspaces.get(key)
        if table == "service_proxy":
            return self._proxies.get(key)
        if table == "service_meta":
            return self._metas.get(key)
        return None

    def update_item(self, table: str, key: str, item, include_nulls: bool = False) -> None:
        if table == "service_proxy":
            self._proxies[key] = item
        self.updated.append((table, key, item))


def _patch(monkeypatch, proxies, topics=None, workspaces=None, metas=None):
    db = FakeDB(proxies, workspaces, metas)
    monkeypatch.setattr(link_service, "get_database_client", lambda: db)

    class _Bus:
        def list_topics_detail(self):
            return topics or []

        def publish_sync(self, *a, **k):
            pass
    monkeypatch.setattr(link_service, "get_bus", lambda: _Bus())
    return db


def _by_id(links):
    return {l["id"]: l for l in links}


# ─── declared: input subscription (joystick → motor_control) ──────────


def test_declared_input_subscription(monkeypatch):
    proxies = [
        {"id": "joystick-1", "service_config": {}},
        {"id": "motor-control-1", "service_config": {
            "channels": [{"id": "left", "input_source": {"topic": "/joystick/joystick-1/input", "field": "axes", "index": 1}}],
        }},
    ]
    _patch(monkeypatch, proxies)
    links = link_service.get_all_link(None, None)
    assert len(links) == 1
    link = links[0]
    assert link["source_proxy_id"] == "joystick-1"
    assert link["target_proxy_id"] == "motor-control-1"
    assert link["source_topic"] == "/joystick/joystick-1/input"
    assert link["target_sink"] == "left"
    assert link["kind"] == "input"
    assert link["origin"] == "declared"


# ─── declared: capability binding (motor_control → sabertooth) ────────


def test_declared_capability_binding(monkeypatch):
    proxies = [
        {"id": "sabertooth-1", "service_config": {}},
        {"id": "motor-control-1", "service_config": {
            "channels": [{"id": "left", "controller_type": "sabertooth", "controller_id": "sabertooth-1"}],
        }},
    ]
    _patch(monkeypatch, proxies)
    links = _by_id(link_service.get_all_link(None, None))
    assert len(links) == 1
    link = next(iter(links.values()))
    assert link["source_proxy_id"] == "motor-control-1"   # consumer holds the ref
    assert link["target_proxy_id"] == "sabertooth-1"
    assert link["kind"] == "capability"
    assert link["target_sink"] == "left"                   # the channel slot holding the binding
    assert link["origin"] == "declared"


def test_proxy_id_reference_field_links(monkeypatch):
    # Generalized rule: ANY config value equal to a known proxy id is a
    # reference — not just literal `controller_id`. ik_solver links servos
    # via calibration[].servo_proxy_id. Regression for missing edges.
    proxies = [
        {"id": "servo-1", "service_config": {}},
        {"id": "servo-2", "service_config": {}},
        {"id": "ik_solver-1", "service_config": {
            "calibration": [
                {"joint": "base", "servo_proxy_id": "servo-1"},
                {"joint": "shoulder", "servo_proxy_id": "servo-2"},
                {"joint": "elbow", "servo_proxy_id": None},
            ],
        }},
    ]
    _patch(monkeypatch, proxies)
    links = link_service.get_all_link(None, None)
    pairs = {(l["source_proxy_id"], l["target_proxy_id"], l["target_sink"]) for l in links}
    assert ("ik_solver-1", "servo-1", "base") in pairs
    assert ("ik_solver-1", "servo-2", "shoulder") in pairs
    assert len(links) == 2     # the None-servo joint produces no edge


def test_self_id_keys_do_not_self_link(monkeypatch):
    # A proxy's own id / name must not be read as a reference to itself.
    proxies = [{"id": "servo-1", "name": "servo-1", "service_config": {"id": "servo-1", "name": "servo-1"}}]
    _patch(monkeypatch, proxies)
    assert link_service.get_all_link(None, None) == []


def test_capability_to_unknown_proxy_is_dropped(monkeypatch):
    # controller_id points at a proxy that doesn't exist → no edge.
    proxies = [{"id": "servo-1", "service_config": {"controller_id": "ghost-9", "controller_type": "arduino"}}]
    _patch(monkeypatch, proxies)
    assert link_service.get_all_link(None, None) == []


# ─── observed (live bus) + merge to "both" ────────────────────────────


def test_observed_edge(monkeypatch):
    proxies = [{"id": "joystick-1", "service_config": {}}, {"id": "motor-control-1", "service_config": {}}]
    topics = [{
        "name": "/joystick/joystick-1/input",
        "subscribers": [{"kind": "service", "type": "motor_control", "proxy_id": "motor-control-1", "suffix": "input"}],
    }]
    _patch(monkeypatch, proxies, topics=topics)
    links = link_service.get_all_link(None, None)
    assert len(links) == 1
    assert links[0]["origin"] == "observed"
    assert links[0]["source_proxy_id"] == "joystick-1"
    assert links[0]["target_proxy_id"] == "motor-control-1"


def test_declared_and_observed_merge_to_both(monkeypatch):
    proxies = [
        {"id": "joystick-1", "service_config": {}},
        {"id": "motor-control-1", "service_config": {
            "channels": [{"id": "left", "input_source": {"topic": "/joystick/joystick-1/input"}}],
        }},
    ]
    # Same source→target, but observed carries no sink, declared carries "left".
    # They key differently (sink differs) so they DON'T collapse — that's
    # intended: the declared edge names the channel, the observed one is the
    # raw bus fan-out. We assert both appear and the declared one is precise.
    topics = [{
        "name": "/joystick/joystick-1/input",
        "subscribers": [{"kind": "service", "proxy_id": "motor-control-1", "suffix": "input"}],
    }]
    _patch(monkeypatch, proxies, topics=topics)
    links = link_service.get_all_link(None, None)
    origins = sorted(l["origin"] for l in links)
    assert "declared" in origins and "observed" in origins


def test_exact_same_edge_merges_to_both(monkeypatch):
    # When declared + observed produce the IDENTICAL key (no sink on
    # either), origin collapses to "both".
    proxies = [
        {"id": "cam-1", "service_config": {}},
        {"id": "viewer-1", "service_config": {"input_source": {"topic": "/cam/cam-1/frames"}}},
    ]
    topics = [{
        "name": "/cam/cam-1/frames",
        "subscribers": [{"kind": "service", "proxy_id": "viewer-1", "suffix": "frames"}],
    }]
    _patch(monkeypatch, proxies, topics=topics)
    links = link_service.get_all_link(None, None)
    assert len(links) == 1
    assert links[0]["origin"] == "both"


# ─── filtering / hygiene ──────────────────────────────────────────────


def test_ui_session_subscribers_ignored(monkeypatch):
    proxies = [{"id": "joystick-1", "service_config": {}}]
    topics = [{
        "name": "/joystick/joystick-1/input",
        "subscribers": [{"kind": "ui", "user": "admin@x"}, {"kind": "subprocess", "session": "abc"}],
    }]
    _patch(monkeypatch, proxies, topics=topics)
    assert link_service.get_all_link(None, None) == []


def test_workspace_scope_filters(monkeypatch):
    proxies = [
        {"id": "joystick-1", "service_config": {}},
        {"id": "motor-control-1", "service_config": {
            "channels": [{"id": "left", "input_source": {"topic": "/joystick/joystick-1/input"}}],
        }},
        {"id": "servo-1", "service_config": {"controller_id": "arduino-1"}},
        {"id": "arduino-1", "service_config": {}},
    ]
    workspaces = {"ws-a": {"id": "ws-a", "service_proxy_ids": ["joystick-1", "motor-control-1"]}}
    _patch(monkeypatch, proxies, workspaces=workspaces)

    class _Req:
        query_params = {"workspace": "ws-a"}
    links = link_service.get_all_link(None, _Req())
    # Only the joystick→motor-control edge survives; servo→arduino is out of scope.
    assert len(links) == 1
    assert links[0]["source_proxy_id"] == "joystick-1"


def test_runtime_workspace_scope_hydrates_membership(monkeypatch):
    # The runtime workspace stores no service_proxy_ids (computed at
    # read-time). Scoping must hydrate membership, else every link is
    # wrongly dropped. Regression for "no edges in the runtime canvas".
    proxies = [
        {"id": "servo-1", "status": "running", "service_config": {"controller_id": "arduino-1"}},
        {"id": "arduino-1", "status": "running", "service_config": {}},
    ]
    workspaces = {"runtime": {"id": "runtime", "kind": "runtime", "service_proxy_ids": None}}
    _patch(monkeypatch, proxies, workspaces=workspaces)

    class _Req:
        query_params = {"workspace": "runtime"}
    links = link_service.get_all_link(None, _Req())
    assert len(links) == 1
    assert links[0]["source_proxy_id"] == "servo-1"
    assert links[0]["target_proxy_id"] == "arduino-1"


# ─── interactive create / delete ──────────────────────────────────────


def test_create_capability_binding(monkeypatch):
    proxies = [
        {"id": "servo-1", "service_meta_id": "servo@1.0.0", "service_config": {}},
        {"id": "arduino-1", "service_meta_id": "arduino@1.0.0", "service_config": {}},
    ]
    metas = {
        "servo@1.0.0": {"id": "servo@1.0.0", "requires": ["servo_controller"], "implements": []},
        "arduino@1.0.0": {"id": "arduino@1.0.0", "requires": [], "implements": ["servo_controller"]},
    }
    db = _patch(monkeypatch, proxies, metas=metas)
    res = link_service.process_link_request(
        {"action": "create", "kind": "capability", "source_proxy_id": "servo-1", "target_proxy_id": "arduino-1"},
        None, None)
    assert res["metadata"]["status"] == "success"
    cfg = db.get_item("service_proxy", "servo-1")["service_config"]
    assert cfg["controller_type"] == "arduino"
    assert cfg["controller_id"] == "arduino-1"
    # And the new link now shows up in the refreshed records.
    assert any(l["source_proxy_id"] == "servo-1" and l["target_proxy_id"] == "arduino-1"
               for l in res["records"])


def test_create_rejects_incompatible_capability(monkeypatch):
    from fastapi import HTTPException
    proxies = [
        {"id": "servo-1", "service_meta_id": "servo@1.0.0", "service_config": {}},
        {"id": "clock-1", "service_meta_id": "clock@1.0.0", "service_config": {}},
    ]
    metas = {
        "servo@1.0.0": {"id": "servo@1.0.0", "requires": ["servo_controller"]},
        "clock@1.0.0": {"id": "clock@1.0.0", "implements": []},
    }
    _patch(monkeypatch, proxies, metas=metas)
    with pytest.raises(HTTPException) as exc:
        link_service.process_link_request(
            {"action": "create", "source_proxy_id": "servo-1", "target_proxy_id": "clock-1"}, None, None)
    assert exc.value.status_code == 400


def test_create_rejects_channel_based_consumer(monkeypatch):
    from fastapi import HTTPException
    proxies = [
        {"id": "motor-control-1", "service_meta_id": "motor_control@1.0.0",
         "service_config": {"channels": []}},
        {"id": "sabertooth-1", "service_meta_id": "sabertooth@1.0.0", "service_config": {}},
    ]
    metas = {
        "motor_control@1.0.0": {"id": "motor_control@1.0.0", "requires": ["motor_controller"]},
        "sabertooth@1.0.0": {"id": "sabertooth@1.0.0", "implements": ["motor_controller"]},
    }
    _patch(monkeypatch, proxies, metas=metas)
    with pytest.raises(HTTPException) as exc:
        link_service.process_link_request(
            {"action": "create", "source_proxy_id": "motor-control-1", "target_proxy_id": "sabertooth-1"}, None, None)
    assert exc.value.status_code == 400
    assert "panel" in str(exc.value.detail)


def test_delete_capability_clears_top_level(monkeypatch):
    proxies = [
        {"id": "servo-1", "service_meta_id": "servo@1.0.0",
         "service_config": {"controller_type": "arduino", "controller_id": "arduino-1", "attached": True, "pin": 9}},
        {"id": "arduino-1", "service_meta_id": "arduino@1.0.0", "service_config": {}},
    ]
    db = _patch(monkeypatch, proxies)
    res = link_service.process_link_request(
        {"action": "delete", "kind": "capability", "source_proxy_id": "servo-1", "target_proxy_id": "arduino-1"},
        None, None)
    assert res["metadata"]["cleared"] is True
    cfg = db.get_item("service_proxy", "servo-1")["service_config"]
    assert cfg["controller_id"] is None and cfg["controller_type"] is None
    assert cfg["attached"] is False
    assert cfg["pin"] == 9   # unrelated fields untouched


def test_delete_input_clears_channel_source(monkeypatch):
    proxies = [
        {"id": "joystick-1", "service_meta_id": "joystick@1.0.0", "service_config": {}},
        {"id": "motor-control-1", "service_meta_id": "motor_control@1.0.0", "service_config": {
            "channels": [
                {"id": "left", "input_source": {"topic": "/joystick/joystick-1/input", "field": "axes", "index": 1}},
                {"id": "right", "input_source": {"topic": "/joystick/joystick-1/input", "field": "axes", "index": 3}},
            ],
        }},
    ]
    db = _patch(monkeypatch, proxies)
    res = link_service.process_link_request(
        {"action": "delete", "kind": "input", "source_proxy_id": "joystick-1",
         "target_proxy_id": "motor-control-1", "source_topic": "/joystick/joystick-1/input", "target_sink": "left"},
        None, None)
    assert res["metadata"]["cleared"] is True
    channels = db.get_item("service_proxy", "motor-control-1")["service_config"]["channels"]
    by_id = {c["id"]: c for c in channels}
    assert by_id["left"]["input_source"] is None     # only the named channel cleared
    assert by_id["right"]["input_source"] is not None


def test_unknown_action_400(monkeypatch):
    from fastapi import HTTPException
    _patch(monkeypatch, [{"id": "a", "service_config": {}}, {"id": "b", "service_config": {}}])
    with pytest.raises(HTTPException) as exc:
        link_service.process_link_request(
            {"action": "bogus", "source_proxy_id": "a", "target_proxy_id": "b"}, None, None)
    assert exc.value.status_code == 400
