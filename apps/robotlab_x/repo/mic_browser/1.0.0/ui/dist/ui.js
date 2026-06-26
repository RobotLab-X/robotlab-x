import { jsxs, jsx } from "react/jsx-runtime";
import { useState, useRef, useCallback, useEffect } from "react";
import { useWsClient } from "@rlx/ui";
const FRAME_FORMAT = "pcm_s16le";
function floatToInt16(f) {
  const v = Math.max(-1, Math.min(1, f));
  return v < 0 ? v * 32768 : v * 32767;
}
function int16ToB64(a) {
  const u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}
const WORKLET_SRC = `
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs){ const ch=inputs[0]&&inputs[0][0]; if(ch&&ch.length) this.port.postMessage(ch.slice(0)); return true }
}
registerProcessor('rlx-capture', CaptureProcessor)`;
function makeFramer(srcRate, dstRate, frameSamples, onFrame) {
  const ratio = srcRate / dstRate;
  let srcBuf = new Float32Array(0);
  let pos = 0;
  const acc = [];
  return (chunk) => {
    const buf = new Float32Array(srcBuf.length + chunk.length);
    buf.set(srcBuf);
    buf.set(chunk, srcBuf.length);
    let i = pos;
    while (i < buf.length - 1) {
      const idx = Math.floor(i);
      const frac = i - idx;
      acc.push(floatToInt16(buf[idx] * (1 - frac) + buf[idx + 1] * frac));
      if (acc.length >= frameSamples) onFrame(Int16Array.from(acc.splice(0, frameSamples)));
      i += ratio;
    }
    const keep = Math.floor(i);
    srcBuf = buf.slice(keep);
    pos = i - keep;
  };
}
function MicBrowserView({ proxy }) {
  const wsClient = useWsClient();
  const proxyId = proxy.id ?? proxy.name ?? "";
  const T = (s) => `/microphone/${proxyId}/${s}`;
  const secure = typeof window !== "undefined" ? window.isSecureContext : true;
  const [state, setState] = useState({});
  const [level, setLevel] = useState(0);
  const [filename, setFilename] = useState("");
  const filenameEdited = useRef(false);
  const sendAction = useCallback(
    (action, args = {}) => wsClient.publish(T("control"), { action, ...args }),
    [wsClient, proxyId]
  );
  const streamRef = useRef(null);
  const ctxRef = useRef(null);
  const nodeRef = useRef(null);
  const seqRef = useRef(0);
  const devicesRef = useRef([]);
  const connectedRef = useRef(false);
  const mutedRef = useRef(false);
  const levelRef = useRef(0);
  const report = useCallback((extra = {}) => {
    wsClient.publish(T("report"), {
      ts: Date.now() / 1e3,
      connected: connectedRef.current,
      muted: mutedRef.current,
      level_rms: levelRef.current,
      devices: devicesRef.current,
      ...extra
    });
  }, [wsClient, proxyId]);
  const enumerate = useCallback(async () => {
    try {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
      } catch {
      }
      const all = await navigator.mediaDevices.enumerateDevices();
      devicesRef.current = all.filter((d) => d.kind === "audioinput").map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}`, default: d.deviceId === "default" }));
      report();
    } catch (err) {
      report({ error: err instanceof Error ? err.message : "enumerate failed" });
    }
  }, [report]);
  const disconnect = useCallback(() => {
    nodeRef.current?.disconnect();
    nodeRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => {
    });
    ctxRef.current = null;
    connectedRef.current = false;
    levelRef.current = 0;
    setLevel(0);
    report({ connected: false });
  }, [report]);
  const connect = useCallback(async (p) => {
    if (!secure) {
      report({ error: "microphone needs a secure context (https or localhost)" });
      return;
    }
    disconnect();
    const sampleRate = p.sample_rate || 16e3;
    const frameSamples = Math.max(1, Math.round(sampleRate * (p.frame_ms || 20) / 1e3));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: p.device_id ? { deviceId: { exact: p.device_id } } : true });
      streamRef.current = stream;
      const Ctor = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctor();
      ctxRef.current = ctx;
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" })));
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "rlx-capture");
      nodeRef.current = node;
      const framer = makeFramer(ctx.sampleRate, sampleRate, frameSamples, (pcm) => {
        let s = 0;
        for (let i = 0; i < pcm.length; i++) {
          const v = pcm[i] / 32768;
          s += v * v;
        }
        levelRef.current = pcm.length ? Math.min(1, Math.sqrt(s / pcm.length)) : 0;
        setLevel(levelRef.current);
        if (mutedRef.current) return;
        seqRef.current += 1;
        wsClient.publish(T("audio"), { seq: seqRef.current, ts: Date.now() / 1e3, sample_rate: sampleRate, channels: 1, format: FRAME_FORMAT, data: int16ToB64(pcm) });
      });
      node.port.onmessage = (e) => framer(e.data);
      source.connect(node);
      connectedRef.current = true;
      report({ connected: true });
      void enumerate();
    } catch (err) {
      report({ error: err instanceof Error ? err.message : "getUserMedia failed", connected: false });
    }
  }, [secure, disconnect, report, enumerate, wsClient, proxyId]);
  useEffect(() => {
    if (!proxyId) return;
    const off = wsClient.subscribe(T("state"), (f) => {
      if (f.method !== "message") return;
      const s = f.payload ?? {};
      setState(s);
      mutedRef.current = !!s.muted;
      if (!filenameEdited.current && s.recording_suggested_path) setFilename(s.recording_suggested_path);
    });
    return off;
  }, [proxyId, wsClient]);
  useEffect(() => {
    if (!proxyId) return;
    const off = wsClient.subscribe(T("cmd"), (f) => {
      if (f.method !== "message") return;
      const cmd = f.payload;
      if (cmd.action === "enumerate") void enumerate();
      else if (cmd.action === "connect") void connect(cmd);
      else if (cmd.action === "disconnect") disconnect();
      else if (cmd.action === "set_muted") {
        mutedRef.current = !!cmd.muted;
        report();
      }
    });
    return off;
  }, [proxyId, wsClient, enumerate, connect, disconnect, report]);
  useEffect(() => {
    if (!proxyId) return;
    report();
    void enumerate();
    const hb = setInterval(() => report(), 2e3);
    return () => {
      clearInterval(hb);
      disconnect();
    };
  }, [proxyId, report, enumerate, disconnect]);
  const connected = !!state.connected || connectedRef.current;
  const muted = !!state.muted;
  const recording = !!state.recording;
  const devices = state.devices ?? devicesRef.current;
  return /* @__PURE__ */ jsxs("div", { className: "rlx-drag-handle space-y-3 p-3 text-sm text-slate-200", children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between", children: [
      /* @__PURE__ */ jsx("span", { className: "font-semibold", children: "Microphone" }),
      /* @__PURE__ */ jsx("span", { className: "text-[10px] uppercase tracking-wide text-violet-400", children: state.source ?? "browser" })
    ] }),
    !secure && /* @__PURE__ */ jsx("div", { className: "rounded border border-amber-700 bg-amber-950/40 p-2 text-[11px] text-amber-300", children: "Browser microphone needs a secure context (https or localhost)." }),
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
      connected ? /* @__PURE__ */ jsx("button", { type: "button", onClick: () => sendAction("disconnect"), className: "rounded bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-500", children: "Disconnect" }) : /* @__PURE__ */ jsx("button", { type: "button", disabled: !secure, onClick: () => sendAction("connect"), className: "rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50", children: "Connect" }),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          disabled: !connected,
          onClick: () => sendAction(muted ? "unmute" : "mute"),
          className: `rounded border px-2 py-1 text-xs disabled:opacity-50 ${muted ? "border-amber-500 text-amber-300" : "border-slate-700 text-slate-300 hover:border-slate-500"}`,
          children: muted ? "Unmute" : "Mute"
        }
      )
    ] }),
    /* @__PURE__ */ jsx("div", { className: "h-2 w-full overflow-hidden rounded bg-slate-800", children: /* @__PURE__ */ jsx("div", { className: "h-full bg-violet-400 transition-[width] duration-75", style: { width: `${Math.round((connected && !muted ? level : 0) * 100)}%` } }) }),
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
        recording ? /* @__PURE__ */ jsx("button", { type: "button", onClick: () => sendAction("stop_recording"), className: "rounded bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-500", children: "Stop saving" }) : /* @__PURE__ */ jsx("button", { type: "button", onClick: () => {
          sendAction("start_recording", { path: filename || void 0 });
          filenameEdited.current = false;
        }, className: "rounded border border-emerald-700 px-3 py-1 text-xs font-medium text-emerald-300 hover:border-emerald-500", children: "Record to file" }),
        recording && /* @__PURE__ */ jsxs("span", { className: "text-[10px] text-emerald-400", children: [
          "● ",
          Math.round((state.recorded_bytes ?? 0) / 1024),
          " KB"
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "flex justify-between text-[10px] text-slate-500", children: [
      /* @__PURE__ */ jsxs("span", { children: [
        state.sample_rate ?? 16e3,
        " Hz · mono"
      ] }),
      /* @__PURE__ */ jsx("span", { className: connected ? muted ? "text-amber-400" : "text-emerald-400" : "", children: connected ? muted ? "muted" : "live" : "disconnected" })
    ] }),
    state.last_error && /* @__PURE__ */ jsx("div", { className: "text-[10px] text-rose-400", children: state.last_error })
  ] });
}
export {
  MicBrowserView as default
};
