import { jsxs, jsx } from "react/jsx-runtime";
import { forwardRef, createElement, useState, useRef, useEffect, useCallback, useLayoutEffect, useMemo } from "react";
import { useWsClient, useServiceRequest } from "@rlx/ui";
/**
 * @license lucide-react v0.344.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
var defaultAttributes = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round"
};
/**
 * @license lucide-react v0.344.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const toKebabCase = (string) => string.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().trim();
const createLucideIcon = (iconName, iconNode) => {
  const Component = forwardRef(
    ({
      color = "currentColor",
      size = 24,
      strokeWidth = 2,
      absoluteStrokeWidth,
      className = "",
      children,
      ...rest
    }, ref) => {
      return createElement(
        "svg",
        {
          ref,
          ...defaultAttributes,
          width: size,
          height: size,
          stroke: color,
          strokeWidth: absoluteStrokeWidth ? Number(strokeWidth) * 24 / Number(size) : strokeWidth,
          className: ["lucide", `lucide-${toKebabCase(iconName)}`, className].join(" "),
          ...rest
        },
        [
          ...iconNode.map(([tag, attrs]) => createElement(tag, attrs)),
          ...Array.isArray(children) ? children : [children]
        ]
      );
    }
  );
  Component.displayName = `${iconName}`;
  return Component;
};
/**
 * @license lucide-react v0.344.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Loader2 = createLucideIcon("Loader2", [
  ["path", { d: "M21 12a9 9 0 1 1-6.219-8.56", key: "13zald" }]
]);
const DECODER_OPTIONS = [
  { value: "hexdump", label: "Hex + ASCII" },
  { value: "hex", label: "Hex" },
  { value: "ascii", label: "ASCII" },
  { value: "dec", label: "Decimal" },
  { value: "lines", label: "Lines" }
];
const TX_ENCODING_OPTIONS = [
  { value: "ascii", label: "ASCII" },
  { value: "hex", label: "Hex" },
  { value: "dec", label: "Decimal" }
];
const EOL_OPTIONS = [
  { value: "", label: "None" },
  { value: "\n", label: "LF (\\n)" },
  { value: "\r\n", label: "CRLF (\\r\\n)" },
  { value: "\r", label: "CR (\\r)" }
];
const BAUD_OPTIONS = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];
const PARITY_OPTIONS = [["N", "None"], ["E", "Even"], ["O", "Odd"], ["M", "Mark"], ["S", "Space"]];
const STOPBIT_OPTIONS = [1, 1.5, 2];
const BYTESIZE_OPTIONS = [5, 6, 7, 8];
const MAX_ROWS = 2e3;
function b64ToBytes(b64) {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function bytesToHex(bytes, sep = " ") {
  const parts = [];
  for (let i = 0; i < bytes.length; i++) {
    parts.push(bytes[i].toString(16).padStart(2, "0"));
  }
  return parts.join(sep);
}
function bytesToDec(bytes) {
  const parts = [];
  for (let i = 0; i < bytes.length; i++) {
    parts.push(bytes[i].toString().padStart(3, " "));
  }
  return parts.join(" ");
}
function bytesToAscii(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 10) out += "\n";
    else if (b === 13) out += "\r";
    else if (b === 9) out += "	";
    else if (b >= 32 && b < 127) out += String.fromCharCode(b);
    else out += "·";
  }
  return out;
}
function bytesToHexdump(bytes, offset = 0) {
  const lines = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const slice = bytes.subarray(i, Math.min(i + 16, bytes.length));
    const off = (offset + i).toString(16).padStart(6, "0");
    const hex = bytesToHex(slice).padEnd(48, " ");
    const asc = bytesToAscii(slice).replace(/[\n\r\t]/g, "·");
    lines.push(`${off}  ${hex}  ${asc}`);
  }
  return lines.join("\n");
}
function bytesToLines(bytes) {
  const text = bytesToAscii(bytes);
  return text.split("\n").map((s) => s.replace(/\r$/, ""));
}
function encodeTxBytes(input, encoding, eol) {
  if (encoding === "ascii") {
    const enc = new TextEncoder();
    return enc.encode(input + (eol ?? ""));
  }
  if (encoding === "hex") {
    const cleaned = input.replace(/[^0-9a-fA-F]/g, "");
    if (cleaned.length % 2) return null;
    const out2 = new Uint8Array(cleaned.length / 2);
    for (let i = 0; i < out2.length; i++) {
      out2[i] = parseInt(cleaned.substr(i * 2, 2), 16);
    }
    return out2;
  }
  if (!input.trim()) return new Uint8Array(0);
  const tokens = input.trim().split(/[^0-9]+/).filter(Boolean);
  const out = new Uint8Array(tokens.length);
  for (let i = 0; i < tokens.length; i++) {
    const n = Number(tokens[i]);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out[i] = n;
  }
  return out;
}
function bytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function SerialFullView({ proxy }) {
  const wsClient = useWsClient();
  const proxyId = proxy.id ?? proxy.name ?? "";
  const stateTopic = `/serial/${proxyId}/state`;
  const rxTopic = `/serial/${proxyId}/rx`;
  const txTopic = `/serial/${proxyId}/tx`;
  const controlTopic = `/serial/${proxyId}/control`;
  const [state, setState] = useState({});
  const [chunks, setChunks] = useState([]);
  const keyCounterRef = useRef(0);
  const [portDraft, setPortDraft] = useState("");
  const [baudDraft, setBaudDraft] = useState(115200);
  const [bytesizeDraft, setBytesizeDraft] = useState(8);
  const [parityDraft, setParityDraft] = useState("N");
  const [stopbitsDraft, setStopbitsDraft] = useState(1);
  const [decoder, setDecoder] = useState("hexdump");
  const [autoscroll, setAutoscroll] = useState(true);
  const [paused, setPaused] = useState(false);
  const [timestamps, setTimestamps] = useState(false);
  const [txInput, setTxInput] = useState("");
  const [txEncoding, setTxEncoding] = useState("ascii");
  const [txEol, setTxEol] = useState("\n");
  const [txError, setTxError] = useState(null);
  const pausedBufferRef = useRef([]);
  useEffect(() => {
    if (!proxyId) return;
    const off = wsClient.subscribe(stateTopic, (f) => {
      if (f.method !== "message") return;
      setState(f.payload);
    });
    return off;
  }, [proxyId, stateTopic, wsClient]);
  useEffect(() => {
    if (state.connected) return;
    if (state.last_port && !portDraft) setPortDraft(state.last_port);
    if (state.last_baud) setBaudDraft(state.last_baud);
    if (typeof state.bytesize === "number") setBytesizeDraft(state.bytesize);
    if (state.parity) setParityDraft(state.parity);
    if (typeof state.stopbits === "number") setStopbitsDraft(state.stopbits);
  }, [state.last_port, state.last_baud, state.bytesize, state.parity, state.stopbits, state.connected]);
  const ingest = useCallback(
    (dir, payload) => {
      if (!payload || typeof payload.data !== "string") return;
      let bytes;
      try {
        bytes = b64ToBytes(payload.data);
      } catch {
        return;
      }
      keyCounterRef.current += 1;
      const chunk = {
        key: keyCounterRef.current,
        dir,
        bytes,
        ts: payload.ts ?? Date.now() / 1e3,
        source: payload.source
      };
      if (paused) {
        pausedBufferRef.current.push(chunk);
        if (pausedBufferRef.current.length > MAX_ROWS) {
          pausedBufferRef.current.splice(0, pausedBufferRef.current.length - MAX_ROWS);
        }
        return;
      }
      setChunks((prev) => {
        const next = prev.length >= MAX_ROWS ? prev.slice(prev.length - MAX_ROWS + 1) : prev.slice();
        next.push(chunk);
        return next;
      });
    },
    [paused]
  );
  useEffect(() => {
    if (!proxyId) return;
    const offRx = wsClient.subscribe(rxTopic, (f) => {
      if (f.method !== "message") return;
      ingest("rx", f.payload ?? {});
    });
    const offTx = wsClient.subscribe(txTopic, (f) => {
      if (f.method !== "message") return;
      ingest("tx", f.payload ?? {});
    });
    return () => {
      offRx();
      offTx();
    };
  }, [proxyId, rxTopic, txTopic, wsClient, ingest]);
  useEffect(() => {
    if (paused) return;
    if (pausedBufferRef.current.length === 0) return;
    const drained = pausedBufferRef.current;
    pausedBufferRef.current = [];
    setChunks((prev) => {
      const merged = prev.concat(drained);
      return merged.length > MAX_ROWS ? merged.slice(merged.length - MAX_ROWS) : merged;
    });
  }, [paused]);
  const sendAction = useCallback(
    (payload) => {
      wsClient.publish(controlTopic, payload);
    },
    [controlTopic, wsClient]
  );
  const connectRequest = useServiceRequest(controlTopic, {
    timeoutMs: 1e4,
    errorField: "last_error",
    replyPrefix: `serial-${proxyId}-connect`
  });
  const disconnectRequest = useServiceRequest(controlTopic, {
    timeoutMs: 5e3,
    errorField: "last_error",
    replyPrefix: `serial-${proxyId}-disconnect`
  });
  const onConnect = useCallback(
    (e) => {
      e?.preventDefault();
      if (!portDraft || connectRequest.inFlight) return;
      void connectRequest.request("connect", {
        port: portDraft,
        baudrate: baudDraft,
        bytesize: bytesizeDraft,
        parity: parityDraft,
        stopbits: stopbitsDraft
      });
    },
    [portDraft, baudDraft, bytesizeDraft, parityDraft, stopbitsDraft, connectRequest]
  );
  const onDisconnect = useCallback(() => {
    if (disconnectRequest.inFlight) return;
    void disconnectRequest.request("disconnect");
  }, [disconnectRequest]);
  const onRefreshPorts = useCallback(() => sendAction({ action: "list_ports" }), [sendAction]);
  const onClearCounters = useCallback(() => sendAction({ action: "clear_counters" }), [sendAction]);
  const onClearBuffer = useCallback(() => {
    setChunks([]);
    pausedBufferRef.current = [];
  }, []);
  const onSendTx = useCallback(() => {
    setTxError(null);
    const bytes = encodeTxBytes(txInput, txEncoding, txEncoding === "ascii" ? txEol : "");
    if (bytes === null) {
      setTxError(`invalid ${txEncoding}`);
      return;
    }
    if (bytes.length === 0) return;
    sendAction({ action: "write_bytes", data: bytesToBase64(bytes) });
  }, [txInput, txEncoding, txEol, sendAction]);
  const onSendFile = useCallback(async (file) => {
    setTxError(null);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      sendAction({ action: "send_file", data: bytesToBase64(bytes), chunk_bytes: 4096 });
    } catch (err) {
      setTxError(`file read failed: ${err}`);
    }
  }, [sendAction]);
  const onTxKeyDown = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSendTx();
    }
  }, [onSendTx]);
  const scrollRef = useRef(null);
  useLayoutEffect(() => {
    if (!autoscroll) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chunks, autoscroll]);
  const rendered = useMemo(() => {
    return chunks.map((c) => ({
      key: c.key,
      dir: c.dir,
      ts: c.ts,
      source: c.source,
      // Decode per the currently-selected decoder. lines decoder
      // returns an array; everything else a single string.
      decoded: decoder === "hex" ? bytesToHex(c.bytes) : decoder === "hexdump" ? bytesToHexdump(c.bytes) : decoder === "ascii" ? bytesToAscii(c.bytes) : decoder === "dec" ? bytesToDec(c.bytes) : bytesToLines(c.bytes).join("\n"),
      len: c.bytes.length
    }));
  }, [chunks, decoder]);
  const connected = !!state.connected;
  const statsLine = useMemo(() => {
    const port = state.port ?? state.last_port ?? "—";
    const framing = `${state.baudrate ?? "?"} ${state.bytesize ?? "?"}${state.parity ?? "?"}${state.stopbits ?? "?"}`;
    return `${port}  ${framing}  ·  RX ${(state.rx_bytes ?? 0).toLocaleString()} B  ·  TX ${(state.tx_bytes ?? 0).toLocaleString()} B  ·  errors ${state.errors ?? 0}`;
  }, [state]);
  const portOptions = useMemo(() => {
    const list = state.ports ?? [];
    const augmented = list.map((p) => {
      const others = (p.holders ?? []).filter(
        (h) => h.proxy_id !== proxyId
      );
      const ownedByOther = others.length > 0;
      const ownerLabel = others.length === 0 ? "" : others.map((h) => h.proxy_id ?? `${h.service_type ?? h.name ?? "pid"} ${h.pid}`).join(", ");
      return { ...p, ownedByOther, ownerLabel };
    });
    const devices = new Set(augmented.map((p) => p.device));
    if (portDraft && !devices.has(portDraft)) {
      augmented.push({
        device: portDraft,
        description: "(not detected)",
        hwid: "",
        ownedByOther: false,
        ownerLabel: ""
      });
    }
    return augmented;
  }, [state.ports, portDraft, proxyId]);
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: "flex h-full min-w-[520px] flex-col gap-3 p-3 text-xs",
      onPointerDown: (e) => e.stopPropagation(),
      children: [
        /* @__PURE__ */ jsxs("section", { className: "rounded border border-slate-800 bg-slate-900/40 p-2", children: [
          /* @__PURE__ */ jsxs("form", { onSubmit: onConnect, className: "flex flex-wrap items-end gap-2", children: [
            /* @__PURE__ */ jsxs("label", { className: "flex flex-col", children: [
              /* @__PURE__ */ jsx("span", { className: "mb-0.5 text-[10px] uppercase tracking-wider text-slate-500", children: "port" }),
              /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1", children: [
                /* @__PURE__ */ jsxs(
                  "select",
                  {
                    value: portDraft,
                    onChange: (e) => setPortDraft(e.target.value),
                    disabled: connected,
                    onPointerDown: (e) => e.stopPropagation(),
                    className: "nodrag nopan w-72 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100 focus:border-slate-500 focus:outline-none disabled:opacity-50",
                    children: [
                      !portDraft && /* @__PURE__ */ jsx("option", { value: "", children: "(pick a port)" }),
                      portOptions.map((p) => (
                        // ``disabled`` greys out + blocks selection on
                        // ports another service is already holding. The
                        // suffix names the owning proxy when known so the
                        // operator knows what to release first.
                        /* @__PURE__ */ jsxs(
                          "option",
                          {
                            value: p.device,
                            disabled: p.ownedByOther,
                            children: [
                              p.device,
                              p.description ? `  — ${p.description}` : "",
                              p.ownedByOther ? `  (in use by ${p.ownerLabel})` : ""
                            ]
                          },
                          p.device
                        )
                      ))
                    ]
                  }
                ),
                /* @__PURE__ */ jsx(
                  "button",
                  {
                    type: "button",
                    onClick: onRefreshPorts,
                    disabled: connected,
                    onPointerDown: (e) => e.stopPropagation(),
                    title: "Refresh port list",
                    className: "nodrag nopan rounded border border-slate-700 px-2 py-1 text-[11px] hover:border-slate-500 disabled:opacity-50",
                    children: "↻"
                  }
                )
              ] })
            ] }),
            /* @__PURE__ */ jsxs("label", { className: "flex flex-col", children: [
              /* @__PURE__ */ jsx("span", { className: "mb-0.5 text-[10px] uppercase tracking-wider text-slate-500", children: "baud" }),
              /* @__PURE__ */ jsx(
                "select",
                {
                  value: baudDraft,
                  onChange: (e) => setBaudDraft(Number(e.target.value)),
                  disabled: connected,
                  onPointerDown: (e) => e.stopPropagation(),
                  className: "nodrag nopan w-24 rounded border border-slate-700 bg-slate-950 px-1 py-1 font-mono text-[11px] text-slate-100 focus:border-slate-500 focus:outline-none disabled:opacity-50",
                  children: BAUD_OPTIONS.map((b) => /* @__PURE__ */ jsx("option", { value: b, children: b }, b))
                }
              )
            ] }),
            /* @__PURE__ */ jsxs("label", { className: "flex flex-col", children: [
              /* @__PURE__ */ jsx("span", { className: "mb-0.5 text-[10px] uppercase tracking-wider text-slate-500", children: "bits" }),
              /* @__PURE__ */ jsx(
                "select",
                {
                  value: bytesizeDraft,
                  onChange: (e) => setBytesizeDraft(Number(e.target.value)),
                  disabled: connected,
                  onPointerDown: (e) => e.stopPropagation(),
                  className: "nodrag nopan w-14 rounded border border-slate-700 bg-slate-950 px-1 py-1 font-mono text-[11px] disabled:opacity-50",
                  children: BYTESIZE_OPTIONS.map((b) => /* @__PURE__ */ jsx("option", { value: b, children: b }, b))
                }
              )
            ] }),
            /* @__PURE__ */ jsxs("label", { className: "flex flex-col", children: [
              /* @__PURE__ */ jsx("span", { className: "mb-0.5 text-[10px] uppercase tracking-wider text-slate-500", children: "parity" }),
              /* @__PURE__ */ jsx(
                "select",
                {
                  value: parityDraft,
                  onChange: (e) => setParityDraft(e.target.value),
                  disabled: connected,
                  onPointerDown: (e) => e.stopPropagation(),
                  className: "nodrag nopan w-20 rounded border border-slate-700 bg-slate-950 px-1 py-1 font-mono text-[11px] disabled:opacity-50",
                  children: PARITY_OPTIONS.map(([v, label]) => /* @__PURE__ */ jsx("option", { value: v, children: label }, v))
                }
              )
            ] }),
            /* @__PURE__ */ jsxs("label", { className: "flex flex-col", children: [
              /* @__PURE__ */ jsx("span", { className: "mb-0.5 text-[10px] uppercase tracking-wider text-slate-500", children: "stop" }),
              /* @__PURE__ */ jsx(
                "select",
                {
                  value: stopbitsDraft,
                  onChange: (e) => setStopbitsDraft(Number(e.target.value)),
                  disabled: connected,
                  onPointerDown: (e) => e.stopPropagation(),
                  className: "nodrag nopan w-14 rounded border border-slate-700 bg-slate-950 px-1 py-1 font-mono text-[11px] disabled:opacity-50",
                  children: STOPBIT_OPTIONS.map((s) => /* @__PURE__ */ jsx("option", { value: s, children: s }, s))
                }
              )
            ] }),
            /* @__PURE__ */ jsx("div", { className: "ml-auto flex items-center gap-2", children: !connected ? /* @__PURE__ */ jsxs(
              "button",
              {
                type: "submit",
                disabled: !portDraft || connectRequest.inFlight,
                "aria-busy": connectRequest.inFlight,
                onPointerDown: (e) => e.stopPropagation(),
                className: "nodrag nopan inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40",
                children: [
                  connectRequest.inFlight && /* @__PURE__ */ jsx(Loader2, { className: "h-3 w-3 animate-spin" }),
                  connectRequest.inFlight ? "Connecting…" : "Connect"
                ]
              }
            ) : /* @__PURE__ */ jsxs(
              "button",
              {
                type: "button",
                onClick: onDisconnect,
                disabled: disconnectRequest.inFlight,
                "aria-busy": disconnectRequest.inFlight,
                onPointerDown: (e) => e.stopPropagation(),
                className: "nodrag nopan inline-flex items-center gap-1.5 rounded border border-slate-700 px-3 py-1 text-[11px] hover:border-rose-500 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-40",
                children: [
                  disconnectRequest.inFlight && /* @__PURE__ */ jsx(Loader2, { className: "h-3 w-3 animate-spin" }),
                  disconnectRequest.inFlight ? "Disconnecting…" : "Disconnect"
                ]
              }
            ) })
          ] }),
          (connectRequest.error ?? disconnectRequest.error ?? state.last_error) && /* @__PURE__ */ jsxs(
            "div",
            {
              className: "mt-2 truncate font-mono text-[10px] text-rose-300",
              title: connectRequest.error ?? disconnectRequest.error ?? state.last_error ?? "",
              children: [
                "error: ",
                connectRequest.error ?? disconnectRequest.error ?? state.last_error
              ]
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("section", { className: "flex items-center justify-between gap-3 rounded border border-slate-800 bg-slate-900/40 px-2 py-1 font-mono text-[10px] text-slate-400", children: [
          /* @__PURE__ */ jsxs("span", { children: [
            /* @__PURE__ */ jsx("span", { className: connected ? "text-emerald-400" : "text-slate-500", children: connected ? "● connected" : "○ idle" }),
            "  ",
            /* @__PURE__ */ jsx("span", { children: statsLine })
          ] }),
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              onClick: onClearCounters,
              onPointerDown: (e) => e.stopPropagation(),
              title: "Reset RX / TX / error counters",
              className: "nodrag nopan rounded border border-slate-700 px-1.5 py-0.5 text-[9px] hover:border-slate-500",
              children: "reset counters"
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("section", { className: "flex min-h-0 flex-1 flex-col rounded border border-slate-800 bg-slate-900/40", children: [
          /* @__PURE__ */ jsxs("header", { className: "flex items-center gap-2 border-b border-slate-800 px-2 py-1 text-[10px] text-slate-500", children: [
            /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-1", children: [
              /* @__PURE__ */ jsx("span", { className: "uppercase tracking-wider", children: "view" }),
              /* @__PURE__ */ jsx(
                "select",
                {
                  value: decoder,
                  onChange: (e) => setDecoder(e.target.value),
                  onPointerDown: (e) => e.stopPropagation(),
                  className: "nodrag nopan rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[10px] text-slate-100 focus:border-slate-500 focus:outline-none",
                  children: DECODER_OPTIONS.map((d) => /* @__PURE__ */ jsx("option", { value: d.value, children: d.label }, d.value))
                }
              )
            ] }),
            /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-1", children: [
              /* @__PURE__ */ jsx(
                "input",
                {
                  type: "checkbox",
                  checked: autoscroll,
                  onChange: (e) => setAutoscroll(e.target.checked),
                  onPointerDown: (e) => e.stopPropagation(),
                  className: "nodrag nopan h-3 w-3 accent-emerald-500"
                }
              ),
              /* @__PURE__ */ jsx("span", { children: "autoscroll" })
            ] }),
            /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-1", children: [
              /* @__PURE__ */ jsx(
                "input",
                {
                  type: "checkbox",
                  checked: paused,
                  onChange: (e) => setPaused(e.target.checked),
                  onPointerDown: (e) => e.stopPropagation(),
                  className: "nodrag nopan h-3 w-3 accent-amber-500"
                }
              ),
              /* @__PURE__ */ jsxs("span", { className: paused ? "text-amber-300" : "", children: [
                "pause display",
                paused && pausedBufferRef.current.length > 0 && ` (${pausedBufferRef.current.length} buffered)`
              ] })
            ] }),
            /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-1", children: [
              /* @__PURE__ */ jsx(
                "input",
                {
                  type: "checkbox",
                  checked: timestamps,
                  onChange: (e) => setTimestamps(e.target.checked),
                  onPointerDown: (e) => e.stopPropagation(),
                  className: "nodrag nopan h-3 w-3 accent-sky-500"
                }
              ),
              /* @__PURE__ */ jsx("span", { children: "timestamps" })
            ] }),
            /* @__PURE__ */ jsxs("span", { className: "ml-auto font-mono", children: [
              chunks.length,
              " chunks"
            ] }),
            /* @__PURE__ */ jsx(
              "button",
              {
                type: "button",
                onClick: onClearBuffer,
                onPointerDown: (e) => e.stopPropagation(),
                title: "Clear the scrollback (counters unchanged)",
                className: "nodrag nopan rounded border border-slate-700 px-1.5 py-0.5 text-[9px] hover:border-slate-500",
                children: "clear"
              }
            )
          ] }),
          /* @__PURE__ */ jsx("div", { className: "relative min-h-0 flex-1", children: /* @__PURE__ */ jsx(
            "div",
            {
              ref: scrollRef,
              className: "nodrag nopan absolute inset-0 overflow-y-auto p-2 font-mono text-[11px] leading-tight",
              onWheel: (e) => e.stopPropagation(),
              children: rendered.length === 0 ? /* @__PURE__ */ jsx("div", { className: "text-slate-600", children: connected ? "waiting for bytes…" : "connect to a port to see traffic" }) : rendered.map((c) => /* @__PURE__ */ jsxs(
                "div",
                {
                  className: c.dir === "rx" ? "whitespace-pre-wrap text-emerald-200" : "whitespace-pre-wrap text-sky-200",
                  children: [
                    timestamps && /* @__PURE__ */ jsxs("span", { className: "text-slate-600", children: [
                      new Date(c.ts * 1e3).toISOString().slice(11, 23),
                      " "
                    ] }),
                    /* @__PURE__ */ jsxs("span", { className: "text-slate-500", children: [
                      c.dir === "rx" ? "<" : ">",
                      c.source ? ` ${c.source}` : "",
                      " [",
                      c.len,
                      "]"
                    ] }),
                    " ",
                    c.decoded
                  ]
                },
                c.key
              ))
            }
          ) })
        ] }),
        /* @__PURE__ */ jsxs("section", { className: "rounded border border-slate-800 bg-slate-900/40 p-2", children: [
          /* @__PURE__ */ jsxs("div", { className: "flex items-end gap-2", children: [
            /* @__PURE__ */ jsxs("label", { className: "flex flex-col", children: [
              /* @__PURE__ */ jsx("span", { className: "mb-0.5 text-[10px] uppercase tracking-wider text-slate-500", children: "enc" }),
              /* @__PURE__ */ jsx(
                "select",
                {
                  value: txEncoding,
                  onChange: (e) => {
                    setTxEncoding(e.target.value);
                    setTxError(null);
                  },
                  onPointerDown: (e) => e.stopPropagation(),
                  className: "nodrag nopan rounded border border-slate-700 bg-slate-950 px-1 py-1 text-[11px]",
                  children: TX_ENCODING_OPTIONS.map((o) => /* @__PURE__ */ jsx("option", { value: o.value, children: o.label }, o.value))
                }
              )
            ] }),
            txEncoding === "ascii" && /* @__PURE__ */ jsxs("label", { className: "flex flex-col", children: [
              /* @__PURE__ */ jsx("span", { className: "mb-0.5 text-[10px] uppercase tracking-wider text-slate-500", children: "eol" }),
              /* @__PURE__ */ jsx(
                "select",
                {
                  value: txEol,
                  onChange: (e) => setTxEol(e.target.value),
                  onPointerDown: (e) => e.stopPropagation(),
                  className: "nodrag nopan rounded border border-slate-700 bg-slate-950 px-1 py-1 text-[11px]",
                  children: EOL_OPTIONS.map((o) => /* @__PURE__ */ jsx("option", { value: o.value, children: o.label }, o.value))
                }
              )
            ] }),
            /* @__PURE__ */ jsx(
              "textarea",
              {
                value: txInput,
                onChange: (e) => {
                  setTxInput(e.target.value);
                  setTxError(null);
                },
                onKeyDown: onTxKeyDown,
                onPointerDown: (e) => e.stopPropagation(),
                disabled: !connected,
                placeholder: !connected ? "connect first" : txEncoding === "ascii" ? "text — Enter sends, Shift-Enter newline" : txEncoding === "hex" ? "hex bytes — DE AD BE EF / DE:AD:BE:EF / DEADBEEF" : "decimal — 222 173 190 239",
                rows: 2,
                className: "nodrag nopan min-h-[44px] flex-1 resize-none rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none disabled:opacity-50"
              }
            ),
            /* @__PURE__ */ jsxs("div", { className: "flex flex-col items-stretch gap-1", children: [
              /* @__PURE__ */ jsx(
                "button",
                {
                  type: "button",
                  onClick: onSendTx,
                  onPointerDown: (e) => e.stopPropagation(),
                  disabled: !connected || !txInput,
                  className: "nodrag nopan rounded bg-sky-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40",
                  children: "Send"
                }
              ),
              /* @__PURE__ */ jsxs(
                "label",
                {
                  className: connected ? "nodrag nopan cursor-pointer rounded border border-slate-700 px-3 py-1 text-center text-[10px] hover:border-slate-500" : "nodrag nopan cursor-not-allowed rounded border border-slate-700 px-3 py-1 text-center text-[10px] opacity-40",
                  title: "Send a binary file",
                  children: [
                    "File…",
                    /* @__PURE__ */ jsx(
                      "input",
                      {
                        type: "file",
                        disabled: !connected,
                        onChange: (e) => {
                          const f = e.target.files?.[0];
                          if (f) {
                            onSendFile(f);
                            e.target.value = "";
                          }
                        },
                        onClick: (e) => e.stopPropagation(),
                        className: "hidden"
                      }
                    )
                  ]
                }
              )
            ] })
          ] }),
          txError && /* @__PURE__ */ jsxs("div", { className: "mt-1 font-mono text-[10px] text-rose-300", children: [
            "tx error: ",
            txError
          ] })
        ] })
      ]
    }
  );
}
export {
  SerialFullView as default
};
