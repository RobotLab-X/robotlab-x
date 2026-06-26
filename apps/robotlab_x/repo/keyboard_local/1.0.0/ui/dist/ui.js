import { jsxs, jsx } from "react/jsx-runtime";
import { forwardRef, createElement, useState, useEffect, useCallback } from "react";
import { useWsClient, KeymapEditor } from "@rlx/ui";
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
const Keyboard = createLucideIcon("Keyboard", [
  ["path", { d: "M10 8h.01", key: "1r9ogq" }],
  ["path", { d: "M12 12h.01", key: "1mp3jc" }],
  ["path", { d: "M14 8h.01", key: "1primd" }],
  ["path", { d: "M16 12h.01", key: "1l6xoz" }],
  ["path", { d: "M18 8h.01", key: "emo2bl" }],
  ["path", { d: "M6 8h.01", key: "x9i8wu" }],
  ["path", { d: "M7 16h10", key: "wp8him" }],
  ["path", { d: "M8 12h.01", key: "czm47f" }],
  ["rect", { x: "2", y: "4", width: "20", height: "16", rx: "2", key: "izxlao" }]
]);
function KeyboardLocalView({ proxy }) {
  const wsClient = useWsClient();
  const proxyId = proxy.id ?? proxy.name ?? "";
  const stateTopic = `/keyboard/${proxyId}/state`;
  const controlTopic = `/keyboard/${proxyId}/control`;
  const [state, setState] = useState({});
  useEffect(() => {
    if (!proxyId) return;
    const off = wsClient.subscribe(stateTopic, (f) => {
      if (f.method !== "message") return;
      setState((prev) => ({ ...prev, ...f.payload }));
    });
    return off;
  }, [proxyId, stateTopic, wsClient]);
  const send = useCallback((action, args = {}) => {
    wsClient.publish(controlTopic, { action, ...args });
  }, [wsClient, controlTopic]);
  const capturing = !!state.capturing;
  const pressed = state.pressed ?? [];
  const bindings = state.bindings ?? [];
  const devices = state.devices ?? [];
  const available = state.available_backends ?? [];
  const backend = state.backend ?? "auto";
  const isEvdev = backend === "evdev" || backend === "auto" && available.includes("evdev");
  const last = state.last_event ?? null;
  const fmtEvent = (e) => {
    if (!e) return "—";
    const m = e.modifiers ?? {};
    const mods = [m.ctrl && "ctrl", m.alt && "alt", m.shift && "shift", m.meta && "meta"].filter(Boolean);
    return `${e.type === "up" ? "▲" : "▼"} ${[...mods, e.code || e.key].join("+")}`;
  };
  const fieldCls = "rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200";
  const btn = "rounded px-2 py-1 text-xs disabled:opacity-40";
  return /* @__PURE__ */ jsxs("div", { className: `flex flex-col gap-3 p-3 text-slate-200 ${capturing ? "rounded ring-2 ring-emerald-500/40" : ""}`, children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 text-xs", children: [
      /* @__PURE__ */ jsx(Keyboard, { className: "h-4 w-4 text-slate-400" }),
      /* @__PURE__ */ jsx("span", { className: `h-2 w-2 rounded-full ${capturing ? "bg-emerald-400" : "bg-slate-600"}` }),
      /* @__PURE__ */ jsx("span", { className: "font-medium", children: capturing ? "Capturing" : "Idle" }),
      /* @__PURE__ */ jsxs("span", { className: "text-slate-500", children: [
        backend,
        state.grab ? " · grab" : ""
      ] }),
      state.last_error && /* @__PURE__ */ jsx("span", { className: "ml-auto truncate text-rose-400", title: state.last_error, children: state.last_error })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [
      !capturing ? /* @__PURE__ */ jsx("button", { type: "button", className: `${btn} bg-emerald-700 text-white hover:bg-emerald-600`, onClick: () => send("start_capture"), children: "Arm" }) : /* @__PURE__ */ jsx("button", { type: "button", className: `${btn} bg-slate-700 text-slate-100 hover:bg-slate-600`, onClick: () => send("stop_capture"), children: "Disarm" }),
      /* @__PURE__ */ jsxs("select", { className: fieldCls, value: backend, onChange: (e) => send("set_backend", { backend: e.target.value }), children: [
        /* @__PURE__ */ jsx("option", { value: "auto", children: "auto" }),
        ["evdev", "pynput"].map((b) => /* @__PURE__ */ jsxs("option", { value: b, disabled: !available.includes(b), children: [
          b,
          available.includes(b) ? "" : " (n/a)"
        ] }, b))
      ] }),
      /* @__PURE__ */ jsxs("select", { className: fieldCls, value: state.scope ?? "global", onChange: (e) => send("set_scope", { scope: e.target.value }), children: [
        /* @__PURE__ */ jsx("option", { value: "global", children: "global" }),
        /* @__PURE__ */ jsx("option", { value: "focused", children: "focused" })
      ] }),
      /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-1 text-[11px] text-slate-400", title: isEvdev ? "Exclusive grab — keys do not reach other apps (teleop)" : "Grab is evdev/Linux only", children: [
        /* @__PURE__ */ jsx("input", { type: "checkbox", checked: !!state.grab, disabled: !isEvdev, onChange: (e) => send("set_grab", { grab: e.target.checked }) }),
        "grab"
      ] })
    ] }),
    isEvdev && /* @__PURE__ */ jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [
      /* @__PURE__ */ jsxs("select", { className: `${fieldCls} max-w-[220px]`, value: state.device_id ?? "", onChange: (e) => send("select_device", { device_id: e.target.value || null }), children: [
        /* @__PURE__ */ jsx("option", { value: "", children: "all keyboards" }),
        devices.map((d) => /* @__PURE__ */ jsx("option", { value: d.id, children: d.name ?? d.id }, d.id))
      ] }),
      /* @__PURE__ */ jsx("button", { type: "button", className: `${btn} bg-slate-800 text-slate-200 hover:bg-slate-700`, onClick: () => send("list_devices"), children: "Rescan" })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "rounded border border-slate-800 p-2 text-[11px]", children: [
      /* @__PURE__ */ jsxs("div", { className: "mb-1 flex items-center justify-between text-slate-500", children: [
        /* @__PURE__ */ jsx("span", { children: "last" }),
        /* @__PURE__ */ jsx("span", { className: "font-mono text-slate-300", children: fmtEvent(last) })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "flex flex-wrap gap-1", children: [
        pressed.length === 0 && /* @__PURE__ */ jsx("span", { className: "text-slate-600", children: "no keys held" }),
        pressed.map((k) => /* @__PURE__ */ jsx("span", { className: "rounded bg-emerald-900/50 px-1.5 py-0.5 font-mono text-emerald-200", children: k }, k))
      ] })
    ] }),
    /* @__PURE__ */ jsx(
      KeymapEditor,
      {
        bindings,
        onBind: (b) => send("bind", b),
        onUnbind: (id) => send("unbind", { id }),
        onClear: () => send("clear_bindings")
      }
    )
  ] });
}
export {
  KeyboardLocalView as default
};
