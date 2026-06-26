# unmanaged
"""Load workflows + memory + run context from disk.

Two roots are consulted on every load:

  * Bundled:      ``<package_dir>/../workflows/``   (this file's grandparent)
  * Per-instance: ``<workspace_dir>/workflows/``    (operator-owned)

Per-instance wins on name conflict — operators can shadow a bundled
workflow by writing a same-named directory.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Dict, List, Optional

import yaml

from brain.schemas import (
    AllowedTools, ExitOnPhrase, LoopOnTimeout, RunConfiguration,
    ToolPattern, ToolTerminationCondition,
    Workflow, WorkflowInput, WorkflowStep,
)


logger = logging.getLogger(__name__)


def _bundled_workflows_dir() -> Path:
    """``repo/brain/1.0.0/workflows/`` — sibling of the ``brain`` package."""
    return Path(__file__).resolve().parent.parent / "workflows"


def list_workflow_dirs(workspace_dir: Path) -> Dict[str, Path]:
    """Return {workflow_name: dir} merging bundled + per-instance.

    Per-instance shadows bundled on name conflict.
    """
    found: Dict[str, Path] = {}
    bundled_dir = _bundled_workflows_dir()
    if bundled_dir.is_dir():
        for entry in sorted(bundled_dir.iterdir()):
            if entry.is_dir() and (entry / "workflow.yaml").is_file():
                found[entry.name] = entry

    user_dir = workspace_dir / "workflows"
    if user_dir.is_dir():
        for entry in sorted(user_dir.iterdir()):
            if entry.is_dir() and (entry / "workflow.yaml").is_file():
                if entry.name in found:
                    logger.info("brain: per-instance workflow %s shadows bundled one", entry.name)
                found[entry.name] = entry
    return found


def load_workflow(name: str, workspace_dir: Path) -> Workflow:
    """Read a single named workflow off disk into a Workflow model."""
    dirs = list_workflow_dirs(workspace_dir)
    if name not in dirs:
        raise FileNotFoundError(
            f"workflow {name!r} not found "
            f"(searched bundled + {workspace_dir / 'workflows'})"
        )
    return _load_workflow_dir(name, dirs[name])


def _load_workflow_dir(name: str, wf_dir: Path) -> Workflow:
    """Parse workflow.yaml + sibling .md / .yaml files into a Workflow."""
    raw = yaml.safe_load((wf_dir / "workflow.yaml").read_text()) or {}

    inputs: Dict[str, WorkflowInput] = {}
    for key, val in (raw.get("inputs") or {}).items():
        if isinstance(val, dict):
            inputs[key] = WorkflowInput(**val)

    steps: List[WorkflowStep] = []
    for st in raw.get("steps") or []:
        if isinstance(st, dict):
            steps.append(WorkflowStep(**st))
    if not steps:
        steps = [WorkflowStep()]

    allowed = _load_allowed_tools(wf_dir / "allowed_tools.yaml")
    prompt_md = _read_optional(wf_dir / steps[0].prompt)
    success_md = _read_optional(wf_dir / steps[0].on_success)
    failure_md = _read_optional(wf_dir / steps[0].on_failure)

    terminate_on: List[ToolTerminationCondition] = []
    for cond in raw.get("terminate_on") or []:
        if isinstance(cond, dict) and isinstance(cond.get("action"), str):
            terminate_on.append(ToolTerminationCondition(action=cond["action"]))

    # Operator-curated run configurations — see RunConfiguration in
    # schemas.py. Each entry must have a name + backend at minimum;
    # invalid entries are skipped silently rather than failing the
    # whole workflow load (operator-mistyped yaml shouldn't brick a
    # workflow they were trying to enrich). Names must be unique
    # within a workflow; duplicates retain the first occurrence and
    # drop the rest with a warning.
    configurations: List[RunConfiguration] = []
    seen_config_names: set = set()
    for cfg in raw.get("configurations") or []:
        if not isinstance(cfg, dict):
            continue
        cfg_name = cfg.get("name")
        cfg_backend = cfg.get("backend")
        if not isinstance(cfg_name, str) or not cfg_name.strip():
            continue
        if not isinstance(cfg_backend, str) or not cfg_backend.strip():
            continue
        if cfg_name in seen_config_names:
            logger.warning(
                "workflow %s: duplicate configuration name %r — dropping",
                name, cfg_name,
            )
            continue
        seen_config_names.add(cfg_name)
        configurations.append(RunConfiguration(
            name=cfg_name.strip(),
            backend=cfg_backend.strip(),
            model=cfg.get("model") if isinstance(cfg.get("model"), str) else None,
            description=str(cfg.get("description") or ""),
        ))

    # Validation: every terminate_on action must be reachable via the
    # workflow's allowed_tools. A workflow that requires an action it
    # cannot call would never terminate by this path — better to
    # reject at load time than to surface as a runtime mystery.
    if terminate_on:
        allowed_action_names: set = set()
        for pattern in allowed.allowed:
            # ``actions: ["*"]`` is a wildcard — accept anything.
            if "*" in pattern.actions:
                allowed_action_names = None  # type: ignore[assignment]
                break
            allowed_action_names.update(pattern.actions)
        if allowed_action_names is not None:
            for cond in terminate_on:
                if cond.action not in allowed_action_names:
                    raise ValueError(
                        f"workflow {name!r}: terminate_on references "
                        f"action {cond.action!r} but allowed_tools.yaml "
                        f"does not include it. Add it to ``allowed:`` "
                        f"or remove the terminate_on entry."
                    )

    # Engine-enforced exit-phrase interceptor (ExitOnPhrase). When
    # present + non-trivial, the engine spawns a watcher task at run
    # start that subscribes + matches. Missing fields default to safe
    # values; an invalid block (e.g. ``matches`` not a list) is
    # silently coerced to None — the workflow still loads.
    exit_on_phrase: Optional[ExitOnPhrase] = None
    eop_raw = raw.get("exit_on_phrase")
    if isinstance(eop_raw, dict):
        eop_matches = eop_raw.get("matches")
        if isinstance(eop_matches, list) and all(isinstance(m, str) for m in eop_matches):
            exit_on_phrase = ExitOnPhrase(
                matches=eop_matches,
                case_insensitive=bool(eop_raw.get("case_insensitive", True)),
                whole_message=bool(eop_raw.get("whole_message", True)),
                listen_topic=eop_raw.get("listen_topic") if isinstance(eop_raw.get("listen_topic"), str) else None,
            )

    # Loop-on-timeout fast-path (LoopOnTimeout).
    loop_on_timeout: Optional[LoopOnTimeout] = None
    lot_raw = raw.get("loop_on_timeout")
    if isinstance(lot_raw, dict):
        if isinstance(lot_raw.get("tool"), str) and isinstance(lot_raw.get("field"), str):
            loop_on_timeout = LoopOnTimeout(
                tool=lot_raw["tool"],
                field=lot_raw["field"],
                value=lot_raw.get("value"),
            )

    # ``preferred_backend`` (since 2026-06-04) replaces the legacy
    # ``model`` field which was misnamed — it picked the adapter
    # (provider) name, not a specific model. Existing workflow.yaml
    # files are migrated in this same change so the alias isn't
    # strictly needed, but we accept ``model`` as a deprecated alias
    # one more cycle so out-of-tree workspaces don't break silently.
    preferred_backend = raw.get("preferred_backend") or raw.get("model") or "mock"
    return Workflow(
        # The DIRECTORY name is the single source of truth for a
        # workflow's identity (normalized). The yaml ``name:`` field, if
        # present, is ignored — storing the name in both the folder and
        # the file is a denormalization that desyncs on duplicate/rename
        # (a copied workflow.yaml carried the original's name, so the
        # copy reported under the wrong name and couldn't be run).
        name=name,
        description=raw.get("description", "") or "",
        preferred_backend=preferred_backend,
        preferred_model=raw.get("preferred_model"),
        configurations=configurations,
        exit_on_phrase=exit_on_phrase,
        loop_on_timeout=loop_on_timeout,
        message_window_size=raw.get("message_window_size") if isinstance(raw.get("message_window_size"), int) else None,
        max_steps=int(raw.get("max_steps", 8)),
        timeout_seconds=int(raw.get("timeout_seconds", 120)),
        max_tokens_per_run=raw.get("max_tokens_per_run"),
        requires_human_approval=bool(raw.get("requires_human_approval", False)),
        inputs=inputs,
        steps=steps,
        context=list(raw.get("context") or []),
        allowed_tools=allowed,
        terminate_on=terminate_on,
        prompt_md=prompt_md,
        success_md=success_md,
        failure_md=failure_md,
    )


def _load_allowed_tools(path: Path) -> AllowedTools:
    if not path.is_file():
        # Default-deny — no allowed list, no blocked list. Workflow
        # without a allowed_tools.yaml can't call ANYTHING. That's a
        # safe + obvious failure mode for a misconfigured workflow.
        return AllowedTools()
    raw = yaml.safe_load(path.read_text()) or {}
    return AllowedTools(
        allowed=[ToolPattern(**p) for p in (raw.get("allowed") or [])],
        blocked=[ToolPattern(**p) for p in (raw.get("blocked") or [])],
    )


def _read_optional(path: Path) -> str:
    if path.is_file():
        return path.read_text()
    return ""


def render_context(wf: Workflow, workspace_dir: Path, inputs: Optional[Dict] = None) -> str:
    """Compose the user-facing prompt: workflow's prompt.md plus
    contents of every memory file in workflow.context. ``inputs`` are
    formatted in if the prompt body references them via simple {key}
    substitution (no Jinja2 dep for v1)."""
    parts: List[str] = []
    prompt = wf.prompt_md
    if inputs:
        # Cheap str.format; non-existent keys raise loudly so the
        # workflow author sees the typo. Use {{key}} for literal braces.
        try:
            prompt = prompt.format(**inputs)
        except (KeyError, IndexError) as e:
            raise ValueError(f"workflow {wf.name!r} prompt references unknown input: {e}")
    parts.append(prompt)
    for rel in wf.context:
        p = workspace_dir / rel
        if p.is_file():
            body = p.read_text().strip()
            if body:
                parts.append(f"\n--- {rel} ---\n{body}")
    return "\n".join(parts).strip()
