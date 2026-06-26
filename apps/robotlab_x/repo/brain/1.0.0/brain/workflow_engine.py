# unmanaged
"""WorkflowEngine — the step loop.

Owns one ``WorkflowRun`` (the live state of a single run) and walks
through the standard cycle until success / failure / cancel.

Per step:
  1. Build context (workflow.prompt_md + memory + previous tool results).
  2. Build chat messages from the context.
  3. Ask the adapter to ``complete()`` with the allowed-tool descriptors.
  4. Parse the response → ProposedAction.
  5. Validate via the safety_gate.
  6. If ``done`` → write success, terminate.
  7. If blocked → write failure, terminate.
  8. Else publish to the bus via ToolExecutor + record the result.
  9. Loop.

The engine doesn't know about FastAPI, bus internals, or model
vendors. Everything goes through small interfaces (ModelAdapter,
ToolExecutor, RunLogger) — tests can stub each.
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional

from brain import memory as memory_mod
from brain.adapters.base import ModelAdapter
from brain.context_loader import render_context
from brain.run_logger import RunLogger, _now_iso, make_run_dir
from brain.safety_gate import (
    check_max_steps,
    check_max_tokens,
    check_tool_call,
)
from brain.schemas import (
    ChatMessage,
    ModelResponse,
    ProposedAction,
    RunRecord,
    SafetyVerdict,
    StepRecord,
    ToolCallRecord,
    ToolDescriptor,
    ToolResult,
    Workflow,
)
from brain.tool_executor import ToolExecutor
from robotlab_x.runtime.bus import get_bus


logger = logging.getLogger(__name__)


# Callable that performs a tool call. Wraps ToolExecutor.call so the
# engine can be unit-tested by injecting a stub.
ToolCaller = Callable[[str, str, Dict[str, Any]], Awaitable[ToolResult]]


class WorkflowEngine:
    """Run a workflow to completion.

    Single-shot per run — construct, ``await run()``, read the
    terminal ``RunRecord``. Cancel + approve are exposed via the
    optional events injected at construction time.
    """

    def __init__(
        self,
        *,
        workflow: Workflow,
        workspace_dir: Path,
        adapter: ModelAdapter,
        tool_caller: ToolCaller,
        publish: Callable[..., None],
        bus_prefix: str,
        tool_catalog: Optional[Dict[str, ToolDescriptor]] = None,
        inputs: Optional[Dict[str, Any]] = None,
        backend: Optional[str] = None,
        model_id: Optional[str] = None,
    ):
        self.workflow = workflow
        self.workspace_dir = workspace_dir
        self.adapter = adapter
        self.tool_caller = tool_caller
        self.tool_catalog = tool_catalog or {}
        self.inputs = inputs or {}
        # Direct publish callable (the RunLogger has a separate one
        # scoped to /runs/<run_id>); workflow_events fire on
        # /brain/<proxy_id>/workflow_events so we keep this raw.
        self._publish = publish
        # Per-call model pin. ``model_id`` overrides the adapter's
        # configured default on every ``complete()`` call (see
        # ``_loop``). ``backend`` is the adapter's name — passed in
        # rather than read off ``self.adapter.name`` so the RunRecord
        # matches whatever the caller resolved (workflow.preferred_*
        # vs config default vs start-time override).
        # Fall back to ``workflow.preferred_model`` when no explicit
        # override was passed in — keeps direct WorkflowEngine
        # callers (mostly tests) working without having to resolve
        # the precedence themselves.
        self._model_id = model_id if model_id is not None else workflow.preferred_model

        run_id = uuid.uuid4().hex[:8]
        self.run_id = run_id
        self.run_dir = make_run_dir(workspace_dir, workflow.name, run_id)
        self.logger = RunLogger(
            run_dir=self.run_dir,
            publish=publish,
            bus_prefix=f"{bus_prefix.rstrip('/')}/runs/{run_id}",
        )
        self.record = RunRecord(
            run_id=run_id,
            workflow=workflow.name,
            started_at=_now_iso(),
            status="pending",
            inputs=self.inputs,
            backend=backend or workflow.preferred_backend,
            model_id=model_id,
        )
        # bus_prefix shape is "/brain/<proxy_id>" — derive proxy_id for
        # the workflow_events topic. Falls back to the run dir's parent
        # workspace path if the prefix is malformed.
        parts = bus_prefix.strip("/").split("/")
        self._proxy_id = parts[1] if len(parts) >= 2 and parts[0] == "brain" else ""
        # Engine-driven termination state. ``_actions_succeeded`` is
        # the set of action names that have been called with
        # result.status == "ok" during this run. Compared against
        # ``workflow.terminate_on`` after each tool call.
        self._actions_succeeded: set = set()
        self._tool_calls_attempted = 0
        self._tool_calls_succeeded = 0

        # Approval flow: when requires_human_approval is set, the engine
        # parks before each tool call and waits on this event.
        self._approval_event: Optional[asyncio.Event] = None
        self._approval_decision: Optional[bool] = None
        self._cancel_event = asyncio.Event()

    # ─── public lifecycle ──────────────────────────────────────────

    async def run(self) -> RunRecord:
        """Drive the workflow to a terminal state. Always returns the
        final RunRecord; never raises for normal failures (they're
        recorded on the record)."""
        self.logger.write_input({"workflow": self.workflow.name, "inputs": self.inputs})
        # Prepend a small run-header to the LLM context so:
        #   1. The model has self-awareness of which backend + model
        #      is running it (sometimes useful for prompts that branch
        #      on capability, e.g. "if you are a smaller model, keep
        #      replies short").
        #   2. The captured ``runs/<id>/context.md`` artifact is
        #      self-describing — opening the file later tells you
        #      what model produced these outputs without cross-
        #      referencing ``summary.json``.
        header_lines = [
            "# Run context",
            f"- run_id: {self.run_id}",
            f"- workflow: {self.workflow.name}",
            f"- backend: {self.record.backend}",
            f"- model_id: {self.record.model_id or '(adapter default)'}",
            "",
            "---",
            "",
        ]
        context_body = "\n".join(header_lines) + render_context(
            self.workflow, self.workspace_dir, self.inputs,
        )
        self.logger.write_context(context_body)
        self.record.status = "running"
        self.logger.write_summary(self.record)
        # Workflow-level lifecycle event. Operators/UI subscribe to
        # /brain/<proxy_id>/workflow_events to track every workflow
        # run from start to end without parsing per-run topics.
        self._emit_workflow_event("started")

        messages: List[ChatMessage] = [
            ChatMessage(role="system", content=_system_prompt(self.workflow)),
            ChatMessage(role="user", content=context_body),
        ]
        tools: List[ToolDescriptor] = self._allowed_tool_descriptors()
        # How many tools the model was actually offered this run. Zero
        # is a common silent failure: the workflow allows e.g. listen/
        # speak but the conversation service isn't running, so the
        # catalog has nothing to offer and the model narrates its calls
        # as text (which parses as ``done``). The done-handler surfaces
        # this in its failure message.
        self._tools_offered_count = len(tools)
        # Capture the tool catalog the LLM will see for this run.
        # Adapters override ``encode_tools_for_log`` to return the
        # provider-native wire shape (Ollama/OpenAI {type:"function",
        # function:{name,description,parameters}}; Anthropic
        # {name,description,input_schema}) — exactly what gets sent
        # on the network. Falls back to the brain's internal
        # ``ToolDescriptor`` shape for stub/test adapters that don't
        # override. Static for the run; written once.
        self.logger.write_tools(self.adapter.encode_tools_for_log(tools))

        # Capture our own task ref so the exit-phrase watcher (spawned
        # below) can cancel us cleanly on match. ``asyncio.current_task()``
        # is the task created in service.py via ``asyncio.create_task(
        # _run_to_completion(engine))``.
        self._run_task = asyncio.current_task()
        self._exit_via_phrase = False
        self._exit_phrase_matched: Optional[str] = None
        watcher: Optional[asyncio.Task] = None
        if self.workflow.exit_on_phrase and self.workflow.exit_on_phrase.listen_topic:
            watcher = asyncio.create_task(self._exit_phrase_watcher())

        try:
            await self._loop(messages, tools)
        except asyncio.CancelledError:
            # Distinguish operator-cancel from exit-phrase-cancel. Both
            # raise CancelledError through the await chain; the
            # ``_exit_via_phrase`` flag tells us which initiated it.
            if self._exit_via_phrase:
                self.record.status = "success"
                self.record.result_summary = (
                    f"exit phrase matched: {self._exit_phrase_matched!r}"
                )
                self.record.ended_at = _now_iso()
                self.logger.write_result(self.record.result_summary, status="success")
            else:
                self.record.status = "cancelled"
                self.record.failure_reason = "cancelled by operator"
                self.record.ended_at = _now_iso()
                self.logger.write_result(self.record.failure_reason, status="cancelled")
        except Exception as exc:  # noqa: BLE001
            self.record.status = "failure"
            self.record.failure_reason = f"engine error: {type(exc).__name__}: {exc}"
            self.record.ended_at = _now_iso()
            self.logger.log_error(self.record.failure_reason)
            self.logger.write_result(self.record.failure_reason, status="failure")
            logger.exception("brain.workflow_engine: %s/%s crashed", self.workflow.name, self.run_id)
        finally:
            # Make sure the watcher doesn't outlive the run. The watcher
            # exits naturally when its get_bus().subscribe iterator is
            # cancelled.
            if watcher is not None and not watcher.done():
                watcher.cancel()
                try:
                    await watcher
                except BaseException:  # noqa: BLE001
                    pass
            self.logger.write_summary(self.record)
            self._emit_workflow_event("ended")

        return self.record

    # ─── workflow_events publishing ────────────────────────────────

    def _emit_workflow_event(self, event: str) -> None:
        """Publish a workflow-level lifecycle event to
        /brain/<proxy_id>/workflow_events. Non-retained — each run's
        start/end is a discrete signal, not a state to query.

        Failures are swallowed; missed events don't affect correctness."""
        if not self._proxy_id:
            return
        topic = f"/brain/{self._proxy_id}/workflow_events"
        payload: Dict[str, Any] = {
            "event": event,
            "workflow": self.workflow.name,
            "run_id": self.run_id,
            "started_at": self.record.started_at,
        }
        if event == "started":
            payload["inputs"] = dict(self.inputs)
            payload["model"] = self.workflow.preferred_backend
        elif event == "ended":
            payload["ended_at"] = self.record.ended_at or _now_iso()
            payload["status"] = self.record.status
            payload["tool_calls_count"] = self._tool_calls_succeeded
            if self.record.result_summary:
                payload["result_summary"] = self.record.result_summary
            if self.record.failure_reason:
                payload["failure_reason"] = self.record.failure_reason
            # Duration in milliseconds — wall-clock is what operators
            # care about (vs eval_count token totals).
            try:
                from datetime import datetime
                started = datetime.fromisoformat(self.record.started_at)
                ended = datetime.fromisoformat(payload["ended_at"])
                payload["duration_ms"] = int(
                    (ended - started).total_seconds() * 1000
                )
            except Exception:  # noqa: BLE001
                payload["duration_ms"] = None
        try:
            self._publish(topic, payload)
        except Exception:  # noqa: BLE001
            logger.exception("workflow_events publish failed (%s)", event)

    def cancel(self, reason: str = "") -> None:
        """Request the engine to stop at the next safe checkpoint."""
        if reason:
            self.record.failure_reason = reason
        self._cancel_event.set()
        if self._approval_event is not None and not self._approval_event.is_set():
            self._approval_decision = False
            self._approval_event.set()

    # ─── exit-phrase watcher (E1) ──────────────────────────────────

    async def _exit_phrase_watcher(self) -> None:
        """Subscribe to ``workflow.exit_on_phrase.listen_topic`` and
        match every incoming text payload against the configured
        phrases. On match: set ``_exit_via_phrase`` + cancel the run
        task so an in-flight ``adapter.complete()`` aborts immediately
        — exit latency is bus-RTT, not inference-latency.

        The cancel manifests as ``CancelledError`` in ``run()``, which
        the special-case branch there converts to a clean
        ``status=success`` with a ``result_summary`` naming the
        matched phrase.

        Failures (bus issues, malformed payloads) are logged but
        swallowed — a broken watcher must not crash the run.
        """
        cfg = self.workflow.exit_on_phrase
        if cfg is None or not cfg.listen_topic:
            return
        matches = list(cfg.matches or [])
        if not matches:
            return
        # Pre-normalize so the per-message hot path is just string
        # compare / contains.
        if cfg.case_insensitive:
            matches_norm = [m.lower() for m in matches]
        else:
            matches_norm = matches
        sid = f"brain-engine-{self.run_id}-exit"
        try:
            async for msg in get_bus().subscribe(cfg.listen_topic, subscriber_id=sid):
                payload = msg.payload if hasattr(msg, "payload") else msg
                if not isinstance(payload, dict):
                    continue
                text = payload.get("text")
                if not isinstance(text, str):
                    continue
                candidate = text.strip()
                if cfg.case_insensitive:
                    candidate_norm = candidate.lower()
                else:
                    candidate_norm = candidate
                hit: Optional[str] = None
                for raw_m, norm_m in zip(matches, matches_norm):
                    if cfg.whole_message:
                        if candidate_norm == norm_m:
                            hit = raw_m
                            break
                    else:
                        if norm_m in candidate_norm:
                            hit = raw_m
                            break
                if hit is None:
                    continue
                self._exit_via_phrase = True
                self._exit_phrase_matched = hit
                logger.info(
                    "brain.workflow_engine: exit phrase %r matched on %s — cancelling run %s",
                    hit, cfg.listen_topic, self.run_id,
                )
                if self._run_task is not None and not self._run_task.done():
                    self._run_task.cancel()
                return
        except asyncio.CancelledError:
            # Normal shutdown path — the run.finally cancels us.
            raise
        except Exception:  # noqa: BLE001
            logger.exception(
                "brain.workflow_engine: exit-phrase watcher crashed (run=%s)",
                self.run_id,
            )

    def approve(self, decision: bool) -> bool:
        """Resolve a pending approval gate. Returns True if a gate
        was actually pending; False if there was nothing to approve."""
        if self._approval_event is None or self._approval_event.is_set():
            return False
        self._approval_decision = decision
        self._approval_event.set()
        return True

    # ─── step loop ─────────────────────────────────────────────────

    async def _loop(self, messages: List[ChatMessage], tools: List[ToolDescriptor]) -> None:
        deadline = time.monotonic() + self.workflow.timeout_seconds
        while True:
            if self._cancel_event.is_set():
                raise asyncio.CancelledError()

            verdict = check_max_steps(self.workflow, self.record.steps_used)
            if not verdict.allowed:
                self._terminate_failure(verdict.reason)
                return
            verdict = check_max_tokens(self.workflow, self.record.tokens_used)
            if not verdict.allowed:
                self._terminate_failure(verdict.reason)
                return
            if time.monotonic() > deadline:
                self._terminate_failure(
                    f"workflow.timeout_seconds={self.workflow.timeout_seconds} exceeded"
                )
                return

            # ``self._model_id`` pins a specific model id for this
            # run (e.g. ``llama3.2:3b``). Resolved upstream from per-
            # call override > workflow.preferred_model > None. When
            # None the adapter uses its configured default. Per-call
            # so concurrent runs with different pins on the same
            # adapter instance don't trample each other.
            #
            # Log the exact request before dispatching. ``messages``
            # grows turn-over-turn as tool results are threaded back
            # in; capturing each call gives a full
            # request-stream-over-time view in
            # ``runs/<id>/requests.jsonl``. Pair with steps.jsonl's
            # ``response_raw`` for a complete request/response audit.
            self.logger.log_request({
                "ts": _now_iso(),
                "step": self.record.steps_used,
                "backend": self.adapter.name,
                "model": self._model_id,
                "messages": [m.model_dump() for m in messages],
                "tools": self.adapter.encode_tools_for_log(tools),
            })
            response = await self.adapter.complete(
                messages,
                tools=tools,
                model=self._model_id,
            )
            self.record.tokens_used += response.usage.input_tokens + response.usage.output_tokens

            action = response.action
            verdict = check_tool_call(self.workflow, action, tool_catalog=self.tool_catalog)

            step_rec = StepRecord(
                ts=_now_iso(),
                step=self.record.steps_used,
                model=self.adapter.name,
                prompt_summary=_summarise_messages(messages),
                response_raw=response.raw,
                action=action,
                verdict=verdict,
                usage=response.usage,
            )

            if action.kind == "done":
                self.logger.log_step(step_rec)
                self.record.steps_used += 1
                # Phrase-terminated workflows (exit_on_phrase set) run
                # until the operator says the configured phrase — they
                # are NOT meant to end when the model decides it's
                # finished. A model-emitted ``done`` here is a misfire,
                # not a success. The usual cause: the model had no real
                # tools to call (the conversation service isn't running,
                # so listen/speak aren't in the catalog) so it narrated
                # its intended calls as text, which parses as ``done``.
                # Fail honestly instead of reporting a 0-work success.
                if self.workflow.exit_on_phrase is not None:
                    # Name the ACTUAL model that ran so the message is
                    # truthful about what was sent (no assumptions about
                    # which model is configured).
                    model_desc = self.record.model_id or self.adapter.name
                    if self._tools_offered_count == 0:
                        why = ("no tools were available to the model — is "
                               "the conversation service (e.g. chat) "
                               "running? listen/speak come from it")
                    elif self._tool_calls_succeeded == 0:
                        why = (f"the model ({model_desc}) returned prose "
                               "instead of calling a tool — it must act via "
                               "tools (listen/speak/write), not describe")
                    else:
                        why = (f"the model ({model_desc}) made "
                               f"{self._tool_calls_succeeded} tool call(s) "
                               "then stopped instead of continuing")
                    self._terminate_failure(
                        "model emitted 'done', but this workflow ends only "
                        f"on its exit phrase, not by the model. {why}."
                    )
                    return
                # When ``terminate_on`` is declared, ``done`` is only
                # legitimate AFTER the required actions have actually
                # been called successfully. Without this check, models
                # that emit ``done`` without calling any tools (text-
                # as-JSON encoders like qwen2.5-coder, hallucinated
                # completions) would silently succeed with no work
                # done. Treat that as a failure — the workflow's stated
                # success criterion wasn't met.
                required = {c.action for c in self.workflow.terminate_on}
                if required and not required.issubset(self._actions_succeeded):
                    missing = sorted(required - self._actions_succeeded)
                    self._terminate_failure(
                        f"model emitted done but terminate_on actions "
                        f"were not satisfied: missing {missing}"
                    )
                    return
                self._terminate_success(action.rationale or "done")
                return

            if not verdict.allowed:
                self.logger.log_step(step_rec)
                self.record.steps_used += 1
                self._terminate_failure(f"unsafe tool call: {verdict.reason}")
                return

            if self.workflow.requires_human_approval:
                approved = await self._wait_for_approval()
                if not approved:
                    self.logger.log_step(step_rec)
                    self.record.steps_used += 1
                    self._terminate_failure("operator denied approval")
                    return

            # Execute the tool call. tool_call_id stitches the response
            # back into the conversation as a `role=tool` message.
            tool_call_id = action.tool_call_id or f"tc-{uuid.uuid4().hex[:8]}"
            action.tool_call_id = tool_call_id
            step_rec.action = action
            step_rec.tool_call_id = tool_call_id
            self.logger.log_step(step_rec)

            result = await self.tool_caller(action.topic or "", action.action or "", action.args)
            tcr = ToolCallRecord(
                ts=_now_iso(),
                step=self.record.steps_used,
                tool_call_id=tool_call_id,
                topic=action.topic or "",
                action=action.action or "",
                args=action.args,
                result=result,
            )
            self.logger.log_tool_call(tcr)
            self._tool_calls_attempted += 1
            if result.status == "ok":
                self._tool_calls_succeeded += 1
                # Engine-driven termination: track which actions have
                # been called successfully + check against the
                # workflow's terminate_on requirements.
                self._actions_succeeded.add(action.action or "")
                required = {c.action for c in self.workflow.terminate_on}
                if required and required.issubset(self._actions_succeeded):
                    self.record.steps_used += 1
                    self.logger.write_summary(self.record)
                    self._terminate_success(
                        f"terminate_on satisfied: {sorted(required)}"
                    )
                    return

            # E2 — loop_on_timeout: re-dispatch the SAME tool call
            # (no LLM round-trip, no steps_used increment) while the
            # result keeps matching the configured field/value. The
            # canonical case is ``chat.listen`` returning
            # ``{timeout: true}`` after its wait window — the engine
            # silently re-listens until the operator actually says
            # something, instead of pinging the LLM for a "you got
            # nothing, listen again" turn each time. Operator cancel
            # + wall-clock timeout still fire from inside the inner
            # loop. Each re-dispatch logs a fresh ToolCallRecord for
            # audit; the LLM only sees the final (non-matching)
            # result via the threaded ``tool`` message below.
            lot_cfg = self.workflow.loop_on_timeout
            while (
                lot_cfg is not None
                and (action.action or "") == lot_cfg.tool
                and _matches_loop_on_timeout(result, lot_cfg)
            ):
                if self._cancel_event.is_set():
                    raise asyncio.CancelledError()
                if time.monotonic() > deadline:
                    self._terminate_failure(
                        f"workflow.timeout_seconds={self.workflow.timeout_seconds} exceeded"
                    )
                    return
                redispatch_id = f"tc-{uuid.uuid4().hex[:8]}"
                result = await self.tool_caller(
                    action.topic or "", action.action or "", action.args,
                )
                self.logger.log_tool_call(ToolCallRecord(
                    ts=_now_iso(),
                    step=self.record.steps_used,
                    tool_call_id=redispatch_id,
                    topic=action.topic or "",
                    action=action.action or "",
                    args=action.args,
                    result=result,
                ))
                self._tool_calls_attempted += 1
                if result.status == "ok":
                    self._tool_calls_succeeded += 1

            # Feed the tool result back into the conversation so the
            # next .complete() call sees it. The assistant message
            # carries the tool name + args so adapters that need the
            # full call shape (anthropic ``tool_use`` block, openai
            # ``tool_calls`` array) can reconstruct it. Without these
            # fields, anthropic's API returns 400 because the
            # tool_result's tool_use_id resolves to no prior tool_use.
            messages.append(ChatMessage(
                role="assistant",
                content=action.rationale or "",
                tool_call_id=tool_call_id,
                name=action.action,
                tool_args=action.args,
            ))
            messages.append(ChatMessage(
                role="tool",
                content=_format_tool_result(result),
                tool_call_id=tool_call_id,
                name=f"{action.topic}::{action.action}",
            ))

            # E3 — message_window_size: trim the conversation to keep
            # the LLM's context bounded for long-running workflows
            # (conversation_servo can run for hours; without trimming,
            # ``messages`` grows turn-over-turn into the model's
            # context cap). Always keep the head (system prompt +
            # initial user context_body — the workflow's prompt.md +
            # memory injection) so workflow instructions never fall
            # out of the window; trim only the conversational tail to
            # the last N messages. Drop leading tool-result orphans
            # whose paired assistant message was just trimmed — they
            # confuse adapters that expect tool_use → tool_result
            # adjacency.
            wnd = self.workflow.message_window_size
            if wnd is not None and wnd > 0 and len(messages) > 2 + wnd:
                head = messages[:2]
                tail = messages[2:][-wnd:]
                while tail and tail[0].role == "tool":
                    tail.pop(0)
                messages[:] = head + tail

            self.record.steps_used += 1
            self.logger.write_summary(self.record)

    # ─── terminal transitions ──────────────────────────────────────

    def _terminate_success(self, summary: str) -> None:
        self.record.status = "success"
        self.record.ended_at = _now_iso()
        self.record.result_summary = summary
        body = (self.workflow.success_md or summary).strip()
        self.logger.write_result(body, status="success")

    def _terminate_failure(self, reason: str) -> None:
        self.record.status = "failure"
        self.record.ended_at = _now_iso()
        self.record.failure_reason = reason
        body = (self.workflow.failure_md or reason).strip()
        self.logger.write_result(body + ("\n\n" + reason if self.workflow.failure_md else ""), status="failure")

    # ─── helpers ───────────────────────────────────────────────────

    def _allowed_tool_descriptors(self) -> List[ToolDescriptor]:
        """Filter the live tool catalog down to entries the workflow
        allows. Adapters get this list — they never see anything else,
        so a buggy model can't propose a tool it wasn't shown."""
        out: List[ToolDescriptor] = []
        for descriptor in self.tool_catalog.values():
            v = check_tool_call(
                self.workflow,
                ProposedAction(
                    kind="tool",
                    topic=descriptor.topic,
                    action=descriptor.action,
                ),
            )
            if v.allowed:
                out.append(descriptor)
        return out

    async def _wait_for_approval(self) -> bool:
        self._approval_decision = None
        self._approval_event = asyncio.Event()
        self.record.status = "awaiting_approval"
        self.logger.write_summary(self.record)
        try:
            await self._approval_event.wait()
        finally:
            self.record.status = "running"
            self.logger.write_summary(self.record)
        return bool(self._approval_decision)


