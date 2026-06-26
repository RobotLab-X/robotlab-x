# unmanaged
"""Pick the right ServiceAdapter for a given service_meta row.

One place to centralise the decision. Today the rule is:

    language == 'builtin'                  -> InProcessAdapter
    language == 'python' and entry_argv    -> SubprocessAdapter
    is_dockerized                          -> NotImplementedError (stub for now)
    otherwise                              -> ValueError

Adapters are singletons — lifecycle.py keeps no state of its own.
"""
from __future__ import annotations

from typing import Any, Dict

from .adapter import ServiceAdapter
from .adapters import InProcessAdapter, SubprocessAdapter


_IN_PROCESS = InProcessAdapter()
_SUBPROCESS = SubprocessAdapter()


def pick_adapter(meta: Dict[str, Any]) -> ServiceAdapter:
    """Return the adapter for this service_meta row.

    Raises ValueError if no adapter fits — surfacing misconfiguration
    instead of silently falling back.
    """
    if not isinstance(meta, dict) or not meta:
        raise ValueError("pick_adapter: meta is empty")
    language = (meta.get("language") or "").lower()
    if meta.get("is_dockerized"):
        raise NotImplementedError(
            "docker transport adapter is not implemented yet"
        )
    if language == "builtin":
        return _IN_PROCESS
    if meta.get("entry_argv"):
        return _SUBPROCESS
    raise ValueError(
        f"no adapter for service_meta {meta.get('id')!r}: "
        f"language={language!r} entry_argv={bool(meta.get('entry_argv'))}"
    )
