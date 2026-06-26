# unmanaged
"""Phase D — multiple local repo roots + multiple remote registries.

Covers:
  * repo.repo_roots / writable_repo_dir / scan_repos / find_type_dir
    precedence (writable first, then config.repo_paths in order).
  * catalog.reconcile_catalog over several roots, tagging repo_root +
    install_phase per row.
  * registry.find_in_catalogs ordered fallback across registries.
  * registry.fetch_merged_catalog merge + skip-unreachable behaviour.

Mirrors tests/test_registry.py's inline-mirror + FakeDB approach so the
suite stays dependency-free.
"""
from __future__ import annotations

import hashlib
import io
import tarfile
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, Optional

import pytest
import yaml

from robotlab_x.runtime import catalog as catalog_mod
from robotlab_x.runtime import registry
from robotlab_x.runtime import repo as repo_mod


# ─── FakeDB (same shape as test_registry.py) ─────────────────────────

class FakeDB:
    def __init__(self) -> None:
        self.tables: Dict[str, Dict[str, Dict[str, Any]]] = {}

    def _t(self, name: str) -> Dict[str, Dict[str, Any]]:
        return self.tables.setdefault(name, {})

    def insert_item(self, table: str, key: str, item: Dict[str, Any]) -> None:
        self._t(table)[key] = dict(item)

    def update_item(self, table: str, key: str, item: Dict[str, Any], include_nulls: bool = False) -> None:
        self._t(table)[key] = dict(item)

    def get_item(self, table: str, key: str) -> Optional[Dict[str, Any]]:
        return self._t(table).get(key)

    def delete_item(self, table: str, key: str) -> None:
        self._t(table).pop(key, None)

    def get_all_items(self, table: str) -> list:
        return list(self._t(table).values())


# ─── helpers ─────────────────────────────────────────────────────────

def _settings(repo_dir: Path, repo_paths=None, registries=None):
    return SimpleNamespace(
        repo_dir=str(repo_dir),
        repo_paths=[str(p) for p in (repo_paths or [])],
        registries=[str(u) for u in (registries or [])],
        registry_url=None,
    )


def _write_builtin_service(root: Path, name: str, version: str = "1.0.0") -> Path:
    d = root / name / version
    d.mkdir(parents=True)
    (d / "package.yml").write_text(
        f"name: {name}\n"
        f"description: svc {name}\n"
        "language: builtin\n"
        "status: development\n"
        "install:\n  kind: builtin\n"
        "entry:\n  in_process:\n"
        f"    module: {name}\n"
        f"    class: {''.join(p.capitalize() for p in name.split('_'))}Service\n"
    )
    return d


def _catalog_dict(name: str, version: str, sha: str, archive: str) -> dict:
    return {
        "registry_version": 1,
        "services": [{
            "name": name, "description": f"svc {name}", "tags": [],
            "implements": [], "requires": [],
            "versions": [{"version": version, "archive": archive, "sha256": sha,
                          "language": "builtin", "install": {"kind": "builtin"}}],
        }],
    }


def _publish(mirror: Path, name: str, version: str) -> Path:
    """Write a one-service catalog + archive into ``mirror``; return the
    catalog.yml path. Archive content is irrelevant for the catalog-
    lookup tests so we ship a tiny placeholder + its real sha."""
    svc_out = mirror / name
    svc_out.mkdir(parents=True)
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        info = tarfile.TarInfo(f"{name}/{version}/package.yml")
        payload = b"name: x\n"
        info.size = len(payload)
        tf.addfile(info, io.BytesIO(payload))
    data = buf.getvalue()
    archive = f"{name}/{name}-{version}.tar.gz"
    (mirror / archive).write_bytes(data)
    sha = hashlib.sha256(data).hexdigest()
    cat_path = mirror / "catalog.yml"
    cat_path.write_text(yaml.safe_dump(_catalog_dict(name, version, sha, archive)))
    return cat_path


# ─── repo_roots / scan_repos / find_type_dir ─────────────────────────

def test_repo_roots_writable_first_then_repo_paths(tmp_path):
    writable = tmp_path / "writable"
    extra1 = tmp_path / "public"
    extra2 = tmp_path / "private"
    for d in (writable, extra1, extra2):
        d.mkdir()
    roots = repo_mod.repo_roots(_settings(writable, [extra1, extra2]))
    assert roots == [writable.resolve(), extra1.resolve(), extra2.resolve()]


