# unmanaged
"""brain service — folder-defined, AI-agnostic workflow brain.

See ``docs/TODO_BRAIN.md`` for the full spec. Public entry point is
``BrainService``; everything else under this package is implementation
detail.
"""
from brain.service import BrainService

__all__ = ["BrainService"]
