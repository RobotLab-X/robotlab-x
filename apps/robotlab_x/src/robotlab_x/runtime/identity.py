# unmanaged
"""Runtime identity — one human-memorable name per runtime process.

The id is generated once and persisted to ``<data_dir>/runtime_id``
(plain text, single line). On every boot the file is read; if missing,
a fresh ``adjective-robotnoun`` pair is picked and written. The id is
also mirrored into the ``runtime`` service_proxy row's
``service_config.runtime_id`` so the API + UI can read it without
touching the bus.

Override paths, in priority order:

  1. ``RLX_RUNTIME_ID`` environment variable
  2. ``ROBOTLAB_X_RUNTIME_ID`` in ``.env`` (via pydantic settings) —
     the standard ``ROBOTLAB_X_*`` knob, surfaced as
     ``settings.runtime_id`` and threaded into ``get_runtime_id``
     from ``event_handlers.on_startup``
  3. The persisted file at ``<data_dir>/runtime_id`` (default
     ``data/runtime_id`` at app root; co-located with the rest of the
     instance's working state — see ``settings.data_dir``)
  4. Freshly generated + persisted

The id is the federation primitive — the ``@<id>`` topic suffix
routes messages to that runtime's bus. Two runtimes peering exchange
``/runtime/runtime/services`` retained payloads on connect so they
learn each other's id with no out-of-band coordination.
"""
from __future__ import annotations

import logging
import os
import random
import re
from pathlib import Path
from typing import Optional


logger = logging.getLogger(__name__)


# Small curated pools — memorable, distinct on glance, no profanity,
# no ambiguity (e.g. "iron-bot" vs "ironbot"). 18 × 22 = 396 combos,
# plenty of headroom for ~10 runtimes.
_ADJECTIVES = (
    "bouncy", "plucky", "grumpy", "witty", "sleepy", "dapper",
    "fuzzy", "snappy", "peppy", "jolly", "sturdy", "breezy",
    "sneaky", "perky", "cosmic", "rusty", "glowing", "sparky",
)
_ROBOT_NOUNS = (
    "bot", "droid", "mecha", "golem", "automaton", "cyborg",
    "gizmo", "widget", "gadget", "sprocket", "rover", "drone",
    "pilot", "cogger", "tinker", "scout", "herald", "vector",
    "axis", "gear", "byte", "circuit",
)

# Format constraint: lowercase letters, digits, hyphens. Used by the
# future ``@<id>`` topic-suffix parser so the id can never collide
# with normal topic chars.
_VALID_ID = re.compile(r"^[a-z][a-z0-9-]{1,62}$")

_ENV_VAR = "RLX_RUNTIME_ID"
# File NAME (not path) — the directory portion comes from settings.data_dir
# at call time. Default fallback path is ``<cwd>/data/runtime_id`` which
# matches the long-standing on-disk layout for callers that don't
# supply ``data_dir`` (tests, ad-hoc CLI tools).
_FILE_NAME = "runtime_id"
_DEFAULT_DATA_DIR = "data"


def generate_id() -> str:
    """Pick a fresh adjective-noun pair."""
    return f"{random.choice(_ADJECTIVES)}-{random.choice(_ROBOT_NOUNS)}"


def is_valid_id(value: str) -> bool:
    """True iff ``value`` matches the format constraint.

    Permissive — any ascii lowercase + digits + hyphens, must start
    with a letter. The shape is enforced at the boundary (here, and
    in the eventual @<id> suffix parser) so internal code can assume
    it's safe to use in topic paths.
    """
    return isinstance(value, str) and bool(_VALID_ID.match(value))


def _data_path(data_dir: Optional[str] = None) -> Path:
    """Resolve the runtime-id file inside the per-process data dir.

    ``data_dir`` is the same value as ``settings.data_dir`` — the
    per-instance working directory that also houses ``databases/``
    + ``admin_password.txt``. Relative paths resolve against the
    current working directory (the backend's launch dir,
    ``apps/robotlab_x/``); absolute paths pass through. When the
    caller passes nothing, we fall back to ``<cwd>/data/runtime_id``
    so legacy callers (tests, ad-hoc scripts) keep working.
    """
    raw = data_dir if data_dir is not None else _DEFAULT_DATA_DIR
    p = Path(raw).expanduser()
    if not p.is_absolute():
        p = Path.cwd() / p
    return p / _FILE_NAME


def _read_persisted(path: Path) -> Optional[str]:
    """Read the id text file. Returns None if missing/malformed."""
    try:
        raw = path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeDecodeError):
        return None
    return raw if is_valid_id(raw) else None