def test_repo_roots_dev_default_is_single(tmp_path):
    writable = tmp_path / "repo"
    writable.mkdir()
    assert repo_mod.repo_roots(_settings(writable)) == [writable.resolve()]


def test_scan_repos_first_root_shadows_later(tmp_path):
    a = tmp_path / "a"
    b = tmp_path / "b"
    _write_builtin_service(a, "shared")   # same id in both roots
    _write_builtin_service(b, "shared")
    _write_builtin_service(b, "only_b")
    manifests = repo_mod.scan_repos([a, b])
    ids = sorted(m.id for m in manifests)
    assert ids == ["only_b@1.0.0", "shared@1.0.0"]
    shared = next(m for m in manifests if m.name == "shared")
    # First root (a) wins the shadow.
    assert repo_mod.root_of(shared) == a.resolve() or repo_mod.root_of(shared) == a


def test_find_type_dir_searches_all_roots(tmp_path):
    writable = tmp_path / "w"
    extra = tmp_path / "e"
    writable.mkdir()
    _write_builtin_service(extra, "only_extra")
    s = _settings(writable, [extra])
    found = repo_mod.find_type_dir(s, "only_extra", "1.0.0")
    assert found is not None and found == extra / "only_extra" / "1.0.0"
    assert repo_mod.find_type_dir(s, "nope", "1.0.0") is None


# ─── reconcile across roots ──────────────────────────────────────────

def test_reconcile_tags_repo_root_and_phase(tmp_path):
    writable = tmp_path / "w"
    extra = tmp_path / "e"
    _write_builtin_service(writable, "alpha")
    _write_builtin_service(extra, "beta")
    db = FakeDB()
    summary = catalog_mod.reconcile_catalog(db, [writable, extra])
    assert summary["found"] == 2
    alpha = db.get_item("service_meta", "alpha@1.0.0")
    beta = db.get_item("service_meta", "beta@1.0.0")
    assert Path(alpha["repo_root"]) == writable
    assert Path(beta["repo_root"]) == extra
    # builtins are installed-by-construction → install_phase 'installed'
    assert alpha["install_phase"] == "installed"
    assert beta["install_phase"] == "installed"


def test_reconcile_single_path_backcompat(tmp_path):
    writable = tmp_path / "w"
    _write_builtin_service(writable, "alpha")
    db = FakeDB()
    # Passing a single Path (legacy callers) must still work.
    summary = catalog_mod.reconcile_catalog(db, writable)
    assert summary["found"] == 1
    assert db.get_item("service_meta", "alpha@1.0.0")["repo_root"] == str(writable.resolve()) \
        or db.get_item("service_meta", "alpha@1.0.0")["repo_root"] == str(writable)


# ─── multi-registry catalog search ───────────────────────────────────

def test_find_in_catalogs_ordered_fallback(tmp_path):
    m1 = tmp_path / "reg1"
    m2 = tmp_path / "reg2"
    _publish(m1, "in_first", "1.0.0")
    _publish(m2, "in_second", "1.0.0")
    urls = [f"file://{m1/'catalog.yml'}", f"file://{m2/'catalog.yml'}"]

    entry, serving = registry.find_in_catalogs(urls, "in_second", "1.0.0")
    assert entry["name"] == "in_second"
    assert serving == urls[1]  # came from the 2nd registry

    entry2, serving2 = registry.find_in_catalogs(urls, "in_first", "1.0.0")
    assert serving2 == urls[0]

    with pytest.raises(registry.NotInCatalogError):
        registry.find_in_catalogs(urls, "nowhere", "1.0.0")


