import { jsxs, jsx, Fragment } from "react/jsx-runtime";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useWsClient } from "@rlx/ui";
const PIN_MODES = ["input", "input_pullup", "input_pulldown", "output", "pwm"];
function RaspiFullView({ proxy }) {
  const wsClient = useWsClient();
  const proxyId = proxy.id ?? proxy.name ?? "";
  const stateTopic = `/raspi/${proxyId}/state`;
  const i2cScanTopic = `/raspi/${proxyId}/i2c/scan`;
  const controlTopic = `/raspi/${proxyId}/control`;
  const [state, setState] = useState({});
  const [i2cScan, setI2cScan] = useState(null);
  useEffect(() => {
    if (!proxyId) return;
    const off1 = wsClient.subscribe(stateTopic, (f) => {
      if (f.method !== "message") return;
      setState(f.payload);
    });
    const off2 = wsClient.subscribe(i2cScanTopic, (f) => {
      if (f.method !== "message") return;
      setI2cScan(f.payload);
    });
    return () => {
      off1();
      off2();
    };
  }, [proxyId, stateTopic, i2cScanTopic, wsClient]);
  const configuredPins = useMemo(
    () => Object.keys(state.pins ?? {}).map(Number).sort((a, b) => a - b),
    [state.pins]
  );
  useEffect(() => {
    if (!proxyId || configuredPins.length === 0) return;
    const unsubs = [];
    for (const p of configuredPins) {
      const topic = `/raspi/${proxyId}/pin/${p}`;
      const off = wsClient.subscribe(topic, (f) => {
        if (f.method !== "message") return;
        const payload = f.payload;
        if (typeof payload?.value !== "number") return;
        setState((prev) => {
          const pins2 = { ...prev.pins ?? {} };
          pins2[String(p)] = { ...pins2[String(p)] ?? {}, value: payload.value };
          return { ...prev, pins: pins2 };
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
  const board = state.board ?? {};
  const pins = state.pins ?? {};
  const polling = state.polling ?? {};
  const allPins = board.gpio_pins ?? [];
  const pinFunctions = board.pin_functions ?? {};
  return /* @__PURE__ */ jsxs("div", { className: "flex min-w-[480px] flex-col gap-3 p-3 text-xs", children: [
    /* @__PURE__ */ jsx(BoardPanel, { board, backendMode: state.backend_mode }),
    /* @__PURE__ */ jsx(
      PinGrid,
      {
        allPins,
        pinFunctions,
        pins,
        polling,
        onSetMode: (pin, mode) => send("set_pin_mode", { pin, mode }),
        onRelease: (pin) => send("release_pin", { pin }),
        onDigitalWrite: (pin, value) => send("digital_write", { pin, value }),
        onDigitalRead: (pin) => send("digital_read", { pin }),
        onPwmWrite: (pin, duty) => send("pwm_write", { pin, duty }),
        onPoll: (pin, interval_ms) => send("poll_pin", { pin, interval_ms }),
        onStopPoll: (pin) => send("stop_poll", { pin })
      }
    ),
    /* @__PURE__ */ jsx(
      I2CPanel,
      {
        scan: i2cScan,
        onScan: (bus) => send("i2c_scan", { bus }),
        onRead: (addr, reg, count, bus) => send("i2c_read", { addr, reg, count, bus }),
        onWrite: (addr, data, bus) => send("i2c_write", { addr, data, bus })
      }
    )
  ] });
}
function BoardPanel({ board, backendMode }) {
  const isMock = board.kind === "mock" || backendMode === "mock";
  return /* @__PURE__ */ jsx(Section, { title: "board", children: /* @__PURE__ */ jsxs("div", { className: `rounded border p-2 leading-snug ${isMock ? "border-amber-700 bg-amber-950/30 text-amber-200" : "border-slate-800 bg-slate-950/70 text-slate-300"}`, children: [
    isMock && /* @__PURE__ */ jsx("div", { className: "mb-2 text-[10px] uppercase tracking-wider text-amber-400", children: "mock — no Raspberry Pi detected" }),
    /* @__PURE__ */ jsxs("div", { className: "grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 font-mono", children: [
      /* @__PURE__ */ jsx("span", { className: "text-slate-500", children: "model" }),
      /* @__PURE__ */ jsx("span", { children: board.model ?? "—" }),
      board.soc && /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx("span", { className: "text-slate-500", children: "soc" }),
        /* @__PURE__ */ jsx("span", { children: board.soc })
      ] }),
      typeof board.memory_mb === "number" && /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx("span", { className: "text-slate-500", children: "memory" }),
        /* @__PURE__ */ jsxs("span", { children: [
          board.memory_mb,
          " MB"
        ] })
      ] }),
      board.revision_code && /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx("span", { className: "text-slate-500", children: "revision" }),
        /* @__PURE__ */ jsx("span", { children: board.revision_code })
      ] }),
      board.serial && /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx("span", { className: "text-slate-500", children: "serial" }),
        /* @__PURE__ */ jsx("span", { className: "truncate", children: board.serial })
      ] })
    ] }),
    isMock && board.reason && /* @__PURE__ */ jsx("div", { className: "mt-2 text-[10px]", children: board.reason })
  ] }) });
}
function PinGrid({
  allPins,
  pinFunctions,
  pins,
  polling,
  onSetMode,
  onRelease,
  onDigitalWrite,
  onDigitalRead,
  onPwmWrite,
  onPoll,
  onStopPoll
}) {
  const [filter, setFilter] = useState("all");
  const rows = useMemo(() => {
    const list = filter === "configured" ? allPins.filter((p) => pins[String(p)]) : allPins;
    return list;
  }, [allPins, pins, filter]);
  return /* @__PURE__ */ jsxs(Section, { title: "gpio pins", children: [
    /* @__PURE__ */ jsxs("div", { className: "mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500", children: [
      /* @__PURE__ */ jsxs("span", { children: [
        rows.length,
        " pin",
        rows.length === 1 ? "" : "s"
      ] }),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          onClick: () => setFilter("all"),
          className: `rounded border px-1.5 py-0.5 ${filter === "all" ? "border-slate-500 text-slate-200" : "border-slate-700 text-slate-500 hover:text-slate-300"}`,
          children: "all"
        }
      ),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          onClick: () => setFilter("configured"),
          className: `rounded border px-1.5 py-0.5 ${filter === "configured" ? "border-slate-500 text-slate-200" : "border-slate-700 text-slate-500 hover:text-slate-300"}`,
          children: "configured"
        }
      )
    ] }),
    /* @__PURE__ */ jsxs("table", { className: "w-full table-auto font-mono", children: [
      /* @__PURE__ */ jsx("thead", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: /* @__PURE__ */ jsxs("tr", { children: [
        /* @__PURE__ */ jsx("th", { className: "py-1 text-left", children: "pin" }),
        /* @__PURE__ */ jsx("th", { className: "py-1 text-left", children: "fn" }),
        /* @__PURE__ */ jsx("th", { className: "py-1 text-left", children: "mode" }),
        /* @__PURE__ */ jsx("th", { className: "py-1 text-left", children: "value" }),
        /* @__PURE__ */ jsx("th", { className: "py-1 text-left", children: "poll" }),
        /* @__PURE__ */ jsx("th", { className: "py-1 text-right", children: "action" })
      ] }) }),
      /* @__PURE__ */ jsx("tbody", { children: rows.map((pin) => /* @__PURE__ */ jsx(
        PinRow,
        {
          pin,
          fn: pinFunctions[String(pin)],
          snap: pins[String(pin)] ?? {},
          pollInterval: polling[String(pin)] ?? 0,
          onSetMode: (m) => onSetMode(pin, m),
          onRelease: () => onRelease(pin),
          onDigitalWrite: (v) => onDigitalWrite(pin, v),
          onDigitalRead: () => onDigitalRead(pin),
          onPwmWrite: (d) => onPwmWrite(pin, d),
          onPoll: (ms) => onPoll(pin, ms),
          onStopPoll: () => onStopPoll(pin)
        },
        pin
      )) })
    ] })
  ] });
}
function PinRow({
  pin,
  fn,
  snap,
  pollInterval,
  onSetMode,
  onRelease,
  onDigitalWrite,
  onDigitalRead,
  onPwmWrite,
  onPoll,
  onStopPoll
}) {
  const [pwmDraft, setPwmDraft] = useState("0.5");
  const [intervalDraft, setIntervalDraft] = useState(String(pollInterval || 100));
  useEffect(() => {
    if (pollInterval) setIntervalDraft(String(pollInterval));
  }, [pollInterval]);
  const mode = snap.mode ?? "";
  const polling = pollInterval > 0;
  return /* @__PURE__ */ jsxs("tr", { className: "border-t border-slate-800", children: [
    /* @__PURE__ */ jsx("td", { className: "py-1 pr-2 text-slate-200", children: pin }),
    /* @__PURE__ */ jsx("td", { className: "py-1 pr-2 text-[10px] text-slate-500", children: fn ?? "" }),
    /* @__PURE__ */ jsx("td", { className: "py-1 pr-2", children: /* @__PURE__ */ jsxs(
      "select",
      {
        value: mode,
        onChange: (e) => onSetMode(e.target.value),
        onPointerDown: (e) => e.stopPropagation(),
        className: "nodrag nopan rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-xs text-slate-100",
        children: [
          /* @__PURE__ */ jsx("option", { value: "", children: "—" }),
          PIN_MODES.map((m) => /* @__PURE__ */ jsx("option", { value: m, children: m }, m))
        ]
      }
    ) }),
    /* @__PURE__ */ jsx("td", { className: "py-1 pr-2 text-slate-300", children: snap.value === void 0 ? "—" : typeof snap.value === "number" ? snap.value : String(snap.value) }),
    /* @__PURE__ */ jsx("td", { className: "py-1 pr-2", onPointerDown: (e) => e.stopPropagation(), children: polling ? /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1", children: [
      /* @__PURE__ */ jsxs("span", { className: "text-emerald-400", children: [
        pollInterval,
        "ms"
      ] }),
      /* @__PURE__ */ jsx(SmallButton, { onClick: onStopPoll, children: "stop" })
    ] }) : /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1", children: [
      /* @__PURE__ */ jsx(
        "input",
        {
          type: "number",
          min: 10,
          max: 5e3,
          step: 10,
          value: intervalDraft,
          onChange: (e) => setIntervalDraft(e.target.value),
          className: "nodrag nopan w-14 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-xs text-slate-100"
        }
      ),
      /* @__PURE__ */ jsx(
        SmallButton,
        {
          onClick: () => onPoll(Number.parseInt(intervalDraft, 10) || 100),
          disabled: !mode.startsWith("input"),
          children: "poll"
        }
      )
    ] }) }),
    /* @__PURE__ */ jsx("td", { className: "py-1 text-right", onPointerDown: (e) => e.stopPropagation(), children: /* @__PURE__ */ jsxs("div", { className: "flex justify-end gap-1", children: [
      mode === "input" || mode === "input_pullup" || mode === "input_pulldown" ? /* @__PURE__ */ jsx(SmallButton, { onClick: onDigitalRead, children: "read" }) : null,
      mode === "output" ? /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx(SmallButton, { onClick: () => onDigitalWrite(1), children: "HI" }),
        /* @__PURE__ */ jsx(SmallButton, { onClick: () => onDigitalWrite(0), children: "LO" })
      ] }) : null,
      mode === "pwm" ? /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "number",
            min: 0,
            max: 1,
            step: 0.05,
            value: pwmDraft,
            onChange: (e) => setPwmDraft(e.target.value),
            className: "nodrag nopan w-14 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-xs text-slate-100"
          }
        ),
        /* @__PURE__ */ jsx(SmallButton, { onClick: () => onPwmWrite(Number.parseFloat(pwmDraft) || 0), children: "write" })
      ] }) : null,
      mode && /* @__PURE__ */ jsx(SmallButton, { onClick: onRelease, tone: "danger", children: "×" })
    ] }) })
  ] });
}
function I2CPanel({
  scan,
  onScan,
  onRead,
  onWrite
}) {
  const [bus, setBus] = useState("1");
  const [addr, setAddr] = useState("0x68");
  const [reg, setReg] = useState("0x00");
  const [count, setCount] = useState("1");
  const [data, setData] = useState("0x00");
  const parseHex = (s) => {
    const t = s.trim();
    return Number.parseInt(t.startsWith("0x") ? t.slice(2) : t, 16);
  };
  return /* @__PURE__ */ jsx(Section, { title: "i²c", children: /* @__PURE__ */ jsxs("div", { className: "space-y-2", onPointerDown: (e) => e.stopPropagation(), children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
      /* @__PURE__ */ jsx("label", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: "bus" }),
      /* @__PURE__ */ jsx(
        "input",
        {
          type: "number",
          value: bus,
          onChange: (e) => setBus(e.target.value),
          className: "nodrag nopan w-12 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100"
        }
      ),
      /* @__PURE__ */ jsx(SmallButton, { onClick: () => onScan(Number.parseInt(bus, 10) || 1), children: "Scan" }),
      scan && /* @__PURE__ */ jsxs("span", { className: "font-mono text-[11px] text-slate-300", children: [
        "bus ",
        scan.bus,
        ": ",
        scan.addresses.length ? scan.addresses.join(" ") : "(no devices)"
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "grid grid-cols-[max-content_1fr_max-content_1fr_max-content_1fr] items-center gap-2", children: [
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
        SmallButton,
        {
          onClick: () => onRead(
            parseHex(addr),
            parseHex(reg),
            Number.parseInt(count, 10) || 1,
            Number.parseInt(bus, 10) || 1
          ),
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
        SmallButton,
        {
          onClick: () => {
            const bytes = data.trim().split(/\s+/).map(parseHex).filter((n) => !Number.isNaN(n));
            onWrite(parseHex(addr), bytes, Number.parseInt(bus, 10) || 1);
          },
          children: "Write"
        }
      )
    ] })
  ] }) });
}
function Section({ title, children }) {
  return /* @__PURE__ */ jsxs("section", { className: "rounded border border-slate-800 bg-slate-900/40 p-3", children: [
    /* @__PURE__ */ jsx("h3", { className: "mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400", children: title }),
    children
  ] });
}
function SmallButton({
  children,
  onClick,
  disabled,
  tone = "normal"
}) {
  const cls = tone === "danger" ? "border border-rose-700 text-rose-300 hover:border-rose-500" : "border border-slate-700 text-slate-200 hover:border-slate-500";
  return /* @__PURE__ */ jsx(
    "button",
    {
      type: "button",
      onClick: (e) => {
        e.stopPropagation();
        onClick?.();
      },
      onPointerDown: (e) => e.stopPropagation(),
      disabled,
      className: `nodrag nopan rounded px-1.5 py-0.5 text-[11px] ${cls} disabled:cursor-not-allowed disabled:opacity-40`,
      children
    }
  );
}
export {
  RaspiFullView as default
};
