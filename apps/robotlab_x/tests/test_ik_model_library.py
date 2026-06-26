# unmanaged
"""ik_solver Model Library (models_lib) tests.

Loads ``models_lib.py`` directly (it depends only on pydantic, not the
numpy/scipy solver), so it runs in the top-level test venv without the
service's own deps. Covers schema, two-root resolution, user-shadows-
bundled, save/load round-trip, and read-only bundled examples.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

_MODELS_LIB = (
    Path(__file__).resolve().parents[1]
    / "repo" / "ik_solver" / "1.0.0" / "src" / "ik_solver_service" / "models_lib.py"
)


def _load_models_lib():
    name = "ik_models_lib_under_test"
    spec = importlib.util.spec_from_file_location(name, _MODELS_LIB)
    mod = importlib.util.module_from_spec(spec)
    # Register before exec so pydantic can resolve the module's annotations
    # (the module uses `from __future__ import annotations`).
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture()
def lib(tmp_path, monkeypatch):
    """models_lib wired to tmp bundled + user roots."""
    mod = _load_models_lib()
    bundled = tmp_path / "bundled"
    user = tmp_path / "data" / "ik_solver" / "models"
    bundled.mkdir(parents=True)
    monkeypatch.setattr(mod, "bundled_dir", lambda: bundled)
    monkeypatch.setenv("ROBOTLAB_X_DATA_DIR_ABS", str(tmp_path / "data"))
    return mod, bundled, user


def _write(d: Path, model_id: str, title: str) -> None:
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{model_id}.json").write_text(json.dumps({
        "schema_version": 1, "id": model_id, "title": title,
        "ik_model": {"joints": [{"name": "base"}], "links": []},
        "poses": [{"name": "home", "is_initial": True, "angles": {"base": 0}}],
    }))


def test_robotmodel_initial_pose():
    mod = _load_models_lib()
    m = mod.RobotModel(id="t", poses=[
        {"name": "a", "angles": {}},
        {"name": "home", "is_initial": True, "angles": {"base": 5}},
    ])
    assert m.initial_pose().name == "home"
    # falls back to first when none flagged
    m2 = mod.RobotModel(id="t", poses=[{"name": "a", "angles": {}}])
    assert m2.initial_pose().name == "a"
    assert mod.RobotModel(id="t").initial_pose() is None


def test_save_load_round_trip(lib):
    mod, _bundled, _user = lib
    m = mod.RobotModel(id="my_arm", title="My Arm",
                       ik_model={"joints": [{"name": "base"}], "links": []})
    path = mod.save(m)
    assert path.is_file()
    loaded = mod.load("my_arm")
    assert loaded.id == "my_arm" and loaded.title == "My Arm"


def test_list_merges_user_shadows_bundled(lib):
    mod, bundled, user = lib
    _write(bundled, "inmoov_right_arm", "InMoov — Right Arm (bundled)")
    _write(bundled, "demo_arm", "Demo")
    _write(user, "inmoov_right_arm", "InMoov — Right Arm (my edit)")
    rows = {r["id"]: r for r in mod.list_models()}
    assert set(rows) == {"inmoov_right_arm", "demo_arm"}
    # user shadows bundled by id
    assert rows["inmoov_right_arm"]["root"] == "user"
    assert rows["inmoov_right_arm"]["title"] == "InMoov — Right Arm (my edit)"
    assert rows["demo_arm"]["root"] == "bundled"


def test_load_prefers_user_then_bundled(lib):
    mod, bundled, user = lib
    _write(bundled, "x", "bundled-x")
    assert mod.load("x").title == "bundled-x"
    _write(user, "x", "user-x")
    assert mod.load("x").title == "user-x"


def test_delete_user_only(lib):
    mod, bundled, user = lib
    _write(bundled, "ex", "bundled example")
    _write(user, "mine", "user model")
    assert mod.delete("mine") is True
    assert mod.delete("ex") is False          # bundled untouched
    assert (bundled / "ex.json").is_file()    # still there
    assert mod.load("ex").title == "bundled example"


def test_invalid_id_rejected(lib):
    mod, _bundled, _user = lib
    for bad in ("../etc", "a/b", ""):
        with pytest.raises(ValueError):
            mod.load(bad)


def test_missing_model_raises(lib):
    mod, _bundled, _user = lib
    with pytest.raises(FileNotFoundError):
        mod.load("nope")


def test_shipped_examples_are_valid():
    """The committed bundled examples (InMoov arms) must parse as
    RobotModel with positive-length links so load_model -> set_model
    (LinkSpec gt=0) succeeds."""
    mod = _load_models_lib()
    ex_dir = mod.bundled_dir()
    files = sorted(ex_dir.glob("*.json"))
    assert files, f"no bundled examples in {ex_dir}"
    for f in files:
        m = mod.RobotModel(**json.loads(f.read_text()))
        assert m.id and m.title, f"{f.name} missing id/title"
        joints = m.ik_model.get("joints", [])
        links = m.ik_model.get("links", [])
        assert joints, f"{f.name} has no joints"
        assert len(links) == len(joints) - 1, f"{f.name} link count != joints-1"
        for l in links:
            assert l["length_mm"] > 0, f"{f.name} has a non-positive link length"
        assert m.chain, f"{f.name} missing rich chain"
