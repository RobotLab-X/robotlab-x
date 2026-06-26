import { jsxs, jsx, Fragment } from "react/jsx-runtime";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useWsClient, useApiFetch } from "@rlx/ui";
const SERVO_INTERFACE = "servo_controller";
function ServoFullView({ proxy }) {
  const wsClient = useWsClient();
  const apiFetch = useApiFetch();
  const proxyId = proxy.id ?? proxy.name ?? "";
  const stateTopic = `/servo/${proxyId}/state`;
  const controlTopic = `/servo/${proxyId}/control`;
  const [state, setState] = useState({});
  const [candidates, setCandidates] = useState([]);
  const [candidatesError, setCandidatesError] = useState(null);
  const [selectedController, setSelectedController] = useState("");
  const [pinDraft, setPinDraft] = useState("9");
  const [angleDraft, setAngleDraft] = useState(90);
  const [draggingAngle, setDraggingAngle] = useState(false);
  const [speedDraft, setSpeedDraft] = useState(90);
  const [draggingSpeed, setDraggingSpeed] = useState(false);
  useEffect(() => {
    if (!proxyId) return;
    const off = wsClient.subscribe(stateTopic, (f) => {
      if (f.method !== "message") return;
      const next = f.payload;
      setState((prev) => ({ ...prev, ...next }));
    });
    return off;
  }, [proxyId, stateTopic, wsClient]);
  useEffect(() => {
    if (draggingAngle) return;
    if (typeof state.angle === "number") setAngleDraft(state.angle);
  }, [state.angle, draggingAngle]);
  useEffect(() => {
    if (draggingSpeed) return;
    if (typeof state.speed_deg_per_s === "number") setSpeedDraft(state.speed_deg_per_s);
  }, [state.speed_deg_per_s, draggingSpeed]);
  useEffect(() => {
    if (selectedController) return;
    if (state.controller_id) {
      setSelectedController(state.controller_id);
      return;
    }
    if (candidates.length > 0) setSelectedController(candidates[0].id);
  }, [state.controller_id, selectedController, candidates]);
  useEffect(() => {
    if (typeof state.pin === "number") setPinDraft(String(state.pin));
  }, [state.pin]);
  const refreshCandidates = useCallback(async () => {
    try {
      const [metas, proxies] = await Promise.all([
        apiFetch("/v1/service-meta-list"),
        apiFetch("/v1/service-proxy-list")
      ]);
      const compatibleMetaIds = /* @__PURE__ */ new Set();
      const typeForMeta = /* @__PURE__ */ new Map();
      for (const m of metas) {
        const impls = Array.isArray(m.implements) ? m.implements : [];
        if (impls.includes(SERVO_INTERFACE)) {
          const id = `${m.name}@${m.version}`;
          compatibleMetaIds.add(id);
          typeForMeta.set(id, m.name);
        }
      }
      const found = [];
      for (const p of proxies) {
        if (!compatibleMetaIds.has(p.service_meta_id)) continue;
        const pid = p.id ?? p.name;
        if (!pid) continue;
        found.push({
          id: pid,
          type: typeForMeta.get(p.service_meta_id) ?? p.service_meta_id.split("@")[0],
          status: p.status ?? "unknown",
          metaId: p.service_meta_id
        });
      }
      setCandidates(found);
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
  const sendAction = useCallback(
    (payload) => wsClient.publish(controlTopic, payload),
    [controlTopic, wsClient]
  );
  const onAttach = useCallback((e) => {
    e?.preventDefault();
    const c = candidates.find((x) => x.id === selectedController);
    if (!c) {
      console.warn("[servo] attach aborted — no candidate matched", { selectedController, candidates });
      return;
    }
    const pin = Number.parseInt(pinDraft, 10);
    if (Number.isNaN(pin) || pin < 0) {
      console.warn("[servo] attach aborted — bad pin", { pinDraft });
      return;
    }
    const payload = { action: "attach", controller_type: c.type, controller_id: c.id, pin };
    console.info("[servo] publishing attach", { topic: controlTopic, payload });
    sendAction(payload);
  }, [candidates, selectedController, pinDraft, sendAction, controlTopic]);
  const onDetach = useCallback(() => sendAction({ action: "detach" }), [sendAction]);
  const sendWrite = useCallback((angle2) => {
    sendAction({ action: "write", angle: angle2 });
  }, [sendAction]);
  const attached = !!state.attached;
  const min = state.min_angle ?? 0;
  const max = state.max_angle ?? 180;
  const angle = typeof state.angle === "number" ? state.angle : 90;
  const hasNoCandidates = candidates.length === 0;
  const selectedCandidate = candidates.find((c) => c.id === selectedController);
  const selectedCandidateRunning = selectedCandidate?.status === "running";
  return /* @__PURE__ */ jsxs("div", { className: "flex min-w-[420px] flex-col gap-3 p-3 text-xs", children: [
    /* @__PURE__ */ jsx(
      Attachment,
      {
        candidates,
        candidatesError,
        attached,
        currentControllerType: state.controller_type ?? null,
        currentControllerId: state.controller_id ?? null,
        currentPin: state.pin ?? null,
        selectedController,
        onSelect: setSelectedController,
        pinDraft,
        onPinChange: setPinDraft,
        hasNoCandidates,
        selectedCandidateRunning,
        onAttach,
        onDetach,
        onRefresh: refreshCandidates
      }
    ),
    /* @__PURE__ */ jsx(
      Position,
      {
        attached,
        min,
        max,
        angle,
        currentAngle: state.current_angle ?? angle,
        moving: !!state.moving,
        angleDraft,
        setAngleDraft,
        setDraggingAngle,
        speed: state.speed_deg_per_s ?? 90,
        speedControlEnabled: state.speed_control_enabled ?? true,
        speedDraft,
        setSpeedDraft,
        setDraggingSpeed,
        onSetSpeed: (s) => sendAction({ action: "set_speed", speed_deg_per_s: s }),
        onSetSpeedControlEnabled: (enabled) => sendAction({ action: "set_speed_control_enabled", enabled }),
        onWrite: sendWrite,
        onStop: () => sendAction({ action: "stop" }),
        sweeping: !!state.sweeping,
        onSweep: (s, e) => sendAction({ action: "sweep", start: s, end: e }),
        onStopSweep: () => sendAction({ action: "stop_sweep" })
      }
    ),
    /* @__PURE__ */ jsx(
      Limits,
      {
        min,
        max,
        onApply: (lo, hi) => sendAction({ action: "set_limits", min_angle: lo, max_angle: hi })
      }
    )
  ] });
}
function Attachment({
  candidates,
  candidatesError,
  attached,
  currentControllerType,
  currentControllerId,
  currentPin,
  selectedController,
  onSelect,
  pinDraft,
  onPinChange,
  hasNoCandidates,
  selectedCandidateRunning,
  onAttach,
  onDetach,
  onRefresh
}) {
  return /* @__PURE__ */ jsx(Section, { title: "Attachment", children: /* @__PURE__ */ jsxs("form", { className: "flex flex-col gap-2", onSubmit: onAttach, onPointerDown: (e) => e.stopPropagation(), children: [
    attached && /* @__PURE__ */ jsxs("div", { className: "rounded border border-emerald-700 bg-emerald-950/40 p-2 font-mono leading-snug text-emerald-200", children: [
      "attached → ",
      currentControllerType,
      "/",
      currentControllerId,
      " pin ",
      currentPin
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
      /* @__PURE__ */ jsxs(
        "select",
        {
          value: selectedController,
          onChange: (e) => onSelect(e.target.value),
          disabled: attached || hasNoCandidates,
          onPointerDown: (e) => e.stopPropagation(),
          onClick: (e) => e.stopPropagation(),
          className: "nodrag nopan flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-200 focus:border-slate-500 focus:outline-none disabled:opacity-50",
          children: [
            hasNoCandidates && /* @__PURE__ */ jsx("option", { value: "", children: "(no servo_controller services running)" }),
            candidates.map((c) => /* @__PURE__ */ jsxs("option", { value: c.id, children: [
              c.id,
              "  — ",
              c.type,
              "  · ",
              c.status
            ] }, c.id))
          ]
        }
      ),
      /* @__PURE__ */ jsx(ActionButton, { onClick: onRefresh, children: "↻" })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
      /* @__PURE__ */ jsx("label", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: "pin" }),
      /* @__PURE__ */ jsx(
        "input",
        {
          type: "number",
          min: 0,
          value: pinDraft,
          onChange: (e) => onPinChange(e.target.value),
          disabled: attached,
          onPointerDown: (e) => e.stopPropagation(),
          className: "nodrag nopan w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100 focus:border-slate-500 focus:outline-none disabled:opacity-50"
        }
      ),
      !attached ? /* @__PURE__ */ jsx(
        ActionButton,
        {
          tone: "primary",
          onClick: () => onAttach(),
          disabled: hasNoCandidates || !selectedController || !selectedCandidateRunning,
          children: "Attach"
        }
      ) : /* @__PURE__ */ jsx(ActionButton, { onClick: onDetach, children: "Detach" }),
      !attached && selectedController && !selectedCandidateRunning && /* @__PURE__ */ jsx("span", { className: "text-amber-300", children: "controller not running" })
    ] }),
    candidatesError && /* @__PURE__ */ jsxs("div", { className: "rounded border border-rose-700 bg-rose-950/40 px-2 py-1 font-mono text-[11px] text-rose-200", children: [
      "could not load controllers — ",
      candidatesError
    ] }),
    hasNoCandidates && !candidatesError && /* @__PURE__ */ jsxs("div", { className: "text-slate-500", children: [
      "No services declaring ",
      /* @__PURE__ */ jsx("span", { className: "font-mono", children: "implements: [servo_controller]" }),
      " are running. Start an Arduino (or any other implementation) and click ↻."
    ] })
  ] }) });
}
function Position({
  attached,
  min,
  max,
  angle,
  currentAngle,
  moving,
  sweeping,
  angleDraft,
  setAngleDraft,
  setDraggingAngle,
  speed,
  speedControlEnabled,
  speedDraft,
  setSpeedDraft,
  setDraggingSpeed,
  onSetSpeed,
  onSetSpeedControlEnabled,
  onWrite,
  onStop,
  onSweep,
  onStopSweep
}) {
  const [sweepStart, setSweepStart] = useState(min);
  const [sweepEnd, setSweepEnd] = useState(max);
  useEffect(() => {
    setSweepStart((v) => Math.max(min, Math.min(max - 1, v)));
    setSweepEnd((v) => Math.max(min + 1, Math.min(max, v)));
  }, [min, max]);
  if (!attached) {
    return /* @__PURE__ */ jsx(Section, { title: "Position", children: /* @__PURE__ */ jsx("div", { className: "rounded border border-slate-800 bg-slate-950/70 p-2 text-slate-500", children: "Attach to a controller first." }) });
  }
  return /* @__PURE__ */ jsx(Section, { title: "Position", children: /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-3", onPointerDown: (e) => e.stopPropagation(), children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-3", children: [
      /* @__PURE__ */ jsxs("span", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: [
        min,
        "°"
      ] }),
      /* @__PURE__ */ jsx(
        "input",
        {
          type: "range",
          min,
          max,
          step: 1,
          value: angleDraft,
          className: "nodrag nopan flex-1 accent-emerald-500",
          onPointerDown: () => setDraggingAngle(true),
          onPointerUp: () => setDraggingAngle(false),
          onChange: (e) => {
            const v = Number(e.target.value);
            setAngleDraft(v);
            onWrite(v);
          }
        }
      ),
      /* @__PURE__ */ jsxs("span", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: [
        max,
        "°"
      ] }),
      /* @__PURE__ */ jsx(
        "input",
        {
          type: "number",
          min,
          max,
          step: 1,
          value: angleDraft,
          onChange: (e) => setAngleDraft(Number(e.target.value)),
          onBlur: () => onWrite(angleDraft),
          className: "nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100 focus:border-slate-500 focus:outline-none"
        }
      )
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between font-mono text-slate-400", children: [
      /* @__PURE__ */ jsxs("span", { children: [
        "target ",
        angle,
        "°",
        moving && /* @__PURE__ */ jsxs(Fragment, { children: [
          " · ",
          /* @__PURE__ */ jsxs("span", { className: "text-amber-300", children: [
            "live ",
            currentAngle,
            "°"
          ] }),
          " ",
          /* @__PURE__ */ jsx("span", { className: "text-amber-300/70 animate-pulse", children: "moving" })
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "flex gap-2", children: [
        moving && /* @__PURE__ */ jsx(ActionButton, { onClick: onStop, children: "Stop" }),
        /* @__PURE__ */ jsx(ActionButton, { onClick: () => onWrite(angleDraft), children: "Write" })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "border-t border-slate-800 pt-2", children: [
      /* @__PURE__ */ jsxs("div", { className: "mb-1 flex items-baseline justify-between gap-2", children: [
        /* @__PURE__ */ jsx("span", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: "speed control" }),
        /* @__PURE__ */ jsxs("label", { className: "flex cursor-pointer items-center gap-1.5 font-mono text-[10px] text-slate-300", children: [
          /* @__PURE__ */ jsx(
            "input",
            {
              type: "checkbox",
              checked: speedControlEnabled,
              onChange: (e) => onSetSpeedControlEnabled(e.target.checked),
              onPointerDown: (e) => e.stopPropagation(),
              className: "nodrag nopan accent-emerald-500"
            }
          ),
          /* @__PURE__ */ jsx("span", { className: speedControlEnabled ? "text-emerald-300" : "text-slate-500", children: speedControlEnabled ? "interpolated" : "instant" })
        ] })
      ] }),
      /* @__PURE__ */ jsx("div", { className: "mb-1 flex items-baseline justify-between gap-2", children: /* @__PURE__ */ jsxs("span", { className: `font-mono text-[10px] ${speedControlEnabled ? "text-slate-400" : "text-slate-600"}`, children: [
        speedControlEnabled ? `${speedDraft} °/sec` : "writes snap directly to target (no host interpolation)",
        speedControlEnabled && speed !== speedDraft && /* @__PURE__ */ jsx("span", { className: "ml-1 text-amber-400", title: "Drag finished — release will commit", children: "*" })
      ] }) }),
      /* @__PURE__ */ jsxs("div", { className: `flex items-center gap-2 ${speedControlEnabled ? "" : "opacity-40"}`, children: [
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "range",
            min: 1,
            max: 360,
            step: 5,
            value: speedDraft,
            disabled: !speedControlEnabled,
            className: "nodrag nopan flex-1 accent-sky-500 disabled:cursor-not-allowed",
            onPointerDown: () => setDraggingSpeed(true),
            onPointerUp: () => {
              setDraggingSpeed(false);
              if (speedControlEnabled) onSetSpeed(speedDraft);
            },
            onChange: (e) => setSpeedDraft(Number(e.target.value))
          }
        ),
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "number",
            min: 1,
            max: 360,
            step: 5,
            value: speedDraft,
            disabled: !speedControlEnabled,
            onChange: (e) => setSpeedDraft(Math.max(1, Number(e.target.value))),
            onBlur: () => {
              if (speedControlEnabled) onSetSpeed(speedDraft);
            },
            className: "nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100 focus:border-slate-500 focus:outline-none disabled:cursor-not-allowed"
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "border-t border-slate-800 pt-2", children: [
      /* @__PURE__ */ jsxs("div", { className: "mb-1 flex items-baseline justify-between gap-2", children: [
        /* @__PURE__ */ jsxs("span", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: [
          "sweep",
          sweeping && /* @__PURE__ */ jsx("span", { className: "ml-1 text-emerald-400 animate-pulse", children: "running" })
        ] }),
        /* @__PURE__ */ jsxs("span", { className: "font-mono text-[10px] text-slate-400", children: [
          sweepStart,
          "° – ",
          sweepEnd,
          "°"
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
        /* @__PURE__ */ jsxs("span", { className: "font-mono text-[10px] text-slate-500 w-8 text-right", children: [
          min,
          "°"
        ] }),
        /* @__PURE__ */ jsx(
          DualRangeSlider,
          {
            min,
            max,
            low: sweepStart,
            high: sweepEnd,
            onChange: (lo, hi) => {
              setSweepStart(lo);
              setSweepEnd(hi);
            }
          }
        ),
        /* @__PURE__ */ jsxs("span", { className: "font-mono text-[10px] text-slate-500 w-8", children: [
          max,
          "°"
        ] })
      ] }),
      /* @__PURE__ */ jsx("div", { className: "mt-2 flex items-center gap-3 text-[10px] text-slate-400", children: /* @__PURE__ */ jsxs("div", { className: "ml-auto flex gap-2", children: [
        /* @__PURE__ */ jsx(ActionButton, { onClick: onStopSweep, disabled: !sweeping, children: "Stop" }),
        /* @__PURE__ */ jsx(
          ActionButton,
          {
            tone: "primary",
            onClick: () => onSweep(sweepStart, sweepEnd),
            children: "Run"
          }
        )
      ] }) })
    ] })
  ] }) });
}
function Limits({
  min,
  max,
  onApply
}) {
  const [loDraft, setLoDraft] = useState(String(min));
  const [hiDraft, setHiDraft] = useState(String(max));
  useEffect(() => {
    setLoDraft(String(min));
  }, [min]);
  useEffect(() => {
    setHiDraft(String(max));
  }, [max]);
  const dirty = useMemo(
    () => Number(loDraft) !== min || Number(hiDraft) !== max,
    [loDraft, hiDraft, min, max]
  );
  return /* @__PURE__ */ jsx(Section, { title: "Limits", children: /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", onPointerDown: (e) => e.stopPropagation(), children: [
    /* @__PURE__ */ jsx("label", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: "min" }),
    /* @__PURE__ */ jsx(
      "input",
      {
        type: "number",
        min: 0,
        max: 180,
        step: 1,
        value: loDraft,
        onChange: (e) => setLoDraft(e.target.value),
        className: "nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100"
      }
    ),
    /* @__PURE__ */ jsx("label", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: "max" }),
    /* @__PURE__ */ jsx(
      "input",
      {
        type: "number",
        min: 0,
        max: 180,
        step: 1,
        value: hiDraft,
        onChange: (e) => setHiDraft(e.target.value),
        className: "nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100"
      }
    ),
    /* @__PURE__ */ jsx(
      ActionButton,
      {
        tone: "primary",
        disabled: !dirty,
        onClick: () => {
          const lo = Number.parseInt(loDraft, 10);
          const hi = Number.parseInt(hiDraft, 10);
          if (!Number.isNaN(lo) && !Number.isNaN(hi)) onApply(lo, hi);
        },
        children: "Apply"
      }
    )
  ] }) });
}
function Section({ title, children }) {
  return /* @__PURE__ */ jsxs("section", { className: "rounded border border-slate-800 bg-slate-900/40 p-3", children: [
    /* @__PURE__ */ jsx("h3", { className: "mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400", children: title }),
    children
  ] });
}
function DualRangeSlider({
  min,
  max,
  low,
  high,
  onChange
}) {
  const span = Math.max(1, max - min);
  const loPct = (low - min) / span * 100;
  const hiPct = (high - min) / span * 100;
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: "dual-range nodrag nopan relative h-6 flex-1",
      onPointerDown: (e) => e.stopPropagation(),
      children: [
        /* @__PURE__ */ jsx("div", { className: "absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded bg-slate-700" }),
        /* @__PURE__ */ jsx(
          "div",
          {
            className: "absolute top-1/2 -translate-y-1/2 h-1 rounded bg-sky-500",
            style: { left: `${loPct}%`, right: `${100 - hiPct}%` }
          }
        ),
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "range",
            className: "dual-thumb",
            min,
            max,
            step: 1,
            value: low,
            onChange: (e) => {
              const v = Math.min(Number(e.target.value), high - 1);
              onChange(v, high);
            },
            "aria-label": "sweep start angle"
          }
        ),
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "range",
            className: "dual-thumb",
            min,
            max,
            step: 1,
            value: high,
            onChange: (e) => {
              const v = Math.max(Number(e.target.value), low + 1);
              onChange(low, v);
            },
            "aria-label": "sweep end angle"
          }
        )
      ]
    }
  );
}
function ActionButton({
  children,
  onClick,
  disabled,
  tone = "normal",
  type = "button"
}) {
  const base = tone === "primary" ? "bg-emerald-600 text-white hover:bg-emerald-500" : "border border-slate-700 text-slate-200 hover:border-slate-500";
  return /* @__PURE__ */ jsx(
    "button",
    {
      type,
      onClick: (e) => {
        e.stopPropagation();
        onClick?.();
      },
      onPointerDown: (e) => e.stopPropagation(),
      disabled,
      className: `nodrag nopan rounded px-2 py-1 text-xs font-medium ${base} disabled:cursor-not-allowed disabled:opacity-40`,
      children
    }
  );
}
export {
  ServoFullView as default
};
