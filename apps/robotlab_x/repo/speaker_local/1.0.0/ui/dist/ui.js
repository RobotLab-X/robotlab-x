import { jsxs, jsx } from "react/jsx-runtime";
import { useState, useRef, useCallback, useEffect } from "react";
import { useWsClient, useServiceRequest } from "@rlx/ui";
function fmtTime(s) {
  if (!s || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
const TBTN = "flex h-7 w-7 items-center justify-center rounded bg-slate-800 text-sm leading-none text-slate-300 hover:bg-slate-700 hover:text-white";
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
function SpeakerLocalView({ proxy }) {
  const wsClient = useWsClient();
  const proxyId = proxy.id ?? proxy.name ?? "";
  const T = (s) => `/speaker/${proxyId}/${s}`;
  const [state, setState] = useState({});
  const [frameLevel, setFrameLevel] = useState(0);
  const [kind, setKind] = useState("");
  const [ref, setRef] = useState("");
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseTarget, setBrowseTarget] = useState("input");
  const [vizMode, setVizMode] = useState("wave");
  const inputDirty = useRef(false);
  const sendAction = useCallback(
    (action, args = {}) => wsClient.publish(T("control"), { action, ...args }),
    [wsClient, proxyId]
  );
  const browse = useServiceRequest(T("control"), { replyPrefix: "spk-browse", timeoutMs: 8e3 });
  const navigate = useCallback((path) => {
    void browse.request("browse_files", { path });
  }, [browse]);
  const pickFile = (name) => {
    const dir = browse.reply?.path ?? "";
    const full = `${dir.replace(/\/$/, "")}/${name}`;
    if (browseTarget === "playlist") {
      sendAction("playlist_add", { items: [{ kind: "file", ref: full, name }] });
      return;
    }
    setRef(full);
    sendAction("select_input", { kind: "file", ref: full });
    inputDirty.current = false;
    setBrowseOpen(false);
  };
  const openBrowse = (target) => {
    setBrowseTarget(target);
    setBrowseOpen(true);
    navigate(ref || void 0);
  };
  useEffect(() => {
    if (!proxyId) return;
    const off = wsClient.subscribe(T("state"), (f) => {
      if (f.method !== "message") return;
      const s = f.payload ?? {};
      setState(s);
      if (!inputDirty.current) {
        setKind(s.input_kind ?? "");
        setRef(s.input_ref ?? "");
      }
    });
    sendAction("list_devices");
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
    const onFrame = (f) => {
      if (f.method !== "message") return;
      const fr = f.payload;
      if (!fr?.data) return;
      const i16 = b64ToInt16(fr.data);
      setFrameLevel(rms16(i16));
      pushSamples(i16);
    };
    const offs = [wsClient.subscribe(T("audio"), onFrame), wsClient.subscribe(T("viz"), onFrame)];
    if (state.input_kind === "topic" && state.input_ref) offs.push(wsClient.subscribe(state.input_ref, onFrame));
    return () => offs.forEach((o) => o());
  }, [proxyId, wsClient, state.input_kind, state.input_ref, pushSamples]);
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
      g.fillStyle = "#22d3ee";
      if (vizMode === "wave") {
        g.beginPath();
        g.lineWidth = 1.5;
        for (let i = 0; i < ring.length; i++) {
          const x = i / (ring.length - 1) * w;
          const y = h / 2 - ring[i] * h * 0.46;
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
      } else {
        const n = 40, step = Math.max(1, Math.floor(ring.length / n));
        for (let b = 0; b < n; b++) {
          let m = 0;
          for (let j = 0; j < step; j++) m = Math.max(m, Math.abs(ring[b * step + j] || 0));
          const bh = Math.min(1, m) * h;
          g.fillRect(b / n * w + 1, h - bh, w / n - 2, bh);
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [vizMode]);
  const applyInput = () => {
    sendAction("select_input", { kind: kind || null, ref: ref || null });
    inputDirty.current = false;
  };
  const muted = !!state.muted;
  const devices = state.devices ?? [];
  const isBuffer = state.input_kind === "file" || state.input_kind === "url";
  const level = isBuffer ? state.level_rms ?? 0 : frameLevel;
  const playlist = state.playlist ?? [];
  const plIdx = state.playlist_index ?? -1;
  const repeat = state.repeat ?? "off";
  const shuffle = !!state.shuffle;
  const cycleRepeat = () => sendAction("set_repeat", { mode: repeat === "off" ? "all" : repeat === "all" ? "one" : "off" });
  return /* @__PURE__ */ jsxs("div", { className: "rlx-drag-handle space-y-3 p-3 text-sm text-slate-200", children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between", children: [
      /* @__PURE__ */ jsx("span", { className: "font-semibold", children: "Speaker" }),
      /* @__PURE__ */ jsx("span", { className: "text-[10px] uppercase tracking-wide text-cyan-400", children: state.source ?? "local" })
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
    /* @__PURE__ */ jsxs("div", { className: "space-y-1 border-t border-slate-800 pt-2", children: [
      /* @__PURE__ */ jsx("span", { className: "text-xs text-slate-400", children: "Input" }),
      /* @__PURE__ */ jsxs("div", { className: "flex gap-2", children: [
        /* @__PURE__ */ jsxs("select", { value: kind, onChange: (e) => {
          setKind(e.target.value);
          inputDirty.current = true;
          setBrowseOpen(false);
        }, className: "rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs", children: [
          /* @__PURE__ */ jsx("option", { value: "", children: "Sink" }),
          /* @__PURE__ */ jsx("option", { value: "topic", children: "Topic" }),
          /* @__PURE__ */ jsx("option", { value: "file", children: "File" }),
          /* @__PURE__ */ jsx("option", { value: "url", children: "URL" })
        ] }),
        kind !== "" && /* @__PURE__ */ jsx(
          "input",
          {
            type: "text",
            value: ref,
            onChange: (e) => {
              setRef(e.target.value);
              inputDirty.current = true;
            },
            placeholder: kind === "topic" ? "/microphone/mic-1/audio" : kind === "file" ? "/path/on/server.wav" : "https://…/audio.mp3",
            className: "min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px]"
          }
        ),
        kind === "file" && /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            onClick: () => browseOpen && browseTarget === "input" ? setBrowseOpen(false) : openBrowse("input"),
            className: "rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500",
            children: "Browse…"
          }
        ),
        /* @__PURE__ */ jsx("button", { type: "button", onClick: applyInput, className: "rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500", children: "Set" })
      ] }),
      browseOpen && /* @__PURE__ */ jsxs("div", { className: "mt-1 rounded border border-slate-700 bg-slate-950/80 text-xs", children: [
        /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 border-b border-slate-800 px-2 py-1", children: [
          (browse.reply?.roots ?? []).map((r) => /* @__PURE__ */ jsx("button", { type: "button", onClick: () => navigate(r.path), className: "text-[10px] text-sky-400 hover:text-sky-300", children: r.label }, r.path)),
          browseTarget === "playlist" && browse.reply?.path && /* @__PURE__ */ jsx("button", { type: "button", onClick: () => {
            sendAction("playlist_add_folder", { path: browse.reply.path });
            setBrowseOpen(false);
          }, className: "rounded border border-slate-700 px-1.5 text-[10px] text-emerald-300 hover:border-emerald-500", children: "+ folder" }),
          /* @__PURE__ */ jsx("span", { className: "ml-auto truncate font-mono text-[10px] text-slate-500", title: browse.reply?.path, children: browse.reply?.path ?? "…" }),
          /* @__PURE__ */ jsx("button", { type: "button", onClick: () => setBrowseOpen(false), className: "text-[10px] text-slate-500 hover:text-slate-300", children: "✕" })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "max-h-40 overflow-y-auto p-1", children: [
          browse.inFlight && /* @__PURE__ */ jsx("div", { className: "px-1 py-0.5 text-slate-500", children: "loading…" }),
          browse.error && /* @__PURE__ */ jsx("div", { className: "px-1 py-0.5 text-rose-400", children: browse.error }),
          browse.reply?.parent && /* @__PURE__ */ jsx("button", { type: "button", onClick: () => navigate(browse.reply.parent), className: "block w-full truncate px-1 py-0.5 text-left text-slate-300 hover:bg-slate-800/60", children: "📁 .." }),
          (browse.reply?.dirs ?? []).map((d) => /* @__PURE__ */ jsxs("button", { type: "button", onClick: () => navigate(`${browse.reply.path.replace(/\/$/, "")}/${d}`), className: "block w-full truncate px-1 py-0.5 text-left text-slate-300 hover:bg-slate-800/60", children: [
            "📁 ",
            d
          ] }, d)),
          (browse.reply?.files ?? []).map((f) => /* @__PURE__ */ jsxs("button", { type: "button", onClick: () => pickFile(f.name), className: "flex w-full items-center justify-between gap-2 px-1 py-0.5 text-left text-cyan-300 hover:bg-slate-800/60", children: [
            /* @__PURE__ */ jsxs("span", { className: "truncate", children: [
              "🎵 ",
              f.name
            ] }),
            /* @__PURE__ */ jsxs("span", { className: "shrink-0 text-[9px] text-slate-500", children: [
              Math.round(f.size / 1024),
              " KB"
            ] })
          ] }, f.name)),
          browse.reply && browse.reply.dirs.length === 0 && browse.reply.files.length === 0 && !browse.inFlight && /* @__PURE__ */ jsxs("div", { className: "px-1 py-0.5 text-slate-500", children: [
            "no audio files here",
            browse.reply.warn ? ` (${browse.reply.warn})` : ""
          ] })
        ] })
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
    /* @__PURE__ */ jsx("div", { className: "h-2 w-full overflow-hidden rounded bg-slate-800", children: /* @__PURE__ */ jsx("div", { className: "h-full bg-cyan-400 transition-[width] duration-75", style: { width: `${Math.round((!muted ? level : 0) * 100)}%` } }) }),
    /* @__PURE__ */ jsxs("div", { className: "relative", children: [
      /* @__PURE__ */ jsx("canvas", { ref: canvasRef, width: 256, height: 56, className: "h-14 w-full rounded border border-slate-800" }),
      /* @__PURE__ */ jsxs("div", { className: "absolute right-1 top-1 flex gap-1", children: [
        /* @__PURE__ */ jsx("button", { type: "button", title: "Waveform", onClick: () => setVizMode("wave"), className: `rounded px-1 text-[10px] ${vizMode === "wave" ? "bg-cyan-600 text-white" : "bg-slate-800/80 text-slate-400 hover:text-slate-200"}`, children: "∿" }),
        /* @__PURE__ */ jsx("button", { type: "button", title: "Spectrum", onClick: () => setVizMode("bars"), className: `rounded px-1 text-[10px] ${vizMode === "bars" ? "bg-cyan-600 text-white" : "bg-slate-800/80 text-slate-400 hover:text-slate-200"}`, children: "▥" })
      ] })
    ] }),
    (state.input_kind === "file" || state.input_kind === "url") && /* @__PURE__ */ jsxs("div", { className: "space-y-1", children: [
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
          className: "w-full accent-cyan-400"
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
          className: "flex-1 accent-cyan-400"
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
            className: `rounded px-1.5 py-0.5 ${shuffle ? "bg-cyan-600 text-white" : "text-slate-400 hover:text-slate-200"}`,
            children: "⇄"
          }
        ),
        /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            title: `Repeat: ${repeat}`,
            onClick: cycleRepeat,
            className: `rounded px-1.5 py-0.5 ${repeat !== "off" ? "bg-cyan-600 text-white" : "text-slate-400 hover:text-slate-200"}`,
            children: repeat === "one" ? "↻¹" : "↻"
          }
        ),
        /* @__PURE__ */ jsx("button", { type: "button", onClick: () => openBrowse("playlist"), className: "rounded border border-slate-700 px-1.5 py-0.5 text-slate-300 hover:border-slate-500", children: "+ Files / Folder" }),
        playlist.length > 0 && /* @__PURE__ */ jsx("button", { type: "button", onClick: () => sendAction("playlist_clear"), className: "rounded border border-slate-700 px-1.5 py-0.5 text-slate-400 hover:border-rose-500 hover:text-rose-300", children: "Clear" })
      ] }),
      playlist.length > 0 && /* @__PURE__ */ jsx("ul", { className: "max-h-32 overflow-y-auto rounded border border-slate-800", children: playlist.map((t, i) => /* @__PURE__ */ jsxs("li", { className: `flex items-center gap-1 px-1.5 py-0.5 text-[11px] ${i === plIdx ? "bg-cyan-500/10 text-cyan-200" : "text-slate-300 hover:bg-slate-800/50"}`, children: [
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
  ] });
}
export {
  SpeakerLocalView as default
};
