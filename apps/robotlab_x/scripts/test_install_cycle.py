#!/usr/bin/env python3
"""Dev smoke test for the type install/uninstall lifecycle.

Validates install → uninstall → install against a LIVE robotlab_x runtime
over the REST API, for a bundled pip service. Offline + repeatable: no
remote registry needed — bundled services install from their on-disk
``-e`` spec, and uninstall only drops the per-type ``.venv`` (the source
stays), so this round-trips cleanly in default dev mode.

At each step it asserts BOTH the API state (install_phase) AND the on-disk
``.venv``, so a regression that wedges the catalog or leaves a stale venv
is caught.

Usage:
    python scripts/test_install_cycle.py \
        --base http://localhost:8998 \
        --user <email> --password <pw> \
        --service echo_http --version 1.0.0

Creds default to env RLX_USER / RLX_PASS. Exits 0 on PASS, 1 on failure.
Pick a service with NO dependents (echo_http, cron, serial) — not arduino
(other services use it as a servo_controller) and not one that's running.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1] / "repo"


def _api(base: str, token: str | None, method: str, path: str, body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(base + path, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
    return json.loads(raw) if raw else {}


def _login(base: str, user: str, pw: str) -> str:
    return _api(base, None, "POST", "/v1/login", {"username": user, "password": pw})["access_token"]


def _meta_row(base: str, token: str, mid: str) -> dict | None:
    rows = _api(base, token, "GET", "/v1/service-meta-list")
    for r in rows or []:
        if r.get("id") == mid:
            return r
    return None


def _venv_dir(name: str, version: str) -> Path:
    return REPO / name / version / ".venv"


def _wait(base, token, mid, want_installed: bool, timeout=180) -> dict:
    """Poll the catalog until install_phase settles. Returns the row."""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        row = _meta_row(base, token, mid) or {}
        last = row
        phase = row.get("install_phase")
        installed = bool(row.get("installed"))
        if want_installed and (phase == "installed" or installed):
            return row
        if (not want_installed) and phase in ("loaded", "uninstalled") and not installed:
            return row
        if phase == "failed":
            raise SystemExit(f"FAIL: install of {mid} reported phase=failed: {row.get('install_error')}")
        time.sleep(1.5)
    raise SystemExit(f"FAIL: timed out waiting for {mid} installed={want_installed}; last={last}")


def _check(label: str, cond: bool, detail: str = "") -> None:
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}{(' — ' + detail) if detail else ''}")
    if not cond:
        sys.exit(1)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.environ.get("RLX_BASE", "http://localhost:8998"))
    ap.add_argument("--user", default=os.environ.get("RLX_USER", ""))
    ap.add_argument("--password", default=os.environ.get("RLX_PASS", ""))
    ap.add_argument("--service", default="echo_http")
    ap.add_argument("--version", default="1.0.0")
    args = ap.parse_args()
    if not args.user or not args.password:
        print("Provide --user/--password (or RLX_USER/RLX_PASS).", file=sys.stderr)
        return 2

    name, version, mid = args.service, args.version, f"{args.service}@{args.version}"
    venv = _venv_dir(name, version)
    print(f"== install-cycle test: {mid} @ {args.base} ==")

    try:
        token = _login(args.base, args.user, args.password)
    except urllib.error.HTTPError as e:
        print(f"login failed: HTTP {e.code} {e.read()[:120]!r}", file=sys.stderr)
        return 2

    row = _meta_row(args.base, token, mid)
    _check(f"{mid} is in the catalog", row is not None)
    _check(f"{mid} is pip-based (venv lifecycle)", (row or {}).get("dependency_manager") == "pip",
           f"dependency_manager={(row or {}).get('dependency_manager')}")

    # Ensure a known starting point: installed.
    if (row or {}).get("install_phase") != "installed":
        print("- pre-step: installing to a known baseline")
        _api(args.base, token, "POST", "/v1/registry/install", {"name": name, "version": version})
        _wait(args.base, token, mid, want_installed=True)

    # 1) UNINSTALL → venv gone, source + catalog row stay.
    print("- uninstall")
    _api(args.base, token, "POST", "/v1/registry/uninstall", {"name": name, "version": version})
    _wait(args.base, token, mid, want_installed=False)
    _check("venv removed", not venv.exists(), str(venv))
    _check("source preserved", (REPO / name / version / "package.yml").exists())
    _check("catalog row preserved", _meta_row(args.base, token, mid) is not None)

    # 2) INSTALL → venv rebuilt, phase installed.
    print("- install")
    _api(args.base, token, "POST", "/v1/registry/install", {"name": name, "version": version})
    _wait(args.base, token, mid, want_installed=True)
    _check("venv rebuilt", venv.exists(), str(venv))

    # 3) INSTALL again is idempotent (re-install over an installed type).
    print("- re-install (idempotent)")
    _api(args.base, token, "POST", "/v1/registry/install", {"name": name, "version": version})
    _wait(args.base, token, mid, want_installed=True)
    _check("still installed + venv present", venv.exists())

    # Catalog still healthy (the wedge symptom: empty catalog).
    rows = _api(args.base, token, "GET", "/v1/service-meta-list")
    _check("catalog still populated", len(rows or []) > 1, f"{len(rows or [])} entries")

    print("== PASS ==")
    return 0


if __name__ == "__main__":
    sys.exit(main())
