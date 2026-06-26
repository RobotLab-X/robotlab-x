import { jsxs, jsx, Fragment } from "react/jsx-runtime";
import { forwardRef, createElement, useState, useEffect, useMemo, useCallback } from "react";
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
const PIN_MODES = ["input", "output", "pwm", "analog", "servo"];
const HEARTBEAT_FRESH_MS = 2500;
function ArduinoFullView({ proxy }) {
  const wsClient = useWsClient();
  const proxyId = proxy.id ?? proxy.name ?? "";
  const stateTopic = `/arduino/${proxyId}/state`;
  const heartbeatTopic = `/arduino/${proxyId}/heartbeat`;
  const controlTopic = `/arduino/${proxyId}/control`;
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
  const [serialProxies, setSerialProxies] = useState({});
  useEffect(() => {
    const off = wsClient.subscribe("/serial/+/state", (f) => {
      if (f.method !== "message") return;
      const m = (f.topic ?? "").match(/^\/serial\/([^/]+)\/state$/);
      if (!m) return;
      const id = m[1];
      const p = f.payload ?? {};
      setSerialProxies((prev) => ({
        ...prev,
        [id]: { port: p.port, connected: !!p.connected, baudrate: p.baudrate }
      }));
    });
    return off;
  }, [wsClient]);
  const configuredPins = useMemo(() => Object.keys(state.pins ?? {}).map(Number).sort((a, b) => a - b), [state.pins]);
  useEffect(() => {
    if (!proxyId || configuredPins.length === 0) return;
    const unsubs = [];
    for (const p of configuredPins) {
      const topic = `/arduino/${proxyId}/pin/${p}`;
      const off = wsClient.subscribe(topic, (f) => {
        if (f.method !== "message") return;
        const payload = f.payload;
        if (typeof payload?.value !== "number") return;
        setState((prev) => {
          const pins = { ...prev.pins ?? {} };
          pins[String(p)] = { ...pins[String(p)] ?? {}, value: payload.value };
          return { ...prev, pins };
        });
      });
      unsubs.push(off);
    }
    return () => {
      for (const off of unsubs) off();
    };
  }, [proxyId, configuredPins.join(","), wsClient]);
  const send = useCallback(
    (action, args = {}) => {
      wsClient.publish(controlTopic, { action, ...args });
    },
    [controlTopic, wsClient]
  );
  const connectReq = useServiceRequest(controlTopic, {
    timeoutMs: CONNECT_REPLY_TIMEOUT_MS,
    errorField: "error",
    replyPrefix: `arduino-${proxyId}-connect`
  });
  const disconnectReq = useServiceRequest(controlTopic, {
    timeoutMs: CONNECT_REPLY_TIMEOUT_MS,
    errorField: "error",
    replyPrefix: `arduino-${proxyId}-disconnect`
  });
  const connecting = connectReq.inFlight || disconnectReq.inFlight;
  const sendConnect = useCallback((port, baud) => {
    void connectReq.request("connect", { port, baud });
  }, [connectReq]);
  const sendDisconnect = useCallback(() => {
    void disconnectReq.request("disconnect");
  }, [disconnectReq]);
  const serviceRunning = proxy.status === "running" || proxy.status === "starting";
  const heartbeatFresh = lastBeat !== null && Date.now() - lastBeat < HEARTBEAT_FRESH_MS;
  const heartbeatAge = lastBeat !== null ? Date.now() - lastBeat : null;
  const connected = !!state.connected;
  const ports = useMemo(() => {
    const real = state.ports ?? [];
    const virtual = Object.entries(serialProxies).map(([id, info]) => ({
      device: `bus:${id}`,
      description: info.connected ? `serial proxy → ${info.port ?? "?"}` : "serial proxy (not connected)",
      // hwid kept empty; the bus protocol has no hardware id.
      hwid: "",
      // Virtual ports are always "available" from arduino's POV —
      // the underlying real-port contention is handled inside the
      // serial service. The serial proxy ITSELF can only be
      // attached to once at a time though; if some other process
      // already opened bus:serial-1 via a BusBackedSerial it'd
      // share the same /serial/<id>/rx stream which is actually
      // OK (broadcasting to multiple subscribers). So we don't
      // mark virtual ports as "in use".
      holders: [],
      available: true
    }));
    return [...real, ...virtual];
  }, [state.ports, serialProxies]);
  const displayedConnectError = connectReq.error ?? disconnectReq.error ?? (connecting ? null : state.connect_error ?? null);
  return /* @__PURE__ */ jsxs("div", { className: "flex min-w-[420px] flex-col gap-3 p-3 text-xs", children: [
    /* @__PURE__ */ jsx(
      Connection,
      {
        ports,
        ownProxyId: proxyId,
        connectedPort: state.port,
        lastPort: state.last_port ?? null,
        lastBaud: state.last_baud ?? null,
        connected,
        connecting,
        heartbeatFresh,
        heartbeatAge,
        serviceRunning,
        onRefresh: () => send("list_ports"),
        onConnect: sendConnect,
        onDisconnect: sendDisconnect,
        onPortChange: () => {
        }
      }
    ),
    /* @__PURE__ */ jsx(
      Firmware,
      {
        firmataVersion: state.firmata_version ?? null,
        firmwareName: state.firmware_name ?? null,
        firmwareVersion: state.firmware_version ?? null,
        connectError: displayedConnectError,
        connecting
      }
    ),
    /* @__PURE__ */ jsx(
      Pins,
      {
        connected,
        pins: state.pins ?? {},
        onSetMode: (pin, mode) => send("set_pin_mode", { pin, mode }),
        onDigitalWrite: (pin, value) => send("digital_write", { pin, value }),
        onAnalogWrite: (pin, value) => send("analog_write", { pin, value }),
        onDigitalRead: (pin) => send("digital_read", { pin }),
        onAnalogRead: (pin) => send("analog_read", { pin })
      }
    ),
    /* @__PURE__ */ jsx(
      I2C,
      {
        connected,
        onSetup: () => send("i2c_setup"),
        onScan: () => send("i2c_scan"),
        onRead: (addr, reg, count) => send("i2c_read", { addr, reg, count }),
        onWrite: (addr, data) => send("i2c_write", { addr, data })
      }
    ),
    /* @__PURE__ */ jsx(
      Sonar,
      {
        proxyId,
        connected,
        onSetup: (trig, echo) => send("sonar_setup", { trigger_pin: trig, echo_pin: echo }),
        onRead: (trig) => send("sonar_read", { trigger_pin: trig })
      }
    )
  ] });
}
const BAUD_OPTIONS = [9600, 19200, 38400, 57600, 115200];
function Connection({
  ports,
  ownProxyId,
  connectedPort,
  lastPort,
  lastBaud,
  connected,
  connecting,
  heartbeatFresh,
  heartbeatAge,
  serviceRunning,
  onRefresh,
  onConnect,
  onDisconnect,
  onPortChange
}) {
  const [selected, setSelected] = useState("");
  const [baud, setBaud] = useState(lastBaud ?? 115200);
  useEffect(() => {
    if (selected) return;
    if (lastPort && ports.some((p) => p.device === lastPort)) {
      setSelected(lastPort);
      return;
    }
    if (ports.length > 0) setSelected(ports[0].device);
  }, [ports, lastPort, selected]);
  useEffect(() => {
    if (!connected && lastBaud && lastBaud !== baud) setBaud(lastBaud);
  }, [lastBaud, connected]);
  const dotColor = !serviceRunning ? "bg-slate-500" : connected ? heartbeatFresh ? "bg-emerald-500" : "bg-amber-400" : "bg-slate-500";
  return /* @__PURE__ */ jsxs(Section, { title: "Connection", children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
      /* @__PURE__ */ jsxs(
        "select",
        {
          value: selected,
          onChange: (e) => {
            setSelected(e.target.value);
            onPortChange();
          },
          disabled: !serviceRunning || connected || connecting,
          onPointerDown: (e) => e.stopPropagation(),
          onClick: (e) => e.stopPropagation(),
          className: "nodrag nopan flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-200 focus:border-slate-500 focus:outline-none disabled:opacity-50",
          children: [
            ports.length === 0 && /* @__PURE__ */ jsx("option", { value: "", children: "(no ports detected)" }),
            ports.map((p) => {
              const others = (p.holders ?? []).filter((h) => h.proxy_id !== ownProxyId);
              const ownedByOther = others.length > 0;
              const ownerLabel = ownedByOther ? others.map((h) => h.proxy_id ?? `${h.service_type ?? h.name ?? "pid"} ${h.pid}`).join(", ") : "";
              return /* @__PURE__ */ jsxs("option", { value: p.device, disabled: ownedByOther, children: [
                p.device,
                p.device === lastPort ? "  ★ last" : "",
                p.description ? `  — ${p.description}` : "",
                ownedByOther ? `  (in use by ${ownerLabel})` : ""
              ] }, p.device);
            })
          ]
        }
      ),
      /* @__PURE__ */ jsx(ActionButton, { onClick: onRefresh, disabled: !serviceRunning || connecting, children: "↻" }),
      /* @__PURE__ */ jsx(
        "select",
        {
          value: baud,
          onChange: (e) => {
            setBaud(Number(e.target.value));
            onPortChange();
          },
          disabled: !serviceRunning || connected || connecting,
          onPointerDown: (e) => e.stopPropagation(),
          onClick: (e) => e.stopPropagation(),
          title: "Serial baud rate — FirmataExpress runs at 115200 (default). pymata4 only does its FirmataExpress handshake at 115200; other rates fall through and may report 'Firmware Version Not Found' on a healthy board.",
          className: "nodrag nopan rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-200 focus:border-slate-500 focus:outline-none disabled:opacity-50",
          children: BAUD_OPTIONS.map((b) => /* @__PURE__ */ jsxs("option", { value: b, children: [
            b,
            b === lastBaud ? "  ★" : ""
          ] }, b))
        }
      ),
      !connected ? /* @__PURE__ */ jsx(
        ActionButton,
        {
          tone: "primary",
          onClick: () => selected && onConnect(selected, baud),
          disabled: !serviceRunning || !selected || connecting,
          children: connecting ? /* @__PURE__ */ jsxs("span", { className: "inline-flex items-center gap-1.5", children: [
            /* @__PURE__ */ jsx(Loader2, { className: "h-3 w-3 animate-spin" }),
            /* @__PURE__ */ jsx("span", { children: "Connecting…" })
          ] }) : "Connect"
        }
      ) : /* @__PURE__ */ jsx(ActionButton, { onClick: onDisconnect, disabled: !serviceRunning || connecting, children: connecting ? /* @__PURE__ */ jsxs("span", { className: "inline-flex items-center gap-1.5", children: [
        /* @__PURE__ */ jsx(Loader2, { className: "h-3 w-3 animate-spin" }),
        /* @__PURE__ */ jsx("span", { children: "Disconnecting…" })
      ] }) : "Disconnect" })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "mt-2 flex items-center gap-2 text-[10px] uppercase tracking-wide text-slate-400", children: [
      /* @__PURE__ */ jsx("span", { className: `inline-block h-2 w-2 rounded-full ${dotColor}` }),
      !serviceRunning && /* @__PURE__ */ jsx("span", { children: "service not running" }),
      serviceRunning && !connected && /* @__PURE__ */ jsx("span", { children: "disconnected" }),
      serviceRunning && connected && /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsxs("span", { children: [
          "connected on ",
          connectedPort
        ] }),
        /* @__PURE__ */ jsxs("span", { className: "text-slate-500", children: [
          "· heartbeat ",
          heartbeatAge === null ? "—" : `${Math.round(heartbeatAge)}ms ago`
        ] })
      ] })
    ] })
  ] });
}
function Firmware({
  firmataVersion,
  firmwareName,
  firmwareVersion,
  connectError,
  connecting
}) {
  return /* @__PURE__ */ jsx(Section, { title: "Firmware", children: /* @__PURE__ */ jsxs("div", { className: "rounded border border-slate-800 bg-slate-950/70 p-2 leading-snug text-slate-400", children: [
    /* @__PURE__ */ jsxs("div", { className: "text-slate-300", children: [
      "Expected — ",
      /* @__PURE__ */ jsx("span", { className: "font-mono", children: "StandardFirmata" }),
      " (Arduino IDE",
      " → ",
      "Examples → Firmata → StandardFirmata) or",
      " ",
      /* @__PURE__ */ jsx("span", { className: "font-mono", children: "FirmataExpress" }),
      " for sonar / I2C / servo extensions."
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 font-mono", children: [
      /* @__PURE__ */ jsx("span", { className: "text-slate-500", children: "firmata" }),
      /* @__PURE__ */ jsx("span", { children: firmataVersion ?? "—" }),
      /* @__PURE__ */ jsx("span", { className: "text-slate-500", children: "firmware" }),
      /* @__PURE__ */ jsxs("span", { children: [
        firmwareName ?? "—",
        " ",
        firmwareVersion ?? ""
      ] })
    ] }),
    connecting && /* @__PURE__ */ jsxs("div", { className: "mt-2 inline-flex items-center gap-1.5 rounded border border-amber-700 bg-amber-950/40 px-2 py-1 font-mono text-[11px] text-amber-200", children: [
      /* @__PURE__ */ jsx(Loader2, { className: "h-3 w-3 animate-spin" }),
      /* @__PURE__ */ jsx("span", { children: "Negotiating with the board…" })
    ] }),
    !connecting && connectError && /* @__PURE__ */ jsxs("div", { className: "mt-2 rounded border border-rose-700 bg-rose-950/40 px-2 py-1 font-mono text-[11px] text-rose-200", children: [
      "connect failed — ",
      connectError
    ] })
  ] }) });
}
function Pins({
  connected,
  pins,
  onSetMode,
  onDigitalWrite,
  onAnalogWrite,
  onDigitalRead,
  onAnalogRead
}) {
  const [newPin, setNewPin] = useState("");
  const [newMode, setNewMode] = useState("input");
  const rows = useMemo(() => {
    return Object.entries(pins).map(([k, v]) => ({ pin: Number(k), ...v })).sort((a, b) => a.pin - b.pin);
  }, [pins]);
  return /* @__PURE__ */ jsxs(Section, { title: "Pins", children: [
    !connected && /* @__PURE__ */ jsx("div", { className: "rounded border border-slate-800 bg-slate-950/70 p-2 text-slate-500", children: "Connect to a board first." }),
    connected && /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsxs(
        "form",
        {
          className: "mb-2 flex items-center gap-2",
          onSubmit: (e) => {
            e.preventDefault();
            const p = Number.parseInt(newPin, 10);
            if (!Number.isNaN(p)) {
              onSetMode(p, newMode);
              setNewPin("");
            }
          },
          onPointerDown: (e) => e.stopPropagation(),
          children: [
            /* @__PURE__ */ jsx("span", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: "add pin" }),
            /* @__PURE__ */ jsx(
              "input",
              {
                type: "number",
                value: newPin,
                onChange: (e) => setNewPin(e.target.value),
                placeholder: "13",
                className: "nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100 focus:border-slate-500 focus:outline-none"
              }
            ),
            /* @__PURE__ */ jsx(
              "select",
              {
                value: newMode,
                onChange: (e) => setNewMode(e.target.value),
                className: "nodrag nopan rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100",
                children: PIN_MODES.map((m) => /* @__PURE__ */ jsx("option", { value: m, children: m }, m))
              }
            ),
            /* @__PURE__ */ jsx(ActionButton, { type: "submit", disabled: !newPin, children: "Add" })
          ]
        }
      ),
      rows.length === 0 && /* @__PURE__ */ jsx("div", { className: "text-slate-500", children: "No pins configured yet." }),
      rows.length > 0 && /* @__PURE__ */ jsxs("table", { className: "w-full table-auto font-mono", children: [
        /* @__PURE__ */ jsx("thead", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: /* @__PURE__ */ jsxs("tr", { children: [
          /* @__PURE__ */ jsx("th", { className: "text-left", children: "pin" }),
          /* @__PURE__ */ jsx("th", { className: "text-left", children: "mode" }),
          /* @__PURE__ */ jsx("th", { className: "text-left", children: "value" }),
          /* @__PURE__ */ jsx("th", { className: "text-right", children: "action" })
        ] }) }),
        /* @__PURE__ */ jsx("tbody", { children: rows.map((row) => /* @__PURE__ */ jsx(
          PinRow,
          {
            pin: row.pin,
            mode: row.mode ?? "",
            value: row.value,
            onSetMode: (m) => onSetMode(row.pin, m),
            onDigitalWrite: (v) => onDigitalWrite(row.pin, v),
            onAnalogWrite: (v) => onAnalogWrite(row.pin, v),
            onDigitalRead: () => onDigitalRead(row.pin),
            onAnalogRead: () => onAnalogRead(row.pin)
          },
          row.pin
        )) })
      ] })
    ] })
  ] });
}
function PinRow({
  pin,
  mode,
  value,
  onSetMode,
  onDigitalWrite,
  onAnalogWrite,
  onDigitalRead,
  onAnalogRead
}) {
  const [pwm, setPwm] = useState("0");
  return /* @__PURE__ */ jsxs("tr", { className: "border-t border-slate-800", children: [
    /* @__PURE__ */ jsx("td", { className: "py-1 text-slate-300", children: pin }),
    /* @__PURE__ */ jsx("td", { className: "py-1", children: /* @__PURE__ */ jsxs(
      "select",
      {
        value: mode,
        onChange: (e) => onSetMode(e.target.value),
        onPointerDown: (e) => e.stopPropagation(),
        className: "nodrag nopan rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-xs text-slate-100",
        children: [
          PIN_MODES.map((m) => /* @__PURE__ */ jsx("option", { value: m, children: m }, m)),
          mode && !PIN_MODES.includes(mode) && /* @__PURE__ */ jsx("option", { value: mode, children: mode })
        ]
      }
    ) }),
    /* @__PURE__ */ jsx("td", { className: "py-1 text-slate-300", children: value === void 0 ? "—" : value }),
    /* @__PURE__ */ jsxs("td", { className: "py-1 text-right", children: [
      mode === "input" && /* @__PURE__ */ jsx(ActionButton, { onClick: onDigitalRead, children: "read" }),
      mode === "output" && /* @__PURE__ */ jsxs("span", { className: "flex justify-end gap-1", children: [
        /* @__PURE__ */ jsx(ActionButton, { onClick: () => onDigitalWrite(1), children: "HIGH" }),
        /* @__PURE__ */ jsx(ActionButton, { onClick: () => onDigitalWrite(0), children: "LOW" })
      ] }),
      mode === "pwm" && /* @__PURE__ */ jsxs("span", { className: "flex justify-end gap-1", children: [
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "number",
            min: 0,
            max: 255,
            step: 1,
            value: pwm,
            onChange: (e) => setPwm(e.target.value),
            onPointerDown: (e) => e.stopPropagation(),
            className: "nodrag nopan w-14 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-xs text-slate-100"
          }
        ),
        /* @__PURE__ */ jsx(
          ActionButton,
          {
            onClick: () => {
              const v = Number.parseInt(pwm, 10);
              if (!Number.isNaN(v)) onAnalogWrite(v);
            },
            children: "write"
          }
        )
      ] }),
      mode === "analog" && /* @__PURE__ */ jsx(ActionButton, { onClick: onAnalogRead, children: "read" }),
      mode === "servo" && /* @__PURE__ */ jsxs("span", { className: "flex justify-end gap-1", children: [
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "number",
            min: 0,
            max: 180,
            step: 1,
            value: pwm,
            onChange: (e) => setPwm(e.target.value),
            onPointerDown: (e) => e.stopPropagation(),
            className: "nodrag nopan w-14 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-xs text-slate-100"
          }
        ),
        /* @__PURE__ */ jsx(
          ActionButton,
          {
            onClick: () => {
              const v = Number.parseInt(pwm, 10);
              if (!Number.isNaN(v)) onAnalogWrite(v);
            },
            children: "write"
          }
        )
      ] })
    ] })
  ] });
}
function I2C({
  connected,
  onSetup,
  onScan,
  onRead,
  onWrite
}) {
  const [addr, setAddr] = useState("0x68");
  const [reg, setReg] = useState("0x00");
  const [count, setCount] = useState("1");
  const [data, setData] = useState("0x00");
  const parseHex = (s) => {
    const t = s.trim();
    return Number.parseInt(t.startsWith("0x") ? t.slice(2) : t, 16);
  };
  return /* @__PURE__ */ jsxs(Section, { title: "I²C", children: [
    !connected && /* @__PURE__ */ jsx("div", { className: "rounded border border-slate-800 bg-slate-950/70 p-2 text-slate-500", children: "Connect to a board first." }),
    connected && /* @__PURE__ */ jsxs("div", { onPointerDown: (e) => e.stopPropagation(), children: [
      /* @__PURE__ */ jsxs("div", { className: "mb-2 flex items-center gap-2", children: [
        /* @__PURE__ */ jsx(ActionButton, { onClick: onSetup, children: "Setup" }),
        /* @__PURE__ */ jsx(ActionButton, { onClick: onScan, children: "Scan" }),
        /* @__PURE__ */ jsx("span", { className: "text-slate-500", children: "addresses arrive on the bus (response topic)" })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "grid grid-cols-[max-content_1fr_max-content_1fr] items-center gap-2", children: [
        /* @__PURE__ */ jsx("label", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: "addr" }),
        /* @__PURE__ */ jsx(
          "input",
          {
            value: addr,
            onChange: (e) => setAddr(e.target.value),
            className: "nodrag nopan rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100"
          }
        ),
        /* @__PURE__ */ jsx("label", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: "reg" }),
        /* @__PURE__ */ jsx(
          "input",
          {
            value: reg,
            onChange: (e) => setReg(e.target.value),
            className: "nodrag nopan rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100"
          }
        ),
        /* @__PURE__ */ jsx("label", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: "count" }),
        /* @__PURE__ */ jsx(
          "input",
          {
            value: count,
            onChange: (e) => setCount(e.target.value),
            className: "nodrag nopan rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100"
          }
        ),
        /* @__PURE__ */ jsx(
          ActionButton,
          {
            onClick: () => onRead(parseHex(addr), parseHex(reg), Number.parseInt(count, 10) || 1),
            children: "Read"
          }
        ),
        /* @__PURE__ */ jsx("label", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: "data" }),
        /* @__PURE__ */ jsx(
          "input",
          {
            value: data,
            onChange: (e) => setData(e.target.value),
            placeholder: "0x01 0x02",
            className: "nodrag nopan col-span-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100"
          }
        ),
        /* @__PURE__ */ jsx(
          ActionButton,
          {
            onClick: () => {
              const bytes = data.trim().split(/\s+/).map(parseHex).filter((n) => !Number.isNaN(n));
              onWrite(parseHex(addr), bytes);
            },
            children: "Write"
          }
        )
      ] })
    ] })
  ] });
}
function Sonar({
  proxyId,
  connected,
  onSetup,
  onRead
}) {
  const wsClient = useWsClient();
  const [trig, setTrig] = useState("");
  const [echo, setEcho] = useState("");
  const [distance, setDistance] = useState(null);
  const [lastSeen, setLastSeen] = useState(null);
  useEffect(() => {
    const t = Number.parseInt(trig, 10);
    if (!proxyId || Number.isNaN(t)) return;
    const topic = `/arduino/${proxyId}/sonar/${t}`;
    const off = wsClient.subscribe(topic, (f) => {
      if (f.method !== "message") return;
      const p = f.payload;
      if (typeof p?.distance_cm === "number") {
        setDistance(p.distance_cm);
        setLastSeen(Date.now());
      }
    });
    return off;
  }, [proxyId, trig, wsClient]);
  return /* @__PURE__ */ jsxs(Section, { title: "Sonar", children: [
    !connected && /* @__PURE__ */ jsx("div", { className: "rounded border border-slate-800 bg-slate-950/70 p-2 text-slate-500", children: "Connect to a board first." }),
    connected && /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", onPointerDown: (e) => e.stopPropagation(), children: [
      /* @__PURE__ */ jsx("label", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: "trigger" }),
      /* @__PURE__ */ jsx(
        "input",
        {
          type: "number",
          value: trig,
          onChange: (e) => setTrig(e.target.value),
          placeholder: "7",
          className: "nodrag nopan w-12 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-xs text-slate-100"
        }
      ),
      /* @__PURE__ */ jsx("label", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: "echo" }),
      /* @__PURE__ */ jsx(
        "input",
        {
          type: "number",
          value: echo,
          onChange: (e) => setEcho(e.target.value),
          placeholder: "8",
          className: "nodrag nopan w-12 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-xs text-slate-100"
        }
      ),
      /* @__PURE__ */ jsx(
        ActionButton,
        {
          onClick: () => {
            const t = Number.parseInt(trig, 10);
            const e = Number.parseInt(echo, 10);
            if (!Number.isNaN(t) && !Number.isNaN(e)) onSetup(t, e);
          },
          disabled: !trig || !echo,
          children: "Setup"
        }
      ),
      /* @__PURE__ */ jsx(
        ActionButton,
        {
          onClick: () => {
            const t = Number.parseInt(trig, 10);
            if (!Number.isNaN(t)) onRead(t);
          },
          disabled: !trig,
          children: "Read"
        }
      ),
      /* @__PURE__ */ jsx("span", { className: "ml-auto font-mono text-slate-200", children: distance === null ? "—" : `${distance.toFixed(1)} cm` }),
      lastSeen !== null && /* @__PURE__ */ jsxs("span", { className: "text-[10px] text-slate-500", children: [
        Math.round((Date.now() - lastSeen) / 1e3),
        "s ago"
      ] })
    ] })
  ] });
}
function Section({ title, children }) {
  return /* @__PURE__ */ jsxs("section", { className: "rounded border border-slate-800 bg-slate-900/40 p-3", children: [
    /* @__PURE__ */ jsx("h3", { className: "mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400", children: title }),
    children
  ] });
}
function ActionButton({
  children,
  onClick,
  disabled,
  tone = "normal",
  type = "button"
}) {
  const base = tone === "primary" ? "bg-emerald-600 text-white hover:bg-emerald-500" : "border border-slate-700 text-slate-200 hover:border-slate-500";
  return /* @__PURE__ */ jsx(
    "button",
    {
      type,
      onClick: (e) => {
        e.stopPropagation();
        onClick?.();
      },
      onPointerDown: (e) => e.stopPropagation(),
      disabled,
      className: `nodrag nopan rounded px-2 py-1 text-xs font-medium ${base} disabled:cursor-not-allowed disabled:opacity-40`,
      children
    }
  );
}
export {
  ArduinoFullView as default
};