def test_sideload_extracts_and_archives_processed(tmp_path):
    # Build a sideload archive containing svc_x/1.0.0/.
    name, version = "svc_x", "1.0.0"
    src = tmp_path / "src"
    _write_builtin_service(src, name)
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        type_dir = src / name / version
        for p in [type_dir, *sorted(type_dir.rglob("*"))]:
            tf.add(str(p), arcname=str(p.relative_to(src)))
    staging = tmp_path / "repo-staging"
    staging.mkdir()
    (staging / f"{name}-{version}.tar.gz").write_bytes(buf.getvalue())

    writable = tmp_path / "writable"
    writable.mkdir()
    db = FakeDB()
    summary = registry.sideload_dir(staging, repo_dir=writable, db=db)

    assert summary["loaded"] == [f"{name}@{version}"]
    # Extracted into the writable root.
    assert (writable / name / version / "package.yml").is_file()
    # service_meta row created by the post-sideload reconcile.
    assert db.get_item("service_meta", f"{name}@{version}") is not None
    # Archive moved aside so it won't re-extract next boot.
    assert not (staging / f"{name}-{version}.tar.gz").exists()
    assert (staging / "installed" / f"{name}-{version}.tar.gz").exists()


def test_effective_config_db_row_overrides_env(tmp_path):
    writable = tmp_path / "w"; writable.mkdir()
    extra_env = tmp_path / "env_extra"; extra_env.mkdir()
    extra_db = tmp_path / "db_extra"; extra_db.mkdir()
    settings = _settings(writable, repo_paths=[extra_env], registries=["file:///env.yml"])
    db = FakeDB()

    # No config row → env values apply.
    assert registry.effective_repo_paths(settings, db) == [str(extra_env)]
    assert registry.effective_registries(settings, db) == ["file:///env.yml"]

    # config/default row overrides both (user edited via UI).
    db.insert_item("config", "default", {
        "id": "default",
        "repo_paths": [str(extra_db)],
        "registries": ["file:///db1.yml", "file:///db2.yml"],
    })
    assert registry.effective_repo_paths(settings, db) == [str(extra_db)]
    assert registry.effective_registries(settings, db) == ["file:///db1.yml", "file:///db2.yml"]
    roots = registry.effective_repo_roots(settings, db)
    assert roots[0] == writable.resolve() and roots[1] == extra_db.resolve()


def test_effective_repo_paths_empty_db_list_honoured(tmp_path):
    writable = tmp_path / "w"; writable.mkdir()
    extra_env = tmp_path / "env_extra"; extra_env.mkdir()
    settings = _settings(writable, repo_paths=[extra_env])
    db = FakeDB()
    # User cleared the list → [] persisted → no extra roots (env ignored).
    db.insert_item("config", "default", {"id": "default", "repo_paths": []})
    assert registry.effective_repo_paths(settings, db) == []
    assert registry.effective_repo_roots(settings, db) == [writable.resolve()]


def test_lifecycle_install_copies_readonly_source_to_writable(tmp_path, monkeypatch):
    """Regression (s1 deploy): when repo_dir is a SEPARATE writable root and
    a pip type's source lives in a read-only repo_paths root (the image's
    bundled repo/), the lazy install-on-Start must copy the source into the
    writable root before building the venv — else pip installs an editable
    spec pointing at an empty dir and fails with exit 1."""
    from robotlab_x.runtime import lifecycle, installer

    # Read-only root with a pip-type source; writable root starts empty.
    ro = tmp_path / "bundled"
    src = ro / "widget_pip" / "1.0.0"
    src.mkdir(parents=True)
    (src / "package.yml").write_text("name: widget_pip\nlanguage: python\ninstall:\n  kind: pip\n")
    (src / "pyproject.toml").write_text("[project]\nname = 'widget_pip'\nversion = '1.0.0'\n")
    writable = tmp_path / "var" / "repo"
    writable.mkdir(parents=True)

    s = _settings(writable, repo_paths=[ro])
    monkeypatch.setattr(lifecycle, "get_settings", lambda: s)

    captured = {}
    def fake_install(manager, spec, slot, repo_dir, on_event=None):
        captured["spec"] = spec
        captured["repo_dir"] = str(repo_dir)
        (Path(repo_dir) / "widget_pip" / "1.0.0" / ".venv" / "bin").mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(installer, "install", fake_install)

    meta = {
        "id": "widget_pip@1.0.0", "name": "widget_pip", "version": "1.0.0",
        "dependency_manager": "pip",
        "package_spec": "-e ${APP_ROOT}/repo/widget_pip/1.0.0",
    }
    lifecycle._ensure_type_installed(meta, "req-1", db=None)

    # Source was copied into the writable root before the venv build…
    assert (writable / "widget_pip" / "1.0.0" / "package.yml").exists()
    assert (writable / "widget_pip" / "1.0.0" / "pyproject.toml").exists()
    # …the venv builds in the writable root…
    assert Path(captured["repo_dir"]).resolve() == writable.resolve()
    # …and the editable spec resolves to that writable copy (${APP_ROOT}/repo
    # == repo_dir since repo_dir's basename is 'repo').
    assert str((writable / "widget_pip" / "1.0.0")) in captured["spec"]


