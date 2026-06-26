import { jsxs, jsx } from "react/jsx-runtime";
import { useState, useCallback, useEffect, useRef } from "react";
import { useWsClient } from "@rlx/ui";
function b64ToInt16(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Int16Array(u8.buffer, 0, u8.length >> 1);
}
function rms16(a) {
  if (!a.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i] / 32768;
    s += v * v;
  }
  return Math.min(1, Math.sqrt(s / a.length));
}
function fmtBytes(n) {
  if (!n) return "0 KB";
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}
function SpeechLocalView({ proxy }) {
  const wsClient = useWsClient();
  const proxyId = proxy.id ?? proxy.name ?? "";
  const T = (s) => `/speech/${proxyId}/${s}`;
  const [state, setState] = useState({});
  const [text, setText] = useState("");
  const [frameLevel, setFrameLevel] = useState(0);
  const sendAction = useCallback(
    (action, args = {}) => wsClient.publish(T("control"), { action, ...args }),
    [wsClient, proxyId]
  );
  useEffect(() => {
    if (!proxyId) return;
    const off = wsClient.subscribe(T("state"), (f) => {
      if (f.method !== "message") return;
      setState(f.payload ?? {});
    });
    sendAction("list_voices");
    return off;
  }, [proxyId, wsClient, sendAction]);
  const ringRef = useRef(new Float32Array(256));
  const pushSamples = useCallback((i16) => {
    const ring = ringRef.current;
    const m = i16.length;
    if (m === 0) return;
    const f = new Float32Array(m);
    for (let i = 0; i < m; i++) f[i] = i16[i] / 32768;
    if (m >= ring.length) ring.set(f.slice(-ring.length));
    else {
      ring.copyWithin(0, m);
      ring.set(f, ring.length - m);
    }
  }, []);
  useEffect(() => {
    if (!proxyId) return;
    return wsClient.subscribe(T("audio"), (f) => {
      if (f.method !== "message") return;
      const fr = f.payload;
      if (!fr?.data) return;
      const i16 = b64ToInt16(fr.data);
      setFrameLevel(rms16(i16));
      pushSamples(i16);
    });
  }, [proxyId, wsClient, pushSamples]);
  const canvasRef = useRef(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cv = canvasRef.current;
      const g = cv?.getContext("2d");
      if (!cv || !g) return;
      const w = cv.width, h = cv.height;
      g.clearRect(0, 0, w, h);
      g.fillStyle = "#0f172a";
      g.fillRect(0, 0, w, h);
      const ring = ringRef.current;
      g.strokeStyle = "#22d3ee";
      g.beginPath();
      g.lineWidth = 1.5;
      for (let i = 0; i < ring.length; i++) {
        const x = i / (ring.length - 1) * w;
        const y = h / 2 - ring[i] * h * 0.46;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  const say = (interrupt) => {
    const t = text.trim();
    if (!t) return;
    sendAction("speak", { text: t, interrupt });
  };
  const onKeyDown = (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      say(false);
    }
  };
  const muted = !!state.muted;
  const voices = state.voices ?? [];
  const level = muted ? 0 : frameLevel;
  const queue = state.queue ?? [];
  const status = state.synthesizing ? "synthesizing…" : state.speaking ? "speaking" : "idle";
  return /* @__PURE__ */ jsxs("div", { className: "rlx-drag-handle space-y-3 p-3 text-sm text-slate-200", children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between", children: [
      /* @__PURE__ */ jsx("span", { className: "font-semibold", children: "Speech" }),
      /* @__PURE__ */ jsx("span", { className: "text-[10px] uppercase tracking-wide text-cyan-400", children: state.source ?? "local" })
    ] }),
    /* @__PURE__ */ jsx(
      "textarea",
      {
        className: "nodrag nopan w-full resize-y rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs",
        rows: 3,
        value: text,
        placeholder: "Type something to say…  (⌘/Ctrl+Enter = Say)",
        onPointerDown: (e) => e.stopPropagation(),
        onKeyDown,
        onChange: (e) => setText(e.target.value)
      }
    ),
    /* @__PURE__ */ jsxs("div", { className: "flex gap-2", children: [
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          onClick: () => say(false),
          className: "nodrag nopan flex-1 rounded bg-cyan-600 px-2 py-1 text-xs font-medium text-white hover:bg-cyan-500",
          onPointerDownCapture: (e) => e.stopPropagation(),
          children: "Say"
        }
      ),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          onClick: () => say(true),
          title: "Interrupt anything playing and say this now",
          className: "nodrag nopan rounded border border-cyan-700 px-2 py-1 text-xs text-cyan-300 hover:border-cyan-500",
          onPointerDownCapture: (e) => e.stopPropagation(),
          children: "Say now"
        }
      ),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          onClick: () => sendAction("stop"),
          title: "Interrupt + clear queue",
          className: "nodrag nopan rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-rose-500 hover:text-rose-300",
          onPointerDownCapture: (e) => e.stopPropagation(),
          children: "Stop"
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
    /* @__PURE__ */ jsxs("label", { className: "block space-y-1", children: [
      /* @__PURE__ */ jsx("span", { className: "text-xs text-slate-400", children: "Voice" }),
      /* @__PURE__ */ jsxs(
        "select",
        {
          value: state.voice ?? "",
          onChange: (e) => sendAction("set_voice", { voice: e.target.value || null }),
          className: "nodrag nopan w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs",
          onPointerDown: (e) => e.stopPropagation(),
          children: [
            /* @__PURE__ */ jsx("option", { value: "", children: "(default voice)" }),
            voices.map((v) => /* @__PURE__ */ jsxs("option", { value: v.id, children: [
              v.label ?? v.id,
              v.downloaded ? "" : " ⤓"
            ] }, v.id))
          ]
        }
      )
    ] }),
    /* @__PURE__ */ jsx("div", { className: "h-2 w-full overflow-hidden rounded bg-slate-800", children: /* @__PURE__ */ jsx("div", { className: "h-full bg-cyan-400 transition-[width] duration-75", style: { width: `${Math.round(level * 100)}%` } }) }),
    /* @__PURE__ */ jsx("canvas", { ref: canvasRef, width: 256, height: 48, className: "h-12 w-full rounded border border-slate-800" }),
    /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-2 text-[10px] text-slate-500", children: [
      /* @__PURE__ */ jsx("span", { className: "w-9 shrink-0 uppercase tracking-wide", children: "Rate" }),
      /* @__PURE__ */ jsx(
        "input",
        {
          type: "range",
          min: 0.5,
          max: 2,
          step: 0.05,
          value: state.rate ?? 1,
          onChange: (e) => sendAction("set_rate", { rate: Number(e.target.value) }),
          className: "nodrag nopan flex-1 accent-cyan-400",
          onPointerDown: (e) => e.stopPropagation()
        }
      ),
      /* @__PURE__ */ jsxs("span", { className: "w-8 text-right tabular-nums text-slate-400", children: [
        (state.rate ?? 1).toFixed(2),
        "×"
      ] })
    ] }),
    /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-2 text-[10px] text-slate-500", children: [
      /* @__PURE__ */ jsx("span", { className: "w-9 shrink-0 uppercase tracking-wide", children: "Vol" }),
      /* @__PURE__ */ jsx(
        "input",
        {
          type: "range",
          min: 0,
          max: 1,
          step: 0.01,
          value: state.volume ?? 1,
          onChange: (e) => sendAction("set_volume", { volume: Number(e.target.value) }),
          className: "nodrag nopan flex-1 accent-cyan-400",
          onPointerDown: (e) => e.stopPropagation()
        }
      ),
      /* @__PURE__ */ jsx("span", { className: "w-8 text-right tabular-nums text-slate-400", children: Math.round((state.volume ?? 1) * 100) })
    ] }),
    state.current_text && /* @__PURE__ */ jsxs("div", { className: "truncate text-[11px] text-slate-400", title: state.current_text, children: [
      "▶ ",
      state.current_text
    ] }),
    queue.length > 0 && /* @__PURE__ */ jsxs("div", { className: "text-[10px] text-slate-500", children: [
      "queued: ",
      queue.length
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between border-t border-slate-800 pt-2 text-[10px] text-slate-500", children: [
      /* @__PURE__ */ jsxs("span", { children: [
        "cache: ",
        state.cache_count ?? 0,
        " · ",
        fmtBytes(state.cache_bytes)
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
        /* @__PURE__ */ jsx("span", { className: muted ? "text-amber-400" : state.speaking || state.synthesizing ? "text-emerald-400" : "text-slate-500", children: status }),
        /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            onClick: () => sendAction("clear_cache"),
            className: "nodrag nopan rounded border border-slate-700 px-1.5 py-0.5 text-slate-400 hover:border-rose-500 hover:text-rose-300",
            onPointerDownCapture: (e) => e.stopPropagation(),
            children: "Clear cache"
          }
        )
      ] })
    ] }),
    state.last_error && /* @__PURE__ */ jsx("div", { className: "text-[10px] text-rose-400", children: state.last_error })
  ] });
}
export {
  SpeechLocalView as default
};
