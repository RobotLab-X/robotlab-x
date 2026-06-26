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
const Crosshair = createLucideIcon("Crosshair", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["line", { x1: "22", x2: "18", y1: "12", y2: "12", key: "l9bcsi" }],
  ["line", { x1: "6", x2: "2", y1: "12", y2: "12", key: "13hhkx" }],
  ["line", { x1: "12", x2: "12", y1: "6", y2: "2", key: "10w3f3" }],
  ["line", { x1: "12", x2: "12", y1: "22", y2: "18", key: "15g9kq" }]
]);
/**
 * @license lucide-react v0.344.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Eye = createLucideIcon("Eye", [
  ["path", { d: "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z", key: "rwhkz3" }],
  ["circle", { cx: "12", cy: "12", r: "3", key: "1v7zrd" }]
]);
/**
 * @license lucide-react v0.344.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Gamepad2 = createLucideIcon("Gamepad2", [
  ["line", { x1: "6", x2: "10", y1: "11", y2: "11", key: "1gktln" }],
  ["line", { x1: "8", x2: "8", y1: "9", y2: "13", key: "qnk9ow" }],
  ["line", { x1: "15", x2: "15.01", y1: "12", y2: "12", key: "krot7o" }],
  ["line", { x1: "18", x2: "18.01", y1: "10", y2: "10", key: "1lcuu1" }],
  [
    "path",
    {
      d: "M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z",
      key: "mfqc10"
    }
  ]
]);
/**
 * @license lucide-react v0.344.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Globe = createLucideIcon("Globe", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["path", { d: "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20", key: "13o1zl" }],
  ["path", { d: "M2 12h20", key: "9i4pu4" }]
]);
/**
 * @license lucide-react v0.344.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Link2 = createLucideIcon("Link2", [
  ["path", { d: "M9 17H7A5 5 0 0 1 7 7h2", key: "8i5ue5" }],
  ["path", { d: "M15 7h2a5 5 0 1 1 0 10h-2", key: "1b9ql8" }],
  ["line", { x1: "8", x2: "16", y1: "12", y2: "12", key: "1jonct" }]
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
const Trash2 = createLucideIcon("Trash2", [
  ["path", { d: "M3 6h18", key: "d0wm0j" }],
  ["path", { d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", key: "4alrt4" }],
  ["path", { d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2", key: "v07s0e" }],
  ["line", { x1: "10", x2: "10", y1: "11", y2: "17", key: "1uufr5" }],
  ["line", { x1: "14", x2: "14", y1: "11", y2: "17", key: "xtxkd" }]
]);
/**
 * @license lucide-react v0.344.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Video = createLucideIcon("Video", [
  ["path", { d: "m22 8-6 4 6 4V8Z", key: "50v9me" }],
  ["rect", { width: "14", height: "12", x: "2", y: "6", rx: "2", ry: "2", key: "1rqjg6" }]
]);
const ANCHOR_DEFAULT = {
  head: { pos: [0, 0, -1.5], quat: [0, 0, 0, 1] },
  body: { pos: [0, -0.1, -1.4], quat: [0, 0, 0, 1] },
  wrist: { pos: [0, 0.04, -0.08], quat: [0, 0, 0, 1] },
  world: { pos: [0, 1.4, -1.5], quat: [0, 0, 0, 1] }
};
const fmt = (v, d = 0) => v ? `[${v.map((n) => n.toFixed(d)).join(", ")}]` : "—";
const shortId = (id) => id.replace(/^xr-standard-/, "");
function CompList({ c }) {
  const comps = c?.components ?? {};
  const ids = Object.keys(comps).sort();
  if (!ids.length) return /* @__PURE__ */ jsx("div", { className: "text-[10px] text-slate-600", children: "—" });
  return /* @__PURE__ */ jsx("div", { className: "space-y-0.5 font-mono text-[10px] leading-tight", children: ids.map((id) => {
    const k = comps[id];
    const axes = Math.abs(k.x) > 1e-3 || Math.abs(k.y) > 1e-3 || id.includes("thumbstick");
    const active = k.state !== "default" || Math.abs(k.value) > 0.02 || Math.abs(k.x) > 0.02 || Math.abs(k.y) > 0.02;
    return /* @__PURE__ */ jsxs("div", { className: active ? "text-emerald-300" : "text-slate-600", title: `${id} · ${k.state}`, children: [
      shortId(id),
      " ",
      k.state.charAt(0),
      " ",
      k.value.toFixed(2),
      axes ? ` (${k.x.toFixed(2)},${k.y.toFixed(2)})` : ""
    ] }, id);
  }) });
}
function WebXRControlView({ proxy }) {
  const ws = useWsClient();
  const proxyId = proxy.id ?? proxy.name ?? "";
  const [type] = (proxy.service_meta_id ?? "webxr@1.0.0").split("@");
  const stateTopic = `/${type}/${proxyId}/state`;
  const controlTopic = `/${type}/${proxyId}/control`;
  const [state, setState] = useState({});
  const [err, setErr] = useState(null);
  useEffect(() => {
    const off = ws.subscribe(stateTopic, (f) => {
      if (f.method === "message") setState(f.payload);
    });
    return () => off();
  }, [ws, stateTopic]);
  const req = useServiceRequest(controlTopic, {
    timeoutMs: 15e3,
    errorField: "error",
    replyPrefix: `webxr-${proxyId}`
  });
  const call = useCallback(async (action, payload) => {
    try {
      await req.request(action, payload);
      setErr(null);
    } catch (e) {
      setErr(String(e?.message ?? e));
    }
  }, [req]);
  const runtimeId = useMemo(() => {
    const m = window.location.pathname.match(/^\/r\/([^/]+)/);
    return m ? m[1] : "runtime";
  }, []);
  const xrUrl = useMemo(
    () => `${window.location.origin}/r/${runtimeId}/xr/${encodeURIComponent(proxyId)}`,
    [runtimeId, proxyId]
  );
  const [vTitle, setVTitle] = useState("camera");
  const [vUrl, setVUrl] = useState("");
  const [tTitle, setTTitle] = useState("telemetry");
  const [tTopic, setTTopic] = useState("");
  const [bProxy, setBProxy] = useState("");
  const [bView, setBView] = useState("");
  const [mapTarget, setMapTarget] = useState("robot_kinematics-1");
  const addVideo = () => {
    if (!vUrl.trim()) return;
    void call("set_panel", {
      panel: {
        id: `video-${Date.now().toString(36)}`,
        title: vTitle || "camera",
        source: { kind: "video_mjpeg", ref: vUrl.trim() },
        transform: { pos: [0, 1.4, -1.5], quat: [0, 0, 0, 1], width_m: 1.2, height_m: 0.7, scale: 1 }
      }
    });
    setVUrl("");
  };
  const addTelemetry = () => {
    if (!tTopic.trim()) return;
    void call("set_panel", {
      panel: {
        id: `telem-${Date.now().toString(36)}`,
        title: tTitle || "telemetry",
        source: { kind: "telemetry", ref: tTopic.trim() },
        transform: { pos: [1.4, 1.4, -1], quat: [0, -0.38, 0, 0.92], width_m: 0.9, height_m: 0.6, scale: 1 }
      }
    });
    setTTopic("");
  };
  const addBrowser = () => {
    const pid = bProxy.trim();
    if (!pid) return;
    const v = bView.trim();
    const ref = `/r/${encodeURIComponent(runtimeId)}/dock/${encodeURIComponent(pid)}` + (v ? `?view=${encodeURIComponent(v)}` : "");
    void call("set_panel", {
      panel: {
        id: `web-${Date.now().toString(36)}`,
        title: pid,
        source: { kind: "browser", ref },
        transform: { pos: [-1.4, 1.4, -1], quat: [0, 0.38, 0, 0.92], width_m: 1, height_m: 0.7, scale: 1 }
      }
    });
    setBProxy("");
    setBView("");
  };
  const addArmTeleop = () => void call("set_mapping", {
    mapping: {
      id: `map-${Date.now().toString(36)}`,
      source: "controller.right.ray",
      target: mapTarget,
      action: "set_target",
      args: { ee: "right_hand", solve: true }
    }
  });
  const sess = state.session ?? {};
  const dot = (ok) => /* @__PURE__ */ jsx("span", { style: {
    display: "inline-block",
    width: 8,
    height: 8,
    borderRadius: 8,
    background: ok ? "#34d399" : "#64748b"
  } });
  return /* @__PURE__ */ jsxs("div", { className: "space-y-3 p-3 text-xs text-slate-200", children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
      dot(state.connected),
      /* @__PURE__ */ jsx("span", { className: "font-medium", children: state.connected ? `headset connected · ${sess.mode ?? "vr"} · ${Math.round(sess.fps ?? 0)} fps` : "no headset — open the view on the Quest" }),
      /* @__PURE__ */ jsx(
        "button",
        {
          onClick: () => call("set_enabled", { enabled: !(state.enabled ?? true) }),
          className: `ml-auto rounded px-2 py-0.5 ${state.enabled ?? true ? "bg-emerald-800/60 text-emerald-200" : "border border-slate-700 text-slate-400"}`,
          children: state.enabled ?? true ? "enabled" : "disabled"
        }
      )
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "rounded border border-slate-800 bg-slate-950/60 p-2", children: [
      /* @__PURE__ */ jsxs("div", { className: "mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-400", children: [
        /* @__PURE__ */ jsx(Eye, { className: "h-3 w-3" }),
        " open on headset"
      ] }),
      /* @__PURE__ */ jsx(
        "a",
        {
          href: xrUrl,
          target: "_blank",
          rel: "noreferrer",
          className: "block break-all rounded bg-slate-900 px-2 py-1 text-[11px] text-sky-300 underline decoration-sky-700 hover:bg-slate-800 hover:text-sky-200",
          children: xrUrl
        }
      ),
      /* @__PURE__ */ jsxs("p", { className: "mt-1 text-[10px] text-slate-500", children: [
        "Open this on the Quest 3 Browser and press Enter VR. Dev over USB:",
        " ",
        /* @__PURE__ */ jsx("code", { children: "adb reverse tcp:5051 tcp:5051" }),
        " first, so the headset reaches it at localhost."
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "rounded border border-slate-800 bg-slate-950/60 p-2", children: [
      /* @__PURE__ */ jsxs("div", { className: "mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-400", children: [
        /* @__PURE__ */ jsx(Crosshair, { className: "h-3 w-3" }),
        " telemetry (robot frame, mm)"
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "grid grid-cols-[64px_1fr] gap-x-2 gap-y-0.5 font-mono text-[11px]", children: [
        /* @__PURE__ */ jsx("span", { className: "text-slate-500", children: "head" }),
        /* @__PURE__ */ jsx("span", { children: fmt(state.head?.pos) }),
        /* @__PURE__ */ jsx("span", { className: "text-slate-500", children: "L ray" }),
        /* @__PURE__ */ jsx("span", { children: fmt(state.controller?.left?.ray?.pos) }),
        /* @__PURE__ */ jsx("span", { className: "text-slate-500", children: "R ray" }),
        /* @__PURE__ */ jsx("span", { children: fmt(state.controller?.right?.ray?.pos) }),
        /* @__PURE__ */ jsx("span", { className: "text-slate-500", children: "R axes" }),
        /* @__PURE__ */ jsx("span", { children: state.controller?.right?.axes ? `x ${state.controller.right.axes.x.toFixed(2)} y ${state.controller.right.axes.y.toFixed(2)}` : "—" }),
        /* @__PURE__ */ jsx("span", { className: "text-slate-500", children: "origin" }),
        /* @__PURE__ */ jsx("span", { children: fmt(state.origin_mm) })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "mt-1 flex gap-1", children: [
        /* @__PURE__ */ jsx(
          "button",
          {
            onClick: () => call("recenter"),
            disabled: !state.head,
            className: "rounded bg-sky-900/60 px-2 py-0.5 text-sky-200 hover:bg-sky-800/60 disabled:opacity-40",
            children: "Recenter"
          }
        ),
        /* @__PURE__ */ jsx(
          "button",
          {
            onClick: () => call("clear_origin"),
            className: "rounded border border-slate-700 px-2 py-0.5 text-slate-300 hover:border-slate-500",
            children: "Clear origin"
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "rounded border border-slate-800 bg-slate-950/60 p-2", children: [
      /* @__PURE__ */ jsxs("div", { className: "mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-400", children: [
        /* @__PURE__ */ jsx(Gamepad2, { className: "h-3 w-3" }),
        " controller inputs",
        /* @__PURE__ */ jsx("span", { className: "ml-auto normal-case text-slate-600", children: "on /controller/{left,right}" })
      ] }),
      /* @__PURE__ */ jsx("div", { className: "grid grid-cols-2 gap-2", children: ["left", "right"].map((side) => /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("div", { className: "mb-0.5 text-[9px] uppercase tracking-wider text-slate-500", children: side }),
        /* @__PURE__ */ jsx(CompList, { c: state.controller?.[side] ?? null })
      ] }, side)) })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "rounded border border-slate-800 bg-slate-950/60 p-2", children: [
      /* @__PURE__ */ jsxs("div", { className: "mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-400", children: [
        /* @__PURE__ */ jsx(Video, { className: "h-3 w-3" }),
        " feeds (",
        (state.panels ?? []).length,
        ")"
      ] }),
      /* @__PURE__ */ jsx("div", { className: "space-y-0.5", children: (state.panels ?? []).map((p) => /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1", children: [
        /* @__PURE__ */ jsx("span", { className: "rounded bg-slate-800 px-1 text-[9px] uppercase text-slate-400", children: p.source.kind === "telemetry" ? "tlm" : p.source.kind === "browser" ? "web" : "vid" }),
        /* @__PURE__ */ jsx("span", { className: "min-w-0 flex-1 truncate font-mono text-[11px]", title: p.source.ref, children: p.title || p.source.ref }),
        /* @__PURE__ */ jsxs(
          "select",
          {
            value: p.placement ?? "world",
            onChange: (e) => {
              const a = e.target.value;
              const off = ANCHOR_DEFAULT[a];
              void call("set_panel", { panel: { ...p, placement: a, transform: { ...p.transform, pos: off.pos, quat: off.quat } } });
            },
            title: "Anchor frame (head = locks in front of gaze)",
            className: "shrink-0 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[10px]",
            children: [
              /* @__PURE__ */ jsx("option", { value: "world", children: "world" }),
              /* @__PURE__ */ jsx("option", { value: "head", children: "head" }),
              /* @__PURE__ */ jsx("option", { value: "body", children: "body" }),
              /* @__PURE__ */ jsx("option", { value: "wrist", children: "wrist" })
            ]
          }
        ),
        /* @__PURE__ */ jsx(
          "button",
          {
            onClick: () => call("remove_panel", { id: p.id }),
            className: "shrink-0 rounded p-0.5 text-slate-500 hover:bg-rose-900/40 hover:text-rose-300",
            children: /* @__PURE__ */ jsx(Trash2, { className: "h-3 w-3" })
          }
        )
      ] }, p.id)) }),
      /* @__PURE__ */ jsxs("div", { className: "mt-1.5 space-y-1 border-t border-slate-800 pt-1.5", children: [
        /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1", children: [
          /* @__PURE__ */ jsx(
            "input",
            {
              value: vTitle,
              onChange: (e) => setVTitle(e.target.value),
              placeholder: "title",
              className: "w-20 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[11px]"
            }
          ),
          /* @__PURE__ */ jsx(
            "input",
            {
              value: vUrl,
              onChange: (e) => setVUrl(e.target.value),
              placeholder: "stream id e.g. video/video-1 (or full MJPEG url)",
              className: "min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[11px]"
            }
          ),
          /* @__PURE__ */ jsx(
            "button",
            {
              onClick: addVideo,
              title: "Add video feed",
              className: "rounded bg-slate-800 px-1.5 py-0.5 hover:bg-slate-700",
              children: /* @__PURE__ */ jsx(Plus, { className: "h-3 w-3" })
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1", children: [
          /* @__PURE__ */ jsx(
            "input",
            {
              value: tTitle,
              onChange: (e) => setTTitle(e.target.value),
              placeholder: "title",
              className: "w-20 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[11px]"
            }
          ),
          /* @__PURE__ */ jsx(
            "input",
            {
              value: tTopic,
              onChange: (e) => setTTopic(e.target.value),
              placeholder: "bus topic (telemetry)",
              className: "min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[11px]"
            }
          ),
          /* @__PURE__ */ jsx(
            "button",
            {
              onClick: addTelemetry,
              title: "Add telemetry panel",
              className: "rounded bg-slate-800 px-1.5 py-0.5 hover:bg-slate-700",
              children: /* @__PURE__ */ jsx(Plus, { className: "h-3 w-3" })
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1", children: [
          /* @__PURE__ */ jsx("span", { title: "Service UI in VR", className: "flex shrink-0", children: /* @__PURE__ */ jsx(Globe, { className: "h-3 w-3 text-slate-500" }) }),
          /* @__PURE__ */ jsx(
            "input",
            {
              value: bProxy,
              onChange: (e) => setBProxy(e.target.value),
              placeholder: "service proxy id e.g. servo-1",
              className: "min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[11px]"
            }
          ),
          /* @__PURE__ */ jsx(
            "input",
            {
              value: bView,
              onChange: (e) => setBView(e.target.value),
              placeholder: "view (optional)",
              className: "w-20 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[11px]"
            }
          ),
          /* @__PURE__ */ jsx(
            "button",
            {
              onClick: addBrowser,
              title: "Add service UI panel (browser)",
              className: "rounded bg-slate-800 px-1.5 py-0.5 hover:bg-slate-700",
              children: /* @__PURE__ */ jsx(Plus, { className: "h-3 w-3" })
            }
          )
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "rounded border border-slate-800 bg-slate-950/60 p-2", children: [
      /* @__PURE__ */ jsxs("div", { className: "mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-400", children: [
        /* @__PURE__ */ jsx(Gamepad2, { className: "h-3 w-3" }),
        " mappings (",
        (state.mappings ?? []).length,
        ")"
      ] }),
      /* @__PURE__ */ jsx("div", { className: "space-y-0.5", children: (state.mappings ?? []).map((m) => /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1 font-mono text-[11px]", children: [
        /* @__PURE__ */ jsx(Link2, { className: "h-3 w-3 shrink-0 text-slate-500" }),
        /* @__PURE__ */ jsxs("span", { className: "truncate", title: `${m.source} → ${m.target}.${m.action}`, children: [
          m.source,
          " → ",
          m.target,
          ".",
          m.action
        ] }),
        /* @__PURE__ */ jsx(
          "button",
          {
            onClick: () => call("remove_mapping", { id: m.id }),
            className: "ml-auto rounded p-0.5 text-slate-500 hover:bg-rose-900/40 hover:text-rose-300",
            children: /* @__PURE__ */ jsx(Trash2, { className: "h-3 w-3" })
          }
        )
      ] }, m.id)) }),
      /* @__PURE__ */ jsxs("div", { className: "mt-1.5 flex items-center gap-1 border-t border-slate-800 pt-1.5", children: [
        /* @__PURE__ */ jsx(
          "input",
          {
            value: mapTarget,
            onChange: (e) => setMapTarget(e.target.value),
            placeholder: "actuator proxy id",
            className: "min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[11px]"
          }
        ),
        /* @__PURE__ */ jsx(
          "button",
          {
            onClick: addArmTeleop,
            title: "Right controller → IK right_hand target",
            className: "rounded bg-sky-900/60 px-2 py-0.5 text-[11px] text-sky-200 hover:bg-sky-800/60",
            children: "+ arm teleop"
          }
        )
      ] })
    ] }),
    err && /* @__PURE__ */ jsx("div", { className: "truncate font-mono text-[10px] text-rose-300", title: err, children: err })
  ] });
}
export {
  WebXRControlView as default
};
