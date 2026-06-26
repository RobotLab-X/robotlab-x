import { jsxs, jsx, Fragment } from "react/jsx-runtime";
import { useState, useRef, useCallback, useEffect } from "react";
import { useWsClient } from "@rlx/ui";
function b64ToInt16(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Int16Array(u8.buffer, 0, u8.length >> 1);
}
function fmtTime(s) {
  if (!s || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
const TBTN = "flex h-7 w-7 items-center justify-center rounded bg-slate-800 text-sm leading-none text-slate-300 hover:bg-slate-700 hover:text-white";
function SpeakerBrowserView({ proxy }) {
  const wsClient = useWsClient();
  const proxyId = proxy.id ?? proxy.name ?? "";
  const T = (s) => `/speaker/${proxyId}/${s}`;
  const [state, setState] = useState({});
  const [level, setLevel] = useState(0);
  const [kind, setKind] = useState("");
  const [ref, setRef] = useState("");
  const [vizMode, setVizMode] = useState("wave");
  const fileInputRef = useRef(null);
  const plFilesRef = useRef(null);
  const plFolderRef = useRef(null);
  const inputDirty = useRef(false);
  const sendAction = useCallback(
    (action, args = {}) => wsClient.publish(T("control"), { action, ...args }),
    [wsClient, proxyId]
  );
  const ctxRef = useRef(null);
  const gainRef = useRef(null);
  const analyserRef = useRef(null);
  const nextTimeRef = useRef(0);
  const connectedRef = useRef(false);
  const mutedRef = useRef(false);
  const volumeRef = useRef(1);
  const kindRef = useRef(null);
  const devicesRef = useRef([]);
  const levelRef = useRef(0);
  const bufRef = useRef(null);
  const srcRef = useRef(null);
  const offsetRef = useRef(0);
  const startedAtRef = useRef(0);
  const playingRef = useRef(false);
  const pausedRef = useRef(false);
  const applyGain = useCallback(() => {
    if (gainRef.current) gainRef.current.gain.value = mutedRef.current ? 0 : volumeRef.current;
  }, []);
  const report = useCallback((extra = {}) => {
    const dur = bufRef.current?.duration ?? 0;
    const pos = playingRef.current && !pausedRef.current && ctxRef.current ? offsetRef.current + (ctxRef.current.currentTime - startedAtRef.current) : offsetRef.current;
    wsClient.publish(T("report"), {
      ts: Date.now() / 1e3,
      connected: connectedRef.current,
      muted: mutedRef.current,
      level_rms: levelRef.current,
      devices: devicesRef.current,
      playing: playingRef.current,
      paused: pausedRef.current,
      position_s: dur ? Math.min(pos, dur) : pos,
      duration_s: dur,
      ...extra
    });
  }, [wsClient, proxyId]);
  const enumerate = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      devicesRef.current = all.filter((d) => d.kind === "audiooutput").map((d, i) => ({ id: d.deviceId, label: d.label || `Speaker ${i + 1}`, default: d.deviceId === "default" }));
      report();
    } catch (err) {
      report({ error: err instanceof Error ? err.message : "enumerate failed" });
    }
  }, [report]);
  const ensureCtx = useCallback(async (deviceId) => {
    if (ctxRef.current) {
      if (ctxRef.current.state === "suspended") {
        try {
          await ctxRef.current.resume();
        } catch {
        }
      }
      return ctxRef.current;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctor();
    ctxRef.current = ctx;
    nextTimeRef.current = 0;
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
      }
    }
    const gain = ctx.createGain();
    gainRef.current = gain;
    applyGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyserRef.current = analyser;
    gain.connect(analyser);
    analyser.connect(ctx.destination);
    const anyCtx = ctx;
    if (deviceId && typeof anyCtx.setSinkId === "function") {
      try {
        await anyCtx.setSinkId(deviceId);
      } catch {
      }
    }
    return ctx;
  }, [applyGain]);
  const teardown = useCallback(() => {
    srcRef.current?.stop();
    srcRef.current = null;
    ctxRef.current?.close().catch(() => {
    });
    ctxRef.current = null;
    gainRef.current = null;
    analyserRef.current = null;
    connectedRef.current = false;
    playingRef.current = false;
    levelRef.current = 0;
    setLevel(0);
  }, []);
  const stopSrc = useCallback(() => {
    try {
      srcRef.current?.stop();
    } catch {
    }
    srcRef.current = null;
  }, []);
  const startBuffer = useCallback(async () => {
    const ctx = await ensureCtx(state.device_id);
    if (!bufRef.current) return;
    stopSrc();
    const src = ctx.createBufferSource();
    src.buffer = bufRef.current;
    src.connect(gainRef.current);
    src.start(0, Math.max(0, offsetRef.current));
    startedAtRef.current = ctx.currentTime;
    srcRef.current = src;
    src.onended = () => {
      if (srcRef.current === src) {
        playingRef.current = false;
        offsetRef.current = 0;
        report({ ended: true });
      }
    };
    playingRef.current = true;
    pausedRef.current = false;
    report();
  }, [ensureCtx, state.device_id, stopSrc, report]);
  const pauseBuffer = useCallback(() => {
    if (ctxRef.current && playingRef.current && !pausedRef.current) offsetRef.current += ctxRef.current.currentTime - startedAtRef.current;
    stopSrc();
    pausedRef.current = true;
    playingRef.current = false;
    report();
  }, [stopSrc, report]);
  const stopBuffer = useCallback(() => {
    stopSrc();
    offsetRef.current = 0;
    playingRef.current = false;
    pausedRef.current = false;
    report();
  }, [stopSrc, report]);
  const seekBuffer = useCallback((pos) => {
    offsetRef.current = Math.max(0, pos);
    if (playingRef.current) void startBuffer();
    else report();
  }, [startBuffer, report]);
  const loadBuffer = useCallback(async (data) => {
    try {
      const ctx = await ensureCtx(state.device_id);
      bufRef.current = await ctx.decodeAudioData(data);
      offsetRef.current = 0;
      playingRef.current = true;
      pausedRef.current = false;
      await startBuffer();
    } catch (err) {
      report({ error: err instanceof Error ? err.message : "decode failed" });
    }
  }, [ensureCtx, state.device_id, startBuffer, report]);
  const applyInput = useCallback((k, r) => {
    kindRef.current = k || null;
    bufRef.current = null;
    stopSrc();
    offsetRef.current = 0;
    if (k === "url" && r) void fetch(r).then((x) => x.arrayBuffer()).then(loadBuffer).catch((e) => report({ error: String(e) }));
  }, [stopSrc, loadBuffer, report]);
  const playFrame = useCallback(async (fr) => {
    if (!connectedRef.current || pausedRef.current || !fr?.data) return;
    const ctx = await ensureCtx(state.device_id);
    const pcm = b64ToInt16(fr.data);
    const ab = ctx.createBuffer(1, pcm.length, fr.sample_rate || 16e3);
    const ch = ab.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = ab;
    src.connect(gainRef.current);
    const at = Math.max(ctx.currentTime + 0.02, nextTimeRef.current);
    src.start(at);
    nextTimeRef.current = at + ab.duration;
  }, [ensureCtx, state.device_id]);
  const transport = useCallback((op) => {
    const isBuffer2 = kindRef.current === "url" || kindRef.current === "file";
    if (op === "play") {
      pausedRef.current = false;
      if (isBuffer2) void startBuffer();
      else {
        playingRef.current = true;
        report();
      }
    } else if (op === "pause") {
      if (isBuffer2) pauseBuffer();
      else {
        pausedRef.current = true;
        report();
      }
    } else if (op === "stop") {
      if (isBuffer2) stopBuffer();
      else {
        pausedRef.current = true;
        report();
      }
    } else ;
  }, [startBuffer, pauseBuffer, stopBuffer, report]);
  useEffect(() => {
    if (!proxyId) return;
    const off = wsClient.subscribe(T("state"), (f) => {
      if (f.method !== "message") return;
      const s = f.payload ?? {};
      setState(s);
      mutedRef.current = !!s.muted;
      volumeRef.current = s.volume ?? 1;
      applyGain();
      kindRef.current = s.input_kind ?? null;
      if (!inputDirty.current) {
        setKind(s.input_kind ?? "");
        setRef(s.input_ref ?? "");
      }
    });
    return off;
  }, [proxyId, wsClient, applyGain]);
  useEffect(() => {
    if (!proxyId) return;
    const onFrame = (which) => (f) => {
      if (f.method !== "message") return;
      const active = kindRef.current || null;
      if (which === "sink" && active === null || which === "topic" && active === "topic") void playFrame(f.payload);
    };
    const offs = [wsClient.subscribe(T("audio"), onFrame("sink"))];
    if (state.input_kind === "topic" && state.input_ref) offs.push(wsClient.subscribe(state.input_ref, onFrame("topic")));
    return () => offs.forEach((o) => o());
  }, [proxyId, wsClient, state.input_kind, state.input_ref, playFrame]);
  useEffect(() => {
    if (!proxyId) return;
    const off = wsClient.subscribe(T("cmd"), (f) => {
      if (f.method !== "message") return;
      const cmd = f.payload;
      if (cmd.action === "enumerate") void enumerate();
      else if (cmd.action === "connect") {
        void ensureCtx(cmd.device_id).then(() => {
          connectedRef.current = true;
          report({ connected: true });
          applyInput(cmd.input_kind ?? null, cmd.input_ref ?? null);
          void enumerate();
        });
      } else if (cmd.action === "disconnect") {
        teardown();
        report({ connected: false });
      } else if (cmd.action === "set_muted") {
        mutedRef.current = !!cmd.muted;
        applyGain();
        report();
      } else if (cmd.action === "set_volume") {
        volumeRef.current = cmd.volume ?? 1;
        applyGain();
        report();
      } else if (cmd.action === "set_input") applyInput(cmd.input_kind ?? null, cmd.input_ref ?? null);
      else if (cmd.action === "transport") {
        if (cmd.op === "seek" && typeof cmd.position_s === "number") seekBuffer(cmd.position_s);
        else if (cmd.op) transport(cmd.op);
      }
    });
    return off;
  }, [proxyId, wsClient, enumerate, ensureCtx, teardown, report, applyInput, applyGain, transport, seekBuffer]);
  useEffect(() => {
    if (!proxyId) return;
    report();
    void enumerate();
    const tick = setInterval(() => {
      const an = analyserRef.current;
      if (an) {
        const a = new Float32Array(an.fftSize);
        an.getFloatTimeDomainData(a);
        let s = 0;
        for (let i = 0; i < a.length; i++) s += a[i] * a[i];
        levelRef.current = Math.min(1, Math.sqrt(s / a.length));
        setLevel(levelRef.current);
      }
      report();
    }, 400);
    return () => {
      clearInterval(tick);
      teardown();
      report({ connected: false });
    };
  }, [proxyId, report, enumerate, teardown]);
  const canvasRef = useRef(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const an = analyserRef.current;
      const cv = canvasRef.current;
      const g = cv?.getContext("2d");
      if (!cv || !g) return;
      const w = cv.width, h = cv.height;
      g.clearRect(0, 0, w, h);
      g.fillStyle = "#0f172a";
      g.fillRect(0, 0, w, h);
      if (!an) return;
      g.strokeStyle = "#a78bfa";
      g.fillStyle = "#a78bfa";
      if (vizMode === "wave") {
        const buf = new Float32Array(an.fftSize);
        an.getFloatTimeDomainData(buf);
        g.beginPath();
        g.lineWidth = 1.5;
        for (let i = 0; i < buf.length; i++) {
          const x = i / (buf.length - 1) * w;
          const y = h / 2 - buf[i] * h * 0.46;
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
      } else {
        const bins = new Uint8Array(an.frequencyBinCount);
        an.getByteFrequencyData(bins);
        const n = 40, step = Math.max(1, Math.floor(bins.length / n));
        for (let b = 0; b < n; b++) {
          let m = 0;
          for (let j = 0; j < step; j++) m = Math.max(m, bins[b * step + j]);
          const bh = m / 255 * h;
          g.fillRect(b / n * w + 1, h - bh, w / n - 2, bh);
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [vizMode]);
  const onPickFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    kindRef.current = "file";
    setRef(file.name);
    inputDirty.current = false;
    file.arrayBuffer().then((ab) => {
      void loadBuffer(ab);
    });
    report({ input_kind: "file", input_ref: file.name });
  };
  const muted = !!state.muted;
  const devices = state.devices ?? devicesRef.current;
  const isBuffer = state.input_kind === "file" || state.input_kind === "url";
  const playlist = state.playlist ?? [];
  const plIdx = state.playlist_index ?? -1;
  const repeat = state.repeat ?? "off";
  const shuffle = !!state.shuffle;
  const cycleRepeat = () => sendAction("set_repeat", { mode: repeat === "off" ? "all" : repeat === "all" ? "one" : "off" });
  const addFiles = (files) => {
    const items = Array.from(files ?? []).filter((f) => f.type.startsWith("audio/") || /\.(wav|mp3|ogg|oga|flac|m4a|aac|opus|webm|aiff?|)$/i.test(f.name)).map((f) => ({ kind: "url", ref: URL.createObjectURL(f), name: f.name }));
    if (items.length) sendAction("playlist_add", { items });
  };
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: "rlx-drag-handle space-y-3 p-3 text-sm text-slate-200",
      onPointerDown: () => {
        void ensureCtx(state.device_id);
      },
      children: [
        /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between", children: [
          /* @__PURE__ */ jsx("span", { className: "font-semibold", children: "Speaker" }),
          /* @__PURE__ */ jsx("span", { className: "text-[10px] uppercase tracking-wide text-violet-400", children: state.source ?? "browser" })
        ] }),
        /* @__PURE__ */ jsxs("label", { className: "block space-y-1", children: [
          /* @__PURE__ */ jsx("span", { className: "text-xs text-slate-400", children: "Output device" }),
          /* @__PURE__ */ jsxs(
            "select",
            {
              value: state.device_id ?? "",
              onChange: (e) => sendAction("select_device", { device_id: e.target.value || null }),
              className: "w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs",
              children: [
                /* @__PURE__ */ jsx("option", { value: "", children: "(default output)" }),
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
        /* @__PURE__ */ jsxs("div", { className: "space-y-1 border-t border-slate-800 pt-2", children: [
          /* @__PURE__ */ jsx("span", { className: "text-xs text-slate-400", children: "Input" }),
          /* @__PURE__ */ jsxs("div", { className: "flex gap-2", children: [
            /* @__PURE__ */ jsxs("select", { value: kind, onChange: (e) => {
              setKind(e.target.value);
              inputDirty.current = true;
            }, className: "rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs", children: [
              /* @__PURE__ */ jsx("option", { value: "", children: "Sink" }),
              /* @__PURE__ */ jsx("option", { value: "topic", children: "Topic" }),
              /* @__PURE__ */ jsx("option", { value: "file", children: "File" }),
              /* @__PURE__ */ jsx("option", { value: "url", children: "URL" })
            ] }),
            kind === "file" ? /* @__PURE__ */ jsxs(Fragment, { children: [
              /* @__PURE__ */ jsx("input", { ref: fileInputRef, type: "file", accept: "audio/*", onChange: onPickFile, className: "hidden" }),
              /* @__PURE__ */ jsx("button", { type: "button", onClick: () => fileInputRef.current?.click(), className: "min-w-0 flex-1 truncate rounded border border-slate-700 px-2 py-1 text-left text-[11px] text-slate-300 hover:border-slate-500", children: ref || "choose file…" })
            ] }) : kind !== "" ? /* @__PURE__ */ jsx(
              "input",
              {
                type: "text",
                value: ref,
                onChange: (e) => {
                  setRef(e.target.value);
                  inputDirty.current = true;
                },
                placeholder: kind === "topic" ? "/microphone/mic-1/audio" : "https://…/audio.mp3",
                className: "min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px]"
              }
            ) : /* @__PURE__ */ jsxs("span", { className: "flex-1 self-center text-[10px] text-slate-500", children: [
              "plays /speaker/",
              proxyId,
              "/audio"
            ] }),
            kind !== "file" && /* @__PURE__ */ jsx("button", { type: "button", onClick: () => {
              sendAction("select_input", { kind: kind || null, ref: ref || null });
              inputDirty.current = false;
            }, className: "rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500", children: "Set" })
          ] })
        ] }),
        /* @__PURE__ */ jsx("div", { className: "flex items-center gap-2", children: /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            onClick: () => sendAction(muted ? "unmute" : "mute"),
            className: `rounded border px-2 py-1 text-xs ${muted ? "border-amber-500 text-amber-300" : "border-slate-700 text-slate-300 hover:border-slate-500"}`,
            children: muted ? "Unmute" : "Mute"
          }
        ) }),
        /* @__PURE__ */ jsx("div", { className: "h-2 w-full overflow-hidden rounded bg-slate-800", children: /* @__PURE__ */ jsx("div", { className: "h-full bg-violet-400 transition-[width] duration-75", style: { width: `${Math.round((!muted ? level : 0) * 100)}%` } }) }),
        /* @__PURE__ */ jsxs("div", { className: "relative", children: [
          /* @__PURE__ */ jsx("canvas", { ref: canvasRef, width: 256, height: 56, className: "h-14 w-full rounded border border-slate-800" }),
          /* @__PURE__ */ jsxs("div", { className: "absolute right-1 top-1 flex gap-1", children: [
            /* @__PURE__ */ jsx("button", { type: "button", title: "Waveform", onClick: () => setVizMode("wave"), className: `rounded px-1 text-[10px] ${vizMode === "wave" ? "bg-violet-600 text-white" : "bg-slate-800/80 text-slate-400 hover:text-slate-200"}`, children: "∿" }),
            /* @__PURE__ */ jsx("button", { type: "button", title: "Spectrum", onClick: () => setVizMode("bars"), className: `rounded px-1 text-[10px] ${vizMode === "bars" ? "bg-violet-600 text-white" : "bg-slate-800/80 text-slate-400 hover:text-slate-200"}`, children: "▥" })
          ] })
        ] }),
        isBuffer && /* @__PURE__ */ jsxs("div", { className: "space-y-1", children: [
          /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-center gap-1", children: [
            playlist.length > 0 && /* @__PURE__ */ jsx("button", { type: "button", title: "Previous track", onClick: () => sendAction("previous_track"), className: TBTN, children: "|◀" }),
            /* @__PURE__ */ jsx("button", { type: "button", title: "Rewind 10s", onClick: () => sendAction("skip", { delta_seconds: -10 }), className: TBTN, children: "◀◀" }),
            /* @__PURE__ */ jsx("button", { type: "button", title: "Stop", onClick: () => sendAction("stop"), className: TBTN, children: "■" }),
            /* @__PURE__ */ jsx("button", { type: "button", title: state.playing && !state.paused ? "Pause" : "Play", onClick: () => sendAction(state.playing && !state.paused ? "pause" : "play"), className: TBTN, children: state.playing && !state.paused ? "❚❚" : "▶" }),
            /* @__PURE__ */ jsx("button", { type: "button", title: "Forward 10s", onClick: () => sendAction("skip", { delta_seconds: 10 }), className: TBTN, children: "▶▶" }),
            playlist.length > 0 && /* @__PURE__ */ jsx("button", { type: "button", title: "Next track", onClick: () => sendAction("next_track"), className: TBTN, children: "▶|" })
          ] }),
          /* @__PURE__ */ jsx(
            "input",
            {
              type: "range",
              min: 0,
              max: Math.max(1, state.duration_s ?? 1),
              step: 0.1,
              value: state.position_s ?? 0,
              onChange: (e) => sendAction("seek", { seconds: Number(e.target.value) }),
              className: "w-full accent-violet-400"
            }
          ),
          /* @__PURE__ */ jsxs("div", { className: "flex justify-between text-[9px] text-slate-500", children: [
            /* @__PURE__ */ jsx("span", { children: fmtTime(state.position_s) }),
            /* @__PURE__ */ jsx("span", { children: fmtTime(state.duration_s) })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-2 text-[10px] text-slate-500", children: [
          /* @__PURE__ */ jsx("span", { className: "w-8 shrink-0 uppercase tracking-wide", children: "Vol" }),
          /* @__PURE__ */ jsx(
            "input",
            {
              type: "range",
              min: 0,
              max: 1,
              step: 0.01,
              value: state.volume ?? 1,
              onChange: (e) => sendAction("set_volume", { volume: Number(e.target.value) }),
              className: "flex-1 accent-violet-400"
            }
          ),
          /* @__PURE__ */ jsx("span", { className: "w-7 text-right tabular-nums text-slate-400", children: Math.round((state.volume ?? 1) * 100) })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "space-y-1 border-t border-slate-800 pt-2", children: [
          /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1 text-[10px]", children: [
            /* @__PURE__ */ jsxs("span", { className: "mr-auto uppercase tracking-wide text-slate-400", children: [
              "Play set (",
              playlist.length,
              ")"
            ] }),
            /* @__PURE__ */ jsx(
              "button",
              {
                type: "button",
                title: "Shuffle",
                onClick: () => sendAction("set_shuffle", { enabled: !shuffle }),
                className: `rounded px-1.5 py-0.5 ${shuffle ? "bg-violet-600 text-white" : "text-slate-400 hover:text-slate-200"}`,
                children: "⇄"
              }
            ),
            /* @__PURE__ */ jsx(
              "button",
              {
                type: "button",
                title: `Repeat: ${repeat}`,
                onClick: cycleRepeat,
                className: `rounded px-1.5 py-0.5 ${repeat !== "off" ? "bg-violet-600 text-white" : "text-slate-400 hover:text-slate-200"}`,
                children: repeat === "one" ? "↻¹" : "↻"
              }
            ),
            /* @__PURE__ */ jsx("input", { ref: plFilesRef, type: "file", accept: "audio/*", multiple: true, onChange: (e) => {
              addFiles(e.target.files);
              e.currentTarget.value = "";
            }, className: "hidden" }),
            /* @__PURE__ */ jsx("button", { type: "button", onClick: () => plFilesRef.current?.click(), className: "rounded border border-slate-700 px-1.5 py-0.5 text-slate-300 hover:border-slate-500", children: "+ Files" }),
            /* @__PURE__ */ jsx("input", { ref: plFolderRef, type: "file", ...{ webkitdirectory: "", directory: "" }, multiple: true, onChange: (e) => {
              addFiles(e.target.files);
              e.currentTarget.value = "";
            }, className: "hidden" }),
            /* @__PURE__ */ jsx("button", { type: "button", onClick: () => plFolderRef.current?.click(), className: "rounded border border-slate-700 px-1.5 py-0.5 text-slate-300 hover:border-slate-500", children: "+ Folder" }),
            playlist.length > 0 && /* @__PURE__ */ jsx("button", { type: "button", onClick: () => sendAction("playlist_clear"), className: "rounded border border-slate-700 px-1.5 py-0.5 text-slate-400 hover:border-rose-500 hover:text-rose-300", children: "Clear" })
          ] }),
          playlist.length > 0 && /* @__PURE__ */ jsx("ul", { className: "max-h-32 overflow-y-auto rounded border border-slate-800", children: playlist.map((t, i) => /* @__PURE__ */ jsxs("li", { className: `flex items-center gap-1 px-1.5 py-0.5 text-[11px] ${i === plIdx ? "bg-violet-500/10 text-violet-200" : "text-slate-300 hover:bg-slate-800/50"}`, children: [
            /* @__PURE__ */ jsxs("button", { type: "button", onClick: () => sendAction("play_index", { index: i }), className: "min-w-0 flex-1 truncate text-left", title: t.ref, children: [
              i === plIdx && (state.playing && !state.paused) ? "▶ " : "",
              t.name || t.ref
            ] }),
            /* @__PURE__ */ jsx("button", { type: "button", title: "Up", disabled: i === 0, onClick: () => sendAction("playlist_move", { index: i, to: i - 1 }), className: "px-0.5 text-slate-500 hover:text-slate-200 disabled:opacity-30", children: "↑" }),
            /* @__PURE__ */ jsx("button", { type: "button", title: "Down", disabled: i === playlist.length - 1, onClick: () => sendAction("playlist_move", { index: i, to: i + 1 }), className: "px-0.5 text-slate-500 hover:text-slate-200 disabled:opacity-30", children: "↓" }),
            /* @__PURE__ */ jsx("button", { type: "button", title: "Remove", onClick: () => sendAction("playlist_remove", { index: i }), className: "px-0.5 text-slate-500 hover:text-rose-300", children: "✕" })
          ] }, i)) })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "flex justify-between text-[10px] text-slate-500", children: [
          /* @__PURE__ */ jsxs("span", { children: [
            "plays: ",
            state.input_kind ? `${state.input_kind}:${state.input_ref ?? ""}` : `/speaker/${proxyId}/audio`
          ] }),
          /* @__PURE__ */ jsx("span", { className: muted ? "text-amber-400" : "text-emerald-400", children: muted ? "muted" : state.playing && !state.paused ? "playing" : "idle" })
        ] }),
        state.last_error && /* @__PURE__ */ jsx("div", { className: "text-[10px] text-rose-400", children: state.last_error })
      ]
    }
  );
}
export {
  SpeakerBrowserView as default
};
