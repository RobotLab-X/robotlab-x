# unmanaged
"""Subprocess methods-manifest flow.

A subprocess service can't be Python-introspected from the backend, so
it publishes a retained manifest on /service_proxy/{id}/methods. The
discovery listener caches it (manifest_cache) and SubprocessAdapter reads
it back so the topology view shows the same publishes + methods as an
in-process service.

These cover the backend half end-to-end at the unit level:
  discovery._handle_methods_manifest  → manifest_cache  → SubprocessAdapter
"""
from __future__ import annotations

import pytest

from robotlab_x.runtime import discovery, manifest_cache
from robotlab_x.framework.adapters.subprocess import SubprocessAdapter
from robotlab_x.framework.adapter import ServiceHandle


SAMPLE = {
    "proxy_id": "joystick-1",
    "type_name": "joystick",
    "transport": "subprocess",
    "class_publishes": ["state", "input"],
    "methods": [
        {"name": "attach", "doc": "open device", "publishes": ["state", "input"], "publish_return": None},
        {"name": "detach", "doc": None, "publishes": ["state"], "publish_return": "last"},
    ],
}


@pytest.fixture(autouse=True)
def _clean_cache():
    manifest_cache.remove("joystick-1")
    yield
    manifest_cache.remove("joystick-1")


def _handle(handle_id: str = "joystick-1") -> ServiceHandle:
    return ServiceHandle(
        proxy_id=handle_id, transport="subprocess", pid=123, host="127.0.0.1",
        port=None, payload={"meta_id": "joystick@1.0.0"},
    )


# ─── discovery handler → cache ───────────────────────────────────────


def test_handler_caches_manifest():
    discovery._handle_methods_manifest("/service_proxy/joystick-1/methods", SAMPLE)
    cached = manifest_cache.get("joystick-1")
    assert cached is not None
    assert cached["type_name"] == "joystick"
    assert cached["class_publishes"] == ["state", "input"]
    assert len(cached["methods"]) == 2


def test_handler_none_payload_evicts():
    manifest_cache.put("joystick-1", SAMPLE)  # type: ignore[arg-type]
    discovery._handle_methods_manifest("/service_proxy/joystick-1/methods", None)
    assert manifest_cache.get("joystick-1") is None


def test_handler_ignores_wrong_topic_tail():
    discovery._handle_methods_manifest("/service_proxy/joystick-1/hello", SAMPLE)
    assert manifest_cache.get("joystick-1") is None


# ─── cache → adapter ─────────────────────────────────────────────────


def test_adapter_methods_from_cache():
    manifest_cache.put("joystick-1", SAMPLE)  # type: ignore[arg-type]
    infos = SubprocessAdapter().methods(_handle())
    names = {m.name: m for m in infos}
    assert set(names) == {"attach", "detach"}
    assert names["attach"].publishes == ["state", "input"]
    assert names["detach"].publish_return == "last"


def test_adapter_class_publishes_from_cache():
    manifest_cache.put("joystick-1", SAMPLE)  # type: ignore[arg-type]
    assert SubprocessAdapter().class_publishes(_handle()) == ["state", "input"]


def test_adapter_type_name_from_cache():
    manifest_cache.put("joystick-1", SAMPLE)  # type: ignore[arg-type]
    assert SubprocessAdapter().type_name(_handle()) == "joystick"


def test_adapter_empty_before_manifest_arrives():
    # No manifest cached yet (just after start) → empty, not a crash.
    assert SubprocessAdapter().methods(_handle()) == []
    assert SubprocessAdapter().class_publishes(_handle()) == []


def test_adapter_type_name_falls_back_to_meta_id():
    # type_name resolvable from the handle's meta_id even with no manifest,
    # so topic resolution works in the brief pre-manifest window.
    assert SubprocessAdapter().type_name(_handle()) == "joystick"
