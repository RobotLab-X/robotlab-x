# unmanaged
"""Model adapters — pluggable reasoning engines behind a single ABC.

Workflows pick which adapter to use via ``model:`` in workflow.yaml.
Adapters are stateless per-call and translate the brain's
``ChatMessage`` + ``ToolDescriptor`` shape into the provider's native
tool-calling format.
"""
from brain.adapters.base import ModelAdapter
from brain.adapters.mock import MockAdapter

__all__ = ["ModelAdapter", "MockAdapter"]