# ─── small helpers ──────────────────────────────────────────────────


def _system_prompt(wf: Workflow) -> str:
    """Default system prompt — adapters may augment per their format."""
    lines = [
        f"You are the brain controlling a robot workflow named {wf.name!r}.",
        f"Workflow goal: {wf.description.strip()}".rstrip(),
        "You can only act through the tools provided. Refusing to act with a brief explanation IS valid.",
        "When the workflow is complete, emit a terminal ``done`` action with a one-line summary.",
    ]
    return "\n".join([ln for ln in lines if ln])


def _summarise_messages(messages: List[ChatMessage]) -> str:
    """One-line summary of the current message thread for the step log."""
    return f"{len(messages)} message(s), last role={messages[-1].role if messages else 'none'}"


def _format_tool_result(result: ToolResult) -> str:
    """Render a tool result back into a content string for the model."""
    if result.status == "ok":
        return f"OK {result.value!r}" if result.value is not None else "OK"
    if result.status == "error":
        return f"ERROR {result.error}"
    return f"TIMEOUT {result.error}"


def _matches_loop_on_timeout(result: ToolResult, cfg) -> bool:
    """True when ``result.value`` is a dict whose ``cfg.field`` matches
    ``cfg.value``. Tolerates non-dict payloads (returns False) so a
    misbehaving tool can't trap the engine in the re-dispatch inner
    loop."""
    val = result.value
    if not isinstance(val, dict):
        return False
    return val.get(cfg.field) == cfg.value
