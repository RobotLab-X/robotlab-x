import { jsxs, jsx, Fragment } from "react/jsx-runtime";
import { forwardRef, createElement, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useWsClient } from "@rlx/ui";
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
const Octagon = createLucideIcon("Octagon", [
  [
    "polygon",
    {
      points: "7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2",
      key: "h1p8hx"
    }
  ]
]);
/**
 * @license lucide-react v0.344.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Pause = createLucideIcon("Pause", [
  ["rect", { width: "4", height: "16", x: "6", y: "4", key: "iffhe4" }],
  ["rect", { width: "4", height: "16", x: "14", y: "4", key: "sjin7j" }]
]);
/**
 * @license lucide-react v0.344.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Play = createLucideIcon("Play", [
  ["polygon", { points: "5 3 19 12 5 21 5 3", key: "191637" }]
]);
/**
 * @license lucide-react v0.344.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Plus = createLucideIcon("Plus", [
  ["path", { d: "M5 12h14", key: "1ays0h" }],
  ["path", { d: "M12 5v14", key: "s699le" }]
]);
/**
 * @license lucide-react v0.344.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Square = createLucideIcon("Square", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "afitv7" }]
]);
/**
 * @license lucide-react v0.344.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const X = createLucideIcon("X", [
  ["path", { d: "M18 6 6 18", key: "1bl5f8" }],
  ["path", { d: "m6 6 12 12", key: "d8bk6v" }]
]);
const EASINGS = ["linear", "ease_in", "ease_out", "ease_in_out"];
const field = "rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200";
const btn = "rounded px-2 py-1 text-xs disabled:opacity-40";
function ServoMixerView({ proxy }) {
  const wsClient = useWsClient();
  const proxyId = proxy.id ?? proxy.name ?? "";
  const stateTopic = `/servo_mixer/${proxyId}/state`;
  const controlTopic = `/servo_mixer/${proxyId}/control`;
  const [state, setState] = useState({});
  const [servoLive, setServoLive] = useState({});
  const [tab, setTab] = useState("drive");
  useEffect(() => {
    if (!proxyId) return;
    const offState = wsClient.subscribe(stateTopic, (f) => {
      if (f.method !== "message") return;
      setState((prev) => ({ ...prev, ...f.payload }));
    });
    const offServos = wsClient.subscribe("/servo/+/state", (f) => {
      if (f.method !== "message") return;
      const m = (f.topic ?? "").match(/^\/servo\/([^/]+)\/state$/);
      if (!m) return;
      setServoLive((prev) => ({ ...prev, [m[1]]: f.payload ?? {} }));
    });
    return () => {
      offState();
      offServos();
    };
  }, [proxyId, stateTopic, wsClient]);
  const send = useCallback((action, args = {}) => {
    wsClient.publish(controlTopic, { action, ...args });
  }, [wsClient, controlTopic]);
  const writeServo = useCallback((servoId, angle) => {
    wsClient.publish(`/servo/${servoId}/control`, { action: "write", angle });
  }, [wsClient]);
  const members = state.members ?? [];
  const poses = state.poses ?? [];
  const sequences = state.sequences ?? [];
  const player = state.player;
  const transition = state.default_transition_ms ?? 1e3;
  const memberIds = useMemo(() => new Set(members.map((m) => m.servo_id)), [members]);
  const addable = useMemo(
    () => Object.keys(servoLive).filter((id) => !memberIds.has(id)).sort(),
    [servoLive, memberIds]
  );
  return /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-2 p-3 text-slate-200", children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 text-xs", children: [
      /* @__PURE__ */ jsx("span", { className: "font-medium", children: "Servo Mixer" }),
      /* @__PURE__ */ jsxs("span", { className: "text-slate-500", children: [
        members.length,
        " member",
        members.length === 1 ? "" : "s"
      ] }),
      state.last_error && /* @__PURE__ */ jsx("span", { className: "truncate text-rose-400", children: state.last_error }),
      /* @__PURE__ */ jsxs(
        "button",
        {
          type: "button",
          onClick: () => send("stop_all"),
          className: `${btn} ml-auto flex items-center gap-1 bg-rose-700 text-white hover:bg-rose-600`,
          children: [
            /* @__PURE__ */ jsx(Octagon, { className: "h-3.5 w-3.5" }),
            " ALL STOP"
          ]
        }
      )
    ] }),
    /* @__PURE__ */ jsx("div", { className: "flex rounded border border-slate-700 text-xs", children: ["drive", "poses", "sequences", "timeline"].map((t) => /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        onClick: () => setTab(t),
        className: `flex-1 px-2 py-1 capitalize ${tab === t ? "bg-slate-700 text-white" : "text-slate-300 hover:bg-slate-800"}`,
        children: t
      },
      t
    )) }),
    tab === "drive" && /* @__PURE__ */ jsx(
      DriveTab,
      {
        members,
        servoLive,
        addable,
        transition,
        onWrite: writeServo,
        onSend: send
      }
    ),
    tab === "poses" && /* @__PURE__ */ jsx(PosesTab, { poses, transition, onSend: send }),
    tab === "sequences" && /* @__PURE__ */ jsx(
      SequencesTab,
      {
        sequences,
        poses,
        player,
        speakTarget: state.speak_target ?? "",
        onSend: send
      }
    ),
    tab === "timeline" && /* @__PURE__ */ jsx(TimelineTab, { timelines: state.timelines ?? [], members, player, onSend: send })
  ] });
}
function DriveTab({ members, servoLive, addable, transition, onWrite, onSend }) {
  const [pick, setPick] = useState("");
  return /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-2", children: [
    members.length === 0 && /* @__PURE__ */ jsx("div", { className: "text-[11px] text-slate-500", children: "No members yet. Add a servo below." }),
    members.map((m) => {
      const live = servoLive[m.servo_id] ?? {};
      const lo = live.min_angle ?? m.min_angle ?? 0;
      const hi = live.max_angle ?? m.max_angle ?? 180;
      const angle = live.current_angle ?? m.current_angle ?? lo;
      return /* @__PURE__ */ jsx(
        MemberFader,
        {
          label: m.label,
          enabled: m.enabled,
          online: m.servo_id in servoLive,
          min: lo,
          max: hi,
          angle,
          onWrite: (a) => onWrite(m.servo_id, a),
          onToggle: (e) => onSend("set_member_enabled", { servo_id: m.servo_id, enabled: e }),
          onRemove: () => onSend("remove_member", { servo_id: m.servo_id })
        },
        m.servo_id
      );
    }),
    /* @__PURE__ */ jsxs("div", { className: "mt-1 flex items-center gap-1.5", children: [
      /* @__PURE__ */ jsxs("select", { className: `${field} flex-1`, value: pick, onChange: (e) => setPick(e.target.value), children: [
        /* @__PURE__ */ jsx("option", { value: "", children: "add servo…" }),
        addable.map((id) => /* @__PURE__ */ jsx("option", { value: id, children: id }, id))
      ] }),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          className: `${btn} bg-slate-800 text-slate-200 hover:bg-slate-700`,
          disabled: !pick,
          onClick: () => {
            onSend("add_member", { servo_id: pick });
            setPick("");
          },
          children: /* @__PURE__ */ jsx(Plus, { className: "h-3.5 w-3.5" })
        }
      )
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "mt-1 flex items-center gap-2 text-[11px] text-slate-400", children: [
      /* @__PURE__ */ jsx("span", { children: "transition" }),
      /* @__PURE__ */ jsx(
        "input",
        {
          type: "number",
          min: 0,
          step: 100,
          defaultValue: transition,
          className: `${field} w-20`,
          onBlur: (e) => onSend("set_default_transition", { transition_ms: Number(e.target.value) })
        }
      ),
      /* @__PURE__ */ jsx("span", { children: "ms" }),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          className: `${btn} ml-auto bg-slate-800 text-slate-300 hover:bg-slate-700`,
          onClick: () => onSend("relax_all"),
          title: "Detach all members (release torque)",
          children: "relax"
        }
      )
    ] })
  ] });
}
function MemberFader({ label, enabled, online, min, max, angle, onWrite, onToggle, onRemove }) {
  const [draft, setDraft] = useState(angle);
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current) setDraft(angle);
  }, [angle]);
  return /* @__PURE__ */ jsxs("div", { className: `rounded border border-slate-800 p-2 ${enabled ? "" : "opacity-50"}`, children: [
    /* @__PURE__ */ jsxs("div", { className: "mb-1 flex items-center gap-2 text-[11px]", children: [
      /* @__PURE__ */ jsx("input", { type: "checkbox", checked: enabled, onChange: (e) => onToggle(e.target.checked), title: "enabled" }),
      /* @__PURE__ */ jsx("span", { className: "truncate font-mono text-slate-200", children: label }),
      !online && /* @__PURE__ */ jsx("span", { className: "text-amber-400", children: "offline" }),
      /* @__PURE__ */ jsxs("span", { className: "ml-auto font-mono text-slate-400", children: [
        draft,
        "°"
      ] }),
      /* @__PURE__ */ jsx("button", { type: "button", className: "text-slate-500 hover:text-rose-300", onClick: onRemove, children: /* @__PURE__ */ jsx(X, { className: "h-3 w-3" }) })
    ] }),
    /* @__PURE__ */ jsx(
      "input",
      {
        type: "range",
        min,
        max,
        step: 1,
        value: draft,
        disabled: !enabled,
        className: "w-full accent-emerald-500",
        onPointerDown: () => {
          dragging.current = true;
        },
        onPointerUp: () => {
          dragging.current = false;
        },
        onChange: (e) => {
          const v = Number(e.target.value);
          setDraft(v);
          onWrite(v);
        }
      }
    )
  ] });
}
function PosesTab({ poses, transition, onSend }) {
  const [name, setName] = useState("");
  const [applyMs, setApplyMs] = useState(transition);
  useEffect(() => {
    setApplyMs(transition);
  }, [transition]);
  return /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-2", children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1.5", children: [
      /* @__PURE__ */ jsx("input", { className: `${field} flex-1`, placeholder: "pose name", value: name, onChange: (e) => setName(e.target.value) }),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          className: `${btn} bg-sky-700 text-white hover:bg-sky-600`,
          disabled: !name.trim(),
          onClick: () => {
            onSend("capture_pose", { name: name.trim() });
            setName("");
          },
          children: "Capture"
        }
      )
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 text-[11px] text-slate-400", children: [
      /* @__PURE__ */ jsx("span", { children: "apply over" }),
      /* @__PURE__ */ jsx(
        "input",
        {
          type: "number",
          min: 0,
          step: 100,
          value: applyMs,
          className: `${field} w-20`,
          onChange: (e) => setApplyMs(Number(e.target.value))
        }
      ),
      /* @__PURE__ */ jsx("span", { children: "ms" })
    ] }),
    poses.length === 0 && /* @__PURE__ */ jsx("div", { className: "text-[11px] text-slate-500", children: "No poses. Drive the servos, then Capture." }),
    /* @__PURE__ */ jsx("ul", { className: "flex flex-col gap-1", children: poses.map((p) => /* @__PURE__ */ jsxs("li", { className: "flex items-center gap-2 rounded border border-slate-800 px-2 py-1 text-[11px]", children: [
      /* @__PURE__ */ jsx("span", { className: "truncate font-mono text-slate-200", children: p.name }),
      /* @__PURE__ */ jsxs("span", { className: "text-slate-500", children: [
        Object.keys(p.positions).length,
        " servo",
        Object.keys(p.positions).length === 1 ? "" : "s"
      ] }),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          className: `${btn} ml-auto bg-emerald-800 text-emerald-100 hover:bg-emerald-700`,
          onClick: () => onSend("apply_pose", { id: p.id, transition_ms: applyMs }),
          children: "Apply"
        }
      ),
      /* @__PURE__ */ jsx("button", { type: "button", className: "text-slate-500 hover:text-rose-300", onClick: () => onSend("delete_pose", { id: p.id }), children: /* @__PURE__ */ jsx(X, { className: "h-3 w-3" }) })
    ] }, p.id)) })
  ] });
}
function SequencesTab({ sequences, poses, player, speakTarget, onSend }) {
  const poseName = (id) => poses.find((p) => p.id === id)?.name ?? id;
  const [name, setName] = useState("");
  const [loop, setLoop] = useState(false);
  const [steps, setSteps] = useState([]);
  const [pick, setPick] = useState("");
  const addStep = () => {
    if (!pick) return;
    setSteps((s) => [...s, { pose_id: pick, transition_ms: 1e3, hold_ms: 0, speak: "", blocking: false }]);
  };
  const setStep = (i, patch) => setSteps((s) => s.map((st, j) => j === i ? { ...st, ...patch } : st));
  const moveStep = (i, d) => setSteps((s) => {
    const j = i + d;
    if (j < 0 || j >= s.length) return s;
    const next = [...s];
    const t = next[i];
    next[i] = next[j];
    next[j] = t;
    return next;
  });
  const save = () => {
    if (!name.trim() || steps.length === 0) return;
    onSend("save_sequence", { name: name.trim(), loop, steps });
    setName("");
    setLoop(false);
    setSteps([]);
  };
  return /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-2", children: [
    player?.playing && /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 rounded border border-emerald-800 bg-emerald-950/30 px-2 py-1 text-[11px]", children: [
      /* @__PURE__ */ jsxs("span", { className: "text-emerald-300", children: [
        "▶ ",
        player.current_sequence,
        " · step ",
        player.current_step + 1
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "ml-auto flex gap-1", children: [
        player.paused ? /* @__PURE__ */ jsx("button", { type: "button", className: `${btn} bg-slate-800 text-slate-200`, onClick: () => onSend("resume"), children: /* @__PURE__ */ jsx(Play, { className: "h-3 w-3" }) }) : /* @__PURE__ */ jsx("button", { type: "button", className: `${btn} bg-slate-800 text-slate-200`, onClick: () => onSend("pause"), children: /* @__PURE__ */ jsx(Pause, { className: "h-3 w-3" }) }),
        /* @__PURE__ */ jsx("button", { type: "button", className: `${btn} bg-slate-800 text-slate-200`, onClick: () => onSend("stop"), children: /* @__PURE__ */ jsx(Square, { className: "h-3 w-3" }) })
      ] })
    ] }),
    sequences.length === 0 && /* @__PURE__ */ jsx("div", { className: "text-[11px] text-slate-500", children: "No sequences. Build one below from your poses." }),
    /* @__PURE__ */ jsx("ul", { className: "flex flex-col gap-1", children: sequences.map((s) => /* @__PURE__ */ jsxs("li", { className: "flex items-center gap-2 rounded border border-slate-800 px-2 py-1 text-[11px]", children: [
      /* @__PURE__ */ jsx("span", { className: "truncate font-mono text-slate-200", children: s.name }),
      /* @__PURE__ */ jsxs("span", { className: "text-slate-500", children: [
        s.steps.length,
        " step",
        s.steps.length === 1 ? "" : "s",
        s.loop ? " · loop" : "",
        s.steps.some((st) => st.speak) ? " · 🔊" : ""
      ] }),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          className: `${btn} ml-auto bg-emerald-800 text-emerald-100 hover:bg-emerald-700`,
          onClick: () => onSend("play_sequence", { id: s.id }),
          children: /* @__PURE__ */ jsx(Play, { className: "h-3 w-3" })
        }
      ),
      /* @__PURE__ */ jsx("button", { type: "button", className: "text-slate-500 hover:text-rose-300", onClick: () => onSend("delete_sequence", { id: s.id }), children: /* @__PURE__ */ jsx(X, { className: "h-3 w-3" }) })
    ] }, s.id)) }),
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 text-[11px] text-slate-400", children: [
      /* @__PURE__ */ jsx("span", { children: "speak →" }),
      /* @__PURE__ */ jsx(
        "input",
        {
          className: `${field} flex-1 font-mono`,
          placeholder: "control topic e.g. /chat/chat-1/control",
          defaultValue: speakTarget,
          onBlur: (e) => onSend("set_speak_target", { topic: e.target.value.trim() || null })
        }
      )
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "rounded border border-slate-800 p-2", children: [
      /* @__PURE__ */ jsx("div", { className: "mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-400", children: "new sequence" }),
      /* @__PURE__ */ jsxs("div", { className: "mb-1.5 flex items-center gap-1.5", children: [
        /* @__PURE__ */ jsx("input", { className: `${field} flex-1`, placeholder: "name", value: name, onChange: (e) => setName(e.target.value) }),
        /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-1 text-[11px] text-slate-400", children: [
          /* @__PURE__ */ jsx("input", { type: "checkbox", checked: loop, onChange: (e) => setLoop(e.target.checked) }),
          " loop"
        ] })
      ] }),
      /* @__PURE__ */ jsx("ul", { className: "mb-1.5 flex flex-col gap-1", children: steps.map((st, i) => /* @__PURE__ */ jsxs("li", { className: "flex flex-col gap-1 rounded border border-slate-800/60 p-1 text-[11px]", children: [
        /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1", children: [
          /* @__PURE__ */ jsx("span", { className: "w-4 text-slate-500", children: i + 1 }),
          /* @__PURE__ */ jsx("span", { className: "min-w-0 flex-1 truncate font-mono text-slate-200", children: poseName(st.pose_id) }),
          /* @__PURE__ */ jsx(
            "input",
            {
              type: "number",
              min: 0,
              step: 100,
              value: st.transition_ms,
              title: "transition ms",
              className: `${field} w-16`,
              onChange: (e) => setStep(i, { transition_ms: Number(e.target.value) })
            }
          ),
          /* @__PURE__ */ jsx(
            "input",
            {
              type: "number",
              min: 0,
              step: 100,
              value: st.hold_ms,
              title: "hold ms",
              className: `${field} w-16`,
              onChange: (e) => setStep(i, { hold_ms: Number(e.target.value) })
            }
          ),
          /* @__PURE__ */ jsx("button", { type: "button", className: "text-slate-500 hover:text-slate-200", onClick: () => moveStep(i, -1), children: "↑" }),
          /* @__PURE__ */ jsx("button", { type: "button", className: "text-slate-500 hover:text-slate-200", onClick: () => moveStep(i, 1), children: "↓" }),
          /* @__PURE__ */ jsx("button", { type: "button", className: "text-slate-500 hover:text-rose-300", onClick: () => setSteps((s) => s.filter((_, j) => j !== i)), children: /* @__PURE__ */ jsx(X, { className: "h-3 w-3" }) })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1 pl-5", children: [
          /* @__PURE__ */ jsx("span", { className: "text-slate-500", children: "🔊" }),
          /* @__PURE__ */ jsx(
            "input",
            {
              className: `${field} flex-1`,
              placeholder: "speak (optional)",
              value: st.speak ?? "",
              onChange: (e) => setStep(i, { speak: e.target.value })
            }
          ),
          /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-1 text-slate-400", title: "wait for speech to finish before next step", children: [
            /* @__PURE__ */ jsx("input", { type: "checkbox", checked: !!st.blocking, onChange: (e) => setStep(i, { blocking: e.target.checked }) }),
            " block"
          ] })
        ] })
      ] }, i)) }),
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1.5", children: [
        /* @__PURE__ */ jsxs("select", { className: `${field} flex-1`, value: pick, onChange: (e) => setPick(e.target.value), children: [
          /* @__PURE__ */ jsx("option", { value: "", children: "add pose…" }),
          poses.map((p) => /* @__PURE__ */ jsx("option", { value: p.id, children: p.name }, p.id))
        ] }),
        /* @__PURE__ */ jsx("button", { type: "button", className: `${btn} bg-slate-800 text-slate-200 hover:bg-slate-700`, disabled: !pick, onClick: addStep, children: /* @__PURE__ */ jsx(Plus, { className: "h-3.5 w-3.5" }) }),
        /* @__PURE__ */ jsx("button", { type: "button", className: `${btn} bg-sky-700 text-white hover:bg-sky-600`, disabled: !name.trim() || steps.length === 0, onClick: save, children: "Save" })
      ] })
    ] })
  ] });
}
function TimelineTab({ timelines, members, player, onSend }) {
  const [selId, setSelId] = useState("");
  const [newName, setNewName] = useState("");
  const [head, setHead] = useState(0);
  const [selKf, setSelKf] = useState(null);
  const seekRef = useRef(0);
  useEffect(() => {
    if (!selId && timelines[0]) setSelId(timelines[0].id);
  }, [timelines, selId]);
  const tl = timelines.find((t) => t.id === selId) ?? timelines[0];
  const tid = tl?.id;
  const duration = tl?.duration_ms ?? 4e3;
  const playingThis = !!player?.playing && player?.current_timeline === tid;
  useEffect(() => {
    if (playingThis && typeof player?.playhead_ms === "number") setHead(player.playhead_ms);
  }, [playingThis, player?.playhead_ms]);
  const doSeek = useCallback((t) => {
    setHead(t);
    const now = Date.now();
    if (now - seekRef.current < 80 || !tid) return;
    seekRef.current = now;
    onSend("seek", { timeline_id: tid, t_ms: Math.round(t) });
  }, [onSend, tid]);
  const [dragPos, setDragPos] = useState(null);
  const startDrag = useCallback((e, servoId, lo, hi, kf) => {
    e.preventDefault();
    e.stopPropagation();
    setSelKf({ servo_id: servoId, t_ms: kf.t_ms });
    const trackEl = e.currentTarget.parentElement;
    if (!trackEl || !tid) return;
    const rect = trackEl.getBoundingClientRect();
    const orig = kf.t_ms;
    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    const onMove = (ev) => {
      const x = clamp01((ev.clientX - rect.left) / rect.width);
      const y = clamp01((ev.clientY - rect.top) / rect.height);
      setDragPos({
        servo_id: servoId,
        orig_t_ms: orig,
        t_ms: Math.round(x * duration),
        angle: Math.round(hi - y * (hi - lo))
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDragPos((dp) => {
        if (dp && (dp.t_ms !== orig || dp.angle !== kf.angle)) {
          onSend("move_keyframe", { timeline_id: tid, servo_id: servoId, t_ms: orig, new_t_ms: dp.t_ms, new_angle: dp.angle });
          setSelKf({ servo_id: servoId, t_ms: dp.t_ms });
        }
        return null;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [duration, tid, onSend]);
  return /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-2", children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1.5", children: [
      /* @__PURE__ */ jsxs("select", { className: `${field} flex-1`, value: tid ?? "", onChange: (e) => {
        setSelId(e.target.value);
        setSelKf(null);
        setHead(0);
      }, children: [
        timelines.length === 0 && /* @__PURE__ */ jsx("option", { value: "", children: "(no timelines)" }),
        timelines.map((t) => /* @__PURE__ */ jsx("option", { value: t.id, children: t.name }, t.id))
      ] }),
      tid && /* @__PURE__ */ jsx("button", { type: "button", className: "text-slate-500 hover:text-rose-300", onClick: () => onSend("delete_timeline", { id: tid }), children: /* @__PURE__ */ jsx(X, { className: "h-3.5 w-3.5" }) })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1.5", children: [
      /* @__PURE__ */ jsx("input", { className: `${field} flex-1`, placeholder: "new timeline name", value: newName, onChange: (e) => setNewName(e.target.value) }),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          className: `${btn} bg-slate-800 text-slate-200 hover:bg-slate-700`,
          disabled: !newName.trim(),
          onClick: () => {
            onSend("save_timeline", { name: newName.trim() });
            setNewName("");
          },
          children: "New"
        }
      )
    ] }),
    tl && /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 text-[11px] text-slate-400", children: [
        playingThis ? /* @__PURE__ */ jsx("button", { type: "button", className: `${btn} bg-slate-800 text-slate-200`, onClick: () => onSend("stop"), children: /* @__PURE__ */ jsx(Square, { className: "h-3 w-3" }) }) : /* @__PURE__ */ jsx("button", { type: "button", className: `${btn} bg-emerald-800 text-emerald-100`, onClick: () => onSend("play_timeline", { id: tl.id }), children: /* @__PURE__ */ jsx(Play, { className: "h-3 w-3" }) }),
        /* @__PURE__ */ jsx("span", { children: "dur" }),
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "number",
            min: 1,
            step: 100,
            defaultValue: duration,
            className: `${field} w-20`,
            onBlur: (e) => onSend("update_timeline", { id: tl.id, duration_ms: Number(e.target.value) })
          }
        ),
        /* @__PURE__ */ jsx("span", { children: "ms" }),
        /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-1", children: [
          /* @__PURE__ */ jsx("input", { type: "checkbox", checked: tl.loop, onChange: (e) => onSend("update_timeline", { id: tl.id, loop: e.target.checked }) }),
          " loop"
        ] }),
        /* @__PURE__ */ jsxs("span", { className: "ml-auto font-mono text-slate-300", children: [
          Math.round(head),
          "ms"
        ] })
      ] }),
      /* @__PURE__ */ jsx(
        "input",
        {
          type: "range",
          min: 0,
          max: duration,
          step: 10,
          value: head,
          className: "w-full accent-sky-500",
          onChange: (e) => doSeek(Number(e.target.value))
        }
      ),
      /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-1.5", children: [
        members.length === 0 && /* @__PURE__ */ jsx("div", { className: "text-[11px] text-slate-500", children: "Add members in the Drive tab first." }),
        members.map((m) => {
          const lo = m.min_angle ?? 0;
          const hi = m.max_angle ?? 180;
          const span = Math.max(1, hi - lo);
          const track = tl.tracks.find((t) => t.servo_id === m.servo_id);
          const kfs = [...track?.keyframes ?? []].sort((a, b) => a.t_ms - b.t_ms);
          const xPct = (t) => Math.min(100, Math.max(0, t / duration * 100));
          const yPct = (ang) => Math.min(100, Math.max(0, (1 - (ang - lo) / span) * 100));
          const liveKf = (kf) => dragPos && dragPos.servo_id === m.servo_id && dragPos.orig_t_ms === kf.t_ms ? { t_ms: dragPos.t_ms, angle: dragPos.angle } : { t_ms: kf.t_ms, angle: kf.angle };
          const pts = kfs.map((kf) => {
            const v = liveKf(kf);
            return `${xPct(v.t_ms)},${yPct(v.angle)}`;
          }).join(" ");
          return /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 text-[11px]", children: [
            /* @__PURE__ */ jsx("span", { className: "w-14 shrink-0 truncate font-mono text-slate-300", title: `${m.label} (${lo}–${hi}°)`, children: m.label }),
            /* @__PURE__ */ jsxs("div", { className: "relative h-14 flex-1 rounded bg-slate-800", children: [
              kfs.length > 1 && /* @__PURE__ */ jsx("svg", { viewBox: "0 0 100 100", preserveAspectRatio: "none", className: "pointer-events-none absolute inset-0 h-full w-full", children: /* @__PURE__ */ jsx("polyline", { points: pts, fill: "none", stroke: "#34d399", strokeWidth: 1, vectorEffect: "non-scaling-stroke" }) }),
              /* @__PURE__ */ jsx("div", { className: "absolute top-0 h-full w-px bg-sky-400", style: { left: `${xPct(head)}%` } }),
              kfs.map((kf) => {
                const v = liveKf(kf);
                const sel = selKf?.servo_id === m.servo_id && selKf?.t_ms === kf.t_ms;
                return /* @__PURE__ */ jsx(
                  "button",
                  {
                    type: "button",
                    title: `${v.t_ms}ms → ${v.angle}° (${kf.easing ?? "linear"}) — drag to move`,
                    onPointerDown: (e) => startDrag(e, m.servo_id, lo, hi, kf),
                    className: `absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border active:cursor-grabbing ${sel ? "border-white bg-amber-400" : "border-slate-900 bg-emerald-400"}`,
                    style: { left: `${xPct(v.t_ms)}%`, top: `${yPct(v.angle)}%` }
                  },
                  kf.t_ms
                );
              })
            ] }),
            /* @__PURE__ */ jsx(
              "button",
              {
                type: "button",
                className: `${btn} shrink-0 bg-slate-800 text-slate-200 hover:bg-slate-700`,
                title: "Add keyframe at the playhead (captures current angle)",
                onClick: () => onSend("add_keyframe", { timeline_id: tl.id, servo_id: m.servo_id, t_ms: Math.round(head) }),
                children: "+KF"
              }
            )
          ] }, m.servo_id);
        })
      ] }),
      selKf && (() => {
        const track = tl.tracks.find((t) => t.servo_id === selKf.servo_id);
        const kf = track?.keyframes.find((k) => k.t_ms === selKf.t_ms);
        if (!kf) return null;
        const args = (extra) => ({ timeline_id: tl.id, servo_id: selKf.servo_id, t_ms: selKf.t_ms, ...extra });
        return /* @__PURE__ */ jsxs("div", { className: "flex flex-wrap items-center gap-1.5 rounded border border-amber-800/50 bg-amber-950/20 p-2 text-[11px]", children: [
          /* @__PURE__ */ jsx("span", { className: "font-mono text-amber-300", children: selKf.servo_id }),
          /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-1", children: [
            "t",
            /* @__PURE__ */ jsx(
              "input",
              {
                type: "number",
                min: 0,
                step: 10,
                defaultValue: kf.t_ms,
                className: `${field} w-20`,
                onBlur: (e) => {
                  onSend("move_keyframe", args({ new_t_ms: Number(e.target.value) }));
                  setSelKf({ servo_id: selKf.servo_id, t_ms: Number(e.target.value) });
                }
              }
            )
          ] }),
          /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-1", children: [
            "°",
            /* @__PURE__ */ jsx(
              "input",
              {
                type: "number",
                min: 0,
                max: 180,
                defaultValue: kf.angle,
                className: `${field} w-16`,
                onBlur: (e) => onSend("move_keyframe", args({ new_angle: Number(e.target.value) }))
              }
            )
          ] }),
          /* @__PURE__ */ jsx("select", { className: field, defaultValue: kf.easing ?? "linear", onChange: (e) => onSend("move_keyframe", args({ easing: e.target.value })), children: EASINGS.map((ez) => /* @__PURE__ */ jsx("option", { value: ez, children: ez }, ez)) }),
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: "ml-auto text-slate-500 hover:text-rose-300",
              onClick: () => {
                onSend("remove_keyframe", args({}));
                setSelKf(null);
              },
              children: /* @__PURE__ */ jsx(X, { className: "h-3 w-3" })
            }
          )
        ] }, `${selKf.servo_id}:${selKf.t_ms}`);
      })()
    ] })
  ] });
}
export {
  ServoMixerView as default
};
