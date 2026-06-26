# unmanaged
"""Re-export the canonical @service_method definitions from rlx_bus.

The decorator + MethodInfo + collect_methods live in ``rlx_bus.methods``
so subprocess and in-process services share one definition. This file
keeps existing imports (``from robotlab_x.framework.methods import …``)
working without rewriting callers.
"""
from rlx_bus.methods import MethodInfo, collect_methods, service_method

__all__ = ["MethodInfo", "collect_methods", "service_method"]
