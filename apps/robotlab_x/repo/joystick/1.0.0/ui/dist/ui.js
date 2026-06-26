import { jsxs, jsx, Fragment } from "react/jsx-runtime";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useWsClient } from "@rlx/ui";
function JoystickFullView({ proxy }) {
  const wsClient = useWsClient();
  const proxyId = proxy.id ?? proxy.name ?? "";
  const stateTopic = `/joystick/${proxyId}/state`;
  const inputTopic = `/joystick/${proxyId}/input`;
  const controlTopic = `/joystick/${proxyId}/control`;
  const [state, setState] = useState({});
  const [input, setInput] = useState({});
  const [selectedIndex, setSelectedIndex] = useState("");
  useEffect(() => {
    if (!proxyId) return;
    const offState = wsClient.subscribe(stateTopic, (f) => {
      if (f.method !== "message") return;
      setState(f.payload);
    });
    const offInput = wsClient.subscribe(inputTopic, (f) => {
      if (f.method !== "message") return;
      setInput(f.payload);
    });
    return () => {
      offState();
      offInput();
    };
  }, [proxyId, stateTopic, inputTopic, wsClient]);
  useEffect(() => {
    if (!state.attached) setInput({});
  }, [state.attached]);
  const devices = useMemo(() => state.devices ?? [], [state.devices]);
  useEffect(() => {
    if (selectedIndex) return;
    if (state.device) {
      setSelectedIndex(String(state.device.index));
      return;
    }
    if (typeof state.last_index === "number" && devices.some((d) => d.index === state.last_index)) {
      setSelectedIndex(String(state.last_index));
      return;
    }
    if (devices.length > 0) setSelectedIndex(String(devices[0].index));
  }, [state.device, state.last_index, devices, selectedIndex]);
  const sendAction = useCallback(
    (payload) => {
      wsClient.publish(controlTopic, payload);
    },
    [controlTopic, wsClient]
  );
  const onAttach = useCallback((e) => {
    e?.preventDefault();
    const idx = Number.parseInt(selectedIndex, 10);
    if (Number.isNaN(idx)) return;
    sendAction({ action: "attach", index: idx });
  }, [selectedIndex, sendAction]);
  const onDetach = useCallback(() => sendAction({ action: "detach" }), [sendAction]);
  const onRefresh = useCallback(() => sendAction({ action: "list_devices" }), [sendAction]);
  const attached = !!state.attached;
  const enabled = state.enabled ?? true;
  const comps = state.components ?? { axes: 0, buttons: 0, hats: 0, balls: 0 };
  const device = state.device ?? null;
  const streaming = attached && enabled;
  return /* @__PURE__ */ jsxs("div", { className: "flex min-w-[480px] flex-col gap-3 p-3 text-xs", onPointerDown: (e) => e.stopPropagation(), children: [
    /* @__PURE__ */ jsxs(Section, { title: "Device", children: [
      /* @__PURE__ */ jsxs("form", { onSubmit: onAttach, className: "flex flex-wrap items-end gap-2", children: [
        /* @__PURE__ */ jsxs("label", { className: "flex flex-col", children: [
          /* @__PURE__ */ jsx("span", { className: "mb-0.5 text-[10px] uppercase tracking-wider text-slate-500", children: "controller" }),
          /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1", children: [
            /* @__PURE__ */ jsxs(
              "select",
              {
                value: selectedIndex,
                onChange: (e) => setSelectedIndex(e.target.value),
                disabled: attached || devices.length === 0,
                onPointerDown: (e) => e.stopPropagation(),
                className: "nodrag nopan w-72 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100 focus:border-slate-500 focus:outline-none disabled:opacity-50",
                children: [
                  devices.length === 0 && /* @__PURE__ */ jsx("option", { value: "", children: "(no joysticks detected)" }),
                  devices.map((d) => /* @__PURE__ */ jsxs("option", { value: d.index, children: [
                    "[",
                    d.index,
                    "] ",
                    d.name,
                    " · ",
                    d.num_axes,
                    "a ",
                    d.num_buttons,
                    "b ",
                    d.num_hats,
                    "h"
                  ] }, `${d.index}:${d.guid}`))
                ]
              }
            ),
            /* @__PURE__ */ jsx(
              "button",
              {
                type: "button",
                onClick: onRefresh,
                disabled: attached,
                onPointerDown: (e) => e.stopPropagation(),
                title: "Rescan devices",
                className: "nodrag nopan rounded border border-slate-700 px-2 py-1 text-[11px] hover:border-slate-500 disabled:opacity-50",
                children: "↻"
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "ml-auto flex items-center gap-2", children: [
          /* @__PURE__ */ jsxs("span", { className: "flex items-center gap-1.5 font-mono text-[10px]", children: [
            /* @__PURE__ */ jsx("span", { className: `inline-block h-2.5 w-2.5 rounded-full ${attached ? streaming ? "bg-emerald-400 shadow-[0_0_6px_1px] shadow-emerald-500/60" : "bg-amber-400" : "bg-slate-600"}` }),
            /* @__PURE__ */ jsx("span", { className: attached ? streaming ? "text-emerald-300" : "text-amber-300" : "text-slate-500", children: attached ? streaming ? "streaming" : "paused" : "detached" })
          ] }),
          attached && /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-1 font-mono text-[10px] text-slate-300", children: [
            /* @__PURE__ */ jsx(
              "input",
              {
                type: "checkbox",
                checked: enabled,
                onChange: (e) => sendAction({ action: "set_enabled", enabled: e.target.checked }),
                onPointerDown: (e) => e.stopPropagation(),
                className: "nodrag nopan accent-emerald-500"
              }
            ),
            "enabled"
          ] }),
          !attached ? /* @__PURE__ */ jsx(
            "button",
            {
              type: "submit",
              disabled: !selectedIndex || devices.length === 0,
              onPointerDown: (e) => e.stopPropagation(),
              className: "nodrag nopan rounded bg-emerald-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40",
              children: "Attach"
            }
          ) : /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              onClick: onDetach,
              onPointerDown: (e) => e.stopPropagation(),
              className: "nodrag nopan rounded border border-slate-700 px-3 py-1 text-[11px] hover:border-rose-500 hover:text-rose-300",
              children: "Detach"
            }
          )
        ] })
      ] }),
      state.last_error && /* @__PURE__ */ jsxs("div", { className: "mt-2 truncate font-mono text-[10px] text-rose-300", title: state.last_error, children: [
        "error: ",
        state.last_error
      ] }),
      devices.length === 0 && !state.last_error && /* @__PURE__ */ jsx("div", { className: "mt-1 text-slate-500", children: "No joysticks detected. Plug one in and click ↻." })
    ] }),
    !attached ? /* @__PURE__ */ jsx("div", { className: "rounded border border-slate-800 bg-slate-950/70 p-3 text-slate-500", children: "Attach a controller to see its live axes, buttons, and hats." }) : /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx(Section, { title: "Components", children: /* @__PURE__ */ jsxs("div", { className: "flex flex-wrap items-center gap-2 font-mono text-[11px]", children: [
        device && /* @__PURE__ */ jsx("span", { className: "text-slate-300", children: device.name }),
        /* @__PURE__ */ jsx(Stat, { label: "axes", n: comps.axes }),
        /* @__PURE__ */ jsx(Stat, { label: "buttons", n: comps.buttons }),
        /* @__PURE__ */ jsx(Stat, { label: "hats", n: comps.hats }),
        comps.balls > 0 && /* @__PURE__ */ jsx(Stat, { label: "balls", n: comps.balls }),
        /* @__PURE__ */ jsxs("span", { className: "ml-auto text-slate-500", children: [
          state.poll_hz ?? 60,
          " Hz · deadzone ",
          state.deadzone ?? 0.05
        ] })
      ] }) }),
      comps.axes > 0 && /* @__PURE__ */ jsx(Section, { title: "Axes", children: /* @__PURE__ */ jsx("div", { className: "flex flex-col gap-2", children: Array.from({ length: comps.axes }, (_, i) => /* @__PURE__ */ jsx(AxisBar, { index: i, value: input.axes?.[i] ?? 0 }, i)) }) }),
      comps.buttons > 0 && /* @__PURE__ */ jsx(Section, { title: "Buttons", children: /* @__PURE__ */ jsx("div", { className: "flex flex-wrap gap-1.5", children: Array.from({ length: comps.buttons }, (_, i) => /* @__PURE__ */ jsx(ButtonDot, { index: i, pressed: !!input.buttons?.[i] }, i)) }) }),
      comps.hats > 0 && /* @__PURE__ */ jsx(Section, { title: "Hats", children: /* @__PURE__ */ jsx("div", { className: "flex flex-wrap gap-4", children: Array.from({ length: comps.hats }, (_, i) => /* @__PURE__ */ jsx(Hat, { index: i, xy: input.hats?.[i] ?? [0, 0] }, i)) }) }),
      comps.balls > 0 && /* @__PURE__ */ jsx(Section, { title: "Balls", children: /* @__PURE__ */ jsx("div", { className: "flex flex-wrap gap-4 font-mono text-[11px] text-slate-300", children: Array.from({ length: comps.balls }, (_, i) => {
        const [dx, dy] = input.balls?.[i] ?? [0, 0];
        return /* @__PURE__ */ jsxs("span", { children: [
          "ball ",
          i,
          ": Δx ",
          dx,
          " · Δy ",
          dy
        ] }, i);
      }) }) })
    ] })
  ] });
}
function Stat({ label, n }) {
  return /* @__PURE__ */ jsxs("span", { className: "rounded border border-slate-700 bg-slate-950 px-2 py-0.5 text-slate-300", children: [
    n,
    " ",
    /* @__PURE__ */ jsx("span", { className: "text-slate-500", children: label })
  ] });
}
function AxisBar({ index, value }) {
  const v = Math.max(-1, Math.min(1, value));
  const half = Math.abs(v) * 50;
  const positive = v >= 0;
  return /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
    /* @__PURE__ */ jsxs("span", { className: "w-12 font-mono text-[10px] text-slate-500", children: [
      "axis ",
      index
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "relative h-3 flex-1 rounded bg-slate-800", children: [
      /* @__PURE__ */ jsx("div", { className: "absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-slate-600" }),
      /* @__PURE__ */ jsx(
        "div",
        {
          className: `absolute top-0 h-full rounded ${positive ? "bg-emerald-500" : "bg-sky-500"}`,
          style: positive ? { left: "50%", width: `${half}%` } : { right: "50%", width: `${half}%` }
        }
      )
    ] }),
    /* @__PURE__ */ jsxs("span", { className: `w-14 text-right font-mono text-[10px] ${v === 0 ? "text-slate-500" : "text-slate-200"}`, children: [
      v > 0 ? "+" : "",
      v.toFixed(2)
    ] })
  ] });
}
function ButtonDot({ index, pressed }) {
  return /* @__PURE__ */ jsx(
    "span",
    {
      title: `button ${index}`,
      className: `flex h-7 w-7 items-center justify-center rounded font-mono text-[10px] ${pressed ? "bg-emerald-500 text-white shadow-[0_0_6px_1px] shadow-emerald-500/60" : "border border-slate-700 bg-slate-950 text-slate-500"}`,
      children: index
    }
  );
}
function Hat({ index, xy }) {
  const x = xy[0] ?? 0;
  const y = xy[1] ?? 0;
  const centered = x === 0 && y === 0;
  const activeRow = 1 - y;
  const activeCol = x + 1;
  return /* @__PURE__ */ jsxs("div", { className: "flex flex-col items-center gap-1", children: [
    /* @__PURE__ */ jsx("div", { className: "grid grid-cols-3 grid-rows-3 gap-0.5", children: Array.from({ length: 9 }, (_, k) => {
      const row = Math.floor(k / 3);
      const col = k % 3;
      const isCenter = row === 1 && col === 1;
      const lit = !centered && row === activeRow && col === activeCol;
      return /* @__PURE__ */ jsx(
        "span",
        {
          className: `h-3 w-3 rounded-sm ${lit ? "bg-emerald-500" : isCenter ? "bg-slate-700" : "bg-slate-800"}`
        },
        k
      );
    }) }),
    /* @__PURE__ */ jsxs("span", { className: "font-mono text-[10px] text-slate-500", children: [
      "hat ",
      index,
      " (",
      x,
      ",",
      y,
      ")"
    ] })
  ] });
}
function Section({ title, children }) {
  return /* @__PURE__ */ jsxs("section", { className: "rounded border border-slate-800 bg-slate-900/40 p-3", children: [
    /* @__PURE__ */ jsx("h3", { className: "mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400", children: title }),
    children
  ] });
}
export {
  JoystickFullView as default
};
