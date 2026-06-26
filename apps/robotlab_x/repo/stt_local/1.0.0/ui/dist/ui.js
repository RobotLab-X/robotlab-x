import { jsxs, jsx } from "react/jsx-runtime";
import { useState, useRef, useCallback, useEffect } from "react";
import { useWsClient } from "@rlx/ui";
function SttLocalView({ proxy }) {
  const wsClient = useWsClient();
  const proxyId = proxy.id ?? proxy.name ?? "";
  const T = (s) => `/stt/${proxyId}/${s}`;
  const [state, setState] = useState({});
  const [ref, setRef] = useState("");
  const [partial, setPartial] = useState("");
  const [finals, setFinals] = useState([]);
  const refDirty = useRef(false);
  const sendAction = useCallback(
    (action, args = {}) => wsClient.publish(T("control"), { action, ...args }),
    [wsClient, proxyId]
  );
  useEffect(() => {
    if (!proxyId) return;
    const offState = wsClient.subscribe(T("state"), (f) => {
      if (f.method !== "message") return;
      const s = f.payload ?? {};
      setState(s);
      if (!refDirty.current) setRef(s.input_ref ?? "");
    });
    const offText = wsClient.subscribe(T("text"), (f) => {
      if (f.method !== "message") return;
      const t = f.payload;
      const txt = (t?.text ?? "").trim();
      if (t?.final) {
        setPartial("");
        if (txt) setFinals((prev) => [...prev.slice(-49), txt]);
      } else {
        setPartial(txt);
      }
    });
    sendAction("list_models");
    return () => {
      offState();
      offText();
    };
  }, [proxyId, wsClient, sendAction]);
  const logRef = useRef(null);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [finals, partial]);
  const applyInput = () => {
    sendAction("select_input", { kind: ref.trim() ? "topic" : null, ref: ref.trim() || null });
    refDirty.current = false;
  };
  const muted = !!state.muted;
  const listening = !!state.listening;
  const models = state.models ?? [];
  const level = muted ? 0 : state.level_rms ?? 0;
  const status = state.downloading ? "downloading model…" : !state.ready && listening ? "starting…" : listening ? "listening" : "idle";
  return /* @__PURE__ */ jsxs("div", { className: "rlx-drag-handle space-y-3 p-3 text-sm text-slate-200", children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between", children: [
      /* @__PURE__ */ jsx("span", { className: "font-semibold", children: "Speech-to-text" }),
      /* @__PURE__ */ jsx("span", { className: "text-[10px] uppercase tracking-wide text-cyan-400", children: state.source ?? "local" })
    ] }),
    /* @__PURE__ */ jsxs("label", { className: "block space-y-1", children: [
      /* @__PURE__ */ jsx("span", { className: "text-xs text-slate-400", children: "Microphone audio topic" }),
      /* @__PURE__ */ jsxs("div", { className: "flex gap-2", children: [
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "text",
            value: ref,
            onChange: (e) => {
              setRef(e.target.value);
              refDirty.current = true;
            },
            placeholder: "/microphone/mic_local-1/audio",
            className: "nodrag nopan min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px]",
            onPointerDown: (e) => e.stopPropagation()
          }
        ),
        /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            onClick: applyInput,
            className: "nodrag nopan rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500",
            onPointerDownCapture: (e) => e.stopPropagation(),
            children: "Set"
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ jsxs("label", { className: "block space-y-1", children: [
      /* @__PURE__ */ jsx("span", { className: "text-xs text-slate-400", children: "Model" }),
      /* @__PURE__ */ jsxs(
        "select",
        {
          value: state.model ?? "",
          onChange: (e) => sendAction("set_model", { model: e.target.value || null }),
          className: "nodrag nopan w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs",
          onPointerDown: (e) => e.stopPropagation(),
          children: [
            /* @__PURE__ */ jsx("option", { value: "", children: "(default model)" }),
            models.map((m) => /* @__PURE__ */ jsxs("option", { value: m.id, children: [
              m.label ?? m.id,
              m.downloaded ? "" : " ⤓"
            ] }, m.id))
          ]
        }
      )
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "flex gap-2", children: [
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          onClick: () => sendAction(listening ? "stop" : "start"),
          className: `nodrag nopan flex-1 rounded px-2 py-1 text-xs font-medium ${listening ? "border border-rose-600 text-rose-300 hover:bg-rose-950/40" : "bg-cyan-600 text-white hover:bg-cyan-500"}`,
          onPointerDownCapture: (e) => e.stopPropagation(),
          children: listening ? "Stop" : "Start"
        }
      ),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          onClick: () => sendAction(muted ? "unmute" : "mute"),
          className: `nodrag nopan rounded border px-2 py-1 text-xs ${muted ? "border-amber-500 text-amber-300" : "border-slate-700 text-slate-300 hover:border-slate-500"}`,
          onPointerDownCapture: (e) => e.stopPropagation(),
          children: muted ? "Unmute" : "Mute"
        }
      )
    ] }),
    /* @__PURE__ */ jsx("div", { className: "h-2 w-full overflow-hidden rounded bg-slate-800", children: /* @__PURE__ */ jsx("div", { className: "h-full bg-cyan-400 transition-[width] duration-75", style: { width: `${Math.round(level * 100)}%` } }) }),
    /* @__PURE__ */ jsxs("div", { ref: logRef, className: "max-h-40 min-h-[3rem] space-y-1 overflow-y-auto rounded border border-slate-800 bg-slate-950/60 p-2 text-[12px] leading-snug", children: [
      finals.length === 0 && !partial && /* @__PURE__ */ jsx("div", { className: "text-slate-600", children: "…transcript appears here…" }),
      finals.map((t, i) => /* @__PURE__ */ jsx("div", { className: "text-slate-200", children: t }, i)),
      partial && /* @__PURE__ */ jsx("div", { className: "text-cyan-300/80 italic", children: partial })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between text-[10px] text-slate-500", children: [
      /* @__PURE__ */ jsxs("span", { children: [
        "queued: ",
        state.queued ?? 0
      ] }),
      /* @__PURE__ */ jsx("span", { className: muted ? "text-amber-400" : state.downloading ? "text-sky-400" : listening ? "text-emerald-400" : "text-slate-500", children: status })
    ] }),
    state.last_error && /* @__PURE__ */ jsx("div", { className: "text-[10px] text-rose-400", children: state.last_error })
  ] });
}
export {
  SttLocalView as default
};
