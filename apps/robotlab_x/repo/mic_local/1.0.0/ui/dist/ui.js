import { jsxs, jsx } from "react/jsx-runtime";
import { useState, useRef, useCallback, useEffect } from "react";
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
function MicLocalView({ proxy }) {
  const wsClient = useWsClient();
  const proxyId = proxy.id ?? proxy.name ?? "";
  const stateTopic = `/microphone/${proxyId}/state`;
  const controlTopic = `/microphone/${proxyId}/control`;
  const audioTopic = `/microphone/${proxyId}/audio`;
  const [state, setState] = useState({});
  const [level, setLevel] = useState(0);
  const [monitor, setMonitor] = useState(false);
  const [filename, setFilename] = useState("");
  const filenameEdited = useRef(false);
  const sendAction = useCallback(
    (action, args = {}) => wsClient.publish(controlTopic, { action, ...args }),
    [wsClient, controlTopic]
  );
  useEffect(() => {
    if (!proxyId) return;
    const off = wsClient.subscribe(stateTopic, (f) => {
      if (f.method !== "message") return;
      const s = f.payload ?? {};
      setState(s);
      if (!filenameEdited.current && s.recording_suggested_path) setFilename(s.recording_suggested_path);
    });
    sendAction("list_devices");
    return off;
  }, [proxyId, stateTopic, wsClient, sendAction]);
  const ctxRef = useRef(null);
  const nextTimeRef = useRef(0);
  useEffect(() => {
    if (!monitor) {
      ctxRef.current?.close().catch(() => {
      });
      ctxRef.current = null;
      return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    ctxRef.current = new Ctor();
    nextTimeRef.current = 0;
    return () => {
      ctxRef.current?.close().catch(() => {
      });
      ctxRef.current = null;
    };
  }, [monitor]);
  useEffect(() => {
    if (!proxyId) return;
    const off = wsClient.subscribe(audioTopic, (f) => {
      if (f.method !== "message") return;
      const frame = f.payload;
      if (!frame?.data) return;
      const pcm = b64ToInt16(frame.data);
      setLevel(rms16(pcm));
      const ctx = ctxRef.current;
      if (!ctx) return;
      const buf = ctx.createBuffer(1, pcm.length, frame.sample_rate || 16e3);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      const at = Math.max(ctx.currentTime + 0.02, nextTimeRef.current);
      src.start(at);
      nextTimeRef.current = at + buf.duration;
    });
    return off;
  }, [proxyId, audioTopic, wsClient]);
  const connected = !!state.connected;
  const muted = !!state.muted;
  const recording = !!state.recording;
  const devices = state.devices ?? [];
  return /* @__PURE__ */ jsxs("div", { className: "rlx-drag-handle space-y-3 p-3 text-sm text-slate-200", children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between", children: [
      /* @__PURE__ */ jsx("span", { className: "font-semibold", children: "Microphone" }),
      /* @__PURE__ */ jsx("span", { className: "text-[10px] uppercase tracking-wide text-cyan-400", children: state.source ?? "local" })
    ] }),
    /* @__PURE__ */ jsxs("label", { className: "block space-y-1", children: [
      /* @__PURE__ */ jsx("span", { className: "text-xs text-slate-400", children: "Device" }),
      /* @__PURE__ */ jsxs(
        "select",
        {
          value: state.device_id ?? "",
          onChange: (e) => sendAction("select_device", { device_id: e.target.value || null }),
          className: "w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs",
          children: [
            /* @__PURE__ */ jsx("option", { value: "", children: "(default device)" }),
            devices.map((d) => /* @__PURE__ */ jsxs("option", { value: d.id, children: [
              d.label,
              d.default ? " ★" : ""
            ] }, d.id))
          ]
        }
      ),
      state.last_connected_source != null && /* @__PURE__ */ jsxs("span", { className: "block text-[10px] text-slate-500", children: [
        "last connected: ",
        state.last_connected_source
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
      connected ? /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          onClick: () => sendAction("disconnect"),
          className: "rounded bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-500",
          children: "Disconnect"
        }
      ) : /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          onClick: () => sendAction("connect"),
          className: "rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500",
          children: "Connect"
        }
      ),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          disabled: !connected,
          onClick: () => sendAction(muted ? "unmute" : "mute"),
          className: `rounded border px-2 py-1 text-xs disabled:opacity-50 ${muted ? "border-amber-500 text-amber-300" : "border-slate-700 text-slate-300 hover:border-slate-500"}`,
          children: muted ? "Unmute" : "Mute"
        }
      ),
      /* @__PURE__ */ jsxs("label", { className: "ml-auto flex items-center gap-1 text-xs text-slate-400", children: [
        /* @__PURE__ */ jsx("input", { type: "checkbox", checked: monitor, onChange: (e) => setMonitor(e.target.checked) }),
        " Monitor"
      ] })
    ] }),
    /* @__PURE__ */ jsx("div", { className: "h-2 w-full overflow-hidden rounded bg-slate-800", children: /* @__PURE__ */ jsx(
      "div",
      {
        className: "h-full bg-cyan-400 transition-[width] duration-75",
        style: { width: `${Math.round((connected && !muted ? level : 0) * 100)}%` }
      }
    ) }),
    /* @__PURE__ */ jsxs("div", { className: "space-y-1 border-t border-slate-800 pt-2", children: [
      /* @__PURE__ */ jsx("span", { className: "text-xs text-slate-400", children: "Save to file" }),
      /* @__PURE__ */ jsx(
        "input",
        {
          type: "text",
          value: filename,
          onChange: (e) => {
            setFilename(e.target.value);
            filenameEdited.current = true;
          },
          placeholder: "auto filename",
          disabled: recording,
          className: "w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] disabled:opacity-60"
        }
      ),
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
        recording ? /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            onClick: () => sendAction("stop_recording"),
            className: "rounded bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-500",
            children: "Stop saving"
          }
        ) : /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            onClick: () => {
              sendAction("start_recording", { path: filename || void 0 });
              filenameEdited.current = false;
            },
            className: "rounded border border-emerald-700 px-3 py-1 text-xs font-medium text-emerald-300 hover:border-emerald-500",
            children: "Record to file"
          }
        ),
        recording && /* @__PURE__ */ jsxs("span", { className: "text-[10px] text-emerald-400", children: [
          "● ",
          Math.round((state.recorded_bytes ?? 0) / 1024),
          " KB"
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "flex justify-between text-[10px] text-slate-500", children: [
      /* @__PURE__ */ jsxs("span", { children: [
        state.sample_rate ?? "—",
        " Hz · ",
        state.channels === 2 ? "stereo" : "mono"
      ] }),
      /* @__PURE__ */ jsx("span", { className: connected ? muted ? "text-amber-400" : "text-emerald-400" : "", children: connected ? muted ? "muted" : "live" : "disconnected" })
    ] }),
    state.last_error && /* @__PURE__ */ jsx("div", { className: "text-[10px] text-rose-400", children: state.last_error })
  ] });
}
export {
  MicLocalView as default
};
