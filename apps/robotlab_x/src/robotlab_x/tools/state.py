# unmanaged
"""Dump robotlab_x's actual state.

Used in two ways:

  * CLI: ``python -m robotlab_x.tools.state`` prints a human report.
  * HTTP: the ``/v1/admin/state`` endpoint and the in-UI admin page
    both call ``gather_state()`` to get the same data as a dict.

Read-only. The split lets the UI report and the CLI report stay in
lockstep — there's a single function that knows what "state" looks like.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional


# ─── pure data gathering (used by CLI + /v1/admin/state) ──────────────
def _app_dir() -> Path:
    """The robotlab_x app directory (where data/databases lives).

    When running under uvicorn / the live backend, cwd may be the app
    root already. The tools were originally run as a script; computing
    from __file__ stays correct in both contexts.
    """
    here = Path(__file__).resolve()
    # tools/state.py → tools/ → robotlab_x/ → src/ → robotlab_x/ (app)
    return here.parents[3]


def _load_table(name: str) -> Dict[str, Dict[str, Any]]:
    path = _app_dir() / "data" / "databases" / f"{name}.json"
    if not path.is_file():
        return {}
    try:
        return json.load(open(path)).get("_default", {})
    except json.JSONDecodeError:
        return {}


def pid_alive(pid: Any) -> bool:
    """Cheap kernel-level liveness check. Mirrors process_manager.pid_alive
    but importable without the runtime stack (handy for tests + CLI use)."""
    if not isinstance(pid, int) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def _scan_processes() -> List[Dict[str, Any]]:
    """Find robotlab_x / arduino_service / echo_http subprocesses via /proc.

    Returns dicts with {pid, argv}. Subprocesses are flagged elsewhere as
    "orphan" if no service_proxy row points at their pid.
    """
    out: List[Dict[str, Any]] = []
    proc = Path("/proc")
    if not proc.is_dir():
        return out
    for entry in proc.iterdir():
        if not entry.name.isdigit():
            continue
        pid = int(entry.name)
        try:
            cmdline = (entry / "cmdline").read_bytes().decode("utf-8", "replace")
        except (OSError, PermissionError):
            continue
        if not cmdline:
            continue
        args = [a for a in cmdline.split("\x00") if a]
        joined = " ".join(args)
        if (
            "robotlab_x.main" in joined
            or "arduino_service" in joined
            or "echo_http" in joined
        ):
            out.append({"pid": pid, "argv": args})
    return out


def gather_state() -> Dict[str, Any]:
    """Snapshot of everything the reconciler + admin UI care about.

    Shape::

        {
          "proxies": [
            {
              "id": str, "status": str, "pid": int|None, "host": str|None,
              "port": int|None, "service_meta_id": str, "error": str|None,
              "pid_alive": bool,
              "warnings": list[str],   # human-readable inconsistency flags
            }, ...
          ],
          "workspaces": [
            {
              "id": str, "kind": str, "members_stored": int,
              "members_computed": bool, "positions": int, "view_types": int,
              "edges": int,
              "orphans": {
                "members": [...], "positions": [...],
                "view_types": [...], "edges": [...]
              },
            }, ...
          ],
          "processes": [
            {"pid": int, "argv": list[str], "orphan": bool}, ...
          ],
          "summary": {
            "proxies": int,
            "workspaces": int,
            "processes": int,
            "drift_warnings": int,
          }
        }
    """
    proxy_rows = _load_table("service_proxy")
    workspace_rows = _load_table("workspace")
    processes = _scan_processes()

    proxy_ids: set[str] = {v.get("id") for v in proxy_rows.values() if v.get("id")}
    proxy_pids: set[int] = {
        v.get("pid") for v in proxy_rows.values()
        if isinstance(v.get("pid"), int)
    }

    drift_warnings = 0

    proxies: List[Dict[str, Any]] = []
    for v in sorted(proxy_rows.values(), key=lambda r: r.get("id") or ""):
        warnings: List[str] = []
        status = v.get("status") or "?"
        pid = v.get("pid")
        alive = pid_alive(pid) if pid else False

        if status in {"running", "starting"} and pid and not alive:
            warnings.append("pid not alive but status claims running")
            drift_warnings += 1
        elif status not in {"running", "starting"} and pid_alive(pid):
            warnings.append("pid alive but status not running")
            drift_warnings += 1

        proxies.append({
            "id": v.get("id"),
            "status": status,
            "pid": pid,
            "host": v.get("host"),
            "port": v.get("port"),
            "service_meta_id": v.get("service_meta_id"),
            "error": v.get("error"),
            "pid_alive": alive,
            "warnings": warnings,
        })

    workspaces: List[Dict[str, Any]] = []
    for ws in sorted(workspace_rows.values(), key=lambda w: w.get("id") or ""):
        ws_id = ws.get("id")
        kind = ws.get("kind") or "user"
        members = list(ws.get("service_proxy_ids") or [])
        positions = ws.get("node_positions") or {}
        view_types = ws.get("node_view_types") or {}
        edges = list(ws.get("edges") or [])

        ref_pos = list(positions.keys()) if isinstance(positions, dict) else []
        ref_view = list(view_types.keys()) if isinstance(view_types, dict) else []
        ref_edge: List[str] = []
        for e in edges:
            if isinstance(e, dict):
                for k in ("source", "target"):
                    if e.get(k):
                        ref_edge.append(e[k])

        orphans = {
            "members": [p for p in members if p not in proxy_ids] if kind == "user" else [],
            "positions": [p for p in ref_pos if p not in proxy_ids],
            "view_types": [p for p in ref_view if p not in proxy_ids],
            "edges": list({p for p in ref_edge if p not in proxy_ids}),
        }
        if any(orphans.values()):
            drift_warnings += sum(len(v) for v in orphans.values())

        workspaces.append({
            "id": ws_id,
            "kind": kind,
            "members_stored": len(members),
            "members_computed": kind == "runtime",
            "positions": len(ref_pos),
            "view_types": len(ref_view),
            "edges": len(edges),
            "orphans": orphans,
        })

    process_rows: List[Dict[str, Any]] = []
    for p in sorted(processes, key=lambda x: x["pid"]):
        joined = " ".join(p["argv"])
        # Backend (robotlab_x.main) is its own process; subprocesses
        # SHOULD be referenced by a proxy row's pid.
        is_backend = "robotlab_x.main" in joined
        orphan = (not is_backend) and (p["pid"] not in proxy_pids)
        if orphan:
            drift_warnings += 1
        process_rows.append({
            "pid": p["pid"],
            "argv": p["argv"],
            "is_backend": is_backend,
            "orphan": orphan,
        })

    return {
        "proxies": proxies,
        "workspaces": workspaces,
        "processes": process_rows,
        "summary": {
            "proxies": len(proxies),
            "workspaces": len(workspaces),
            "processes": len(process_rows),
            "drift_warnings": drift_warnings,
        },
    }


# ─── CLI presentation ────────────────────────────────────────────────
_USE_COLOUR = sys.stdout.isatty()


def _c(code: str, s: str) -> str:
    if not _USE_COLOUR:
        return s
    return f"\033[{code}m{s}\033[0m"


def red(s: str) -> str: return _c("31", s)
def yellow(s: str) -> str: return _c("33", s)
def green(s: str) -> str: return _c("32", s)
def grey(s: str) -> str: return _c("90", s)
def bold(s: str) -> str: return _c("1", s)


def _print_proxies(proxies: List[Dict[str, Any]], focus: Optional[str] = None) -> None:
    print(bold("service_proxy" + (f" (focus: {focus})" if focus else "")))
    print("-" * 72)
    rows = proxies if not focus else [p for p in proxies if p.get("id") == focus]
    if not rows:
        print(grey("  (no rows)"))
        print()
        return
    for p in rows:
        status_render = (
            green(p["status"]) if p["status"] == "running"
            else red(p["status"]) if p["status"] == "error"
            else yellow(p["status"])
        )
        pid = p["pid"] if p["pid"] else grey("—")
        port = p["port"] if p["port"] else grey("—")
        warns = "  " + red(" ⚠ " + " · ".join(p["warnings"])) if p["warnings"] else ""
        print(
            f"  {bold(p['id'] or '?'):30}"
            f"  status={status_render}"
            f"  pid={pid}"
            f"  host={p['host'] or grey('—')}"
            f"  port={port}"
            f"  meta={grey(str(p['service_meta_id'] or '—'))}"
            f"{warns}"
        )
        if p.get("error"):
            print(f"      {red('error')}: {p['error']}")
    print()


def _print_workspaces(workspaces: List[Dict[str, Any]]) -> None:
    print(bold("workspaces — referential integrity"))
    print("-" * 72)
    if not workspaces:
        print(grey("  (no workspaces)"))
        print()
        return
    any_orphans = False
    for ws in workspaces:
        members_str = (
            grey("computed") if ws["members_computed"]
            else str(ws["members_stored"])
        )
        print(
            f"  {bold(ws['id'] or '?'):20}  kind={ws['kind']}"
            f"  members={members_str}"
            f"  positions={ws['positions']}"
            f"  view_types={ws['view_types']}"
            f"  edges={ws['edges']}"
        )
        for kind in ("members", "positions", "view_types", "edges"):
            orphans = ws["orphans"].get(kind) or []
            if orphans:
                any_orphans = True
                print(f"      {red('orphan ' + kind)}: {orphans}")
    if not any_orphans:
        print(grey("  (all references resolve)"))
    print()


def _print_processes(processes: List[Dict[str, Any]]) -> None:
    print(bold("processes"))
    print("-" * 72)
    if not processes:
        print(grey("  (none found)"))
        print()
        return
    for p in processes:
        argv = " ".join(p["argv"])
        if len(argv) > 80:
            argv = argv[:77] + "..."
        flag = red("  ⚠ orphan (alive but no service_proxy row)") if p["orphan"] else ""
        print(f"  pid={p['pid']:8}  {argv}{flag}")
    print()


def render(state: Dict[str, Any], focus: Optional[str] = None, orphans_only: bool = False) -> None:
    if not orphans_only:
        _print_proxies(state["proxies"], focus=focus)
        _print_workspaces(state["workspaces"])
        _print_processes(state["processes"])
    else:
        _print_workspaces(state["workspaces"])
        bad = [p for p in state["proxies"] if p["warnings"]]
        if bad:
            print(bold("service_proxy rows with status/pid mismatch"))
            print("-" * 72)
            _print_proxies(bad)
    summary = state["summary"]
    print(grey(
        f"summary: proxies={summary['proxies']} workspaces={summary['workspaces']} "
        f"processes={summary['processes']} drift_warnings={summary['drift_warnings']}"
    ))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--orphans", action="store_true", help="print only inconsistencies")
    parser.add_argument("--proxy", metavar="PROXY_ID", help="focus the proxy section")
    parser.add_argument("--json", action="store_true", help="print structured JSON instead of human report")
    args = parser.parse_args()
    state = gather_state()
    if args.json:
        json.dump(state, sys.stdout, indent=2, default=str)
        sys.stdout.write("\n")
    else:
        render(state, focus=args.proxy, orphans_only=args.orphans)
    return 0


if __name__ == "__main__":
    sys.exit(main())
