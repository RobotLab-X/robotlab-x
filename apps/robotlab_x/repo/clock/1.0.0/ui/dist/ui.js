import { jsxs, jsx, Fragment } from "react/jsx-runtime";
import { useState, useEffect, useCallback } from "react";
import { useWsClient } from "@rlx/ui";
function fmtClock(epochSec) {
  const d = new Date(epochSec * 1e3);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return {
    hms: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    ms: pad(d.getMilliseconds(), 3)
  };
}
const MIN_INTERVAL_MS = 50;
function ClockFullView({ proxy }) {
  const wsClient = useWsClient();
  const proxyId = proxy.id ?? proxy.name ?? "";
  const tickTopic = `/clock/${proxyId}/tick`;
  const stateTopic = `/clock/${proxyId}/state`;
  const controlTopic = `/clock/${proxyId}/control`;
  const [lastTick, setLastTick] = useState(null);
  const [paused, setPaused] = useState(null);
  const [serviceInterval, setServiceInterval] = useState(null);
  const [intervalDraft, setIntervalDraft] = useState("");
  const [editingInterval, setEditingInterval] = useState(false);
  useEffect(() => {
    if (!proxyId) return;
    const offTick = wsClient.subscribe(tickTopic, (f) => {
      if (f.method !== "message") return;
      setLastTick(f.payload);
    });
    const offState = wsClient.subscribe(stateTopic, (f) => {
      if (f.method !== "message") return;
      const p = f.payload;
      setPaused(!!p?.paused);
      if (typeof p?.interval_ms === "number") {
        setServiceInterval(p.interval_ms);
      }
    });
    return () => {
      offTick();
      offState();
    };
  }, [proxyId, tickTopic, stateTopic, wsClient]);
  useEffect(() => {
    if (editingInterval) return;
    if (serviceInterval !== null) setIntervalDraft(String(serviceInterval));
  }, [serviceInterval, editingInterval]);
  const sendControl = useCallback(
    (payload) => {
      wsClient.publish(controlTopic, payload);
    },
    [controlTopic, wsClient]
  );
  const applyInterval = useCallback(
    (e) => {
      e?.preventDefault();
      const parsed = Number.parseInt(intervalDraft, 10);
      if (Number.isNaN(parsed)) return;
      const clamped = Math.max(MIN_INTERVAL_MS, parsed);
      sendControl({ action: "set_interval", interval_ms: clamped });
      setEditingInterval(false);
    },
    [intervalDraft, sendControl]
  );
  const serviceRunning = proxy.status === "running" || proxy.status === "starting";
  const time = lastTick ? fmtClock(lastTick.now) : null;
  const draftDiffers = editingInterval && serviceInterval !== null && Number.parseInt(intervalDraft, 10) !== serviceInterval;
  return /* @__PURE__ */ jsxs("div", { className: "flex min-w-[260px] flex-col gap-2 p-3", children: [
    /* @__PURE__ */ jsx("div", { className: "rounded bg-slate-950/80 px-3 py-2 text-center font-mono", children: time ? /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("span", { className: "text-3xl tracking-wider text-emerald-300", children: time.hms }),
      /* @__PURE__ */ jsxs("span", { className: "ml-1 text-xs text-emerald-500/70", children: [
        ".",
        time.ms
      ] })
    ] }) : /* @__PURE__ */ jsx("span", { className: "text-sm text-slate-500", children: serviceRunning ? "waiting for tick…" : "service not running" }) }),
    /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500", children: [
      /* @__PURE__ */ jsxs("span", { children: [
        "tick #",
        lastTick?.seq ?? "—"
      ] }),
      /* @__PURE__ */ jsx("span", { children: lastTick ? `every ${lastTick.interval_ms}ms` : "" }),
      /* @__PURE__ */ jsx("span", { children: paused === null ? "state ?" : paused ? "paused" : "ticking" })
    ] }),
    /* @__PURE__ */ jsxs(
      "form",
      {
        onSubmit: applyInterval,
        className: "flex items-center gap-2",
        onPointerDown: (e) => e.stopPropagation(),
        children: [
          /* @__PURE__ */ jsx("label", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: "interval ms" }),
          /* @__PURE__ */ jsx(
            "input",
            {
              type: "number",
              min: MIN_INTERVAL_MS,
              step: 50,
              value: intervalDraft,
              onChange: (e) => {
                setIntervalDraft(e.target.value);
                setEditingInterval(true);
              },
              onFocus: () => setEditingInterval(true),
              onClick: (e) => e.stopPropagation(),
              className: "nodrag nopan w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100 focus:border-slate-500 focus:outline-none"
            }
          ),
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "submit",
              onClick: (e) => e.stopPropagation(),
              onPointerDown: (e) => e.stopPropagation(),
              disabled: !serviceRunning || !draftDiffers,
              className: "nodrag nopan rounded border border-slate-700 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-200 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40",
              children: "Apply"
            }
          )
        ]
      }
    ),
    /* @__PURE__ */ jsxs("div", { className: "flex gap-2", children: [
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          onClick: (e) => {
            e.stopPropagation();
            sendControl({ action: "start_clock" });
          },
          onPointerDown: (e) => e.stopPropagation(),
          disabled: !serviceRunning || paused === false,
          className: "nodrag nopan flex-1 rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40",
          children: "Start clock"
        }
      ),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          onClick: (e) => {
            e.stopPropagation();
            sendControl({ action: "stop_clock" });
          },
          onPointerDown: (e) => e.stopPropagation(),
          disabled: !serviceRunning || paused === true,
          className: "nodrag nopan flex-1 rounded border border-slate-700 px-2 py-1 text-xs font-medium text-slate-200 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40",
          children: "Stop clock"
        }
      )
    ] })
  ] });
}
export {
  ClockFullView as default
};