def test_sideload_missing_dir_is_noop(tmp_path):
    db = FakeDB()
    out = registry.sideload_dir(tmp_path / "nope", repo_dir=tmp_path / "w", db=db)
    assert out == {"loaded": [], "failed": []}


def test_find_repo_asset_resolves_across_readonly_root(tmp_path, monkeypatch):
    """Regression (s1 deploy 404): static repo assets (icon.svg,
    ui/dist/ui.js) ship in a type's bundle, which on a deploy lives in a
    READ-ONLY repo_paths root (the image's baked-in repo/) while repo_dir
    is a SEPARATE writable volume (var/repo). The /repo/<n>/<v>/{icon,ui.js}
    routes must search every effective root — resolving against repo_dir
    alone 404s the assets even though the catalog finds the type."""
    from robotlab_x.runtime import script_routes

    writable = tmp_path / "var" / "repo"   # empty writable root (the volume)
    writable.mkdir(parents=True)
    ro = tmp_path / "bundled"              # read-only image root with the bundle
    bundle = ro / "cli" / "1.0.0"
    (bundle / "ui" / "dist").mkdir(parents=True)
    (bundle / "icon.svg").write_text("<svg/>")
    (bundle / "ui" / "dist" / "ui.js").write_text("export default 1")

    s = _settings(writable, repo_paths=[ro])
    monkeypatch.setattr(script_routes, "get_settings", lambda: s)

    # Asset lives only in the read-only root → still resolved.
    icon = script_routes._find_repo_asset("cli", "1.0.0", ("icon.svg",), None)
    assert icon == (ro / "cli" / "1.0.0" / "icon.svg").resolve()
    uijs = script_routes._find_repo_asset("cli", "1.0.0", ("ui", "dist", "ui.js"), None)
    assert uijs == (ro / "cli" / "1.0.0" / "ui" / "dist" / "ui.js").resolve()

    # Missing asset → None (route turns this into a 404).
    assert script_routes._find_repo_asset("cli", "1.0.0", ("ui", "dist", "ui.css"), None) is None
    assert script_routes._find_repo_asset("nope", "1.0.0", ("icon.svg",), None) is None

    # Writable root shadows the read-only one (first match wins).
    (writable / "cli" / "1.0.0").mkdir(parents=True)
    (writable / "cli" / "1.0.0" / "icon.svg").write_text("<svg id='writable'/>")
    icon2 = script_routes._find_repo_asset("cli", "1.0.0", ("icon.svg",), None)
    assert icon2 == (writable / "cli" / "1.0.0" / "icon.svg").resolve()


def test_find_repo_asset_rejects_traversal(tmp_path, monkeypatch):
    """A bogus name/version segment 404s outright; a rel path can't escape
    a root even if it tries (the per-root relative_to guard)."""
    from fastapi import HTTPException

    from robotlab_x.runtime import script_routes

    writable = tmp_path / "w"; writable.mkdir()
    monkeypatch.setattr(script_routes, "get_settings", lambda: _settings(writable))

    with pytest.raises(HTTPException):
        script_routes._find_repo_asset("../etc", "1.0.0", ("icon.svg",), None)
    with pytest.raises(HTTPException):
        script_routes._find_repo_asset("cli", "../..", ("icon.svg",), None)


def test_fetch_merged_catalog_merges_and_skips_unreachable(tmp_path):
    m1 = tmp_path / "reg1"
    _publish(m1, "svc_a", "1.0.0")
    good = f"file://{m1/'catalog.yml'}"
    bad = f"file://{tmp_path/'missing'/'catalog.yml'}"

    merged = registry.fetch_merged_catalog([good, bad])
    names = {s["name"] for s in merged["services"]}
    assert names == {"svc_a"}

    # All-unreachable → CatalogError.
    with pytest.raises(registry.CatalogError):
        registry.fetch_merged_catalog([bad])
