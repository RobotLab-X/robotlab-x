import { jsxs, jsx } from "react/jsx-runtime";
import { useState, useCallback, useEffect, useMemo } from "react";
import { useWsClient, useApiFetch } from "@rlx/ui";
const MOTOR_CONTROLLER_INTERFACE = "motor_controller";
const JOYSTICK_META_PREFIX = "joystick@";
function MotorControlFullView({ proxy }) {
  const wsClient = useWsClient();
  const apiFetch = useApiFetch();
  const proxyId = proxy.id ?? proxy.name ?? "";
  const stateTopic = `/motor_control/${proxyId}/state`;
  const controlTopic = `/motor_control/${proxyId}/control`;
  const [state, setState] = useState({});
  const [candidates, setCandidates] = useState([]);
  const [joysticks, setJoysticks] = useState([]);
  const [candidatesError, setCandidatesError] = useState(null);
  const [controllerStates, setControllerStates] = useState({});
  const sendAction = useCallback(
    (payload) => {
      wsClient.publish(controlTopic, payload);
    },
    [controlTopic, wsClient]
  );
  useEffect(() => {
    if (!proxyId) return;
    const off = wsClient.subscribe(stateTopic, (f) => {
      if (f.method !== "message") return;
      setState(f.payload);
    });
    return off;
  }, [proxyId, stateTopic, wsClient]);
  const channels = useMemo(() => state.channels ?? [], [state.channels]);
  const boundControllers = useMemo(() => {
    const seen = /* @__PURE__ */ new Map();
    for (const c of channels) {
      if (c.controller_type && c.controller_id) {
        seen.set(`${c.controller_type}/${c.controller_id}`, { type: c.controller_type, id: c.controller_id });
      }
    }
    return Array.from(seen.values());
  }, [channels]);
  useEffect(() => {
    if (boundControllers.length === 0) return;
    const offs = boundControllers.map(({ type, id }) => {
      const key = `${type}/${id}`;
      return wsClient.subscribe(`/${type}/${id}/state`, (f) => {
        if (f.method !== "message") return;
        const p = f.payload ?? {};
        setControllerStates((prev) => ({ ...prev, [key]: p }));
      });
    });
    return () => {
      offs.forEach((off) => off());
    };
  }, [boundControllers.map((c) => `${c.type}/${c.id}`).join("|"), wsClient]);
  const refreshCandidates = useCallback(async () => {
    try {
      const [metas, proxies] = await Promise.all([
        apiFetch("/v1/service-meta-list"),
        apiFetch("/v1/service-proxy-list")
      ]);
      const typeForMeta = /* @__PURE__ */ new Map();
      const compatible = /* @__PURE__ */ new Set();
      for (const m of metas) {
        const impls = Array.isArray(m.implements) ? m.implements : [];
        if (impls.includes(MOTOR_CONTROLLER_INTERFACE)) {
          const id = `${m.name}@${m.version}`;
          compatible.add(id);
          typeForMeta.set(id, m.name);
        }
      }
      const found = [];
      const sticks = [];
      for (const p of proxies) {
        const pid = p.id ?? p.name;
        if (!pid) continue;
        if (compatible.has(p.service_meta_id)) {
          found.push({
            id: pid,
            type: typeForMeta.get(p.service_meta_id) ?? p.service_meta_id.split("@")[0],
            status: p.status ?? "unknown"
          });
        }
        if ((p.service_meta_id ?? "").startsWith(JOYSTICK_META_PREFIX)) {
          sticks.push({ id: pid, name: p.name ?? pid });
        }
      }
      setCandidates(found);
      setJoysticks(sticks);
      setCandidatesError(null);
    } catch (e) {
      setCandidatesError(e instanceof Error ? e.message : String(e));
    }
  }, [apiFetch]);
  useEffect(() => {
    refreshCandidates();
    const t = setInterval(refreshCandidates, 5e3);
    return () => clearInterval(t);
  }, [refreshCandidates]);
  const estopped = !!state.estopped;
  const onStopAll = useCallback(() => sendAction({ action: "stop_all" }), [sendAction]);
  const onClearEstop = useCallback(() => sendAction({ action: "clear_estop" }), [sendAction]);
  const onKeyDown = useCallback((e) => {
    if (e.key !== " " && e.key !== "Enter") return;
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return;
    e.preventDefault();
    e.stopPropagation();
    onStopAll();
  }, [onStopAll]);
  return /* @__PURE__ */ jsxs(
    "div",
    {
      tabIndex: 0,
      onKeyDown,
      onPointerDown: (e) => e.stopPropagation(),
      className: "flex min-w-[520px] flex-col gap-3 p-3 text-xs outline-none focus:ring-1 focus:ring-slate-600 rounded",
      children: [
        /* @__PURE__ */ jsxs(
          "section",
          {
            className: `flex items-center justify-between gap-3 rounded border p-2 ${estopped ? "border-rose-600 bg-rose-950/50" : "border-slate-800 bg-slate-900/40"}`,
            children: [
              /* @__PURE__ */ jsx("div", { className: "flex flex-col", children: estopped ? /* @__PURE__ */ jsx("span", { className: "font-mono text-[11px] font-bold uppercase tracking-wider text-rose-300", children: "⛔ E-STOPPED — motion blocked" }) : /* @__PURE__ */ jsx("span", { className: "font-mono text-[10px] text-slate-500", children: "Space / Enter also triggers STOP when this view is focused" }) }),
              /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
                estopped && /* @__PURE__ */ jsx(
                  "button",
                  {
                    type: "button",
                    onClick: onClearEstop,
                    onPointerDown: (e) => e.stopPropagation(),
                    className: "nodrag nopan rounded border border-slate-600 px-3 py-1 text-[11px] text-slate-200 hover:border-slate-400",
                    children: "Reset"
                  }
                ),
                /* @__PURE__ */ jsx(
                  "button",
                  {
                    type: "button",
                    onClick: onStopAll,
                    onPointerDown: (e) => e.stopPropagation(),
                    className: "nodrag nopan rounded bg-rose-600 px-5 py-2 text-sm font-bold uppercase tracking-wide text-white hover:bg-rose-500",
                    children: "■ STOP"
                  }
                )
              ] })
            ]
          }
        ),
        /* @__PURE__ */ jsx(
          AddChannel,
          {
            candidates,
            candidatesError,
            existingIds: channels.map((c) => c.id),
            onRefresh: refreshCandidates,
            onAdd: (payload) => sendAction({ action: "add_channel", ...payload })
          }
        ),
        channels.length === 0 ? /* @__PURE__ */ jsx("div", { className: "rounded border border-slate-800 bg-slate-950/70 p-3 text-slate-500", children: "No channels yet. Add one above and bind it to a running motor_controller (e.g. a Sabertooth)." }) : channels.map((ch) => /* @__PURE__ */ jsx(
          ChannelCard,
          {
            ch,
            estopped,
            joysticks,
            controllerState: ch.controller_type && ch.controller_id ? controllerStates[`${ch.controller_type}/${ch.controller_id}`] : void 0,
            onSet: (v) => sendAction({ action: "set", id: ch.id, value: v }),
            onStop: () => sendAction({ action: "stop", id: ch.id }),
            onRemove: () => sendAction({ action: "remove_channel", id: ch.id }),
            onSetLimits: (lo, hi, slew) => sendAction({ action: "set_limits", id: ch.id, min_output: lo, max_output: hi, slew_rate: slew }),
            onUpdate: (patch) => sendAction({ action: "update_channel", id: ch.id, ...patch }),
            onSetInput: (src) => sendAction({ action: "set_input", id: ch.id, ...src }),
            onClearInput: () => sendAction({ action: "clear_input", id: ch.id })
          },
          ch.id
        ))
      ]
    }
  );
}
function AddChannel({
  candidates,
  candidatesError,
  existingIds,
  onRefresh,
  onAdd
}) {
  const [label, setLabel] = useState("");
  const [controller, setController] = useState("");
  const [motor, setMotor] = useState("1");
  useEffect(() => {
    if (!controller && candidates.length > 0) setController(candidates[0].id);
  }, [candidates, controller]);
  const dupId = existingIds.includes(label.trim());
  const valid = label.trim().length > 0 && !dupId && !!controller;
  const submit = (e) => {
    e?.preventDefault();
    if (!valid) return;
    const c = candidates.find((x) => x.id === controller);
    if (!c) return;
    onAdd({ id: label.trim(), controller_type: c.type, controller_id: c.id, motor: Number.parseInt(motor, 10) || 1 });
    setLabel("");
    setMotor("1");
  };
  return /* @__PURE__ */ jsxs(Section, { title: "Add channel", children: [
    /* @__PURE__ */ jsxs("form", { className: "flex flex-wrap items-end gap-2", onSubmit: submit, onPointerDown: (e) => e.stopPropagation(), children: [
      /* @__PURE__ */ jsxs("label", { className: "flex flex-col", children: [
        /* @__PURE__ */ jsx("span", { className: "mb-0.5 text-[10px] uppercase tracking-wider text-slate-500", children: "label" }),
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "text",
            value: label,
            placeholder: "e.g. left",
            onChange: (e) => setLabel(e.target.value),
            onPointerDown: (e) => e.stopPropagation(),
            className: "nodrag nopan w-28 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100 focus:border-slate-500 focus:outline-none"
          }
        )
      ] }),
      /* @__PURE__ */ jsxs("label", { className: "flex flex-col", children: [
        /* @__PURE__ */ jsx("span", { className: "mb-0.5 text-[10px] uppercase tracking-wider text-slate-500", children: "controller" }),
        /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1", children: [
          /* @__PURE__ */ jsxs(
            "select",
            {
              value: controller,
              onChange: (e) => setController(e.target.value),
              disabled: candidates.length === 0,
              onPointerDown: (e) => e.stopPropagation(),
              className: "nodrag nopan w-52 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-200 focus:border-slate-500 focus:outline-none disabled:opacity-50",
              children: [
                candidates.length === 0 && /* @__PURE__ */ jsx("option", { value: "", children: "(no motor_controller services running)" }),
                candidates.map((c) => /* @__PURE__ */ jsxs("option", { value: c.id, children: [
                  c.id,
                  " — ",
                  c.type,
                  " · ",
                  c.status
                ] }, c.id))
              ]
            }
          ),
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              onClick: onRefresh,
              onPointerDown: (e) => e.stopPropagation(),
              className: "nodrag nopan rounded border border-slate-700 px-2 py-1 text-[11px] hover:border-slate-500",
              children: "↻"
            }
          )
        ] })
      ] }),
      /* @__PURE__ */ jsxs("label", { className: "flex flex-col", children: [
        /* @__PURE__ */ jsx("span", { className: "mb-0.5 text-[10px] uppercase tracking-wider text-slate-500", children: "motor" }),
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "number",
            min: 1,
            value: motor,
            onChange: (e) => setMotor(e.target.value),
            onPointerDown: (e) => e.stopPropagation(),
            className: "nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100 focus:border-slate-500 focus:outline-none"
          }
        )
      ] }),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "submit",
          disabled: !valid,
          onPointerDown: (e) => e.stopPropagation(),
          className: "nodrag nopan rounded bg-emerald-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40",
          children: "Add"
        }
      ),
      dupId && /* @__PURE__ */ jsx("span", { className: "text-amber-300", children: "id already in use" })
    ] }),
    candidatesError && /* @__PURE__ */ jsxs("div", { className: "mt-2 rounded border border-rose-700 bg-rose-950/40 px-2 py-1 font-mono text-[10px] text-rose-200", children: [
      "could not load controllers — ",
      candidatesError
    ] }),
    candidates.length === 0 && !candidatesError && /* @__PURE__ */ jsxs("div", { className: "mt-1 text-slate-500", children: [
      "No services declaring ",
      /* @__PURE__ */ jsx("span", { className: "font-mono", children: "implements: [motor_controller]" }),
      " are running. Start a Sabertooth (or any other implementation) and click ↻."
    ] })
  ] });
}
function ChannelCard({
  ch,
  estopped,
  joysticks,
  controllerState,
  onSet,
  onStop,
  onRemove,
  onSetLimits,
  onUpdate,
  onSetInput,
  onClearInput
}) {
  const [draft, setDraft] = useState(ch.value);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) setDraft(ch.value);
  }, [ch.value, dragging]);
  const [loDraft, setLoDraft] = useState(String(ch.min_output));
  const [hiDraft, setHiDraft] = useState(String(ch.max_output));
  const [slewDraft, setSlewDraft] = useState(String(ch.slew_rate));
  useEffect(() => {
    setLoDraft(String(ch.min_output));
  }, [ch.min_output]);
  useEffect(() => {
    setHiDraft(String(ch.max_output));
  }, [ch.max_output]);
  useEffect(() => {
    setSlewDraft(String(ch.slew_rate));
  }, [ch.slew_rate]);
  const limitsDirty = Number(loDraft) !== ch.min_output || Number(hiDraft) !== ch.max_output || Number(slewDraft) !== ch.slew_rate;
  const connected = !!controllerState?.connected;
  const hasFeedback = !!controllerState?.has_feedback;
  const feedback = controllerState?.feedback?.[String(ch.motor)];
  const outputPct = Math.round(ch.output * 100);
  const targetPct = Math.round(ch.value * 100);
  const inputBound = !!ch.input_source;
  const disabled = estopped || !ch.enabled || inputBound;
  const sliderMin = ch.min_output;
  const sliderMax = ch.max_output;
  return /* @__PURE__ */ jsxs("section", { className: `rounded border p-3 ${ch.enabled ? "border-slate-800 bg-slate-900/40" : "border-slate-800 bg-slate-950/60 opacity-70"}`, children: [
    /* @__PURE__ */ jsxs("div", { className: "mb-2 flex items-center justify-between gap-2", children: [
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
        /* @__PURE__ */ jsx(
          "span",
          {
            className: `inline-block h-2.5 w-2.5 rounded-full ${ch.bound ? connected ? "bg-emerald-400 shadow-[0_0_6px_1px] shadow-emerald-500/60" : "bg-amber-500" : "bg-slate-600"}`,
            title: ch.bound ? connected ? "controller connected" : "controller offline" : "unbound"
          }
        ),
        /* @__PURE__ */ jsx("span", { className: "font-mono text-[12px] font-semibold text-slate-200", children: ch.id }),
        /* @__PURE__ */ jsx("span", { className: "font-mono text-[10px] text-slate-500", children: ch.bound ? `${ch.controller_type}/${ch.controller_id} · m${ch.motor}` : "unbound" })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
        /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-1 font-mono text-[10px] text-slate-400", children: [
          /* @__PURE__ */ jsx(
            "input",
            {
              type: "checkbox",
              checked: ch.enabled,
              onChange: (e) => onUpdate({ enabled: e.target.checked }),
              onPointerDown: (e) => e.stopPropagation(),
              className: "nodrag nopan accent-emerald-500"
            }
          ),
          "enabled"
        ] }),
        /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-1 font-mono text-[10px] text-slate-400", children: [
          /* @__PURE__ */ jsx(
            "input",
            {
              type: "checkbox",
              checked: ch.invert,
              onChange: (e) => onUpdate({ invert: e.target.checked }),
              onPointerDown: (e) => e.stopPropagation(),
              className: "nodrag nopan accent-sky-500"
            }
          ),
          "invert"
        ] }),
        /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            onClick: onRemove,
            onPointerDown: (e) => e.stopPropagation(),
            title: "Remove channel",
            className: "nodrag nopan rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 hover:border-rose-500 hover:text-rose-300",
            children: "✕"
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-3", children: [
      /* @__PURE__ */ jsxs("span", { className: "w-10 text-right font-mono text-[10px] text-slate-500", children: [
        Math.round(sliderMin * 100),
        "%"
      ] }),
      /* @__PURE__ */ jsx(
        "input",
        {
          type: "range",
          min: sliderMin,
          max: sliderMax,
          step: 0.01,
          value: draft,
          disabled,
          className: "nodrag nopan flex-1 accent-emerald-500 disabled:cursor-not-allowed disabled:opacity-50",
          onPointerDown: () => setDragging(true),
          onPointerUp: () => setDragging(false),
          onChange: (e) => {
            const v = Number(e.target.value);
            setDraft(v);
            onSet(v);
          }
        }
      ),
      /* @__PURE__ */ jsxs("span", { className: "w-10 font-mono text-[10px] text-slate-500", children: [
        Math.round(sliderMax * 100),
        "%"
      ] }),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          onClick: () => {
            setDraft(0);
            onStop();
          },
          onPointerDown: (e) => e.stopPropagation(),
          className: "nodrag nopan rounded border border-slate-700 px-2 py-1 text-[10px] hover:border-rose-500 hover:text-rose-300",
          children: "stop"
        }
      )
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "mt-1 flex items-center gap-4 font-mono text-[10px] text-slate-400", children: [
      /* @__PURE__ */ jsxs("span", { children: [
        "target ",
        /* @__PURE__ */ jsxs("span", { className: targetPct === 0 ? "text-slate-400" : "text-slate-200", children: [
          targetPct > 0 ? "+" : "",
          targetPct,
          "%"
        ] })
      ] }),
      /* @__PURE__ */ jsxs("span", { children: [
        "output ",
        /* @__PURE__ */ jsxs("span", { className: outputPct === 0 ? "text-slate-500" : outputPct > 0 ? "text-emerald-300" : "text-amber-300", children: [
          outputPct > 0 ? "+" : "",
          outputPct,
          "%"
        ] }),
        ch.value !== ch.output && /* @__PURE__ */ jsx("span", { className: "ml-1 animate-pulse text-amber-400/70", children: "ramping" })
      ] }),
      /* @__PURE__ */ jsx("span", { className: "ml-auto", children: !ch.bound ? /* @__PURE__ */ jsx("span", { className: "text-slate-600", children: "no controller" }) : hasFeedback ? /* @__PURE__ */ jsxs("span", { children: [
        "fb ",
        typeof feedback === "number" ? `${Math.round(feedback * 100)}%` : "—"
      ] }) : /* @__PURE__ */ jsx("span", { className: "text-slate-600", children: "open-loop (no feedback)" }) })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "mt-2 flex flex-wrap items-end gap-2 border-t border-slate-800 pt-2", children: [
      /* @__PURE__ */ jsx(LimitInput, { label: "min", value: loDraft, onChange: setLoDraft }),
      /* @__PURE__ */ jsx(LimitInput, { label: "max", value: hiDraft, onChange: setHiDraft }),
      /* @__PURE__ */ jsx(LimitInput, { label: "slew /s", value: slewDraft, onChange: setSlewDraft, min: 0, step: 0.05 }),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          disabled: !limitsDirty,
          onClick: () => {
            const lo = Number(loDraft), hi = Number(hiDraft), slew = Number(slewDraft);
            if (!Number.isNaN(lo) && !Number.isNaN(hi) && !Number.isNaN(slew)) onSetLimits(lo, hi, Math.max(0, slew));
          },
          onPointerDown: (e) => e.stopPropagation(),
          className: "nodrag nopan rounded bg-amber-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40",
          children: "Apply limits"
        }
      ),
      /* @__PURE__ */ jsx("span", { className: "text-[10px] text-slate-500", children: "slew 0 = instant" })
    ] }),
    /* @__PURE__ */ jsx(
      InputSourceRow,
      {
        ch,
        joysticks,
        onSetInput,
        onClearInput
      }
    )
  ] });
}
function InputSourceRow({
  ch,
  joysticks,
  onSetInput,
  onClearInput
}) {
  const src = ch.input_source;
  const [stick, setStick] = useState("");
  const [field, setField] = useState("axes");
  const [index, setIndex] = useState("0");
  const [scale, setScale] = useState("1");
  const [deadzone, setDeadzone] = useState("0.05");
  useEffect(() => {
    if (!stick && joysticks.length > 0) setStick(joysticks[0].id);
  }, [joysticks, stick]);
  if (src) {
    return /* @__PURE__ */ jsxs("div", { className: "mt-2 flex items-center gap-2 border-t border-slate-800 pt-2 font-mono text-[10px]", children: [
      /* @__PURE__ */ jsx("span", { className: "inline-block h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_5px_1px] shadow-sky-500/60", title: "input stream bound" }),
      /* @__PURE__ */ jsx("span", { className: "text-sky-300", children: "live input" }),
      /* @__PURE__ */ jsxs("span", { className: "text-slate-400", children: [
        src.topic,
        " · ",
        src.field,
        "[",
        src.index,
        "] × ",
        src.scale,
        src.offset ? ` ${src.offset >= 0 ? "+" : ""}${src.offset}` : "",
        src.deadzone ? ` · dz ${src.deadzone}` : ""
      ] }),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          onClick: onClearInput,
          onPointerDown: (e) => e.stopPropagation(),
          title: "Unbind input — return to manual slider control",
          className: "nodrag nopan ml-auto rounded border border-slate-700 px-2 py-0.5 text-slate-400 hover:border-rose-500 hover:text-rose-300",
          children: "✕ unbind"
        }
      )
    ] });
  }
  const valid = !!stick;
  const submit = () => {
    if (!valid) return;
    onSetInput({
      topic: `/joystick/${stick}/input`,
      field,
      index: Number.parseInt(index, 10) || 0,
      scale: Number(scale) || 1,
      offset: 0,
      deadzone: Math.max(0, Number(deadzone) || 0)
    });
  };
  return /* @__PURE__ */ jsxs("div", { className: "mt-2 flex flex-wrap items-end gap-2 border-t border-slate-800 pt-2", children: [
    /* @__PURE__ */ jsx("span", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: "input source" }),
    /* @__PURE__ */ jsxs(
      "select",
      {
        value: stick,
        onChange: (e) => setStick(e.target.value),
        disabled: joysticks.length === 0,
        onPointerDown: (e) => e.stopPropagation(),
        className: "nodrag nopan w-40 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-200 focus:border-slate-500 focus:outline-none disabled:opacity-50",
        children: [
          joysticks.length === 0 && /* @__PURE__ */ jsx("option", { value: "", children: "(no joystick running)" }),
          joysticks.map((j) => /* @__PURE__ */ jsxs("option", { value: j.id, children: [
            j.id,
            j.name && j.name !== j.id ? ` — ${j.name}` : ""
          ] }, j.id))
        ]
      }
    ),
    /* @__PURE__ */ jsxs(
      "select",
      {
        value: field,
        onChange: (e) => setField(e.target.value),
        onPointerDown: (e) => e.stopPropagation(),
        className: "nodrag nopan rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-200 focus:border-slate-500 focus:outline-none",
        children: [
          /* @__PURE__ */ jsx("option", { value: "axes", children: "axis" }),
          /* @__PURE__ */ jsx("option", { value: "buttons", children: "button" }),
          /* @__PURE__ */ jsx("option", { value: "hats", children: "hat" })
        ]
      }
    ),
    /* @__PURE__ */ jsx(SmallNum, { label: "index", value: index, onChange: setIndex, min: 0, step: 1, width: "w-14" }),
    /* @__PURE__ */ jsx(SmallNum, { label: "scale", value: scale, onChange: setScale, step: 0.1, width: "w-16" }),
    /* @__PURE__ */ jsx(SmallNum, { label: "deadzone", value: deadzone, onChange: setDeadzone, min: 0, step: 0.01, width: "w-16" }),
    /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        disabled: !valid,
        onClick: submit,
        onPointerDown: (e) => e.stopPropagation(),
        className: "nodrag nopan rounded bg-sky-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40",
        children: "Bind input"
      }
    )
  ] });
}
function SmallNum({
  label,
  value,
  onChange,
  min,
  step = 1,
  width = "w-16"
}) {
  return /* @__PURE__ */ jsxs("label", { className: "flex flex-col gap-0.5", children: [
    /* @__PURE__ */ jsx("span", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: label }),
    /* @__PURE__ */ jsx(
      "input",
      {
        type: "number",
        min,
        step,
        value,
        onChange: (e) => onChange(e.target.value),
        onPointerDown: (e) => e.stopPropagation(),
        className: `nodrag nopan ${width} rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100 focus:border-slate-500 focus:outline-none`
      }
    )
  ] });
}
function LimitInput({
  label,
  value,
  onChange,
  min = -1,
  step = 0.05
}) {
  return /* @__PURE__ */ jsxs("label", { className: "flex flex-col gap-0.5", children: [
    /* @__PURE__ */ jsx("span", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: label }),
    /* @__PURE__ */ jsx(
      "input",
      {
        type: "number",
        min,
        max: 1,
        step,
        value,
        onChange: (e) => onChange(e.target.value),
        onPointerDown: (e) => e.stopPropagation(),
        className: "nodrag nopan w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100 focus:border-slate-500 focus:outline-none"
      }
    )
  ] });
}
function Section({ title, children }) {
  return /* @__PURE__ */ jsxs("section", { className: "rounded border border-slate-800 bg-slate-900/40 p-3", children: [
    /* @__PURE__ */ jsx("h3", { className: "mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400", children: title }),
    children
  ] });
}
export {
  MotorControlFullView as default
};
