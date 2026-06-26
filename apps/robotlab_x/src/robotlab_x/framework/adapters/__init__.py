# unmanaged
"""Concrete ServiceAdapter implementations, one per transport."""
from .in_process import InProcessAdapter
from .subprocess import SubprocessAdapter

__all__ = ["InProcessAdapter", "SubprocessAdapter"]
