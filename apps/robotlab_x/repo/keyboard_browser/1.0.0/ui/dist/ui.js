import { jsxs, jsx } from "react/jsx-runtime";
import { forwardRef, createElement, useState, useRef, useCallback, useEffect } from "react";
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
const HEARTBEAT_MS = 2e3;
function KeyboardBrowserView({ proxy }) {
  const wsClient = useWsClient();
  const proxyId = proxy.id ?? proxy.name ?? "";
  const stateTopic = `/keyboard/${proxyId}/state`;
  const cmdTopic = `/keyboard/${proxyId}/cmd`;
  const eventTopic = `/keyboard/${proxyId}/event`;
  const reportTopic = `/keyboard/${proxyId}/report`;
  const controlTopic = `/keyboard/${proxyId}/control`;
  const [state, setState] = useState({});
  const [armed, setArmed] = useState(false);
  const [scope, setScope] = useState("card");
  const [suppress, setSuppress] = useState(false);
  const [focused, setFocused] = useState(false);
  const cardRef = useRef(null);
  const suppressRef = useRef(suppress);
  suppressRef.current = suppress;
  const publishReport = useCallback((capturing2, error) => {
    wsClient.publish(reportTopic, { capturing: capturing2, error: error ?? null, ts: Date.now() / 1e3 });
  }, [wsClient, reportTopic]);
  const send = useCallback((action, args = {}) => {
    wsClient.publish(controlTopic, { action, ...args });
  }, [wsClient, controlTopic]);
  useEffect(() => {
    if (!proxyId) return;
    const offState = wsClient.subscribe(stateTopic, (f) => {
      if (f.method !== "message") return;
      setState((prev) => ({ ...prev, ...f.payload }));
    });
    const offCmd = wsClient.subscribe(cmdTopic, (f) => {
      if (f.method !== "message") return;
      const p = f.payload;
      if (p.action === "start") {
        if (typeof p.scope === "string") setScope(p.scope);
        if (typeof p.suppress === "boolean") setSuppress(p.suppress);
        setArmed(true);
      } else if (p.action === "stop") {
        setArmed(false);
      } else if (p.action === "set_scope" && typeof p.scope === "string") {
        setScope(p.scope);
      } else if (p.action === "set_suppress" && typeof p.suppress === "boolean") {
        setSuppress(p.suppress);
      }
    });
    return () => {
      offState();
      offCmd();
    };
  }, [proxyId, stateTopic, cmdTopic, wsClient]);
  useEffect(() => {
    if (!armed || !proxyId) return;
    const target = scope === "document" ? window : cardRef.current ?? window;
    const emit = (e, type) => {
      e.stopPropagation();
      if (suppressRef.current) e.preventDefault();
      wsClient.publish(eventTopic, {
        type,
        key: (e.key || "").toLowerCase(),
        code: e.code || "",
        modifiers: { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey },
        repeat: e.repeat,
        ts: Date.now() / 1e3,
        source: "browser"
      });
    };
    const onDown = (e) => emit(e, "down");
    const onUp = (e) => emit(e, "up");
    target.addEventListener("keydown", onDown);
    target.addEventListener("keyup", onUp);
    publishReport(true);
    const hb = setInterval(() => publishReport(true), HEARTBEAT_MS);
    return () => {
      target.removeEventListener("keydown", onDown);
      target.removeEventListener("keyup", onUp);
      clearInterval(hb);
    };
  }, [armed, scope, proxyId, eventTopic, wsClient, publishReport]);
  const capturing = !!state.capturing && armed;
  const pressed = state.pressed ?? [];
  const bindings = state.bindings ?? [];
  const last = state.last_event ?? null;
  const needsFocus = armed && scope === "card" && !focused;
  const fmtEvent = (e) => {
    if (!e) return "—";
    const m = e.modifiers ?? {};
    const mods = [m.ctrl && "ctrl", m.alt && "alt", m.shift && "shift", m.meta && "meta"].filter(Boolean);
    return `${e.type === "up" ? "▲" : "▼"} ${[...mods, e.code || e.key].join("+")}`;
  };
  const btn = "rounded px-2 py-1 text-xs disabled:opacity-40";
  return /* @__PURE__ */ jsxs(
    "div",
    {
      ref: cardRef,
      tabIndex: 0,
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
      className: `flex flex-col gap-3 p-3 text-slate-200 outline-none ${capturing ? "ring-2 ring-emerald-500/60" : ""} ${needsFocus ? "ring-2 ring-amber-500/50" : ""}`,
      children: [
        /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 text-xs", children: [
          /* @__PURE__ */ jsx(Keyboard, { className: "h-4 w-4 text-slate-400" }),
          /* @__PURE__ */ jsx("span", { className: `h-2 w-2 rounded-full ${capturing ? "bg-emerald-400" : "bg-slate-600"}` }),
          /* @__PURE__ */ jsx("span", { className: "font-medium", children: capturing ? "Capturing" : "Idle" }),
          /* @__PURE__ */ jsx("span", { className: "text-slate-500", children: scope }),
          state.last_error && /* @__PURE__ */ jsx("span", { className: "ml-auto text-rose-400", children: state.last_error })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [
          !capturing ? /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: `${btn} bg-emerald-700 text-white hover:bg-emerald-600`,
              onClick: () => {
                cardRef.current?.focus();
                send("start_capture");
              },
              children: "Arm"
            }
          ) : /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: `${btn} bg-slate-700 text-slate-100 hover:bg-slate-600`,
              onClick: () => send("stop_capture"),
              children: "Disarm"
            }
          ),
          /* @__PURE__ */ jsxs(
            "select",
            {
              className: "rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs",
              value: scope,
              onChange: (e) => send("set_scope", { scope: e.target.value }),
              children: [
                /* @__PURE__ */ jsx("option", { value: "card", children: "card focus" }),
                /* @__PURE__ */ jsx("option", { value: "document", children: "whole tab" })
              ]
            }
          ),
          /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-1 text-[11px] text-slate-400", children: [
            /* @__PURE__ */ jsx("input", { type: "checkbox", checked: suppress, onChange: (e) => send("set_suppress", { suppress: e.target.checked }) }),
            "suppress"
          ] })
        ] }),
        needsFocus && /* @__PURE__ */ jsx("div", { className: "rounded border border-amber-700/60 bg-amber-950/30 px-2 py-1 text-[11px] text-amber-300", children: "Click this card to focus it — keys are only captured while it has focus." }),
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
      ]
    }
  );
}
export {
  KeyboardBrowserView as default
};
