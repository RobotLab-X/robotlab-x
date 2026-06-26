import { jsxs, jsx } from "react/jsx-runtime";
import { forwardRef, createElement, useState, useEffect, useCallback, useMemo } from "react";
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
const CONNECT_REPLY_TIMEOUT_MS = 1e4;
const HEARTBEAT_FRESH_MS = 2500;
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}
function ArduinoTelemetrixView({ proxy }) {
  const wsClient = useWsClient();
  const proxyId = proxy.id ?? proxy.name ?? "";
  const stateTopic = `/arduino_telemetrix/${proxyId}/state`;
  const heartbeatTopic = `/arduino_telemetrix/${proxyId}/heartbeat`;
  const controlTopic = `/arduino_telemetrix/${proxyId}/control`;
  const [state, setState] = useState({});
  const [lastBeat, setLastBeat] = useState(null);
  const [, setNowTick] = useState(0);
  useEffect(() => {
    if (!proxyId) return;
    const offState = wsClient.subscribe(stateTopic, (f) => {
      if (f.method !== "message") return;
      setState((prev) => ({ ...prev, ...f.payload }));
    });
    const offBeat = wsClient.subscribe(heartbeatTopic, (f) => {
      if (f.method !== "message") return;
      const p = f.payload;
      if (typeof p?.ts === "number") setLastBeat(p.ts * 1e3);
    });
    const timer = setInterval(() => setNowTick((t) => t + 1), 1e3);
    return () => {
      offState();
      offBeat();
      clearInterval(timer);
    };
  }, [proxyId, stateTopic, heartbeatTopic, wsClient]);
  const send = useCallback(
    (action, args = {}) => {
      wsClient.publish(controlTopic, { action, ...args });
    },
    [controlTopic, wsClient]
  );
  const connectReq = useServiceRequest(controlTopic, {
    timeoutMs: CONNECT_REPLY_TIMEOUT_MS,
    errorField: "error",
    replyPrefix: `tlm-${proxyId}-connect`
  });
  const disconnectReq = useServiceRequest(controlTopic, {
    timeoutMs: CONNECT_REPLY_TIMEOUT_MS,
    errorField: "error",
    replyPrefix: `tlm-${proxyId}-disconnect`
  });
  const connecting = connectReq.inFlight || disconnectReq.inFlight;
  const serviceRunning = proxy.status === "running" || proxy.status === "starting";
  const heartbeatFresh = lastBeat !== null && Date.now() - lastBeat < HEARTBEAT_FRESH_MS;
  const connected = !!state.connected;
  const ports = state.ports ?? [];
  const [selPort, setSelPort] = useState("");
  const effectivePort = selPort || state.last_port || (ports[0]?.device ?? "");
  const onConnect = useCallback((e) => {
    e.preventDefault();
    const baud = state.last_baud ?? 115200;
    if (effectivePort) void connectReq.request("connect", { port: effectivePort, baud });
  }, [connectReq, effectivePort, state.last_baud]);
  const connectError = connectReq.error || disconnectReq.error || state.connect_error || null;
  const pixel = state.pixel ?? {};
  const pixelConfigured = pixel.pin !== null && pixel.pin !== void 0 && (pixel.count ?? 0) > 0;
  const [pxPin, setPxPin] = useState("6");
  const [pxCount, setPxCount] = useState("8");
  const [pxWidth, setPxWidth] = useState("0");
  const [pxHeight, setPxHeight] = useState("0");
  const [pxSerpentine, setPxSerpentine] = useState(false);
  const [pxColor, setPxColor] = useState("#ff0000");
  const [pxIndex, setPxIndex] = useState("0");
  const onConfigure = useCallback((e) => {
    e.preventDefault();
    send("pixel_configure", {
      pin: Number(pxPin),
      count: Number(pxCount),
      width: Number(pxWidth),
      height: Number(pxHeight),
      serpentine: pxSerpentine
    });
  }, [send, pxPin, pxCount, pxWidth, pxHeight, pxSerpentine]);
  const fill = useCallback(() => {
    const [r, g, b] = hexToRgb(pxColor);
    send("pixel_fill", { r, g, b, show: true });
  }, [send, pxColor]);
  const setOne = useCallback(() => {
    const [r, g, b] = hexToRgb(pxColor);
    send("pixel_set", { index: Number(pxIndex), r, g, b, show: true });
  }, [send, pxColor, pxIndex]);
  const pinList = useMemo(
    () => Object.entries(state.pins ?? {}).map(([p, s]) => ({ pin: Number(p), ...s })).sort((a, b) => a.pin - b.pin),
    [state.pins]
  );
  const fieldCls = "rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200";
  const btnCls = "rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-40";
  return /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-3 p-3 text-slate-200", children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 text-xs", children: [
      /* @__PURE__ */ jsx("span", { className: `h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-slate-600"}` }),
      /* @__PURE__ */ jsx("span", { className: "font-medium", children: connected ? "Connected" : "Disconnected" }),
      state.port && /* @__PURE__ */ jsx("span", { className: "text-slate-400", children: state.port }),
      state.firmware_name && /* @__PURE__ */ jsxs("span", { className: "text-slate-500", children: [
        state.firmware_name,
        " ",
        state.firmware_version ?? ""
      ] }),
      /* @__PURE__ */ jsxs("span", { className: "ml-auto flex items-center gap-1 text-slate-500", children: [
        /* @__PURE__ */ jsx("span", { className: `h-1.5 w-1.5 rounded-full ${serviceRunning && heartbeatFresh ? "bg-emerald-400" : "bg-slate-700"}` }),
        serviceRunning ? heartbeatFresh ? "live" : "stale" : "stopped"
      ] })
    ] }),
    /* @__PURE__ */ jsxs("form", { onSubmit: onConnect, className: "flex flex-wrap items-center gap-2", children: [
      /* @__PURE__ */ jsxs(
        "select",
        {
          className: fieldCls,
          value: effectivePort,
          onChange: (e) => setSelPort(e.target.value),
          disabled: connected || connecting,
          children: [
            ports.length === 0 && /* @__PURE__ */ jsx("option", { value: "", children: "(no serial ports)" }),
            ports.map((p) => /* @__PURE__ */ jsxs("option", { value: p.device, children: [
              p.device,
              p.description ? ` — ${p.description}` : ""
            ] }, p.device))
          ]
        }
      ),
      !connected ? /* @__PURE__ */ jsx("button", { type: "submit", className: btnCls, disabled: connecting || !effectivePort, children: connecting ? /* @__PURE__ */ jsx(Loader2, { className: "h-3 w-3 animate-spin" }) : "Connect" }) : /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          className: btnCls,
          disabled: connecting,
          onClick: () => void disconnectReq.request("disconnect"),
          children: connecting ? /* @__PURE__ */ jsx(Loader2, { className: "h-3 w-3 animate-spin" }) : "Disconnect"
        }
      ),
      /* @__PURE__ */ jsx("button", { type: "button", className: btnCls, onClick: () => send("list_ports"), disabled: connecting, children: "Rescan" })
    ] }),
    connectError && /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 rounded border border-rose-800 bg-rose-950/40 px-2 py-1 text-xs text-rose-300", children: [
      /* @__PURE__ */ jsx("span", { className: "flex-1", children: connectError }),
      /* @__PURE__ */ jsx("button", { type: "button", className: "text-rose-400 hover:text-rose-200", onClick: () => send("clear_error"), children: "dismiss" })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "rounded border border-slate-800 p-2", children: [
      /* @__PURE__ */ jsx("div", { className: "mb-2 text-xs font-medium text-slate-300", children: "NeoPixel strip / matrix" }),
      /* @__PURE__ */ jsxs("form", { onSubmit: onConfigure, className: "flex flex-wrap items-end gap-2", children: [
        /* @__PURE__ */ jsxs("label", { className: "flex flex-col text-[10px] text-slate-500", children: [
          "pin",
          /* @__PURE__ */ jsx("input", { className: `${fieldCls} w-14`, value: pxPin, onChange: (e) => setPxPin(e.target.value) })
        ] }),
        /* @__PURE__ */ jsxs("label", { className: "flex flex-col text-[10px] text-slate-500", children: [
          "count",
          /* @__PURE__ */ jsx("input", { className: `${fieldCls} w-16`, value: pxCount, onChange: (e) => setPxCount(e.target.value) })
        ] }),
        /* @__PURE__ */ jsxs("label", { className: "flex flex-col text-[10px] text-slate-500", children: [
          "width",
          /* @__PURE__ */ jsx("input", { className: `${fieldCls} w-14`, value: pxWidth, onChange: (e) => setPxWidth(e.target.value) })
        ] }),
        /* @__PURE__ */ jsxs("label", { className: "flex flex-col text-[10px] text-slate-500", children: [
          "height",
          /* @__PURE__ */ jsx("input", { className: `${fieldCls} w-14`, value: pxHeight, onChange: (e) => setPxHeight(e.target.value) })
        ] }),
        /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-1 text-[10px] text-slate-500", children: [
          /* @__PURE__ */ jsx("input", { type: "checkbox", checked: pxSerpentine, onChange: (e) => setPxSerpentine(e.target.checked) }),
          "serpentine"
        ] }),
        /* @__PURE__ */ jsx("button", { type: "submit", className: btnCls, disabled: !connected, children: "Configure" })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "mt-2 flex flex-wrap items-center gap-2", children: [
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "color",
            value: pxColor,
            onChange: (e) => setPxColor(e.target.value),
            className: "h-7 w-10 rounded border border-slate-700 bg-slate-900"
          }
        ),
        /* @__PURE__ */ jsx("button", { type: "button", className: btnCls, onClick: fill, disabled: !pixelConfigured, children: "Fill" }),
        /* @__PURE__ */ jsx("button", { type: "button", className: btnCls, onClick: () => send("pixel_clear", { show: true }), disabled: !pixelConfigured, children: "Clear" }),
        /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-1 text-[10px] text-slate-500", children: [
          "@",
          /* @__PURE__ */ jsx("input", { className: `${fieldCls} w-14`, value: pxIndex, onChange: (e) => setPxIndex(e.target.value) })
        ] }),
        /* @__PURE__ */ jsx("button", { type: "button", className: btnCls, onClick: setOne, disabled: !pixelConfigured, children: "Set pixel" })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "mt-2 flex items-center gap-2 text-[10px] text-slate-500", children: [
        /* @__PURE__ */ jsx("span", { children: "brightness" }),
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "range",
            min: 0,
            max: 255,
            defaultValue: pixel.brightness ?? 255,
            onChange: (e) => send("pixel_set_brightness", { value: Number(e.target.value) }),
            disabled: !pixelConfigured,
            className: "flex-1"
          }
        ),
        /* @__PURE__ */ jsx("span", { className: "w-8 text-right", children: pixel.brightness ?? 255 })
      ] })
    ] }),
    pinList.length > 0 && /* @__PURE__ */ jsxs("div", { className: "rounded border border-slate-800 p-2 text-[11px]", children: [
      /* @__PURE__ */ jsx("div", { className: "mb-1 font-medium text-slate-400", children: "Pins" }),
      /* @__PURE__ */ jsx("div", { className: "grid grid-cols-3 gap-1", children: pinList.map((p) => /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between rounded bg-slate-900 px-1.5 py-0.5", children: [
        /* @__PURE__ */ jsxs("span", { className: "text-slate-300", children: [
          "D",
          p.pin
        ] }),
        /* @__PURE__ */ jsx("span", { className: "text-slate-500", children: p.mode ?? "" }),
        /* @__PURE__ */ jsx("span", { className: "text-slate-400", children: p.value ?? "" })
      ] }, p.pin)) })
    ] })
  ] });
}
export {
  ArduinoTelemetrixView as default
};
