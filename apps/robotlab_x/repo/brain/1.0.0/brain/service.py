# unmanaged
"""BrainService — robotlab_x in-process service wrapping the workflow
engine.

Exposes:
  /brain/{id}/state                  retained snapshot
  /brain/{id}/heartbeat              1Hz via base class
  /brain/{id}/control                inbound actions
  /brain/{id}/runs/{run_id}/...      per-run streams + retained summary

@service_method actions:
  list_workflows()
  list_tools()
  start_workflow(name, inputs={}, model=None)
  cancel(run_id, reason="")
  approve(run_id, decision=True)
  get_run(run_id)
  write_memory(kind, content)        used internally + exposed as a tool
"""
from __future__ import annotations

import asyncio
import logging
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional

from pydantic import Field, SecretStr
from rlx_bus import ServiceConfig
from robotlab_x.framework import Service, service_method
from robotlab_x.runtime.bus import get_bus

from brain import memory as memory_mod
from brain.adapters import MockAdapter, ModelAdapter
from brain.context_loader import list_workflow_dirs, load_workflow
from brain.run_logger import _now_iso
from brain.schemas import RunRecord, ToolDescriptor, ToolResult
from brain.tool_executor import ToolExecutor
from brain.workflow_engine import WorkflowEngine


logger = logging.getLogger(__name__)


class BrainConfig(ServiceConfig):
    """Per-instance config — surfaces via the wizard at install AND via
    the runtime panel (set_backend / set_active_backend bus actions).

    Backend credentials, URLs, and model names live here so the operator
    can switch from Ollama to Anthropic to OpenAI at runtime without
    re-installing the service. ``default_model`` selects which adapter
    answers when a workflow doesn't pin one. Workspace path defaults to
    ``<data_dir>/brain/<proxy-id>/`` at startup.
    """
    workspace_path: Optional[str] = Field(
        None,
        description="Absolute path to this brain's workspace dir. Falls "
                    "back to <data_dir>/brain/<proxy-id>/ when None.",
    )
    default_model: str = Field(
        "mock",
        description="Adapter name (mock/ollama/anthropic/openai) to use "
                    "when neither the workflow nor the start_workflow call "
                    "overrides it.",
    )

    # Ollama — base URL + model name. Empty/None base URL disables.
    ollama_base_url: str = Field("http://localhost:11434")
    ollama_model: str = Field("llama3.1")
    ollama_num_ctx: int = Field(
        8192,
        description=(
            "Ollama context window (tokens) sent as options.num_ctx. "
            "Ollama defaults to 2048, which truncates large tool-heavy "
            "requests (servo map + ~30 tools) and breaks tool-calling. "
            "Raise for very large workflows."
        ),
    )

    # Anthropic — api_key + model + (rarely) base URL.
    # SecretStr: framework encrypts on save, masks on get_config.
    anthropic_api_key: Optional[SecretStr] = None
    anthropic_base_url: str = Field("https://api.anthropic.com")
    anthropic_model: str = Field("claude-3-5-sonnet-20241022")

    # OpenAI — api_key + model + base URL (handy for OpenAI-compatible
    # proxies like LiteLLM / vLLM / openai-compat endpoints).
    openai_api_key: Optional[SecretStr] = None
    openai_base_url: str = Field("https://api.openai.com")
    openai_model: str = Field("gpt-4o-mini")

    max_concurrent_runs: int = Field(4, ge=1, le=64)


