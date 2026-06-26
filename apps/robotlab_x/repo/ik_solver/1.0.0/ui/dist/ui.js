import { jsxs, jsx, Fragment } from "react/jsx-runtime";
import { forwardRef, createElement, useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useWsClient, useServiceRequest, NumberInput } from "@rlx/ui";
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
const RotateCcw = createLucideIcon("RotateCcw", [
  ["path", { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", key: "1357e3" }],
  ["path", { d: "M3 3v5h5", key: "1xhq8a" }]
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
function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
function jointWorldPositions(joints, links, anglesDeg) {
  const baseRad = (anglesDeg["base"] ?? 0) * Math.PI / 180;
  const inPlaneNames = joints.filter((j) => j.name !== "base").map((j) => j.name);
  const inPlaneRad = inPlaneNames.map((n) => (anglesDeg[n] ?? 0) * Math.PI / 180);
  const positions = [];
  positions.push([0, 0, 0]);
  if (joints.length > 1) positions.push([0, 0, 0]);
  let r = 0;
  let z = 0;
  let cum = 0;
  for (let i = 0; i < links.length; i++) {
    if (i < inPlaneRad.length) cum += inPlaneRad[i];
    r += links[i].length_mm * Math.cos(cum);
    z += links[i].length_mm * Math.sin(cum);
    const x = r * Math.cos(baseRad);
    const y = r * Math.sin(baseRad);
    positions.push([x, y, z]);
  }
  return positions;
}
function ArmProjection({
  positions,
  target,
  axes,
  maxReachMm,
  minReachMm,
  onClick,
  status,
  path,
  width,
  height,
  isoCamera,
  onIsoCameraChange
}) {
  const W = width ?? 280;
  const H = height ?? 220;
  const isIso = axes === "iso";
  const camAzDeg = isoCamera?.azDeg ?? 45;
  const camElDeg = isoCamera?.elDeg ?? 35.264;
  const orthoSpan = Math.max(2 * maxReachMm, 1);
  const orthoPxPerMm = Math.min(W, H) * 0.92 / orthoSpan;
  const pxPerMm = isIso ? Math.min(W, H) * 0.42 / Math.max(maxReachMm, 1) : orthoPxPerMm;
  const ox = W / 2;
  const oy = axes === "xy" ? H / 2 : isIso ? H * 0.62 : H * 0.78;
  const camAzRad = camAzDeg * Math.PI / 180;
  const camElRad = camElDeg * Math.PI / 180;
  const camSinAz = Math.sin(camAzRad);
  const camCosAz = Math.cos(camAzRad);
  const camSinEl = Math.sin(camElRad);
  const camCosEl = Math.cos(camElRad);
  const projectIso = (p) => {
    const [wx, wy, wz] = p;
    const sx = wx * camSinAz - wy * camCosAz;
    const sy = -camSinEl * (wx * camCosAz + wy * camSinAz) + wz * camCosEl;
    return [ox + sx * pxPerMm, oy - sy * pxPerMm];
  };
  const projectWorld = (p) => {
    if (isIso) return projectIso(p);
    const [wx, wy, wz] = p;
    const a = axes === "yz" ? wy : wx;
    const b = axes === "xy" ? wy : wz;
    return [ox + a * pxPerMm, oy - b * pxPerMm];
  };
  const sToW = (sx, sy) => [
    (sx - ox) / pxPerMm,
    (oy - sy) / pxPerMm
  ];
  const armColor = status === "reachable" ? "#10b981" : status === "unreachable" ? "#f59e0b" : "#64748b";
  const onSvgClick = (e) => {
    if (!onClick || isIso) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const [wa, wb] = sToW(sx, sy);
    onClick(wa, wb);
  };
  const dragRef = useRef(null);
  const onIsoPointerDown = (e) => {
    if (!isIso || !onIsoCameraChange) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, az: camAzDeg, el: camElDeg };
  };
  const onIsoPointerMove = (e) => {
    if (!dragRef.current || !onIsoCameraChange) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    const sens = 0.4;
    const nextAz = dragRef.current.az + dx * sens;
    const nextEl = Math.max(5, Math.min(85, dragRef.current.el + dy * sens));
    onIsoCameraChange(nextAz, nextEl);
  };
  const onIsoPointerUp = (e) => {
    if (!dragRef.current) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
  };
  const outerR = maxReachMm * pxPerMm;
  const innerR = minReachMm * pxPerMm;
  const floorY = oy;
  return /* @__PURE__ */ jsxs("div", { className: "flex flex-col items-center", children: [
    /* @__PURE__ */ jsxs("div", { className: "mb-1 flex w-full justify-between text-[9px] uppercase tracking-wider text-slate-500", children: [
      /* @__PURE__ */ jsx("span", { children: axes === "xz" ? "side view" : axes === "xy" ? "top view" : axes === "yz" ? "front view" : "isometric view" }),
      /* @__PURE__ */ jsx("span", { className: "font-mono", children: axes === "xz" ? "X → / Z ↑" : axes === "xy" ? "X → / Y ↑" : axes === "yz" ? "Y → / Z ↑" : `drag to orbit · az ${Math.round((camAzDeg % 360 + 360) % 360)}° / el ${Math.round(camElDeg)}°` })
    ] }),
    /* @__PURE__ */ jsxs(
      "svg",
      {
        width: W,
        height: H,
        onClick: onSvgClick,
        className: `rounded border border-slate-800 bg-slate-950 ${isIso ? dragRef.current ? "cursor-grabbing" : "cursor-grab" : "cursor-crosshair"}`,
        onPointerDown: isIso ? onIsoPointerDown : (e) => e.stopPropagation(),
        onPointerMove: isIso ? onIsoPointerMove : void 0,
        onPointerUp: isIso ? onIsoPointerUp : void 0,
        onPointerCancel: isIso ? onIsoPointerUp : void 0,
        children: [
          /* @__PURE__ */ jsx("circle", { cx: ox, cy: oy, r: outerR, fill: "none", stroke: "#1e293b", strokeDasharray: "3 3" }),
          innerR > 1 && /* @__PURE__ */ jsx("circle", { cx: ox, cy: oy, r: innerR, fill: "none", stroke: "#1e293b", strokeDasharray: "2 2" }),
          !isIso ? /* @__PURE__ */ jsxs(Fragment, { children: [
            /* @__PURE__ */ jsx("line", { x1: 0, y1: oy, x2: W, y2: oy, stroke: "#1e293b" }),
            /* @__PURE__ */ jsx("line", { x1: ox, y1: 0, x2: ox, y2: H, stroke: "#1e293b" }),
            axes !== "xy" && /* @__PURE__ */ jsx("line", { x1: 0, y1: floorY, x2: W, y2: floorY, stroke: "#334155", strokeWidth: 2 })
          ] }) : (() => {
            const R = maxReachMm;
            const step = (() => {
              const raw = R / 6;
              const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
              const choices = [1, 2, 5, 10].map((m) => m * mag);
              return choices.reduce((best, c2) => Math.abs(c2 - raw) < Math.abs(best - raw) ? c2 : best, choices[0]);
            })();
            const lines = [];
            for (let k = -R; k <= R + 1e-3; k += step) {
              const [ax, ay] = projectIso([k, -R, 0]);
              const [bx, by] = projectIso([k, +R, 0]);
              const major = Math.abs(k) < 1e-3;
              lines.push(
                /* @__PURE__ */ jsx(
                  "line",
                  {
                    x1: ax,
                    y1: ay,
                    x2: bx,
                    y2: by,
                    stroke: major ? "#334155" : "#1f2937",
                    strokeWidth: major ? 1.2 : 0.6
                  },
                  `gx-${k.toFixed(2)}`
                )
              );
              const [cx, cy] = projectIso([-R, k, 0]);
              const [dx, dy] = projectIso([+R, k, 0]);
              lines.push(
                /* @__PURE__ */ jsx(
                  "line",
                  {
                    x1: cx,
                    y1: cy,
                    x2: dx,
                    y2: dy,
                    stroke: major ? "#334155" : "#1f2937",
                    strokeWidth: major ? 1.2 : 0.6
                  },
                  `gy-${k.toFixed(2)}`
                )
              );
            }
            const c = [
              [-R, -R, 0],
              [+R, -R, 0],
              [+R, +R, 0],
              [-R, +R, 0],
              [-R, -R, R],
              [+R, -R, R],
              [+R, +R, R],
              [-R, +R, R]
            ].map((p) => projectIso(p));
            const edges = [
              [0, 1],
              [1, 2],
              [2, 3],
              [3, 0],
              // floor
              [4, 5],
              [5, 6],
              [6, 7],
              [7, 4],
              // ceiling
              [0, 4],
              [1, 5],
              [2, 6],
              [3, 7]
              // verticals
            ];
            const boxEdges = edges.map(([i, j], idx) => /* @__PURE__ */ jsx(
              "line",
              {
                x1: c[i][0],
                y1: c[i][1],
                x2: c[j][0],
                y2: c[j][1],
                stroke: "#1f2937",
                strokeWidth: 0.8,
                strokeDasharray: "4 4"
              },
              `box-${idx}`
            ));
            const axLen = R * 1.1;
            const [xEx, xEy] = projectIso([axLen, 0, 0]);
            const [yEx, yEy] = projectIso([0, axLen, 0]);
            const [zEx, zEy] = projectIso([0, 0, axLen]);
            return /* @__PURE__ */ jsxs("g", { children: [
              lines,
              boxEdges,
              /* @__PURE__ */ jsxs("g", { strokeWidth: 1.5, children: [
                /* @__PURE__ */ jsx("line", { x1: ox, y1: oy, x2: xEx, y2: xEy, stroke: "#dc2626" }),
                /* @__PURE__ */ jsx("line", { x1: ox, y1: oy, x2: yEx, y2: yEy, stroke: "#16a34a" }),
                /* @__PURE__ */ jsx("line", { x1: ox, y1: oy, x2: zEx, y2: zEy, stroke: "#2563eb" })
              ] }),
              /* @__PURE__ */ jsx("text", { x: xEx + 4, y: xEy + 4, fill: "#f87171", fontSize: 11, fontFamily: "monospace", fontWeight: "bold", children: "X" }),
              /* @__PURE__ */ jsx("text", { x: yEx + 4, y: yEy + 4, fill: "#4ade80", fontSize: 11, fontFamily: "monospace", fontWeight: "bold", children: "Y" }),
              /* @__PURE__ */ jsx("text", { x: zEx + 4, y: zEy - 2, fill: "#60a5fa", fontSize: 11, fontFamily: "monospace", fontWeight: "bold", children: "Z" })
            ] });
          })(),
          isIso && positions.map((p, i) => {
            const [wx, wy, wz] = p;
            if (wz < 0.5) return null;
            const [jsx2, jsy] = projectIso([wx, wy, wz]);
            const [fsx, fsy] = projectIso([wx, wy, 0]);
            return /* @__PURE__ */ jsxs("g", { children: [
              /* @__PURE__ */ jsx(
                "line",
                {
                  x1: jsx2,
                  y1: jsy,
                  x2: fsx,
                  y2: fsy,
                  stroke: "#334155",
                  strokeWidth: 0.8,
                  strokeDasharray: "2 3"
                }
              ),
              /* @__PURE__ */ jsx(
                "ellipse",
                {
                  cx: fsx,
                  cy: fsy,
                  rx: 4,
                  ry: 1.6,
                  fill: "#0b1220",
                  stroke: "#334155",
                  strokeWidth: 0.8
                }
              )
            ] }, `drop-${i}`);
          }),
          positions.length >= 2 && positions.slice(0, -1).map((from, i) => {
            const to = positions[i + 1];
            const [fx, fy] = projectWorld(from);
            const [tx, ty] = projectWorld(to);
            const dx = tx - fx;
            const dy = ty - fy;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len < 0.5) return null;
            const ux = dx / len;
            const uy = dy / len;
            const perpX = -uy;
            const perpY = ux;
            const r = Math.min(len * 0.16, 14);
            const topX = fx + perpX * r;
            const topY = fy + perpY * r;
            const botX = fx - perpX * r;
            const botY = fy - perpY * r;
            const d = `M ${topX} ${topY} A ${r} ${r} 0 0 1 ${botX} ${botY} L ${tx} ${ty} Z`;
            return /* @__PURE__ */ jsx(
              "path",
              {
                d,
                fill: armColor,
                fillOpacity: 0.18,
                stroke: armColor,
                strokeWidth: 1.5,
                strokeLinejoin: "round"
              },
              `bone-${i}`
            );
          }),
          positions.map((p, i) => {
            const [sx, sy] = projectWorld(p);
            const isEnd = i === positions.length - 1;
            return /* @__PURE__ */ jsx(
              "circle",
              {
                cx: sx,
                cy: sy,
                r: isEnd ? 5 : 4,
                fill: isEnd ? armColor : "#0f172a",
                stroke: armColor,
                strokeWidth: 2
              },
              `joint-${i}`
            );
          }),
          path && (() => {
            const [bx, by] = projectWorld(path.begin);
            const [ex, ey] = projectWorld(path.end);
            return /* @__PURE__ */ jsxs("g", { children: [
              /* @__PURE__ */ jsx(
                "line",
                {
                  x1: bx,
                  y1: by,
                  x2: ex,
                  y2: ey,
                  stroke: "#38bdf8",
                  strokeWidth: 1.5,
                  strokeDasharray: "4 3"
                }
              ),
              path.samples.map((p, i) => {
                const [sx, sy] = projectWorld(p);
                const isCur = path.currentIndex === i;
                return /* @__PURE__ */ jsx(
                  "circle",
                  {
                    cx: sx,
                    cy: sy,
                    r: isCur ? 4 : 2,
                    fill: isCur ? "#38bdf8" : "#0f172a",
                    stroke: "#38bdf8",
                    strokeWidth: 1.5
                  },
                  `pwp-${i}`
                );
              })
            ] });
          })(),
          (() => {
            const [tx, ty] = projectWorld([target.x, target.y, target.z]);
            const targetColor = status === "reachable" ? "#10b981" : "#f59e0b";
            return /* @__PURE__ */ jsxs("g", { stroke: targetColor, strokeWidth: 2, children: [
              /* @__PURE__ */ jsx("line", { x1: tx - 6, y1: ty - 6, x2: tx + 6, y2: ty + 6 }),
              /* @__PURE__ */ jsx("line", { x1: tx - 6, y1: ty + 6, x2: tx + 6, y2: ty - 6 })
            ] });
          })(),
          /* @__PURE__ */ jsxs("g", { children: [
            /* @__PURE__ */ jsx(
              "line",
              {
                x1: W - 110,
                y1: H - 8,
                x2: W - 110 + 100 * pxPerMm,
                y2: H - 8,
                stroke: "#64748b",
                strokeWidth: 1
              }
            ),
            /* @__PURE__ */ jsx("text", { x: W - 110, y: H - 12, fill: "#64748b", fontSize: 9, fontFamily: "monospace", children: "100mm" })
          ] })
        ]
      }
    )
  ] });
}
function IKSolverFullView({ proxy }) {
  const wsClient = useWsClient();
  const proxyId = proxy.id ?? proxy.name ?? "";
  const stateTopic = `/ik_solver/${proxyId}/state`;
  const solutionTopic = `/ik_solver/${proxyId}/solution`;
  const controlTopic = `/ik_solver/${proxyId}/control`;
  const [state, setState] = useState({});
  const [tx, setTx] = useState(200);
  const [ty, setTy] = useState(0);
  const [tz, setTz] = useState(100);
  const ISO_DEFAULT_AZ = 45;
  const ISO_DEFAULT_EL = 35.264;
  const [isoAz, setIsoAz] = useState(ISO_DEFAULT_AZ);
  const [isoEl, setIsoEl] = useState(ISO_DEFAULT_EL);
  const onIsoCameraChange = useCallback((az, el) => {
    setIsoAz(az);
    setIsoEl(el);
  }, []);
  const onIsoCameraReset = useCallback(() => {
    setIsoAz(ISO_DEFAULT_AZ);
    setIsoEl(ISO_DEFAULT_EL);
  }, []);
  useEffect(() => {
    if (!proxyId) return;
    const offState = wsClient.subscribe(stateTopic, (f) => {
      if (f.method !== "message") return;
      setState(f.payload);
    });
    const offSol = wsClient.subscribe(solutionTopic, (f) => {
      if (f.method !== "message") return;
      const sol2 = f.payload;
      setState((prev) => ({ ...prev, last_solution: sol2, last_target: sol2.target ?? prev.last_target }));
    });
    return () => {
      offState();
      offSol();
    };
  }, [proxyId, stateTopic, solutionTopic, wsClient]);
  const [draftPopulated, setDraftPopulated] = useState(false);
  useEffect(() => {
    if (draftPopulated) return;
    const t = state.last_target;
    if (t) {
      setTx(t.x);
      setTy(t.y);
      setTz(t.z);
      setDraftPopulated(true);
    }
  }, [state.last_target, draftPopulated]);
  const [servoProxies, setServoProxies] = useState({});
  useEffect(() => {
    const off = wsClient.subscribe("/servo/+/state", (f) => {
      if (f.method !== "message") return;
      const m = (f.topic ?? "").match(/^\/servo\/([^/]+)\/state$/);
      if (!m) return;
      const id = m[1];
      const p = f.payload ?? {};
      setServoProxies((prev) => ({
        ...prev,
        [id]: {
          connected: !!p.attached,
          angle: typeof p.current_angle === "number" ? p.current_angle : p.angle
        }
      }));
    });
    return off;
  }, [wsClient]);
  const solveReq = useServiceRequest(controlTopic, {
    timeoutMs: 5e3,
    errorField: "reason",
    replyPrefix: `ik-${proxyId}-solve`
  });
  const sendReq = useServiceRequest(controlTopic, {
    timeoutMs: 3e3,
    errorField: "reason",
    replyPrefix: `ik-${proxyId}-send`
  });
  const setModelReq = useServiceRequest(controlTopic, {
    timeoutMs: 5e3,
    errorField: "reason",
    replyPrefix: `ik-${proxyId}-model`
  });
  const setCalReq = useServiceRequest(controlTopic, {
    timeoutMs: 4e3,
    errorField: "reason",
    replyPrefix: `ik-${proxyId}-cal`
  });
  const libReq = useServiceRequest(controlTopic, {
    timeoutMs: 6e3,
    errorField: "reason",
    replyPrefix: `ik-${proxyId}-lib`
  });
  const [models, setModels] = useState([]);
  const [libError, setLibError] = useState(null);
  const [saveId, setSaveId] = useState("");
  const [saveTitle, setSaveTitle] = useState("");
  const [saveIncludePose, setSaveIncludePose] = useState(true);
  const [poseName, setPoseName] = useState("");
  const refreshModels = useCallback(async () => {
    try {
      const r = await libReq.request("list_models");
      setModels(r?.models ?? []);
      setLibError(null);
    } catch (e) {
      setLibError(String(e?.message ?? e));
    }
  }, [libReq]);
  useEffect(() => {
    void refreshModels();
  }, [proxyId]);
  const onLoadModel = useCallback(async (id) => {
    try {
      await libReq.request("load_model", { id });
      setModelInitialised(false);
      setCalInitialised(false);
      await refreshModels();
    } catch (e) {
      setLibError(String(e?.message ?? e));
    }
  }, [libReq, refreshModels]);
  const onSaveToLibrary = useCallback(async () => {
    const id = saveId.trim();
    if (!id) return;
    try {
      await libReq.request("save_model", {
        id,
        title: saveTitle.trim() || void 0,
        include_current_pose: saveIncludePose
      });
      setSaveId("");
      setSaveTitle("");
      await refreshModels();
    } catch (e) {
      setLibError(String(e?.message ?? e));
    }
  }, [libReq, saveId, saveTitle, saveIncludePose, refreshModels]);
  const onDeleteModel = useCallback(async (id) => {
    try {
      await libReq.request("delete_model", { id });
      await refreshModels();
    } catch (e) {
      setLibError(String(e?.message ?? e));
    }
  }, [libReq, refreshModels]);
  const onExportModel = useCallback(async (id) => {
    try {
      const m = await libReq.request("export_model", id ? { id } : {});
      downloadJson(`${id || m?.id || "model"}.json`, m);
    } catch (e) {
      setLibError(String(e?.message ?? e));
    }
  }, [libReq]);
  const onCapturePose = useCallback(async () => {
    const name = poseName.trim();
    if (!name) return;
    try {
      await libReq.request("save_pose", { name });
      setPoseName("");
    } catch (e) {
      setLibError(String(e?.message ?? e));
    }
  }, [libReq, poseName]);
  const onApplyPose = useCallback(async (name) => {
    try {
      await libReq.request("apply_pose", { name });
    } catch (e) {
      setLibError(String(e?.message ?? e));
    }
  }, [libReq]);
  const onDeletePose = useCallback(async (name) => {
    try {
      await libReq.request("delete_pose", { name });
    } catch (e) {
      setLibError(String(e?.message ?? e));
    }
  }, [libReq]);
  const bundledModels = useMemo(() => models.filter((m) => m.root === "bundled"), [models]);
  const userModels = useMemo(() => models.filter((m) => m.root === "user"), [models]);
  const [draftJoints, setDraftJoints] = useState([]);
  const [draftLinks, setDraftLinks] = useState([]);
  const [modelInitialised, setModelInitialised] = useState(false);
  useEffect(() => {
    if (modelInitialised) return;
    if (state.joints && state.links) {
      setDraftJoints(state.joints.map((j) => ({ ...j })));
      setDraftLinks(state.links.map((l) => ({ ...l })));
      setModelInitialised(true);
    }
  }, [state.joints, state.links, modelInitialised]);
  const resyncModel = useCallback(() => {
    if (state.joints && state.links) {
      setDraftJoints(state.joints.map((j) => ({ ...j })));
      setDraftLinks(state.links.map((l) => ({ ...l })));
    }
  }, [state.joints, state.links]);
  const updateJointAt = useCallback((idx, patch) => {
    setDraftJoints((prev) => prev.map((j, i) => i === idx ? { ...j, ...patch } : j));
  }, []);
  const updateLinkAt = useCallback((idx, lengthMm) => {
    setDraftLinks((prev) => prev.map((l, i) => i === idx ? { ...l, length_mm: lengthMm } : l));
  }, []);
  const addJoint = useCallback(() => {
    setDraftJoints((prev) => {
      const n = prev.length;
      const proposedName = `joint${n}`;
      return [...prev, { name: proposedName, type: "revolute", min_deg: -150, max_deg: 150 }];
    });
    setDraftLinks((prev) => [...prev, { length_mm: 120 }]);
  }, []);
  const removeJointAt = useCallback((idx) => {
    setDraftJoints((prev) => prev.filter((_, i) => i !== idx));
    setDraftLinks((prev) => prev.filter((_, i) => i !== idx - 1));
  }, []);
  const modelError = useMemo(() => {
    if (draftJoints.length === 0) return "at least one joint required";
    const baseIdx = draftJoints.findIndex((j) => j.name === "base");
    if (baseIdx === -1) return 'first joint must be named "base"';
    if (baseIdx !== 0) return '"base" must be the first joint';
    const names = /* @__PURE__ */ new Set();
    for (const j of draftJoints) {
      const n = (j.name ?? "").trim();
      if (!n) return "joint name cannot be empty";
      if (names.has(n)) return `duplicate joint name: ${n}`;
      names.add(n);
      const lo = j.min_deg ?? -180;
      const hi = j.max_deg ?? 180;
      if (lo > hi) return `joint "${n}": min (${lo}) > max (${hi})`;
    }
    const expectedLinks = draftJoints.length - 1;
    if (draftLinks.length !== expectedLinks) {
      return `expected ${expectedLinks} link(s), have ${draftLinks.length}`;
    }
    for (let i = 0; i < draftLinks.length; i++) {
      const len = draftLinks[i].length_mm;
      if (!(len > 0)) return `link ${i + 1} length must be > 0 (got ${len})`;
    }
    return null;
  }, [draftJoints, draftLinks]);
  const modelDirty = useMemo(() => {
    if (!state.joints || !state.links) return false;
    if (state.joints.length !== draftJoints.length) return true;
    if (state.links.length !== draftLinks.length) return true;
    for (let i = 0; i < draftJoints.length; i++) {
      const a = state.joints[i];
      const b = draftJoints[i];
      if (a.name !== b.name) return true;
      if ((a.min_deg ?? -180) !== (b.min_deg ?? -180)) return true;
      if ((a.max_deg ?? 180) !== (b.max_deg ?? 180)) return true;
    }
    for (let i = 0; i < draftLinks.length; i++) {
      if (state.links[i].length_mm !== draftLinks[i].length_mm) return true;
    }
    return false;
  }, [state.joints, state.links, draftJoints, draftLinks]);
  const onSaveModel = useCallback(async () => {
    if (modelError || !modelDirty || setModelReq.inFlight) return;
    await setModelReq.request("set_model", {
      joints: draftJoints.map((j) => ({
        name: j.name,
        type: j.type ?? "revolute",
        min_deg: j.min_deg ?? -180,
        max_deg: j.max_deg ?? 180
      })),
      links: draftLinks.map((l) => ({ length_mm: l.length_mm }))
    });
  }, [modelError, modelDirty, setModelReq, draftJoints, draftLinks]);
  const [draftCal, setDraftCal] = useState([]);
  const [calInitialised, setCalInitialised] = useState(false);
  useEffect(() => {
    if (calInitialised) return;
    if (state.calibration) {
      setDraftCal(state.calibration.map((c) => ({ ...c })));
      setCalInitialised(true);
    }
  }, [state.calibration, calInitialised]);
  const resyncCal = useCallback(() => {
    if (state.calibration) setDraftCal(state.calibration.map((c) => ({ ...c })));
  }, [state.calibration]);
  const updateCalAt = useCallback((joint, patch) => {
    setDraftCal((prev) => prev.map((c) => c.joint === joint ? { ...c, ...patch } : c));
  }, []);
  const calError = useMemo(() => {
    for (const c of draftCal) {
      const s = c.scale ?? 1;
      if (!Number.isFinite(s) || s === 0) return `joint "${c.joint}": scale must be non-zero`;
      const lo = c.servo_min_deg ?? 0;
      const hi = c.servo_max_deg ?? 180;
      if (lo > hi) return `joint "${c.joint}": servo min (${lo}) > max (${hi})`;
    }
    return null;
  }, [draftCal]);
  const dirtyCalJoints = useMemo(() => {
    const out = /* @__PURE__ */ new Set();
    const baseline = new Map((state.calibration ?? []).map((c) => [c.joint, c]));
    for (const d of draftCal) {
      const b = baseline.get(d.joint);
      if (!b) {
        out.add(d.joint);
        continue;
      }
      if ((b.zero_offset_deg ?? 0) !== (d.zero_offset_deg ?? 0)) {
        out.add(d.joint);
        continue;
      }
      if ((b.direction ?? 1) !== (d.direction ?? 1)) {
        out.add(d.joint);
        continue;
      }
      if ((b.scale ?? 1) !== (d.scale ?? 1)) {
        out.add(d.joint);
        continue;
      }
      if ((b.servo_min_deg ?? 0) !== (d.servo_min_deg ?? 0)) {
        out.add(d.joint);
        continue;
      }
      if ((b.servo_max_deg ?? 180) !== (d.servo_max_deg ?? 180)) {
        out.add(d.joint);
        continue;
      }
    }
    return out;
  }, [state.calibration, draftCal]);
  const onSaveCal = useCallback(async () => {
    if (calError || dirtyCalJoints.size === 0 || setCalReq.inFlight) return;
    for (const joint of dirtyCalJoints) {
      const c = draftCal.find((x) => x.joint === joint);
      if (!c) continue;
      await setCalReq.request("set_calibration", {
        joint,
        zero_offset_deg: c.zero_offset_deg ?? 0,
        direction: c.direction ?? 1,
        scale: c.scale ?? 1,
        servo_min_deg: c.servo_min_deg ?? 0,
        servo_max_deg: c.servo_max_deg ?? 180
      });
    }
  }, [calError, dirtyCalJoints, setCalReq, draftCal]);
  const currentAnglesRef = useRef({});
  const onSolve = useCallback((e) => {
    e?.preventDefault();
    if (solveReq.inFlight) return;
    void solveReq.request("solve", {
      target: { x: tx, y: ty, z: tz },
      // The hint biases the analytic branch selection + numerical
      // seed toward the current pose, so a solve for "the point I'm
      // already at" returns the same joint config rather than
      // teleporting the servos to a mirror configuration.
      current_angles: currentAnglesRef.current
    });
  }, [tx, ty, tz, solveReq]);
  const onSend = useCallback(() => {
    if (sendReq.inFlight) return;
    void sendReq.request("send_to_servos");
  }, [sendReq]);
  const [bx, setBx] = useState(200);
  const [by, setBy] = useState(-100);
  const [bz, setBz] = useState(100);
  const [ex, setEx] = useState(200);
  const [ey, setEy] = useState(100);
  const [ez, setEz] = useState(100);
  const [pathSteps, setPathSteps] = useState(10);
  const [pathDelayMs, setPathDelayMs] = useState(300);
  const [playing, setPlaying] = useState(false);
  const [playIndex, setPlayIndex] = useState(null);
  const [pathError, setPathError] = useState(null);
  const abortRef = useRef(false);
  const pathSamples = useMemo(() => {
    const n = Math.max(2, Math.min(200, Math.floor(pathSteps)));
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      out.push([
        bx + (ex - bx) * t,
        by + (ey - by) * t,
        bz + (ez - bz) * t
      ]);
    }
    return out;
  }, [bx, by, bz, ex, ey, ez, pathSteps]);
  const onUseCurrentAsBegin = useCallback(() => {
    setBx(tx);
    setBy(ty);
    setBz(tz);
  }, [tx, ty, tz]);
  const onUseCurrentAsEnd = useCallback(() => {
    setEx(tx);
    setEy(ty);
    setEz(tz);
  }, [tx, ty, tz]);
  const onPlay = useCallback(async () => {
    if (playing) return;
    abortRef.current = false;
    setPlaying(true);
    setPathError(null);
    try {
      for (let i = 0; i < pathSamples.length; i++) {
        if (abortRef.current) break;
        setPlayIndex(i);
        const [px, py, pz] = pathSamples[i];
        setTx(px);
        setTy(py);
        setTz(pz);
        const reply = await solveReq.request("solve", {
          target: { x: px, y: py, z: pz },
          current_angles: currentAnglesRef.current
        });
        if (abortRef.current) break;
        if (!reply || !reply.reachable) {
          setPathError(reply?.detail ?? reply?.reason ?? "step unreachable");
          break;
        }
        const angles = {};
        for (const [name, entry] of Object.entries(reply.joint_angles ?? {})) {
          angles[name] = typeof entry === "object" && entry && "math" in entry ? entry.math : entry;
        }
        if (Object.keys(angles).length > 0) {
          await sendReq.request("send_to_servos", { joint_angles: angles });
          if (abortRef.current) break;
        }
        if (i < pathSamples.length - 1) {
          await new Promise((res) => setTimeout(res, Math.max(0, pathDelayMs)));
        }
      }
    } finally {
      setPlaying(false);
      setPlayIndex(null);
    }
  }, [playing, pathSamples, pathDelayMs, solveReq, sendReq]);
  const onStop = useCallback(() => {
    abortRef.current = true;
  }, []);
  const sendAction = useCallback((payload) => {
    wsClient.publish(controlTopic, payload);
  }, [controlTopic, wsClient]);
  const onLink = useCallback((joint, proxyIdLink) => {
    sendAction({ action: "link_servo", joint, proxy_id: proxyIdLink });
  }, [sendAction]);
  const onUnlink = useCallback((joint) => {
    sendAction({ action: "unlink_servo", joint });
  }, [sendAction]);
  const onAutoFit = useCallback(async (joint, direction) => {
    const res = await setCalReq.request(
      "auto_calibrate",
      direction === void 0 ? { joint } : { joint, direction }
    );
    const cals = res?.calibration;
    if (Array.isArray(cals)) setDraftCal(cals.map((c) => ({ ...c })));
  }, [setCalReq]);
  const joints = state.joints ?? [];
  const links = state.links ?? [];
  const calibration = state.calibration ?? [];
  const maxReach = state.max_reach_mm ?? 340;
  const minReach = state.min_reach_mm ?? 20;
  const sol = state.last_solution ?? null;
  const liveAngles = useMemo(() => {
    const out = {};
    for (const c of calibration) {
      if (!c.servo_proxy_id) continue;
      const sp = servoProxies[c.servo_proxy_id];
      if (!sp || typeof sp.angle !== "number") continue;
      const dir = c.direction ?? 1;
      const scale = c.scale ?? 1;
      const offset = c.zero_offset_deg ?? 0;
      const denom = dir * scale;
      if (denom === 0) continue;
      out[c.joint] = (sp.angle - offset) / denom;
    }
    return out;
  }, [calibration, servoProxies]);
  const currentAngles = useMemo(() => {
    const out = {};
    for (const j of joints) {
      if (j.name in liveAngles) {
        out[j.name] = liveAngles[j.name];
        continue;
      }
      const entry = sol?.joint_angles?.[j.name];
      out[j.name] = entry ? entry.math : 0;
    }
    return out;
  }, [joints, liveAngles, sol]);
  useEffect(() => {
    currentAnglesRef.current = currentAngles;
  }, [currentAngles]);
  const liveCount = Object.keys(liveAngles).length;
  const linkedCount = calibration.filter((c) => !!c.servo_proxy_id).length;
  const positions = useMemo(
    () => jointWorldPositions(joints, links, currentAngles),
    [joints, links, currentAngles]
  );
  const projectionStatus = sol === null ? "idle" : sol.reachable ? "reachable" : "unreachable";
  const availableServoIds = useMemo(
    () => Object.keys(servoProxies).sort(),
    [servoProxies]
  );
  const anyLinked = calibration.some((c) => !!c.servo_proxy_id);
  const canSend = projectionStatus === "reachable" && anyLinked;
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: "flex h-full min-w-[1440px] flex-col gap-3 p-3 text-xs",
      onPointerDown: (e) => e.stopPropagation(),
      children: [
        /* @__PURE__ */ jsxs("section", { className: "rounded border border-slate-800 bg-slate-900/40 p-2", children: [
          /* @__PURE__ */ jsxs("div", { className: "mb-1 flex items-center justify-between", children: [
            /* @__PURE__ */ jsx("span", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: "Model Library" }),
            /* @__PURE__ */ jsxs("span", { className: "font-mono text-[10px] text-slate-400", children: [
              state.model_title || state.model_id || "unsaved model",
              state.model_source ? /* @__PURE__ */ jsxs("span", { className: "ml-1 text-slate-600", children: [
                "· ",
                state.model_source
              ] }) : null
            ] })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "flex flex-wrap gap-4", children: [
            /* @__PURE__ */ jsxs("div", { className: "min-w-[220px] flex-1", children: [
              /* @__PURE__ */ jsx("div", { className: "mb-1 text-[9px] uppercase tracking-wider text-sky-300", children: "Examples" }),
              /* @__PURE__ */ jsxs("ul", { className: "space-y-1", children: [
                bundledModels.length === 0 && /* @__PURE__ */ jsx("li", { className: "text-[10px] text-slate-600", children: "none bundled" }),
                bundledModels.map((m) => /* @__PURE__ */ jsxs("li", { className: "flex items-center justify-between gap-2 rounded border border-slate-800 bg-slate-950 px-2 py-1", children: [
                  /* @__PURE__ */ jsxs("span", { className: "min-w-0 truncate", children: [
                    /* @__PURE__ */ jsx("span", { className: "truncate text-slate-200", children: m.title }),
                    /* @__PURE__ */ jsxs("span", { className: "ml-1 font-mono text-[9px] text-slate-500", children: [
                      m.id,
                      " · ",
                      m.joints ?? 0,
                      "j"
                    ] })
                  ] }),
                  /* @__PURE__ */ jsxs("span", { className: "flex shrink-0 gap-1", children: [
                    /* @__PURE__ */ jsx(
                      "button",
                      {
                        type: "button",
                        onClick: () => void onLoadModel(m.id),
                        disabled: libReq.inFlight,
                        onPointerDown: (e) => e.stopPropagation(),
                        className: "nodrag nopan rounded bg-sky-600 px-1.5 py-0.5 text-[10px] text-white hover:bg-sky-500 disabled:opacity-50",
                        children: "Load"
                      }
                    ),
                    /* @__PURE__ */ jsx(
                      "button",
                      {
                        type: "button",
                        onClick: () => void onExportModel(m.id),
                        title: "Download JSON",
                        onPointerDown: (e) => e.stopPropagation(),
                        className: "nodrag nopan rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500",
                        children: "↓"
                      }
                    )
                  ] })
                ] }, m.id))
              ] })
            ] }),
            /* @__PURE__ */ jsxs("div", { className: "min-w-[220px] flex-1", children: [
              /* @__PURE__ */ jsx("div", { className: "mb-1 text-[9px] uppercase tracking-wider text-slate-400", children: "Your models" }),
              /* @__PURE__ */ jsxs("ul", { className: "space-y-1", children: [
                userModels.length === 0 && /* @__PURE__ */ jsx("li", { className: "text-[10px] text-slate-600", children: "none saved yet" }),
                userModels.map((m) => /* @__PURE__ */ jsxs("li", { className: "flex items-center justify-between gap-2 rounded border border-slate-800 bg-slate-950 px-2 py-1", children: [
                  /* @__PURE__ */ jsxs("span", { className: "min-w-0 truncate", children: [
                    /* @__PURE__ */ jsx("span", { className: "truncate text-slate-200", children: m.title }),
                    /* @__PURE__ */ jsxs("span", { className: "ml-1 font-mono text-[9px] text-slate-500", children: [
                      m.id,
                      " · ",
                      m.joints ?? 0,
                      "j"
                    ] })
                  ] }),
                  /* @__PURE__ */ jsxs("span", { className: "flex shrink-0 gap-1", children: [
                    /* @__PURE__ */ jsx(
                      "button",
                      {
                        type: "button",
                        onClick: () => void onLoadModel(m.id),
                        disabled: libReq.inFlight,
                        onPointerDown: (e) => e.stopPropagation(),
                        className: "nodrag nopan rounded bg-sky-600 px-1.5 py-0.5 text-[10px] text-white hover:bg-sky-500 disabled:opacity-50",
                        children: "Load"
                      }
                    ),
                    /* @__PURE__ */ jsx(
                      "button",
                      {
                        type: "button",
                        onClick: () => void onExportModel(m.id),
                        title: "Download JSON",
                        onPointerDown: (e) => e.stopPropagation(),
                        className: "nodrag nopan rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500",
                        children: "↓"
                      }
                    ),
                    /* @__PURE__ */ jsx(
                      "button",
                      {
                        type: "button",
                        onClick: () => void onDeleteModel(m.id),
                        title: "Delete",
                        onPointerDown: (e) => e.stopPropagation(),
                        className: "nodrag nopan rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-rose-300 hover:border-rose-500",
                        children: /* @__PURE__ */ jsx(Trash2, { className: "h-3 w-3" })
                      }
                    )
                  ] })
                ] }, m.id))
              ] })
            ] }),
            /* @__PURE__ */ jsxs("div", { className: "min-w-[220px] flex-1", children: [
              /* @__PURE__ */ jsx("div", { className: "mb-1 text-[9px] uppercase tracking-wider text-slate-400", children: "Save current model" }),
              /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-1", children: [
                /* @__PURE__ */ jsx(
                  "input",
                  {
                    value: saveId,
                    onChange: (e) => setSaveId(e.target.value),
                    placeholder: "id (a-z0-9_-)",
                    onPointerDown: (e) => e.stopPropagation(),
                    className: "nodrag nopan rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[11px]"
                  }
                ),
                /* @__PURE__ */ jsx(
                  "input",
                  {
                    value: saveTitle,
                    onChange: (e) => setSaveTitle(e.target.value),
                    placeholder: "title (optional)",
                    onPointerDown: (e) => e.stopPropagation(),
                    className: "nodrag nopan rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px]"
                  }
                ),
                /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-1 text-[10px] text-slate-400", children: [
                  /* @__PURE__ */ jsx(
                    "input",
                    {
                      type: "checkbox",
                      checked: saveIncludePose,
                      onChange: (e) => setSaveIncludePose(e.target.checked),
                      onPointerDown: (e) => e.stopPropagation(),
                      className: "nodrag nopan"
                    }
                  ),
                  "capture current pose as “home”"
                ] }),
                /* @__PURE__ */ jsxs(
                  "button",
                  {
                    type: "button",
                    onClick: () => void onSaveToLibrary(),
                    disabled: !saveId.trim() || libReq.inFlight,
                    onPointerDown: (e) => e.stopPropagation(),
                    className: "nodrag nopan flex items-center justify-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-[10px] text-white hover:bg-emerald-500 disabled:opacity-50",
                    children: [
                      libReq.inFlight && /* @__PURE__ */ jsx(Loader2, { className: "h-3 w-3 animate-spin" }),
                      " Save model"
                    ]
                  }
                )
              ] })
            ] }),
            /* @__PURE__ */ jsxs("div", { className: "min-w-[220px] flex-1", children: [
              /* @__PURE__ */ jsx("div", { className: "mb-1 text-[9px] uppercase tracking-wider text-slate-400", children: "Poses" }),
              /* @__PURE__ */ jsxs("ul", { className: "mb-1 space-y-1", children: [
                (state.poses ?? []).length === 0 && /* @__PURE__ */ jsx("li", { className: "text-[10px] text-slate-600", children: "no poses" }),
                (state.poses ?? []).map((p) => /* @__PURE__ */ jsxs("li", { className: "flex items-center justify-between gap-2 rounded border border-slate-800 bg-slate-950 px-2 py-1", children: [
                  /* @__PURE__ */ jsxs("span", { className: "min-w-0 truncate text-slate-200", children: [
                    p.name,
                    p.is_initial ? /* @__PURE__ */ jsx("span", { className: "ml-1 text-[9px] text-emerald-400", children: "(home)" }) : null
                  ] }),
                  /* @__PURE__ */ jsxs("span", { className: "flex shrink-0 gap-1", children: [
                    /* @__PURE__ */ jsx(
                      "button",
                      {
                        type: "button",
                        onClick: () => void onApplyPose(p.name),
                        onPointerDown: (e) => e.stopPropagation(),
                        className: "nodrag nopan rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500",
                        children: "Apply"
                      }
                    ),
                    /* @__PURE__ */ jsx(
                      "button",
                      {
                        type: "button",
                        onClick: () => void onDeletePose(p.name),
                        title: "Delete pose",
                        onPointerDown: (e) => e.stopPropagation(),
                        className: "nodrag nopan rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-rose-300 hover:border-rose-500",
                        children: /* @__PURE__ */ jsx(Trash2, { className: "h-3 w-3" })
                      }
                    )
                  ] })
                ] }, p.name))
              ] }),
              /* @__PURE__ */ jsxs("div", { className: "flex gap-1", children: [
                /* @__PURE__ */ jsx(
                  "input",
                  {
                    value: poseName,
                    onChange: (e) => setPoseName(e.target.value),
                    placeholder: "capture pose name",
                    onPointerDown: (e) => e.stopPropagation(),
                    className: "nodrag nopan min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px]"
                  }
                ),
                /* @__PURE__ */ jsx(
                  "button",
                  {
                    type: "button",
                    onClick: () => void onCapturePose(),
                    disabled: !poseName.trim(),
                    onPointerDown: (e) => e.stopPropagation(),
                    className: "nodrag nopan flex shrink-0 items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 disabled:opacity-50",
                    children: /* @__PURE__ */ jsx(Plus, { className: "h-3 w-3" })
                  }
                )
              ] })
            ] })
          ] }),
          libError && /* @__PURE__ */ jsx("div", { className: "mt-1 truncate font-mono text-[10px] text-rose-300", title: libError, children: libError })
        ] }),
        /* @__PURE__ */ jsxs("section", { className: "flex items-center justify-between gap-3 rounded border border-slate-800 bg-slate-900/40 px-2 py-1 font-mono text-[10px] text-slate-400", children: [
          /* @__PURE__ */ jsxs("span", { children: [
            joints.length,
            " joints · ",
            links.length,
            " links · max ",
            maxReach.toFixed(0),
            "mm · min ",
            minReach.toFixed(0),
            "mm"
          ] }),
          /* @__PURE__ */ jsxs("span", { className: "flex items-center gap-3", children: [
            linkedCount > 0 && /* @__PURE__ */ jsxs(
              "span",
              {
                className: liveCount === linkedCount ? "text-sky-300" : "text-slate-500",
                title: "Joints whose live servo position is driving the FK render. The arm visualisation prefers live servo data over the last IK solution.",
                children: [
                  "● tracking ",
                  liveCount,
                  "/",
                  linkedCount
                ]
              }
            ),
            sol && /* @__PURE__ */ jsx("span", { className: sol.reachable ? "text-emerald-300" : "text-amber-300", children: sol.reachable ? `● reachable, err ${(sol.position_error_mm ?? 0).toFixed(2)}mm` : `● ${sol.reason}` }),
            sol?.warnings && sol.warnings.length > 0 && /* @__PURE__ */ jsxs(
              "span",
              {
                className: "text-amber-300",
                title: sol.warnings.map((w) => `${w.kind}: ${w.detail}`).join("\n"),
                children: [
                  "⚠ ",
                  sol.warnings.length,
                  " warning",
                  sol.warnings.length === 1 ? "" : "s"
                ]
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ jsxs("section", { className: "flex flex-wrap items-start gap-3", children: [
          /* @__PURE__ */ jsxs("div", { className: "flex flex-col items-center gap-1", children: [
            /* @__PURE__ */ jsx(
              ArmProjection,
              {
                positions,
                target: { x: tx, y: ty, z: tz },
                axes: "iso",
                maxReachMm: maxReach,
                minReachMm: minReach,
                status: projectionStatus,
                path: { begin: [bx, by, bz], end: [ex, ey, ez], samples: pathSamples, currentIndex: playIndex },
                width: 1120,
                height: 880,
                isoCamera: { azDeg: isoAz, elDeg: isoEl },
                onIsoCameraChange
              }
            ),
            /* @__PURE__ */ jsx(
              "button",
              {
                type: "button",
                onClick: onIsoCameraReset,
                onPointerDown: (e) => e.stopPropagation(),
                title: "Reset iso camera to default angle",
                className: "nodrag nopan rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:border-slate-500",
                children: "reset view"
              }
            )
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-2", children: [
            /* @__PURE__ */ jsx(
              ArmProjection,
              {
                positions,
                target: { x: tx, y: ty, z: tz },
                axes: "xz",
                maxReachMm: maxReach,
                minReachMm: minReach,
                onClick: (x, z) => {
                  setTx(x);
                  setTz(z);
                },
                status: projectionStatus,
                path: { begin: [bx, by, bz], end: [ex, ey, ez], samples: pathSamples, currentIndex: playIndex }
              }
            ),
            /* @__PURE__ */ jsx(
              ArmProjection,
              {
                positions,
                target: { x: tx, y: ty, z: tz },
                axes: "xy",
                maxReachMm: maxReach,
                minReachMm: minReach,
                onClick: (x, y) => {
                  setTx(x);
                  setTy(y);
                },
                status: projectionStatus,
                path: { begin: [bx, by, bz], end: [ex, ey, ez], samples: pathSamples, currentIndex: playIndex }
              }
            ),
            /* @__PURE__ */ jsx(
              ArmProjection,
              {
                positions,
                target: { x: tx, y: ty, z: tz },
                axes: "yz",
                maxReachMm: maxReach,
                minReachMm: minReach,
                onClick: (y, z) => {
                  setTy(y);
                  setTz(z);
                },
                status: projectionStatus,
                path: { begin: [bx, by, bz], end: [ex, ey, ez], samples: pathSamples, currentIndex: playIndex }
              }
            ),
            (() => {
              const ee = positions[positions.length - 1];
              if (!ee) return null;
              const [eex, eey, eez] = ee;
              return /* @__PURE__ */ jsxs("div", { className: "rounded border border-slate-800 bg-slate-900/40 px-2 py-1 font-mono text-[10px] text-slate-400", children: [
                /* @__PURE__ */ jsx("div", { className: "mb-0.5 text-[9px] uppercase tracking-wider text-slate-500", children: "end effector · live" }),
                /* @__PURE__ */ jsxs("div", { className: "flex justify-between gap-2 text-slate-300", children: [
                  /* @__PURE__ */ jsxs("span", { children: [
                    "x ",
                    /* @__PURE__ */ jsx("span", { className: "text-slate-100", children: eex.toFixed(1) })
                  ] }),
                  /* @__PURE__ */ jsxs("span", { children: [
                    "y ",
                    /* @__PURE__ */ jsx("span", { className: "text-slate-100", children: eey.toFixed(1) })
                  ] }),
                  /* @__PURE__ */ jsxs("span", { children: [
                    "z ",
                    /* @__PURE__ */ jsx("span", { className: "text-slate-100", children: eez.toFixed(1) })
                  ] }),
                  /* @__PURE__ */ jsx("span", { className: "text-slate-500", children: "mm" })
                ] })
              ] });
            })()
          ] })
        ] }),
        /* @__PURE__ */ jsxs("section", { className: "rounded border border-slate-800 bg-slate-900/40 p-2", children: [
          /* @__PURE__ */ jsxs("form", { onSubmit: onSolve, className: "flex flex-wrap items-end gap-2", children: [
            /* @__PURE__ */ jsxs("label", { className: "flex flex-col", children: [
              /* @__PURE__ */ jsx("span", { className: "mb-0.5 text-[10px] uppercase tracking-wider text-slate-500", children: "x (mm)" }),
              /* @__PURE__ */ jsx(
                NumberInput,
                {
                  value: tx,
                  step: 5,
                  onChange: setTx,
                  onPointerDown: (e) => e.stopPropagation(),
                  className: "nodrag nopan w-20 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[11px]"
                }
              )
            ] }),
            /* @__PURE__ */ jsxs("label", { className: "flex flex-col", children: [
              /* @__PURE__ */ jsx("span", { className: "mb-0.5 text-[10px] uppercase tracking-wider text-slate-500", children: "y (mm)" }),
              /* @__PURE__ */ jsx(
                NumberInput,
                {
                  value: ty,
                  step: 5,
                  onChange: setTy,
                  onPointerDown: (e) => e.stopPropagation(),
                  className: "nodrag nopan w-20 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[11px]"
                }
              )
            ] }),
            /* @__PURE__ */ jsxs("label", { className: "flex flex-col", children: [
              /* @__PURE__ */ jsx("span", { className: "mb-0.5 text-[10px] uppercase tracking-wider text-slate-500", children: "z (mm)" }),
              /* @__PURE__ */ jsx(
                NumberInput,
                {
                  value: tz,
                  step: 5,
                  onChange: setTz,
                  onPointerDown: (e) => e.stopPropagation(),
                  className: "nodrag nopan w-20 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[11px]"
                }
              )
            ] }),
            /* @__PURE__ */ jsxs(
              "button",
              {
                type: "submit",
                disabled: solveReq.inFlight,
                onPointerDown: (e) => e.stopPropagation(),
                className: "nodrag nopan inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40",
                children: [
                  solveReq.inFlight && /* @__PURE__ */ jsx(Loader2, { className: "h-3 w-3 animate-spin" }),
                  solveReq.inFlight ? "Solving…" : "Solve"
                ]
              }
            ),
            /* @__PURE__ */ jsxs(
              "button",
              {
                type: "button",
                onClick: onSend,
                disabled: !canSend || sendReq.inFlight,
                onPointerDown: (e) => e.stopPropagation(),
                title: !canSend ? "Reachable solution + at least one linked servo required" : "Fan out joint angles to linked servos",
                className: "nodrag nopan inline-flex items-center gap-1.5 rounded border border-sky-700 bg-sky-900/40 px-3 py-1 text-[11px] text-sky-200 hover:border-sky-500 disabled:cursor-not-allowed disabled:opacity-40",
                children: [
                  sendReq.inFlight && /* @__PURE__ */ jsx(Loader2, { className: "h-3 w-3 animate-spin" }),
                  sendReq.inFlight ? "Sending…" : "Send to servos"
                ]
              }
            )
          ] }),
          (solveReq.error || sendReq.error) && /* @__PURE__ */ jsx("div", { className: "mt-2 truncate font-mono text-[10px] text-rose-300", title: solveReq.error ?? sendReq.error ?? "", children: sol?.detail ?? solveReq.error ?? sendReq.error })
        ] }),
        /* @__PURE__ */ jsxs("section", { className: "rounded border border-slate-800 bg-slate-900/40 p-2", children: [
          /* @__PURE__ */ jsxs("div", { className: "mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500", children: [
            /* @__PURE__ */ jsx("span", { children: "path" }),
            playing && /* @__PURE__ */ jsxs("span", { className: "font-mono text-sky-300", children: [
              "step ",
              (playIndex ?? 0) + 1,
              "/",
              pathSamples.length
            ] })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "flex flex-wrap items-end gap-2", children: [
            /* @__PURE__ */ jsxs("div", { className: "flex items-end gap-1", children: [
              /* @__PURE__ */ jsx("span", { className: "mr-1 text-[10px] uppercase tracking-wider text-slate-500", children: "begin" }),
              [
                { label: "x", value: bx, set: setBx },
                { label: "y", value: by, set: setBy },
                { label: "z", value: bz, set: setBz }
              ].map(({ label, value, set }) => /* @__PURE__ */ jsxs("label", { className: "flex flex-col", children: [
                /* @__PURE__ */ jsx("span", { className: "mb-0.5 text-[9px] uppercase tracking-wider text-slate-500", children: label }),
                /* @__PURE__ */ jsx(
                  NumberInput,
                  {
                    value,
                    step: 5,
                    disabled: playing,
                    onChange: set,
                    onPointerDown: (e) => e.stopPropagation(),
                    className: "nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 font-mono text-[11px] disabled:opacity-50"
                  }
                )
              ] }, `b-${label}`)),
              /* @__PURE__ */ jsx(
                "button",
                {
                  type: "button",
                  disabled: playing,
                  onClick: onUseCurrentAsBegin,
                  onPointerDown: (e) => e.stopPropagation(),
                  title: "Copy current target into Begin",
                  className: "nodrag nopan rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 disabled:opacity-40",
                  children: "use ✕"
                }
              )
            ] }),
            /* @__PURE__ */ jsxs("div", { className: "flex items-end gap-1", children: [
              /* @__PURE__ */ jsx("span", { className: "mr-1 text-[10px] uppercase tracking-wider text-slate-500", children: "end" }),
              [
                { label: "x", value: ex, set: setEx },
                { label: "y", value: ey, set: setEy },
                { label: "z", value: ez, set: setEz }
              ].map(({ label, value, set }) => /* @__PURE__ */ jsxs("label", { className: "flex flex-col", children: [
                /* @__PURE__ */ jsx("span", { className: "mb-0.5 text-[9px] uppercase tracking-wider text-slate-500", children: label }),
                /* @__PURE__ */ jsx(
                  NumberInput,
                  {
                    value,
                    step: 5,
                    disabled: playing,
                    onChange: set,
                    onPointerDown: (e) => e.stopPropagation(),
                    className: "nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 font-mono text-[11px] disabled:opacity-50"
                  }
                )
              ] }, `e-${label}`)),
              /* @__PURE__ */ jsx(
                "button",
                {
                  type: "button",
                  disabled: playing,
                  onClick: onUseCurrentAsEnd,
                  onPointerDown: (e) => e.stopPropagation(),
                  title: "Copy current target into End",
                  className: "nodrag nopan rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 disabled:opacity-40",
                  children: "use ✕"
                }
              )
            ] }),
            /* @__PURE__ */ jsxs("label", { className: "flex flex-col", children: [
              /* @__PURE__ */ jsx("span", { className: "mb-0.5 text-[10px] uppercase tracking-wider text-slate-500", children: "steps" }),
              /* @__PURE__ */ jsx(
                NumberInput,
                {
                  value: pathSteps,
                  min: 2,
                  max: 200,
                  step: 1,
                  disabled: playing,
                  onChange: (n) => setPathSteps(Math.max(2, Math.min(200, Math.floor(n)))),
                  onPointerDown: (e) => e.stopPropagation(),
                  className: "nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 font-mono text-[11px] disabled:opacity-50"
                }
              )
            ] }),
            /* @__PURE__ */ jsxs("label", { className: "flex flex-col", children: [
              /* @__PURE__ */ jsx("span", { className: "mb-0.5 text-[10px] uppercase tracking-wider text-slate-500", children: "delay (ms)" }),
              /* @__PURE__ */ jsx(
                NumberInput,
                {
                  value: pathDelayMs,
                  min: 0,
                  step: 50,
                  disabled: playing,
                  onChange: (n) => setPathDelayMs(Math.max(0, Math.floor(n))),
                  onPointerDown: (e) => e.stopPropagation(),
                  className: "nodrag nopan w-20 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 font-mono text-[11px] disabled:opacity-50"
                }
              )
            ] }),
            !playing ? /* @__PURE__ */ jsxs(
              "button",
              {
                type: "button",
                onClick: onPlay,
                onPointerDown: (e) => e.stopPropagation(),
                title: anyLinked ? "Solve + send each interpolated sample to linked servos" : "Dry-run: solve along the path (no servos are linked, so no motion)",
                className: "nodrag nopan inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40",
                children: [
                  "Play",
                  !anyLinked && /* @__PURE__ */ jsx("span", { className: "opacity-70", children: " (dry-run)" })
                ]
              }
            ) : /* @__PURE__ */ jsxs(
              "button",
              {
                type: "button",
                onClick: onStop,
                onPointerDown: (e) => e.stopPropagation(),
                className: "nodrag nopan inline-flex items-center gap-1.5 rounded bg-rose-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-rose-500",
                children: [
                  /* @__PURE__ */ jsx(Loader2, { className: "h-3 w-3 animate-spin" }),
                  "Stop"
                ]
              }
            )
          ] }),
          pathError && /* @__PURE__ */ jsxs("div", { className: "mt-2 truncate font-mono text-[10px] text-amber-300", title: pathError, children: [
            "● aborted at step ",
            (playIndex ?? 0) + 1,
            ": ",
            pathError
          ] })
        ] }),
        /* @__PURE__ */ jsxs("section", { className: "w-fit rounded border border-slate-800 bg-slate-900/40 p-2", children: [
          /* @__PURE__ */ jsxs("div", { className: "mb-1 flex items-center justify-between gap-4 text-[10px] uppercase tracking-wider text-slate-500", children: [
            /* @__PURE__ */ jsx("span", { children: "model · joints + links" }),
            /* @__PURE__ */ jsxs("span", { className: "flex items-center gap-2", children: [
              modelError && /* @__PURE__ */ jsxs("span", { className: "font-mono text-rose-300", children: [
                "● ",
                modelError
              ] }),
              !modelError && modelDirty && /* @__PURE__ */ jsx("span", { className: "font-mono text-amber-300", children: "● unsaved changes" }),
              !modelError && !modelDirty && setModelReq.inFlight === false && /* @__PURE__ */ jsx("span", { className: "font-mono text-slate-500", children: "in sync" }),
              /* @__PURE__ */ jsxs(
                "button",
                {
                  type: "button",
                  onClick: (e) => {
                    e.stopPropagation();
                    resyncModel();
                  },
                  onPointerDown: (e) => e.stopPropagation(),
                  disabled: !modelDirty,
                  title: "Discard draft edits and reload from server",
                  className: "nodrag nopan inline-flex items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40",
                  children: [
                    /* @__PURE__ */ jsx(RotateCcw, { className: "h-3 w-3" }),
                    "reset"
                  ]
                }
              ),
              /* @__PURE__ */ jsxs(
                "button",
                {
                  type: "button",
                  onClick: (e) => {
                    e.stopPropagation();
                    void onSaveModel();
                  },
                  onPointerDown: (e) => e.stopPropagation(),
                  disabled: !!modelError || !modelDirty || setModelReq.inFlight,
                  title: modelError ?? (modelDirty ? "Commit model to the IK service (set_model)" : "No changes to save"),
                  className: "nodrag nopan inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40",
                  children: [
                    setModelReq.inFlight && /* @__PURE__ */ jsx(Loader2, { className: "h-3 w-3 animate-spin" }),
                    setModelReq.inFlight ? "saving…" : "save model"
                  ]
                }
              )
            ] })
          ] }),
          /* @__PURE__ */ jsxs("table", { className: "font-mono text-[11px]", children: [
            /* @__PURE__ */ jsx("thead", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: /* @__PURE__ */ jsxs("tr", { children: [
              /* @__PURE__ */ jsx("th", { className: "text-left", children: "name" }),
              /* @__PURE__ */ jsx("th", { className: "text-right", children: "min°" }),
              /* @__PURE__ */ jsx("th", { className: "text-right", children: "max°" }),
              /* @__PURE__ */ jsx("th", { className: "text-right", children: "length (mm)" }),
              /* @__PURE__ */ jsx("th", { className: "text-right pl-2", children: "math" }),
              /* @__PURE__ */ jsx("th", { className: "text-right", children: "servo" }),
              /* @__PURE__ */ jsx("th", { className: "text-left pl-3", children: "link" }),
              /* @__PURE__ */ jsx("th", { className: "w-6" })
            ] }) }),
            /* @__PURE__ */ jsx("tbody", { children: draftJoints.map((j, idx) => {
              const isBase = j.name === "base" || idx === 0;
              const a = sol?.joint_angles?.[j.name];
              const cal = calibration.find((c) => c.joint === j.name);
              const linked = !!cal?.servo_proxy_id;
              const linkIdx = idx - 1;
              const linkLen = linkIdx >= 0 ? draftLinks[linkIdx]?.length_mm ?? 0 : null;
              return /* @__PURE__ */ jsxs("tr", { className: "border-t border-slate-800", children: [
                /* @__PURE__ */ jsx("td", { className: "py-1", children: /* @__PURE__ */ jsx(
                  "input",
                  {
                    type: "text",
                    value: j.name,
                    readOnly: isBase,
                    onChange: (e) => updateJointAt(idx, { name: e.target.value }),
                    onPointerDown: (e) => e.stopPropagation(),
                    title: isBase ? "The base joint anchors the chain — name is locked" : "Joint name",
                    className: `nodrag nopan w-24 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 font-mono text-[11px] ${isBase ? "opacity-70 cursor-not-allowed" : ""}`
                  }
                ) }),
                /* @__PURE__ */ jsx("td", { className: "py-1 text-right", children: /* @__PURE__ */ jsx(
                  NumberInput,
                  {
                    value: j.min_deg ?? -180,
                    step: 5,
                    onChange: (n) => updateJointAt(idx, { min_deg: n }),
                    onPointerDown: (e) => e.stopPropagation(),
                    className: "nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-right font-mono text-[11px]"
                  }
                ) }),
                /* @__PURE__ */ jsx("td", { className: "py-1 text-right", children: /* @__PURE__ */ jsx(
                  NumberInput,
                  {
                    value: j.max_deg ?? 180,
                    step: 5,
                    onChange: (n) => updateJointAt(idx, { max_deg: n }),
                    onPointerDown: (e) => e.stopPropagation(),
                    className: "nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-right font-mono text-[11px]"
                  }
                ) }),
                /* @__PURE__ */ jsx("td", { className: "py-1 text-right", children: linkIdx < 0 ? /* @__PURE__ */ jsx("span", { className: "text-slate-600", children: "—" }) : /* @__PURE__ */ jsx(
                  NumberInput,
                  {
                    value: linkLen ?? 0,
                    step: 5,
                    min: 1,
                    onChange: (n) => updateLinkAt(linkIdx, n),
                    onPointerDown: (e) => e.stopPropagation(),
                    className: "nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-right font-mono text-[11px]"
                  }
                ) }),
                /* @__PURE__ */ jsx("td", { className: "py-1 pl-2 text-right text-slate-300", children: a ? `${a.math.toFixed(1)}°` : "—" }),
                /* @__PURE__ */ jsx("td", { className: "py-1 text-right text-slate-400", children: a ? `${a.servo.toFixed(1)}°` : "—" }),
                /* @__PURE__ */ jsx("td", { className: "py-1 pl-3", children: linked ? /* @__PURE__ */ jsxs(
                  "button",
                  {
                    type: "button",
                    onClick: (e) => {
                      e.stopPropagation();
                      onUnlink(j.name);
                    },
                    onPointerDown: (e) => e.stopPropagation(),
                    title: "Click to unlink",
                    className: "nodrag nopan rounded bg-emerald-900/60 px-1.5 py-0.5 text-[10px] text-emerald-200 hover:bg-rose-900/60 hover:text-rose-200",
                    children: [
                      "● ",
                      cal?.servo_proxy_id
                    ]
                  }
                ) : /* @__PURE__ */ jsxs(
                  "select",
                  {
                    value: "",
                    onChange: (e) => {
                      if (e.target.value) onLink(j.name, e.target.value);
                    },
                    onPointerDown: (e) => e.stopPropagation(),
                    onClick: (e) => e.stopPropagation(),
                    className: "nodrag nopan rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[10px]",
                    children: [
                      /* @__PURE__ */ jsx("option", { value: "", children: "○ unlinked" }),
                      availableServoIds.map((id) => /* @__PURE__ */ jsx("option", { value: id, children: id }, id))
                    ]
                  }
                ) }),
                /* @__PURE__ */ jsx("td", { className: "py-1 text-right", children: !isBase && /* @__PURE__ */ jsx(
                  "button",
                  {
                    type: "button",
                    onClick: (e) => {
                      e.stopPropagation();
                      removeJointAt(idx);
                    },
                    onPointerDown: (e) => e.stopPropagation(),
                    title: "Remove this joint (and its link)",
                    className: "nodrag nopan rounded p-1 text-slate-400 hover:bg-rose-900/40 hover:text-rose-300",
                    children: /* @__PURE__ */ jsx(Trash2, { className: "h-3 w-3" })
                  }
                ) })
              ] }, `joint-${idx}`);
            }) })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "mt-1 flex items-center justify-between", children: [
            /* @__PURE__ */ jsxs(
              "button",
              {
                type: "button",
                onClick: (e) => {
                  e.stopPropagation();
                  addJoint();
                },
                onPointerDown: (e) => e.stopPropagation(),
                title: "Append a new in-plane joint with a default-length follow-on link",
                className: "nodrag nopan inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:border-slate-500",
                children: [
                  /* @__PURE__ */ jsx(Plus, { className: "h-3 w-3" }),
                  "add joint"
                ]
              }
            ),
            setModelReq.error && /* @__PURE__ */ jsxs("span", { className: "truncate font-mono text-[10px] text-rose-300", title: setModelReq.error, children: [
              "● ",
              setModelReq.error
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("section", { className: "w-fit rounded border border-slate-800 bg-slate-900/40 p-2", children: [
          /* @__PURE__ */ jsxs("div", { className: "mb-1 flex items-center justify-between gap-4 text-[10px] uppercase tracking-wider text-slate-500", children: [
            /* @__PURE__ */ jsx("span", { children: "calibration · math° → servo°" }),
            /* @__PURE__ */ jsxs("span", { className: "flex items-center gap-2", children: [
              calError && /* @__PURE__ */ jsxs("span", { className: "font-mono text-rose-300", children: [
                "● ",
                calError
              ] }),
              !calError && dirtyCalJoints.size > 0 && /* @__PURE__ */ jsxs("span", { className: "font-mono text-amber-300", children: [
                "● ",
                dirtyCalJoints.size,
                " unsaved"
              ] }),
              !calError && dirtyCalJoints.size === 0 && /* @__PURE__ */ jsx("span", { className: "font-mono text-slate-500", children: "in sync" }),
              /* @__PURE__ */ jsxs(
                "button",
                {
                  type: "button",
                  onClick: (e) => {
                    e.stopPropagation();
                    resyncCal();
                  },
                  onPointerDown: (e) => e.stopPropagation(),
                  disabled: dirtyCalJoints.size === 0,
                  title: "Discard draft edits and reload from server",
                  className: "nodrag nopan inline-flex items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40",
                  children: [
                    /* @__PURE__ */ jsx(RotateCcw, { className: "h-3 w-3" }),
                    "reset"
                  ]
                }
              ),
              /* @__PURE__ */ jsxs(
                "button",
                {
                  type: "button",
                  onClick: (e) => {
                    e.stopPropagation();
                    void onSaveCal();
                  },
                  onPointerDown: (e) => e.stopPropagation(),
                  disabled: !!calError || dirtyCalJoints.size === 0 || setCalReq.inFlight,
                  title: calError ?? (dirtyCalJoints.size === 0 ? "No changes to save" : `Commit ${dirtyCalJoints.size} joint(s)`),
                  className: "nodrag nopan inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40",
                  children: [
                    setCalReq.inFlight && /* @__PURE__ */ jsx(Loader2, { className: "h-3 w-3 animate-spin" }),
                    setCalReq.inFlight ? "saving…" : "save calibration"
                  ]
                }
              )
            ] })
          ] }),
          /* @__PURE__ */ jsxs("table", { className: "font-mono text-[11px]", children: [
            /* @__PURE__ */ jsx("thead", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: /* @__PURE__ */ jsxs("tr", { children: [
              /* @__PURE__ */ jsx("th", { className: "text-left", children: "joint" }),
              /* @__PURE__ */ jsx("th", { className: "text-right pl-3", children: "dir" }),
              /* @__PURE__ */ jsx("th", { className: "text-right pl-3", children: "offset°" }),
              /* @__PURE__ */ jsx("th", { className: "text-right pl-3", children: "scale" }),
              /* @__PURE__ */ jsx("th", { className: "text-right pl-3", children: "servo min°" }),
              /* @__PURE__ */ jsx("th", { className: "text-right pl-3", children: "servo max°" }),
              /* @__PURE__ */ jsx("th", { className: "text-right pl-3", children: "cmd°" })
            ] }) }),
            /* @__PURE__ */ jsx("tbody", { children: draftCal.map((c) => {
              const dirty = dirtyCalJoints.has(c.joint);
              const live = sol?.joint_angles?.[c.joint];
              const dir = c.direction ?? 1;
              const scale = c.scale ?? 1;
              const offset = c.zero_offset_deg ?? 0;
              const cmdServo = live ? live.math * dir * scale + offset : null;
              const outOfRange = cmdServo !== null && (cmdServo < (c.servo_min_deg ?? 0) - 1e-3 || cmdServo > (c.servo_max_deg ?? 180) + 1e-3);
              return /* @__PURE__ */ jsxs(
                "tr",
                {
                  className: `border-t border-slate-800 ${dirty ? "bg-amber-900/10" : ""}`,
                  children: [
                    /* @__PURE__ */ jsx("td", { className: "py-1 pr-3 text-slate-300", children: /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1", children: [
                      /* @__PURE__ */ jsx("span", { className: "font-mono", children: c.joint }),
                      /* @__PURE__ */ jsx(
                        "button",
                        {
                          type: "button",
                          onClick: (e) => {
                            e.stopPropagation();
                            void onAutoFit(c.joint);
                          },
                          onPointerDown: (e) => e.stopPropagation(),
                          title: "Auto-fit: map the joint's math range onto the servo range",
                          className: "nodrag nopan rounded bg-sky-900/60 px-1 py-0.5 text-[9px] text-sky-200 hover:bg-sky-800/60",
                          children: "Auto"
                        }
                      ),
                      /* @__PURE__ */ jsx(
                        "button",
                        {
                          type: "button",
                          onClick: (e) => {
                            e.stopPropagation();
                            void onAutoFit(c.joint, (c.direction ?? 1) < 0 ? 1 : -1);
                          },
                          onPointerDown: (e) => e.stopPropagation(),
                          title: "Reverse servo direction and re-fit",
                          className: "nodrag nopan rounded border border-slate-700 px-1 py-0.5 text-[9px] text-slate-400 hover:border-slate-500",
                          children: "Flip"
                        }
                      )
                    ] }) }),
                    /* @__PURE__ */ jsx("td", { className: "py-1 pl-3 text-right", children: /* @__PURE__ */ jsxs(
                      "select",
                      {
                        value: String(c.direction ?? 1),
                        onChange: (e) => updateCalAt(c.joint, { direction: Number(e.target.value) }),
                        onPointerDown: (e) => e.stopPropagation(),
                        onClick: (e) => e.stopPropagation(),
                        title: "Sign flip — -1 for mirror-mounted servos",
                        className: "nodrag nopan rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[11px]",
                        children: [
                          /* @__PURE__ */ jsx("option", { value: "1", children: "+1" }),
                          /* @__PURE__ */ jsx("option", { value: "-1", children: "-1" })
                        ]
                      }
                    ) }),
                    /* @__PURE__ */ jsx("td", { className: "py-1 pl-3 text-right", children: /* @__PURE__ */ jsx(
                      NumberInput,
                      {
                        value: c.zero_offset_deg ?? 0,
                        step: 5,
                        onChange: (n) => updateCalAt(c.joint, { zero_offset_deg: n }),
                        onPointerDown: (e) => e.stopPropagation(),
                        title: "Servo angle when the joint is at math zero",
                        className: "nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-right font-mono text-[11px]"
                      }
                    ) }),
                    /* @__PURE__ */ jsx("td", { className: "py-1 pl-3 text-right", children: /* @__PURE__ */ jsx(
                      NumberInput,
                      {
                        value: c.scale ?? 1,
                        step: 0.1,
                        onChange: (n) => updateCalAt(c.joint, { scale: n }),
                        onPointerDown: (e) => e.stopPropagation(),
                        title: "Gear ratio — math° per servo° (1.0 = direct drive)",
                        className: "nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-right font-mono text-[11px]"
                      }
                    ) }),
                    /* @__PURE__ */ jsx("td", { className: "py-1 pl-3 text-right", children: /* @__PURE__ */ jsx(
                      NumberInput,
                      {
                        value: c.servo_min_deg ?? 0,
                        step: 5,
                        onChange: (n) => updateCalAt(c.joint, { servo_min_deg: n }),
                        onPointerDown: (e) => e.stopPropagation(),
                        title: "Physical lower bound of the linked servo",
                        className: "nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-right font-mono text-[11px]"
                      }
                    ) }),
                    /* @__PURE__ */ jsx("td", { className: "py-1 pl-3 text-right", children: /* @__PURE__ */ jsx(
                      NumberInput,
                      {
                        value: c.servo_max_deg ?? 180,
                        step: 5,
                        onChange: (n) => updateCalAt(c.joint, { servo_max_deg: n }),
                        onPointerDown: (e) => e.stopPropagation(),
                        title: "Physical upper bound of the linked servo",
                        className: "nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-right font-mono text-[11px]"
                      }
                    ) }),
                    /* @__PURE__ */ jsx(
                      "td",
                      {
                        className: `py-1 pl-3 text-right font-mono ${cmdServo === null ? "text-slate-600" : outOfRange ? "text-rose-300" : "text-slate-300"}`,
                        title: cmdServo === null ? "No solution yet — solve to see the commanded servo angle" : outOfRange ? `Would be commanded outside [${c.servo_min_deg ?? 0}, ${c.servo_max_deg ?? 180}]` : "Current commanded servo angle",
                        children: cmdServo === null ? "—" : `${cmdServo.toFixed(1)}°`
                      }
                    )
                  ]
                },
                `cal-${c.joint}`
              );
            }) })
          ] }),
          setCalReq.error && /* @__PURE__ */ jsxs("div", { className: "mt-1 truncate font-mono text-[10px] text-rose-300", title: setCalReq.error, children: [
            "● ",
            setCalReq.error
          ] })
        ] })
      ]
    }
  );
}
export {
  IKSolverFullView as default
};
