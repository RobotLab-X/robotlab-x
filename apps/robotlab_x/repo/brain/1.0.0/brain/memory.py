# unmanaged
"""Markdown-backed memory store.

v1 keeps everything human-readable + diffable. Three default files:

  observations.md   — append-only running log of what the brain saw
  known_objects.md  — facts about specific objects the brain encountered
  task_history.md   — completed workflows + their outcomes

Each kind maps to a file under ``<workspace>/memory/``. The
``write_memory`` action exposed on the brain's /control topic is
the only public writer; reading is just "open the file" — exposed
via the brain's context_loader when a workflow lists the file in
its ``context:`` field.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict


logger = logging.getLogger(__name__)


_KIND_TO_FILENAME: Dict[str, str] = {
    "observations": "observations.md",
    "known_objects": "known_objects.md",
    "task_history": "task_history.md",
}


def _safe_kind(kind: str) -> str:
    """Reduce a kind name to alnum + underscores, max 64 chars. Lets
    workflows define their own memory files (kind='room_layout' →
    room_layout.md) without opening up path traversal."""
    cleaned = re.sub(r"[^A-Za-z0-9_]", "_", kind)[:64].strip("_")
    if not cleaned:
        raise ValueError(f"invalid memory kind: {kind!r}")
    return cleaned


def memory_path(workspace_dir: Path, kind: str) -> Path:
    fname = _KIND_TO_FILENAME.get(kind) or f"{_safe_kind(kind)}.md"
    return workspace_dir / "memory" / fname


def write_observation(workspace_dir: Path, kind: str, content: str) -> Path:
    """Append a timestamped entry to ``<workspace>/memory/<kind>.md``.

    Each entry is rendered as:
        ## 2026-05-31T12:34:56+00:00
        <content>

    Idempotent on identical (kind, content) — duplicates ARE written;
    the brain favours not deduping over silently swallowing repeats.
    """
    out = memory_path(workspace_dir, kind)
    out.parent.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).isoformat()
    block = f"## {ts}\n{content.rstrip()}\n\n"
    with open(out, "a") as f:
        f.write(block)
    logger.info("memory: appended %d bytes to %s", len(block), out)
    return out


def read_memory(workspace_dir: Path, kind: str) -> str:
    """Return the raw markdown for one kind, or empty string if absent."""
    p = memory_path(workspace_dir, kind)
    if not p.is_file():
        return ""
    return p.read_text()
