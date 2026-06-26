import { jsxs, jsx } from "react/jsx-runtime";
import { forwardRef, createElement, useState, useEffect, useCallback } from "react";
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
const BAUD_OPTIONS = [2400, 9600, 19200, 38400, 115200];
const ADDRESS_OPTIONS = [128, 129, 130, 131, 132, 133, 134, 135];
function SabertoothFullView({ proxy }) {
  const wsClient = useWsClient();
  const proxyId = proxy.id ?? proxy.name ?? "";
  const stateTopic = `/sabertooth/${proxyId}/state`;
  const controlTopic = `/sabertooth/${proxyId}/control`;
  const [state, setState] = useState({});
  const [portDraft, setPortDraft] = useState("");
  const [baudDraft, setBaudDraft] = useState(9600);
  const [addressDraft, setAddressDraft] = useState(128);
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
    if (typeof state.address === "number") setAddressDraft(state.address);
  }, [state.last_port, state.last_baud, state.address, state.connected]);
  const sendAction = useCallback(
    (payload) => {
      wsClient.publish(controlTopic, payload);
    },
    [controlTopic, wsClient]
  );
  const connectRequest = useServiceRequest(controlTopic, {
    timeoutMs: 1e4,
    errorField: "last_error",
    replyPrefix: `sabertooth-${proxyId}-connect`
  });
  const disconnectRequest = useServiceRequest(controlTopic, {
    timeoutMs: 5e3,
    errorField: "last_error",
    replyPrefix: `sabertooth-${proxyId}-disconnect`
  });
  const onConnect = useCallback((e) => {
    e?.preventDefault();
    if (!portDraft || connectRequest.inFlight) return;
    void connectRequest.request("connect", { port: portDraft, baudrate: baudDraft, address: addressDraft });
  }, [portDraft, baudDraft, addressDraft, connectRequest]);
  const onDisconnect = useCallback(() => {
    if (disconnectRequest.inFlight) return;
    void disconnectRequest.request("disconnect");
  }, [disconnectRequest]);
  const onRefreshPorts = useCallback(() => sendAction({ action: "list_ports" }), [sendAction]);
  const connected = !!state.connected;
  const channels = state.channels ?? [1, 2];
  const error = connectRequest.error ?? disconnectRequest.error ?? state.last_error;
  const ports = state.ports ?? [];
  const portDevices = new Set(ports.map((p) => p.device));
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: "flex min-w-[460px] flex-col gap-3 p-3 text-xs",
      onPointerDown: (e) => e.stopPropagation(),
      children: [
        /* @__PURE__ */ jsxs(Section, { title: "Connection", children: [
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
                    className: "nodrag nopan w-60 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100 focus:border-slate-500 focus:outline-none disabled:opacity-50",
                    children: [
                      !portDraft && /* @__PURE__ */ jsx("option", { value: "", children: "(pick a port)" }),
                      ports.map((p) => {
                        const others = (p.holders ?? []).filter((h) => h.proxy_id !== proxyId);
                        const ownedByOther = others.length > 0;
                        return /* @__PURE__ */ jsxs("option", { value: p.device, disabled: ownedByOther, children: [
                          p.device,
                          p.description ? `  — ${p.description}` : "",
                          ownedByOther ? "  (in use)" : ""
                        ] }, p.device);
                      }),
                      portDraft && !portDevices.has(portDraft) && /* @__PURE__ */ jsxs("option", { value: portDraft, children: [
                        portDraft,
                        "  — (not detected)"
                      ] })
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
                  className: "nodrag nopan w-24 rounded border border-slate-700 bg-slate-950 px-1 py-1 font-mono text-[11px] text-slate-100 disabled:opacity-50",
                  children: BAUD_OPTIONS.map((b) => /* @__PURE__ */ jsx("option", { value: b, children: b }, b))
                }
              )
            ] }),
            /* @__PURE__ */ jsxs("label", { className: "flex flex-col", children: [
              /* @__PURE__ */ jsx("span", { className: "mb-0.5 text-[10px] uppercase tracking-wider text-slate-500", children: "address" }),
              /* @__PURE__ */ jsx(
                "select",
                {
                  value: addressDraft,
                  onChange: (e) => setAddressDraft(Number(e.target.value)),
                  disabled: connected,
                  onPointerDown: (e) => e.stopPropagation(),
                  className: "nodrag nopan w-20 rounded border border-slate-700 bg-slate-950 px-1 py-1 font-mono text-[11px] text-slate-100 disabled:opacity-50",
                  children: ADDRESS_OPTIONS.map((a) => /* @__PURE__ */ jsx("option", { value: a, children: a }, a))
                }
              )
            ] }),
            /* @__PURE__ */ jsxs("div", { className: "ml-auto flex items-center gap-2", children: [
              /* @__PURE__ */ jsxs("span", { className: "flex items-center gap-1.5 font-mono text-[10px]", children: [
                /* @__PURE__ */ jsx("span", { className: `inline-block h-2.5 w-2.5 rounded-full ${connected ? "bg-emerald-400 shadow-[0_0_6px_1px] shadow-emerald-500/60" : "bg-slate-600"}` }),
                /* @__PURE__ */ jsx("span", { className: connected ? "text-emerald-300" : "text-slate-500", children: connected ? "connected" : "offline" })
              ] }),
              !connected ? /* @__PURE__ */ jsxs(
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
              )
            ] })
          ] }),
          error && /* @__PURE__ */ jsxs("div", { className: "mt-2 truncate font-mono text-[10px] text-rose-300", title: error, children: [
            "error: ",
            error
          ] })
        ] }),
        /* @__PURE__ */ jsx(
          SafetySection,
          {
            maxOutput: state.max_output ?? 1,
            serialTimeoutMs: state.serial_timeout_ms ?? 1e3,
            ramping: state.ramping ?? 0,
            deadband: state.deadband ?? 0,
            onSetMaxOutput: (v) => sendAction({ action: "set_max_output", max_output: v }),
            onSetOptions: (opts) => sendAction({ action: "set_options", ...opts })
          }
        ),
        /* @__PURE__ */ jsx(Section, { title: "Manual test", children: !connected ? /* @__PURE__ */ jsx("div", { className: "rounded border border-slate-800 bg-slate-950/70 p-2 text-slate-500", children: "Connect to drive motors directly. (For limits + e-stop + multi-motor control, use a motor_control service.)" }) : /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-3", children: [
          channels.map((ch) => /* @__PURE__ */ jsx(
            MotorSlider,
            {
              channel: ch,
              value: state.motors?.[String(ch)] ?? 0,
              onSet: (v) => sendAction({ action: "motor_set", motor: ch, value: v }),
              onStop: () => sendAction({ action: "motor_stop", motor: ch })
            },
            ch
          )),
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              onClick: () => sendAction({ action: "motor_stop_all" }),
              onPointerDown: (e) => e.stopPropagation(),
              className: "nodrag nopan rounded bg-rose-600 px-3 py-2 text-sm font-bold uppercase tracking-wide text-white hover:bg-rose-500",
              children: "■ Stop all"
            }
          )
        ] }) })
      ]
    }
  );
}
function MotorSlider({
  channel,
  value,
  onSet,
  onStop
}) {
  const [draft, setDraft] = useState(value);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) setDraft(value);
  }, [value, dragging]);
  const pct = Math.round(draft * 100);
  return /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-1", children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-baseline justify-between font-mono text-[10px] text-slate-400", children: [
      /* @__PURE__ */ jsxs("span", { className: "uppercase tracking-wider text-slate-500", children: [
        "motor ",
        channel
      ] }),
      /* @__PURE__ */ jsxs("span", { className: pct === 0 ? "text-slate-500" : pct > 0 ? "text-emerald-300" : "text-amber-300", children: [
        pct > 0 ? "+" : "",
        pct,
        "%"
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
      /* @__PURE__ */ jsx(
        "input",
        {
          type: "range",
          min: -1,
          max: 1,
          step: 0.01,
          value: draft,
          className: "nodrag nopan flex-1 accent-emerald-500",
          onPointerDown: () => setDragging(true),
          onPointerUp: () => setDragging(false),
          onChange: (e) => {
            const v = Number(e.target.value);
            setDraft(v);
            onSet(v);
          }
        }
      ),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          onClick: () => {
            setDraft(0);
            onStop();
          },
          onPointerDown: (e) => e.stopPropagation(),
          className: "nodrag nopan rounded border border-slate-700 px-2 py-1 text-[10px] hover:border-rose-500 hover:text-rose-300",
          children: "stop"
        }
      )
    ] })
  ] });
}
function SafetySection({
  maxOutput,
  serialTimeoutMs,
  ramping,
  deadband,
  onSetMaxOutput,
  onSetOptions
}) {
  const [maxDraft, setMaxDraft] = useState(maxOutput);
  const [dragging, setDragging] = useState(false);
  const [timeoutDraft, setTimeoutDraft] = useState(String(serialTimeoutMs));
  const [rampDraft, setRampDraft] = useState(String(ramping));
  const [deadDraft, setDeadDraft] = useState(String(deadband));
  useEffect(() => {
    if (!dragging) setMaxDraft(maxOutput);
  }, [maxOutput, dragging]);
  useEffect(() => {
    setTimeoutDraft(String(serialTimeoutMs));
  }, [serialTimeoutMs]);
  useEffect(() => {
    setRampDraft(String(ramping));
  }, [ramping]);
  useEffect(() => {
    setDeadDraft(String(deadband));
  }, [deadband]);
  return /* @__PURE__ */ jsx(Section, { title: "Safety", children: /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-3", children: [
    /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-1", children: [
      /* @__PURE__ */ jsxs("div", { className: "flex items-baseline justify-between font-mono text-[10px]", children: [
        /* @__PURE__ */ jsx("span", { className: "uppercase tracking-wider text-slate-500", children: "max output" }),
        /* @__PURE__ */ jsxs("span", { className: "text-amber-300", children: [
          Math.round(maxDraft * 100),
          "%"
        ] })
      ] }),
      /* @__PURE__ */ jsx(
        "input",
        {
          type: "range",
          min: 0,
          max: 1,
          step: 0.01,
          value: maxDraft,
          className: "nodrag nopan accent-amber-500",
          onPointerDown: () => setDragging(true),
          onPointerUp: () => {
            setDragging(false);
            onSetMaxOutput(maxDraft);
          },
          onChange: (e) => setMaxDraft(Number(e.target.value))
        }
      ),
      /* @__PURE__ */ jsx("span", { className: "text-[10px] text-slate-500", children: "Hard clamp on output magnitude — caps motor power regardless of what's commanded." })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "grid grid-cols-3 gap-2", children: [
      /* @__PURE__ */ jsxs("label", { className: "flex flex-col gap-0.5", children: [
        /* @__PURE__ */ jsx("span", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: "timeout (ms)" }),
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "number",
            min: 0,
            step: 100,
            value: timeoutDraft,
            onChange: (e) => setTimeoutDraft(e.target.value),
            onBlur: () => onSetOptions({ serial_timeout_ms: Math.max(0, Number(timeoutDraft) || 0) }),
            onPointerDown: (e) => e.stopPropagation(),
            className: "nodrag nopan rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100"
          }
        )
      ] }),
      /* @__PURE__ */ jsxs("label", { className: "flex flex-col gap-0.5", children: [
        /* @__PURE__ */ jsx("span", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: "ramping (0-80)" }),
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "number",
            min: 0,
            max: 80,
            value: rampDraft,
            onChange: (e) => setRampDraft(e.target.value),
            onBlur: () => onSetOptions({ ramping: Math.max(0, Math.min(80, Number(rampDraft) || 0)) }),
            onPointerDown: (e) => e.stopPropagation(),
            className: "nodrag nopan rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100"
          }
        )
      ] }),
      /* @__PURE__ */ jsxs("label", { className: "flex flex-col gap-0.5", children: [
        /* @__PURE__ */ jsx("span", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: "deadband (0-127)" }),
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "number",
            min: 0,
            max: 127,
            value: deadDraft,
            onChange: (e) => setDeadDraft(e.target.value),
            onBlur: () => onSetOptions({ deadband: Math.max(0, Math.min(127, Number(deadDraft) || 0)) }),
            onPointerDown: (e) => e.stopPropagation(),
            className: "nodrag nopan rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100"
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ jsx("span", { className: "text-[10px] text-slate-500", children: "Serial timeout is the hardware failsafe — motors stop if the link goes quiet for this long. 0 disables." })
  ] }) });
}
function Section({ title, children }) {
  return /* @__PURE__ */ jsxs("section", { className: "rounded border border-slate-800 bg-slate-900/40 p-3", children: [
    /* @__PURE__ */ jsx("h3", { className: "mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400", children: title }),
    children
  ] });
}
export {
  SabertoothFullView as default
};