def _write_persisted(path: Path, value: str) -> None:
    """Persist the id. Parent dir is created if needed. Atomic write
    so concurrent boots (rare but possible during dev) don't corrupt
    the file mid-write."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(value + "\n", encoding="utf-8")
    tmp.replace(path)


def resolve_runtime_id(
    *,
    data_dir: Optional[str] = None,
    explicit: Optional[str] = None,
    settings_runtime_id: Optional[str] = None,
) -> str:
    """Return the effective runtime id, generating + persisting if needed.

    Order of preference:
      1. ``explicit`` argument (callers that already parsed a value)
      2. ``RLX_RUNTIME_ID`` env var (direct env override, highest-priority
         env-style knob)
      3. ``settings_runtime_id`` (pydantic-settings value pulled from the
         Config model — typically set via ``ROBOTLAB_X_RUNTIME_ID`` in
         ``.env``; same source as every other ``ROBOTLAB_X_*`` knob)
      4. The persisted text file at ``data/runtime_id``
      5. Freshly generated + written to the file

    Overrides 1-3 are READ-ONLY — they never mutate the persisted file.
    That keeps ``--env-file .env.funny-droid python -m robotlab_x.main``
    one-shot ergonomic (no surprise file-stomp) and lets the bare
    ``python -m robotlab_x.main`` come back to its own persisted id.
    """
    # 1. explicit
    if explicit and is_valid_id(explicit):
        logger.info("runtime.identity: using explicit id=%s", explicit)
        return explicit
    if explicit and not is_valid_id(explicit):
        logger.warning("runtime.identity: explicit id %r rejected (bad format) — falling back", explicit)

    # 2. RLX_RUNTIME_ID env var
    env_val = os.environ.get(_ENV_VAR)
    if env_val and is_valid_id(env_val):
        logger.info("runtime.identity: using env id=%s", env_val)
        return env_val
    if env_val and not is_valid_id(env_val):
        logger.warning("runtime.identity: %s=%r rejected (bad format) — falling back", _ENV_VAR, env_val)

    # 3. Pydantic-settings runtime_id (from .env via ROBOTLAB_X_RUNTIME_ID).
    #    Same precedence shape as every other ROBOTLAB_X_* setting — gives
    #    folks the standard knob without having to know about RLX_RUNTIME_ID.
    if settings_runtime_id and is_valid_id(settings_runtime_id):
        logger.info("runtime.identity: using settings.runtime_id=%s", settings_runtime_id)
        return settings_runtime_id
    if settings_runtime_id and not is_valid_id(settings_runtime_id):
        logger.warning("runtime.identity: settings.runtime_id=%r rejected (bad format) — falling back",
                       settings_runtime_id)

    # 4. persisted file
    path = _data_path(data_dir)
    persisted = _read_persisted(path)
    if persisted:
        logger.info("runtime.identity: loaded id=%s from %s", persisted, path)
        return persisted

    # 5. generate + persist
    fresh = generate_id()
    try:
        _write_persisted(path, fresh)
        logger.info("runtime.identity: generated id=%s, persisted to %s", fresh, path)
    except OSError as exc:
        logger.warning("runtime.identity: could not persist id %s to %s (%s) — using in-memory only",
                       fresh, path, exc)
    return fresh


# Module-level cache so successive calls inside one process always
# return the same id. set_runtime_id() may be called from main.py
# once after CLI parse — subsequent calls hit the cache.
_cached_id: Optional[str] = None


def get_runtime_id(
    *,
    data_dir: Optional[str] = None,
    settings_runtime_id: Optional[str] = None,
) -> str:
    """Cached lookup. First call resolves + caches; subsequent calls
    return the cached value. Use ``set_runtime_id`` from main.py to
    seed the cache with the CLI-resolved value.

    ``data_dir`` + ``settings_runtime_id`` are forwarded to
    ``resolve_runtime_id`` on the FIRST call only — once cached,
    subsequent calls return the cached value regardless. Pass
    ``settings.data_dir`` + ``settings.runtime_id`` from
    event_handlers.on_startup to honour .env-driven overrides + the
    co-located runtime_id file.
    """
    global _cached_id
    if _cached_id is None:
        _cached_id = resolve_runtime_id(
            data_dir=data_dir, settings_runtime_id=settings_runtime_id,
        )
    return _cached_id


def set_runtime_id(value: str) -> None:
    """Seed the cache. main.py calls this after parsing --runtime-id
    so every subsequent ``get_runtime_id()`` returns the chosen value.
    """
    global _cached_id
    if not is_valid_id(value):
        raise ValueError(f"runtime id {value!r} fails format check")
    _cached_id = value


def reset_for_tests() -> None:
    """Clear the cache. Tests use this between fixtures."""
    global _cached_id
    _cached_id = None
