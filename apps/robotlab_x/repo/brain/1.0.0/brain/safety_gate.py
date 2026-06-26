# unmanaged
"""Topic-pattern based allow/deny enforcement for proposed tool calls.

The bus is the ultimate enforcer — a publish either matches a
subscription pattern or doesn't. The safety gate sits in front of the
bus publish for tool calls so a proposed action is checked against
the workflow's allow/deny rules BEFORE going on the wire. Same
matching grammar as bus topic subscriptions.

Pattern grammar:
  *           one path segment ("any instance":  /video/*/control matches /video/video-1/control)
  @**         opt-in to federation suffixes      (/arduino/*@**/control matches /arduino/arduino-1@funny-droid/control)
  literal     exact match

Evaluation:
  1. Any blocked match  → DENY (blocked wins ties)
  2. Any allowed match  → ALLOW
  3. Otherwise          → DENY (default-deny)
"""
from __future__ import annotations

import fnmatch
import logging
from typing import Iterable, Optional

from brain.schemas import AllowedTools, ProposedAction, SafetyVerdict, ToolDescriptor, ToolPattern, Workflow


logger = logging.getLogger(__name__)


def _strip_federation(s: str) -> tuple[str, bool]:
    """Strip an inline ``@<peer>`` suffix from any segment of a topic.

    Returns ``(unfederated, was_federated)``. The federation suffix
    lives WITHIN a path segment (``/video/video-1@funny-droid/control``)
    so we walk the segments to find it — a top-level ``partition('@')``
    would chop off everything after the first ``@``, including the
    rest of the topic path.
    """
    parts = s.split("/")
    federated = False
    for i, part in enumerate(parts):
        if "@" in part:
            seg_base, _, _peer = part.partition("@")
            parts[i] = seg_base
            federated = True
    return "/".join(parts), federated


def _topic_matches(pattern: str, topic: str) -> bool:
    """Glob a topic against a pattern.

    ``*`` matches exactly one path segment (no slash crossing — fnmatch's
    default greedy ``*`` is the wrong shape for bus topics).

    ``@**`` is the federation opt-in: a pattern containing ``@**``
    in any segment matches both unfederated and federated topics.
    Without it, federated topics never match.
    """
    pattern_base, _ = _strip_federation(pattern.replace("@**", ""))
    federation_opt_in = "@**" in pattern
    topic_base, topic_federated = _strip_federation(topic)

    if topic_federated and not federation_opt_in:
        return False

    p_parts = pattern_base.split("/")
    t_parts = topic_base.split("/")
    if len(p_parts) != len(t_parts):
        return False
    for pp, tp in zip(p_parts, t_parts):
        if not fnmatch.fnmatchcase(tp, pp):
            return False
    return True


def _action_matches(actions: list[str], proposed: str) -> bool:
    """Membership check with ``"*"`` as a wildcard meaning "any action
    on this topic". An empty list matches nothing — workflow authors
    have to write something explicit to allow anything."""
    if "*" in actions:
        return True
    return proposed in actions


def _matches_any(patterns: Iterable[ToolPattern], topic: str, action: str) -> Optional[ToolPattern]:
    for p in patterns:
        if _topic_matches(p.topic, topic) and _action_matches(p.actions, action):
            return p
    return None


def check_tool_call(
    workflow: Workflow,
    action: ProposedAction,
    *,
    tool_catalog: Optional[dict[str, ToolDescriptor]] = None,
) -> SafetyVerdict:
    """Validate one proposed action against the workflow's tool policy
    + the live tool catalog. Returns a SafetyVerdict — never raises."""
    if action.kind != "tool":
        return SafetyVerdict(allowed=True, reason="terminal action")

    topic = action.topic or ""
    name = action.action or ""

    blocked = _matches_any(workflow.allowed_tools.blocked, topic, name)
    if blocked is not None:
        return SafetyVerdict(
            allowed=False,
            guard="block_list",
            reason=f"matched blocked pattern: topic={blocked.topic!r} action={name!r}",
        )

    allowed = _matches_any(workflow.allowed_tools.allowed, topic, name)
    if allowed is None:
        return SafetyVerdict(
            allowed=False,
            guard="allow_list",
            reason=(
                f"no allow rule matches topic={topic!r} action={name!r} "
                f"(default-deny — workflow.allowed_tools.allowed needs an entry)"
            ),
        )

    if tool_catalog is not None:
        descriptor = tool_catalog.get(f"{topic}::{name}")
        if descriptor is None:
            return SafetyVerdict(
                allowed=False,
                guard="unknown_target",
                reason=f"{topic} has no live service exposing action {name!r}",
            )

    return SafetyVerdict(allowed=True, reason=f"matched allow rule {allowed.topic!r}")


def check_max_steps(workflow: Workflow, steps_used: int) -> SafetyVerdict:
    if steps_used >= workflow.max_steps:
        return SafetyVerdict(
            allowed=False,
            guard="max_steps",
            reason=f"workflow.max_steps={workflow.max_steps} exhausted (used {steps_used})",
        )
    return SafetyVerdict(allowed=True)


def check_max_tokens(workflow: Workflow, tokens_used: int) -> SafetyVerdict:
    limit = workflow.max_tokens_per_run
    if limit is not None and tokens_used > limit:
        return SafetyVerdict(
            allowed=False,
            guard="max_tokens",
            reason=f"workflow.max_tokens_per_run={limit} exceeded (used {tokens_used})",
        )
    return SafetyVerdict(allowed=True)