class BrainService(Service):
    """In-process workflow brain."""

    type_name = "brain"
    config_class = BrainConfig
    heartbeat_interval_s = 1.0
    publishes = ["state"]

    _control_task: Optional[asyncio.Task] = None
    _runs: Dict[str, WorkflowEngine]
    _run_tasks: Dict[str, asyncio.Task]
    _tool_catalog: Dict[str, ToolDescriptor]

    # ─── lifecycle ────────────────────────────────────────────────

    async def on_start(self) -> None:
        self._runs = {}
        self._run_tasks = {}
        self._tool_catalog = {}

        self._workspace = self._resolve_workspace()
        self._workspace.mkdir(parents=True, exist_ok=True)
        (self._workspace / "memory").mkdir(exist_ok=True)
        (self._workspace / "runs").mkdir(exist_ok=True)

        await self._publish_state()
        # Build the initial tool catalog from /v1/service-meta-list-style
        # data already published on the bus. The types index subscriber
        # below keeps it current as services come + go.
        await self._refresh_tool_catalog()
        self._types_task = asyncio.create_task(self._watch_types())
        self._control_task = asyncio.create_task(self.run_control_loop())

    async def on_stop(self) -> None:
        for task in self._run_tasks.values():
            task.cancel()
        for task in (self._control_task, getattr(self, "_types_task", None)):
            if task is not None and not task.done():
                task.cancel()
        await asyncio.gather(
            *(t for t in [*self._run_tasks.values(),
                          self._control_task,
                          getattr(self, "_types_task", None)] if t is not None),
            return_exceptions=True,
        )

    # ─── @service_method actions ──────────────────────────────────

    @service_method("list_workflows")
    async def m_list_workflows(self) -> Dict[str, Any]:
        """Return every workflow visible to this instance — bundled +
        per-instance overrides merged."""
        out: List[Dict[str, Any]] = []
        for name, wf_dir in list_workflow_dirs(self._workspace).items():
            try:
                wf = load_workflow(name, self._workspace)
            except Exception as exc:  # noqa: BLE001
                out.append({"name": name, "error": f"parse failed: {exc}"})
                continue
            out.append({
                "name": wf.name,
                "description": wf.description.strip(),
                "preferred_backend": wf.preferred_backend,
                "preferred_model": wf.preferred_model,
                # Operator-curated alternates — the UI toolbar's
                # configuration dropdown reads these. Empty list when
                # the workflow has no saved configurations yet.
                "configurations": [c.model_dump() for c in wf.configurations],
                "max_steps": wf.max_steps,
                "requires_human_approval": wf.requires_human_approval,
                "source": str(wf_dir),
            })
        return {"workflows": out}

    @service_method("list_tools")
    async def m_list_tools(self) -> Dict[str, Any]:
        """The live tool catalog — every (topic, action) the brain can
        currently see on the bus."""
        return {
            "tools": [t.model_dump() for t in self._tool_catalog.values()],
            "count": len(self._tool_catalog),
        }

    @service_method("start_workflow")
    async def m_start_workflow(
        self,
        name: str,
        inputs: Optional[Dict[str, Any]] = None,
        backend: Optional[str] = None,
        model: Optional[str] = None,
        configuration: Optional[str] = None,
    ) -> Dict[str, Any]:
        if len(self._runs) >= self.config.max_concurrent_runs:
            raise RuntimeError(
                f"max concurrent runs reached ({self.config.max_concurrent_runs})"
            )
        wf = load_workflow(name, self._workspace)
        # Named configuration lookup. When ``configuration`` is given,
        # find a matching entry in ``wf.configurations`` and use its
        # backend + model as the initial values — explicit ``backend``
        # / ``model`` args still win on top (override-the-override).
        # Unknown name is a hard error so operators don't silently
        # fall back to defaults when they meant to pick a specific
        # combo.
        cfg_backend: Optional[str] = None
        cfg_model: Optional[str] = None
        if configuration:
            picked = next((c for c in wf.configurations if c.name == configuration), None)
            if picked is None:
                names = [c.name for c in wf.configurations]
                raise ValueError(
                    f"workflow {name!r} has no configuration {configuration!r} "
                    f"(available: {names or 'none'})"
                )
            cfg_backend = picked.backend
            cfg_model = picked.model
        # Backend (adapter) selection — precedence:
        #   per-call ``backend`` arg > configuration's backend >
        #   workflow.preferred_backend > BrainConfig.default_model
        backend_name = backend or cfg_backend or wf.preferred_backend or self.config.default_model
        adapter = self._adapter(backend_name)
        # Model id selection — precedence:
        #   per-call ``model`` arg > configuration's model >
        #   workflow.preferred_model > None
        # None means "let the adapter use its configured default
        # (BrainConfig.<backend>_model)". Resolved here + passed into
        # the engine so the RunRecord shows the same value the
        # adapter actually uses, and ``active_runs`` snapshot can
        # report it to the UI.
        model_id = model or cfg_model or wf.preferred_model

        bus_prefix = f"/{self.type_name}/{self.proxy_id}"
        executor = ToolExecutor(
            publish=lambda topic, payload, **_: get_bus().publish_sync(topic, payload),
            subscribe_reply=lambda topic: _bus_iter(topic, sid=f"brain-{self.proxy_id}-reply-{topic}"),
            reply_root=f"/{self.type_name}/{self.proxy_id}/_replies",
        )

        async def _caller(topic: str, action: str, args: Dict[str, Any]) -> ToolResult:
            return await executor.call(topic=topic, action=action, args=args, timeout=30.0)

        engine = WorkflowEngine(
            workflow=wf,
            workspace_dir=self._workspace,
            adapter=adapter,
            tool_caller=_caller,
            publish=lambda topic, payload, retained=False: get_bus().publish_sync(
                topic, payload, retained=retained,
            ),
            bus_prefix=bus_prefix,
            tool_catalog=self._tool_catalog,
            inputs=inputs or {},
            backend=backend_name,
            model_id=model_id,
        )
        run_id = engine.run_id
        self._runs[run_id] = engine
        task = asyncio.create_task(self._run_to_completion(run_id, engine))
        self._run_tasks[run_id] = task
        await self._publish_state()
        return {"run_id": run_id, "status": "running"}

    @service_method("cancel")
    async def m_cancel(self, run_id: str, reason: str = "") -> Dict[str, Any]:
        engine = self._runs.get(run_id)
        if engine is None:
            return {"cancelled": False, "reason": f"no run with id {run_id}"}
        engine.cancel(reason or "operator cancel")
        # Also cancel the asyncio task so an in-flight ``adapter.complete()``
        # aborts immediately. Without this the cancel only takes effect at
        # the top of the next loop iteration — for a slow local model that
        # could be 15-30 seconds after the operator pressed Stop. The
        # CancelledError propagates through the awaits + cleans up the run
        # via the ``finally`` in ``_run_to_completion``.
        task = self._run_tasks.get(run_id)
        if task is not None and not task.done():
            task.cancel()
        return {"cancelled": True}

    @service_method("approve")
    async def m_approve(self, run_id: str, decision: bool = True) -> Dict[str, Any]:
        engine = self._runs.get(run_id)
        if engine is None:
            return {"approved": False, "reason": f"no run with id {run_id}"}
        return {"approved": engine.approve(decision)}

    @service_method("get_run")
    async def m_get_run(self, run_id: str) -> Dict[str, Any]:
        engine = self._runs.get(run_id)
        if engine is None:
            return {"error": f"no run with id {run_id}"}
        return engine.record.model_dump()

    @service_method("clear_runs")
    async def m_clear_runs(self) -> Dict[str, Any]:
        """Delete completed run artifacts under ``<workspace>/runs/``.

        In-flight runs (still tracked in ``self._runs``) are SKIPPED so
        their live logging isn't yanked out from under them — the run
        dir name ends in the run_id (``<ts>-<workflow>-<run_id>``), so
        we match the trailing segment against active ids. Returns counts
        for the UI toast."""
        runs_dir = self._workspace / "runs"
        removed = 0
        skipped_active = 0
        errors = 0
        if runs_dir.is_dir():
            active_ids = set(self._runs.keys())
            for entry in sorted(runs_dir.iterdir()):
                if not entry.is_dir():
                    continue
                run_id = entry.name.rsplit("-", 1)[-1]
                if run_id in active_ids:
                    skipped_active += 1
                    continue
                try:
                    shutil.rmtree(entry)
                    removed += 1
                except OSError as exc:  # noqa: PERF203
                    errors += 1
                    logger.warning("brain.clear_runs: failed to remove %s: %s", entry, exc)
        logger.info(
            "brain.clear_runs: removed=%d skipped_active=%d errors=%d",
            removed, skipped_active, errors,
        )
        return {"removed": removed, "skipped_active": skipped_active, "errors": errors}

    @service_method("save_workflow_preferences")
    async def m_save_workflow_preferences(
        self,
        name: str,
        preferred_backend: Optional[str] = None,
        preferred_model: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Persist ``preferred_backend`` + ``preferred_model`` into a
        workflow's ``workflow.yaml``. Two cases:

        * Workspace copy exists → edit in place (comments + key
          order preserved via ruamel.yaml round-trip).
        * Only bundled exists → return ``{needs_fork: true}`` without
          writing. The UI shows a confirm dialog; on confirm it forks
          via ``/files/fork`` (REST) and retries this call, which
          then takes the workspace branch.

        Empty/null ``preferred_model`` clears the pin (the adapter
        falls back to its configured default model). ``preferred_backend``
        is required when saving — there's no "unset" value for it.
        """
        from brain.context_loader import list_workflow_dirs, _bundled_workflows_dir
        from ruamel.yaml import YAML

        if not preferred_backend:
            raise ValueError("preferred_backend is required")

        dirs = list_workflow_dirs(self._workspace)
        if name not in dirs:
            return {"saved": False, "error": f"workflow {name!r} not found"}
        wf_dir = dirs[name]
        # Is this the workspace copy (writable) or the bundled
        # (read-only)? list_workflow_dirs returns the workspace path
        # when both exist (workspace shadows bundled), so a wf_dir
        # under the workspace tree is writable.
        workspace_wf = self._workspace / "workflows" / name
        is_workspace = wf_dir == workspace_wf
        if not is_workspace:
            return {
                "saved": False,
                "needs_fork": True,
                "workflow_dir": f"workflows/{name}",
                "reason": "bundled workflow — fork to workspace before saving",
            }

        yaml_path = wf_dir / "workflow.yaml"
        if not yaml_path.is_file():
            return {"saved": False, "error": f"workflow.yaml missing at {yaml_path}"}

        # ruamel.yaml round-trip preserves comments + ordering, unlike
        # PyYAML which would strip both. ``YAML()`` defaults to
        # round-trip mode which is what we want here.
        yaml = YAML()
        yaml.preserve_quotes = True
        with open(yaml_path, "r") as f:
            data = yaml.load(f) or {}

        data["preferred_backend"] = preferred_backend
        if preferred_model:
            data["preferred_model"] = preferred_model
        else:
            # Empty/None means "clear the pin". Remove the key so the
            # adapter falls back to BrainConfig.<backend>_model.
            data.pop("preferred_model", None)
        # Remove the legacy ``model:`` key when present — the loader
        # treats it as a deprecated alias for ``preferred_backend``,
        # so keeping both would be redundant + confusing. Operators
        # who Save their preferences end up with a yaml that uses
        # the new key set only.
        data.pop("model", None)

        with open(yaml_path, "w") as f:
            yaml.dump(data, f)

        # Refresh the UI tree — the file changed.
        try:
            rel = yaml_path.relative_to(self._workspace)
            self.publish("files/changed", {
                "path": str(rel),
                "kind": "modified",
                "mtime": yaml_path.stat().st_mtime,
            })
        except Exception:  # noqa: BLE001
            pass

        return {
            "saved": True,
            "path": str(yaml_path),
            "preferred_backend": preferred_backend,
            "preferred_model": preferred_model or None,
        }

    # ─── workflow.yaml editing helpers ─────────────────────────────
    #
    # The actions below (save_run_configuration / delete / set-default)
    # all need to load a workspace-resident workflow.yaml, mutate, and
    # write it back via ruamel.yaml. They share the bundled-vs-workspace
    # check + the files/changed publish via these helpers. Bundled
    # workflows return ``{needs_fork: true}`` so the UI's fork-
    # confirm dialog can fire, then the action is retried after fork.

    def _locate_workspace_yaml(self, name: str):
        """Return ``(yaml_path, None)`` when the workflow has a
        writable workspace copy, or ``(None, error_payload)`` when
        the workflow doesn't exist / is bundled-only / has no
        workflow.yaml. The caller returns ``error_payload`` directly
        as the action's reply."""
        from brain.context_loader import list_workflow_dirs
        dirs = list_workflow_dirs(self._workspace)
        if name not in dirs:
            return None, {"saved": False, "error": f"workflow {name!r} not found"}
        wf_dir = dirs[name]
        workspace_wf = self._workspace / "workflows" / name
        if wf_dir != workspace_wf:
            return None, {
                "saved": False,
                "needs_fork": True,
                "workflow_dir": f"workflows/{name}",
                "reason": "bundled workflow — fork to workspace before saving",
            }
        yaml_path = wf_dir / "workflow.yaml"
        if not yaml_path.is_file():
            return None, {"saved": False, "error": f"workflow.yaml missing at {yaml_path}"}
        return yaml_path, None

    def _emit_yaml_changed(self, yaml_path):
        """Publish a files/changed event so the UI tree + file
        viewer auto-refresh after the workflow.yaml mutation."""
        try:
            rel = yaml_path.relative_to(self._workspace)
            self.publish("files/changed", {
                "path": str(rel),
                "kind": "modified",
                "mtime": yaml_path.stat().st_mtime,
            })
        except Exception:  # noqa: BLE001
            pass

    @service_method("save_run_configuration")
    async def m_save_run_configuration(
        self,
        workflow: str,
        name: str,
        backend: str,
        model: Optional[str] = None,
        description: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Append a named (backend, model) combo to a workflow's
        ``configurations`` list. The operator drives this from the
        toolbar's ``save`` button when the current Run Configuration
        diverges from any saved entry.

        ``name`` must be unique within the workflow's configurations.
        Re-saving an existing name UPDATES that entry in place (so
        operators can refine a saved combo without delete+add)."""
        if not workflow:
            raise ValueError("workflow is required")
        if not name or not name.strip():
            raise ValueError("name is required")
        if not backend or not backend.strip():
            raise ValueError("backend is required")

        yaml_path, err = self._locate_workspace_yaml(workflow)
        if err:
            return err

        from ruamel.yaml import YAML
        yaml = YAML()
        yaml.preserve_quotes = True
        with open(yaml_path, "r") as f:
            data = yaml.load(f) or {}

        configs = list(data.get("configurations") or [])
        new_entry: Dict[str, Any] = {
            "name": name.strip(),
            "backend": backend.strip(),
        }
        if model:
            new_entry["model"] = model
        if description:
            new_entry["description"] = description

        # Update-in-place when the name already exists; append otherwise.
        idx = next(
            (i for i, c in enumerate(configs)
             if isinstance(c, dict) and c.get("name") == name.strip()),
            None,
        )
        if idx is not None:
            configs[idx] = new_entry
        else:
            configs.append(new_entry)
        data["configurations"] = configs

        with open(yaml_path, "w") as f:
            yaml.dump(data, f)
        self._emit_yaml_changed(yaml_path)

        return {
            "saved": True,
            "path": str(yaml_path),
            "workflow": workflow,
            "name": name.strip(),
            "backend": backend.strip(),
            "model": model,
            "description": description or "",
            "updated_existing": idx is not None,
        }

    @service_method("delete_run_configuration")
    async def m_delete_run_configuration(
        self,
        workflow: str,
        name: str,
    ) -> Dict[str, Any]:
        """Remove a named configuration from a workflow's
        ``configurations`` list. Returns ``{deleted: false}`` when no
        such name exists; not an error so the UI can be idempotent."""
        yaml_path, err = self._locate_workspace_yaml(workflow)
        if err:
            return err

        from ruamel.yaml import YAML
        yaml = YAML()
        yaml.preserve_quotes = True
        with open(yaml_path, "r") as f:
            data = yaml.load(f) or {}

        configs = list(data.get("configurations") or [])
        before = len(configs)
        configs = [
            c for c in configs
            if not (isinstance(c, dict) and c.get("name") == name)
        ]
        if len(configs) == before:
            return {"deleted": False, "workflow": workflow, "name": name}

        # Empty list — remove the key entirely so the yaml stays
        # tidy. Loader treats missing key the same as empty list.
        if configs:
            data["configurations"] = configs
        else:
            data.pop("configurations", None)

        with open(yaml_path, "w") as f:
            yaml.dump(data, f)
        self._emit_yaml_changed(yaml_path)
        return {"deleted": True, "workflow": workflow, "name": name}

    @service_method("set_default_configuration")
    async def m_set_default_configuration(
        self,
        workflow: str,
        name: str,
    ) -> Dict[str, Any]:
        """Copy a named configuration's ``backend`` + ``model`` into
        the workflow's ``preferred_*`` fields. The configuration
        itself is left in place — it just also becomes the default
        for runs that don't specify a configuration explicitly."""
        yaml_path, err = self._locate_workspace_yaml(workflow)
        if err:
            return err

        from ruamel.yaml import YAML
        yaml = YAML()
        yaml.preserve_quotes = True
        with open(yaml_path, "r") as f:
            data = yaml.load(f) or {}

        configs = data.get("configurations") or []
        picked = next(
            (c for c in configs
             if isinstance(c, dict) and c.get("name") == name),
            None,
        )
        if picked is None:
            names = [c.get("name") for c in configs if isinstance(c, dict)]
            return {
                "saved": False,
                "error": f"configuration {name!r} not found in {workflow!r} "
                         f"(available: {names or 'none'})",
            }

        data["preferred_backend"] = picked["backend"]
        if picked.get("model"):
            data["preferred_model"] = picked["model"]
        else:
            data.pop("preferred_model", None)
        # Drop the legacy ``model:`` alias if present, same as
        # save_workflow_preferences.
        data.pop("model", None)

        with open(yaml_path, "w") as f:
            yaml.dump(data, f)
        self._emit_yaml_changed(yaml_path)
        return {
            "saved": True,
            "workflow": workflow,
            "preferred_backend": picked["backend"],
            "preferred_model": picked.get("model"),
            "from_configuration": name,
        }

    @service_method("list_run_configurations")
    async def m_list_run_configurations(
        self,
        workflow: Optional[str] = None,
    ) -> Dict[str, Any]:
        """List saved configurations. With ``workflow``, returns just
        that one's. Without, returns a dict keyed by workflow name so
        a CLI/operator can dump everything at once."""
        from brain.context_loader import list_workflow_dirs, load_workflow
        dirs = list_workflow_dirs(self._workspace)
        if workflow is not None:
            if workflow not in dirs:
                return {"error": f"workflow {workflow!r} not found"}
            wf = load_workflow(workflow, self._workspace)
            return {
                "workflow": workflow,
                "configurations": [c.model_dump() for c in wf.configurations],
            }
        out: Dict[str, Any] = {}
        for wf_name in dirs:
            try:
                wf = load_workflow(wf_name, self._workspace)
                out[wf_name] = [c.model_dump() for c in wf.configurations]
            except Exception:  # noqa: BLE001
                out[wf_name] = []
        return {"configurations_by_workflow": out}

    @service_method("write_memory")
    async def m_write_memory(self, kind: str, content: str) -> Dict[str, Any]:
        path = memory_mod.write_observation(self._workspace, kind, content)
        # Stone F: publish a files/changed event so the UI's file
        # browser auto-refreshes (and the markdown view scrolls if
        # the operator is watching memory live).
        try:
            rel = path.relative_to(self._workspace)
            self.publish("files/changed", {
                "path": str(rel),
                "kind": "modified",
                "mtime": path.stat().st_mtime,
            })
        except Exception:  # noqa: BLE001
            pass
        return {"written": True, "path": str(path), "kind": kind, "bytes": len(content)}

    # ─── backend management ──────────────────────────────────────
    #
    # The brain ships with four built-in adapters (mock/ollama/anthropic/
    # openai). The operator picks which one is the *active* default at
    # runtime, and can swap base_url / api_key / model name from the UI
    # without re-installing the service. Changes are persisted via
    # ``self.save_config()`` so they survive a restart.

    @service_method("get_backends")
    async def m_get_backends(self) -> Dict[str, Any]:
        """Return the full backend catalog the operator can pick from.

        Credentials are NOT returned verbatim — we expose a boolean
        ``has_credential`` so the UI can show "configured" / "missing"
        without leaking the secret back to the wire (the panel can still
        write fresh values via set_backend).
        """
        cfg = self.config
        return {
            "active": cfg.default_model,
            "backends": [
                {
                    "name": "mock",
                    "kind": "stub",
                    "configured": True,
                    "fields": {},  # no settings
                },
                {
                    "name": "ollama",
                    "kind": "local",
                    "configured": bool(cfg.ollama_base_url),
                    "fields": {
                        "base_url": cfg.ollama_base_url,
                        "model": cfg.ollama_model,
                    },
                },
                {
                    "name": "anthropic",
                    "kind": "cloud",
                    "configured": self._has_api_key("anthropic"),
                    "fields": {
                        "base_url": cfg.anthropic_base_url,
                        "model": cfg.anthropic_model,
                        "has_credential": self._has_api_key("anthropic"),
                    },
                },
                {
                    "name": "openai",
                    "kind": "cloud",
                    "configured": self._has_api_key("openai"),
                    "fields": {
                        "base_url": cfg.openai_base_url,
                        "model": cfg.openai_model,
                        "has_credential": self._has_api_key("openai"),
                    },
                },
            ],
        }

    @service_method("set_backend")
    async def m_set_backend(
        self,
        name: str,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        make_active: bool = False,
    ) -> Dict[str, Any]:
        """Update one backend's settings. Any field left as None is
        unchanged. Pass an empty string to clear (e.g. ``api_key=""``
        wipes a stored cloud credential).

        ``make_active`` flips ``default_model`` to this backend in the
        same call. Persists immediately.
        """
        cfg = self.config
        if name not in {"mock", "ollama", "anthropic", "openai"}:
            return {"ok": False, "error": f"unknown backend: {name!r}"}

        if name == "ollama":
            if base_url is not None:
                cfg.ollama_base_url = base_url
            if model is not None:
                cfg.ollama_model = model
        elif name == "anthropic":
            if base_url is not None:
                cfg.anthropic_base_url = base_url
            if api_key is not None:
                # Wrap in SecretStr so framework save_config encrypts on
                # the way to disk. Empty string clears the credential.
                cfg.anthropic_api_key = SecretStr(api_key) if api_key else None
            if model is not None:
                cfg.anthropic_model = model
        elif name == "openai":
            if base_url is not None:
                cfg.openai_base_url = base_url
            if api_key is not None:
                cfg.openai_api_key = SecretStr(api_key) if api_key else None
            if model is not None:
                cfg.openai_model = model
        # mock has no settings — make_active still works.

        if make_active:
            cfg.default_model = name

        # Persist + re-publish state so the UI's retained subscription
        # picks up the change without a refresh round-trip.
        self.save_config()
        await self._publish_state()
        return await self.m_get_backends()

    @service_method("set_active_backend")
    async def m_set_active_backend(self, name: str) -> Dict[str, Any]:
        """Switch which backend answers when a workflow doesn't pin one.
        Doesn't touch credentials/URLs/models — just the active selector.
        """
        if name not in {"mock", "ollama", "anthropic", "openai"}:
            return {"ok": False, "error": f"unknown backend: {name!r}"}
        self.config.default_model = name
        self.save_config()
        await self._publish_state()
        return {"ok": True, "active": name}

    @service_method("clear_backend")
    async def m_clear_backend(self, name: str) -> Dict[str, Any]:
        """Wipe credentials + URLs for one backend, restoring defaults.
        If the cleared backend was active, fall back to ``mock`` so the
        service is never stuck pointing at an empty config.
        """
        cfg = self.config
        if name == "ollama":
            cfg.ollama_base_url = "http://localhost:11434"
            cfg.ollama_model = "llama3.1"
        elif name == "anthropic":
            cfg.anthropic_api_key = None
            cfg.anthropic_base_url = "https://api.anthropic.com"
            cfg.anthropic_model = "claude-3-5-sonnet-20241022"
        elif name == "openai":
            cfg.openai_api_key = None
            cfg.openai_base_url = "https://api.openai.com"
            cfg.openai_model = "gpt-4o-mini"
        elif name == "mock":
            pass
        else:
            return {"ok": False, "error": f"unknown backend: {name!r}"}
        if cfg.default_model == name and name != "mock":
            cfg.default_model = "mock"
        self.save_config()
        await self._publish_state()
        return await self.m_get_backends()

    @service_method("list_backend_models")
    async def m_list_backend_models(self, backend: str) -> Dict[str, Any]:
        """Query a backend's "what models are available" endpoint so
        the UI can populate the model dropdown with real ids instead
        of forcing the operator to remember them. Free on every
        provider — no completion is run.

        - ollama:    GET <base_url>/api/tags
        - anthropic: GET <base_url>/v1/models (x-api-key + anthropic-version)
        - openai:    GET <base_url>/v1/models (Bearer auth)
        - mock:      a short hardcoded list for parity

        Returns ``{ok: True, models: [...]}`` on success or
        ``{ok: False, error: "..."}`` on failure (missing key,
        unreachable, etc.).
        """
        import httpx
        cfg = self.config
        if backend == "mock":
            return {"ok": True, "models": ["mock", "mock-fast", "mock-slow"]}
        if backend == "ollama":
            if not cfg.ollama_base_url:
                return {"ok": False, "error": "no ollama_base_url configured"}
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    resp = await client.get(f"{cfg.ollama_base_url.rstrip('/')}/api/tags")
                if resp.status_code != 200:
                    return {"ok": False, "error": f"HTTP {resp.status_code}: {resp.text[:200]}"}
                data = resp.json() or {}
                models = [m.get("name") for m in (data.get("models") or []) if m.get("name")]
                return {"ok": True, "models": sorted(models)}
            except Exception as exc:  # noqa: BLE001
                return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        if backend == "anthropic":
            key = self._api_key("anthropic")
            if not key:
                return {"ok": False, "error": "no api_key configured"}
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.get(
                        f"{cfg.anthropic_base_url.rstrip('/')}/v1/models",
                        headers={
                            "x-api-key": key,
                            "anthropic-version": "2023-06-01",
                        },
                    )
                if resp.status_code != 200:
                    return {"ok": False, "error": f"HTTP {resp.status_code}: {resp.text[:200]}"}
                data = resp.json() or {}
                models = [m.get("id") for m in (data.get("data") or []) if m.get("id")]
                return {"ok": True, "models": sorted(models)}
            except Exception as exc:  # noqa: BLE001
                return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        if backend == "openai":
            key = self._api_key("openai")
            if not key:
                return {"ok": False, "error": "no api_key configured"}
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.get(
                        f"{cfg.openai_base_url.rstrip('/')}/v1/models",
                        headers={"Authorization": f"Bearer {key}"},
                    )
                if resp.status_code != 200:
                    return {"ok": False, "error": f"HTTP {resp.status_code}: {resp.text[:200]}"}
                data = resp.json() or {}
                models = [m.get("id") for m in (data.get("data") or []) if m.get("id")]
                return {"ok": True, "models": sorted(models)}
            except Exception as exc:  # noqa: BLE001
                return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        return {"ok": False, "error": f"unknown backend: {backend!r}"}

    @service_method("test_backend")
    async def m_test_backend(self, name: str) -> Dict[str, Any]:
        """Probe a backend without spending money.

        - mock:      always OK.
        - ollama:    GET <base_url>/api/tags — fast, lists installed models.
        - anthropic/openai: validate that an api_key is present. We don't
                     make a real completion call here because that costs
                     money on every test click; starting a workflow is
                     the real end-to-end test.
        """
        import httpx
        cfg = self.config
        if name == "mock":
            return {"ok": True, "detail": "stub adapter — always available"}
        if name == "ollama":
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    resp = await client.get(f"{cfg.ollama_base_url.rstrip('/')}/api/tags")
                    if resp.status_code != 200:
                        return {"ok": False, "error": f"HTTP {resp.status_code}: {resp.text[:200]}"}
                    data = resp.json() or {}
                    models = [m.get("name") for m in (data.get("models") or []) if m.get("name")]
                    return {
                        "ok": True,
                        "detail": f"ollama up at {cfg.ollama_base_url}",
                        "models": models,
                    }
            except Exception as exc:  # noqa: BLE001
                return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        if name == "anthropic":
            if not self._has_api_key("anthropic"):
                return {"ok": False, "error": "no api_key configured"}
            return {"ok": True, "detail": "api_key present (no live call — start a workflow to verify)"}
        if name == "openai":
            if not self._has_api_key("openai"):
                return {"ok": False, "error": "no api_key configured"}
            return {"ok": True, "detail": "api_key present (no live call — start a workflow to verify)"}
        return {"ok": False, "error": f"unknown backend: {name!r}"}

    # ─── state snapshot ──────────────────────────────────────────

    def _snapshot(self) -> Dict[str, Any]:
        cfg = self.config
        return {
            "workspace": str(self._workspace),
            "default_model": cfg.default_model,
            "active_runs": [
                {
                    "run_id": rid,
                    "status": e.record.status,
                    "workflow": e.workflow.name,
                    # ``backend`` + ``model_id`` are the RESOLVED values
                    # (per-call override > workflow.preferred_* > config
                    # default), not what's in workflow.yaml. The UI's
                    # active-run pill + workflow card read these so what
                    # they display matches what the adapter actually
                    # runs.
                    "backend": e.record.backend,
                    "model_id": e.record.model_id,
                }
                for rid, e in self._runs.items()
            ],
            "tool_count": len(self._tool_catalog),
            # Backend summary so the panel can render without a separate
            # round-trip. Keep parity with m_get_backends but without the
            # has_credential leak prevention (just booleans here).
            "backends": [
                {"name": "mock", "configured": True},
                {"name": "ollama", "configured": bool(cfg.ollama_base_url)},
                {"name": "anthropic", "configured": self._has_api_key("anthropic")},
                {"name": "openai", "configured": self._has_api_key("openai")},
            ],
        }

    async def _publish_state(self) -> None:
        # Service.publish is sync — we keep the wrapper async so callers
        # can chain it with other awaits in lifecycle code.
        self.publish("state", self._snapshot(), retained=True)

    # ─── internals ───────────────────────────────────────────────

    def _api_key(self, backend: str) -> Optional[str]:
        """Return plaintext api_key for a backend, or None when unset.

        Handles both the new SecretStr-typed fields AND the legacy
        plain-str values that may still be in memory immediately after
        boot before save_config has rewritten them. Backward compatible.
        """
        field_name = f"{backend}_api_key"
        value = getattr(self.config, field_name, None)
        if value is None:
            return None
        if isinstance(value, SecretStr):
            plain = value.get_secret_value()
            return plain or None
        return value or None

    def _has_api_key(self, backend: str) -> bool:
        return self._api_key(backend) is not None

    def _resolve_workspace(self) -> Path:
        if self.config.workspace_path:
            return Path(self.config.workspace_path).expanduser().resolve()
        # Default: <data_dir>/brain/<proxy-id>/
        from config import get_settings
        settings = get_settings()
        data_dir = Path(getattr(settings, "data_dir", None) or "data")
        if not data_dir.is_absolute():
            data_dir = Path.cwd() / data_dir
        return (data_dir / "brain" / self.proxy_id).resolve()

    def _adapter(self, name: str) -> ModelAdapter:
        """Resolve adapter by name, using whatever credentials + URLs +
        model the operator has configured for that backend in BrainConfig.

        All four real adapters take a model name now — the field defaults
        on BrainConfig give them a sensible value if the operator hasn't
        overridden one.
        """
        cfg = self.config
        if name == "mock":
            # An empty script is fine for accidentally-mock calls — it
            # terminates with `done` immediately. Real test code passes
            # a populated MockAdapter explicitly.
            return MockAdapter(script=[])
        try:
            if name == "ollama":
                from brain.adapters.ollama import OllamaAdapter
                return OllamaAdapter(
                    base_url=cfg.ollama_base_url,
                    model=cfg.ollama_model,
                    num_ctx=cfg.ollama_num_ctx,
                )
            if name == "openai":
                from brain.adapters.openai import OpenAIAdapter
                return OpenAIAdapter(
                    api_key=self._api_key("openai"),
                    base_url=cfg.openai_base_url,
                    model=cfg.openai_model,
                )
            if name == "anthropic":
                from brain.adapters.anthropic import AnthropicAdapter
                return AnthropicAdapter(
                    api_key=self._api_key("anthropic"),
                    base_url=cfg.anthropic_base_url,
                    model=cfg.anthropic_model,
                )
        except ImportError as exc:
            raise RuntimeError(
                f"adapter {name!r} not available in this build: {exc}"
            ) from exc
        raise ValueError(f"unknown model adapter: {name!r}")

    async def _refresh_tool_catalog(self) -> None:
        """Walk service_meta-style snapshots from the runtime types index
        + populate the tool catalog. For each service type, expose every
        @service_method as a ToolDescriptor. Falls back to an empty
        catalog if /runtime/runtime/types isn't published yet (CI tests)."""
        bus = get_bus()
        try:
            retained = bus.retained_get("/runtime/runtime/types")
        except Exception:  # noqa: BLE001
            return
        if not retained:
            return
        types = retained.payload if hasattr(retained, "payload") else retained
        if not isinstance(types, dict):
            return
        catalog: Dict[str, ToolDescriptor] = {}
        for type_name, descriptor in (types.get("types") or {}).items():
            # For every running proxy of this type, emit a descriptor
            # per method. We discover proxies via /<type>/<proxy_id>/meta
            # subscriptions in _watch_types below.
            for method in descriptor.get("methods", []) or []:
                # We can't fan out to per-proxy topics here without the
                # proxy list — populate generic placeholders and let
                # _watch_types fill in. Skip for now; bundled types
                # without proxies just sit in the catalog with no
                # callable instances.
                pass
        self._tool_catalog = catalog

    async def _watch_types(self) -> None:
        """Subscribe to /+/+/meta + maintain the tool catalog.

        Each retained ``meta`` message on /<type>/<proxy_id>/meta has
        the proxy's methods + their JSON Schemas. We turn each method
        into a ToolDescriptor keyed by ``<topic>::<action>``.
        """
        bus = get_bus()
        try:
            async for msg in bus.subscribe("/+/+/meta", subscriber_id=f"brain-{self.proxy_id}-types"):
                meta = msg.payload if hasattr(msg, "payload") else msg
                if not isinstance(meta, dict):
                    continue
                # The control topic is published verbatim under
                # ``topics.control`` — fully resolved + remapped if
                # the service has topic_remap configured. Use it
                # directly instead of reconstructing from the type
                # name + proxy id (which misses remapping and used to
                # collide with the typo ``topic_root`` vs the actual
                # ``topics_root`` key in the meta payload).
                topics = meta.get("topics") or {}
                control_topic = topics.get("control")
                if not isinstance(control_topic, str) or not control_topic:
                    # Older subprocess services may not advertise full
                    # topics map — fall back to topics_root + /control.
                    root = meta.get("topics_root") or meta.get("topic_root") or ""
                    if not root:
                        continue
                    control_topic = f"{root}/control"
                methods = meta.get("methods") or []
                for m in methods:
                    name = m.get("name")
                    if not name:
                        continue
                    self._tool_catalog[f"{control_topic}::{name}"] = ToolDescriptor(
                        topic=control_topic,
                        action=name,
                        description=(m.get("doc") or "").strip(),
                        parameters=m.get("args_schema") or {},
                    )
                await self._publish_state()
        except asyncio.CancelledError:
            return
        except Exception:  # noqa: BLE001
            logger.exception("brain: _watch_types crashed; tool discovery paused")

    async def _run_to_completion(self, run_id: str, engine: WorkflowEngine) -> None:
        try:
            await engine.run()
        finally:
            self._runs.pop(run_id, None)
            self._run_tasks.pop(run_id, None)
            await self._publish_state()


async def _bus_iter(topic: str, *, sid: str):
    """Adapter from get_bus().subscribe → the tool_executor's
    subscribe_reply contract."""
    async for msg in get_bus().subscribe(topic, subscriber_id=sid):
        payload = msg.payload if hasattr(msg, "payload") else msg
        yield payload
