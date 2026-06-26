"""Manifest → service_meta mapping for the install-wizard fields (M3)."""
from __future__ import annotations

import textwrap
from pathlib import Path

from robotlab_x.runtime import repo


def _write(tmp_path: Path, body: str) -> Path:
    d = tmp_path / "demo" / "1.0.0"
    d.mkdir(parents=True)
    p = d / "package.yml"
    p.write_text(textwrap.dedent(body))
    return p


def test_license_and_wizard_install_flow_into_meta(tmp_path):
    p = _write(tmp_path, """
        name: demo
        language: python
        install:
          kind: pip
          package_spec: "-e ./x"
        entry:
          argv: [python, -m, demo]
        license: |
          Accept me before installing.
        wizard_install:
          - id: caps
            title: Capabilities
            fields:
              - id: enable_extra
                type: boolean
                default: false
    """)
    m = repo._parse_manifest(p, "demo", "1.0.0")
    assert m is not None
    meta = repo.manifest_to_service_meta(m)

    assert meta["license"].startswith("Accept me")
    assert meta["wizard_steps"][0]["id"] == "caps"
    assert meta["wizard_steps"][0]["fields"][0]["id"] == "enable_extra"


def test_no_license_maps_to_none(tmp_path):
    p = _write(tmp_path, """
        name: demo
        language: builtin
        install:
          kind: builtin
        entry:
          in_process:
            module: demo
            class: Demo
    """)
    m = repo._parse_manifest(p, "demo", "1.0.0")
    meta = repo.manifest_to_service_meta(m)
    assert meta["license"] is None
    assert meta["wizard_steps"] is None


def test_title_flows_into_meta_when_set(tmp_path):
    p = _write(tmp_path, """
        name: demo
        title: Demo Service (Friendly)
        language: builtin
        install:
          kind: builtin
    """)
    m = repo._parse_manifest(p, "demo", "1.0.0")
    assert m.title == "Demo Service (Friendly)"
    assert repo.manifest_to_service_meta(m)["title"] == "Demo Service (Friendly)"


def test_title_absent_or_blank_maps_to_none(tmp_path):
    # No title key at all.
    p = _write(tmp_path, """
        name: demo
        language: builtin
        install:
          kind: builtin
    """)
    m = repo._parse_manifest(p, "demo", "1.0.0")
    assert m.title is None
    assert repo.manifest_to_service_meta(m)["title"] is None

    # Present but whitespace-only → normalised to None so the UI falls
    # back to the type name rather than rendering an empty heading.
    p2 = _write(tmp_path / "blank", """
        name: demo
        title: "   "
        language: builtin
        install:
          kind: builtin
    """)
    m2 = repo._parse_manifest(p2, "demo", "1.0.0")
    assert m2.title is None
