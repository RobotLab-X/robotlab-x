// IKSolverFullView — diagnostic console for the inverse-kinematics
// service. Two synchronised SVG projections of the arm (side XZ +
// top XY) + a target editor + a joint table.
//
// Rendering convention:
//   * Each SVG has its origin at world (0,0,0) — base of the arm.
//   * +X always points RIGHT.
//   * Side view: +Z points UP (the arm's vertical axis).
//   * Top view:  +Y points UP (down-the-table view, looking from above).
// Scale (mm → px) auto-fits so the full max-reach circle is visible
// with ~10% margin.
//
// Live data flow:
//   /ik_solver/<id>/state    — model + last_solution (retained snapshot)
//   /ik_solver/<id>/solution — non-retained, one event per solve()
//   /servo/+/state           — live current_angle per linked servo,
//                              fed into the FK-from-hardware path
//                              that drives the arm rendering when
//                              servos are tracking
// Direction of data flow:
//   IK  (planner): UI target → /control{solve} → joint_angles → /control{send_to_servos} → /servo/<id>/control
//   FK  (display): /servo/<id>/state → servo_to_math via calibration → live joint angles → arm rendering
// The arm visualisation prefers LIVE servo-derived angles (so you
// see where the arm actually is) and falls back to the most recent
// IK solution's angles when a joint has no live data. The IK target
// ✕ is the operator's intended endpoint regardless of mode.
//
// Action surface:
//   * Solve → publishes ``{action: solve, target: {x,y,z}, reply_to: ...}``
//   * Send → publishes ``{action: send_to_servos}`` (no payload → uses last solution)
//   * Click in either projection → sets target XY (top) or XZ (side)
//   * Joint table → unlink / pick servo dropdown
import {
  useCallback, useEffect, useMemo, useRef, useState,
  type FormEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent,
} from 'react'
import { Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react'

import { NumberInput } from '@rlx/ui'

import type { ServiceProxy } from '@rlx/ui'
import type { InboundFrame } from '@rlx/ui'
import { useWsClient } from '@rlx/ui'
import { useServiceRequest } from '@rlx/ui'


// ─── types matching the backend state shapes ─────────────────────────


interface JointSpec {
  name: string
  type?: string
  min_deg?: number
  max_deg?: number
}

interface LinkSpec {
  length_mm: number
}

interface JointCalibration {
  joint: string
  servo_proxy_id?: string | null
  zero_offset_deg?: number
  direction?: number
  /** Gear ratio — math° per servo°. Default 1.0 (direct drive). */
  scale?: number
  /** Physical lower bound of the linked servo, in servo degrees. */
  servo_min_deg?: number
  /** Physical upper bound of the linked servo, in servo degrees. */
  servo_max_deg?: number
}

interface JointAngles {
  [name: string]: { math: number; servo: number }
}

interface IKWarning {
  kind: string
  detail: string
}

interface IKSolution {
  reachable: boolean
  target?: { x: number; y: number; z: number }
  joint_angles?: JointAngles
  position_error_mm?: number
  reason?: string
  detail?: string
  warnings?: IKWarning[]
  ts?: number
}

interface Pose {
  name: string
  is_initial?: boolean
  angles?: Record<string, number>
}

interface IKState {
  joints?: JointSpec[]
  links?: LinkSpec[]
  calibration?: JointCalibration[]
  max_reach_mm?: number
  min_reach_mm?: number
  last_target?: { x: number; y: number; z: number } | null
  last_solution?: IKSolution | null
  position_tolerance_mm?: number
  // Model Library working state (P1/P2).
  model_id?: string | null
  model_title?: string | null
  model_source?: string | null
  poses?: Pose[]
  current_angles?: Record<string, number>
}

/** One row from the ``list_models`` action. */
interface ModelRow {
  id: string
  title: string
  source?: string
  root: 'bundled' | 'user'
  joints?: number
  pose_names?: string[]
}

/** Trigger a browser download of a JSON object. */
function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}


// ─── FK helper — mirrors the backend's fk.py so the UI can render
// the live arm without round-tripping a separate FK request ────────


function jointWorldPositions(
  joints: JointSpec[],
  links: LinkSpec[],
  anglesDeg: Record<string, number>,
): Array<[number, number, number]> {
  const baseRad = (anglesDeg['base'] ?? 0) * Math.PI / 180
  const inPlaneNames = joints.filter((j) => j.name !== 'base').map((j) => j.name)
  const inPlaneRad = inPlaneNames.map((n) => (anglesDeg[n] ?? 0) * Math.PI / 180)

  const positions: Array<[number, number, number]> = []
  positions.push([0, 0, 0])  // base
  if (joints.length > 1) positions.push([0, 0, 0])  // shoulder co-located

  let r = 0
  let z = 0
  let cum = 0
  for (let i = 0; i < links.length; i++) {
    if (i < inPlaneRad.length) cum += inPlaneRad[i]
    r += links[i].length_mm * Math.cos(cum)
    z += links[i].length_mm * Math.sin(cum)
    const x = r * Math.cos(baseRad)
    const y = r * Math.sin(baseRad)
    positions.push([x, y, z])
  }
  return positions
}


// ─── Arm projection (side or top) ────────────────────────────────────


interface ProjectionProps {
  /** Joint world positions (mm) — same shape as backend's joint_world_positions. */
  positions: Array<[number, number, number]>
  /** Target position (mm) — drawn as ✕ on the canvas. */
  target: { x: number; y: number; z: number }
  /** Which projection to render. Orthographic modes show two world
   *  axes with the first going RIGHT in the SVG and the second
   *  going UP. Isometric collapses all three world axes into one
   *  2D plane via standard 30° axonometric projection.
   *    'xz'  — side view   (looking from +Y), X right / Z up
   *    'xy'  — top view    (looking from +Z), X right / Y up
   *    'yz'  — front view  (looking from -X), Y right / Z up
   *    'iso' — isometric   (3D-ish, +X to lower-right, +Y to lower-left, +Z up)
   */
  axes: 'xz' | 'xy' | 'yz' | 'iso'
  maxReachMm: number
  minReachMm: number
  /** Click handler — yields the world coords corresponding to the click. */
  onClick?: (worldA: number, worldB: number) => void
  /** Optional motion path overlay. Drawn as a sky-blue line segment
   *  from ``begin`` to ``end`` with a small dot at each interpolated
   *  sample point + a filled circle at the current sample (the point
   *  the solver is at right now during playback). */
  path?: {
    begin: [number, number, number]
    end: [number, number, number]
    samples: Array<[number, number, number]>
    currentIndex?: number | null
  }
  /** ``'reachable'`` → emerald arm + green target dot. ``'unreachable'`` →
   *  amber target with dashed arm to the unreachable point. ``'idle'`` =
   *  no recent solve. */
  status: 'idle' | 'reachable' | 'unreachable'
  /** Canvas dimensions in CSS px. Defaults to 280×220 for orthos;
   *  caller passes 560×440 for the prominent iso panel. */
  width?: number
  height?: number
  /** Iso-only — orbital camera angles. ``azDeg`` rotates around
   *  world Z (yaw); ``elDeg`` tilts above horizontal (pitch, expected
   *  in [5°, 85°]). Defaults to the classic 45°/35.26° "(1,1,1)
   *  corner" view. */
  isoCamera?: { azDeg: number; elDeg: number }
  /** Iso-only — drag callback. Receives the new az/el after a drag
   *  step. Caller is responsible for clamping and persisting. */
  onIsoCameraChange?: (azDeg: number, elDeg: number) => void
}


function ArmProjection({
  positions, target, axes, maxReachMm, minReachMm, onClick, status, path,
  width, height, isoCamera, onIsoCameraChange,
}: ProjectionProps) {
  // Render at a configurable viewport — content scales to fit
  // max-reach. Orthos default to 280×220; the prominent iso panel
  // passes 1120×880 (4× linear, 16× area) so it dominates the page.
  const W = width ?? 280
  const H = height ?? 220
  const isIso = axes === 'iso'
  const camAzDeg = isoCamera?.azDeg ?? 45
  const camElDeg = isoCamera?.elDeg ?? 35.264   // arctan(1/√2) — classic "(1,1,1) corner"

  // Scale: 90% of the smaller dimension covers the full orthographic
  // reach span. Iso uses an orbital camera (see ``projectIso``); its
  // worst-case extent is roughly 2R horizontally + ~2R vertically at
  // any orientation, so it gets a slightly tighter scale.
  const orthoSpan = Math.max(2 * maxReachMm, 1)
  const orthoPxPerMm = Math.min(W, H) * 0.92 / orthoSpan
  const pxPerMm = isIso
    ? Math.min(W, H) * 0.42 / Math.max(maxReachMm, 1)
    : orthoPxPerMm
  // Origin position. Iso anchors slightly low so the +Z axis has
  // headroom; top view is dead-centre; side/front bias downward to
  // show the floor plane.
  const ox = W / 2
  const oy = axes === 'xy' ? H / 2 : isIso ? H * 0.62 : H * 0.78

  // ── Iso camera math ─────────────────────────────────────────────
  // Standard orbital camera: rotate world by -az around Z, then tilt
  // by -el around the camera-right axis, then project. The screen-x
  // axis is camera-right (horizontal in world after rotation), and
  // screen-y is the world-up component foreshortened by elevation.
  //
  //   screen_x = wx·sin(az) − wy·cos(az)
  //   screen_y = −sin(el)·(wx·cos(az) + wy·sin(az)) + wz·cos(el)
  //
  // At default az=45°/el=35.26°, +X projects down-right, +Y down-
  // left, +Z straight up — matching the original 30° axonometric.
  const camAzRad = (camAzDeg * Math.PI) / 180
  const camElRad = (camElDeg * Math.PI) / 180
  const camSinAz = Math.sin(camAzRad)
  const camCosAz = Math.cos(camAzRad)
  const camSinEl = Math.sin(camElRad)
  const camCosEl = Math.cos(camElRad)

  const projectIso = (p: [number, number, number]): [number, number] => {
    const [wx, wy, wz] = p
    const sx = wx * camSinAz - wy * camCosAz
    const sy = -camSinEl * (wx * camCosAz + wy * camSinAz) + wz * camCosEl
    return [ox + sx * pxPerMm, oy - sy * pxPerMm]
  }

  /** World (x, y, z in mm) → SVG (sx, sy in px). */
  const projectWorld = (p: [number, number, number]): [number, number] => {
    if (isIso) return projectIso(p)
    // Orthographic. First letter of ``axes`` is the horizontal
    // (A), second is the vertical (B). SVG Y grows down so the
    // vertical contribution is negated.
    const [wx, wy, wz] = p
    const a = axes === 'yz' ? wy : wx
    const b = axes === 'xy' ? wy : wz
    return [ox + a * pxPerMm, oy - b * pxPerMm]
  }

  /** Inverse for click handlers — only defined for orthographic
   *  views. Iso click maps from 2D to a 3D ray, which is ambiguous;
   *  we use drag-to-orbit on iso instead of click-to-set-target. */
  const sToW = (sx: number, sy: number): [number, number] => [
    (sx - ox) / pxPerMm,
    (oy - sy) / pxPerMm,
  ]

  const armColor = status === 'reachable' ? '#10b981' : status === 'unreachable' ? '#f59e0b' : '#64748b'

  const onSvgClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (!onClick || isIso) return
    const rect = e.currentTarget.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const [wa, wb] = sToW(sx, sy)
    onClick(wa, wb)
  }

  // ── Iso drag-to-orbit ──────────────────────────────────────────
  // Pointer capture on the iso SVG: a drag updates az/el by 0.4° per
  // px. Elevation clamped to [5°, 85°] so the camera can't roll
  // through the floor or stare straight down. Mousewheel is reserved
  // for the canvas (zoom in/out), so drag is the only orbit input.
  const dragRef = useRef<{ x: number; y: number; az: number; el: number } | null>(null)
  const onIsoPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!isIso || !onIsoCameraChange) return
    e.stopPropagation()
    e.preventDefault()
    ;(e.currentTarget as SVGSVGElement).setPointerCapture?.(e.pointerId)
    dragRef.current = { x: e.clientX, y: e.clientY, az: camAzDeg, el: camElDeg }
  }
  const onIsoPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragRef.current || !onIsoCameraChange) return
    const dx = e.clientX - dragRef.current.x
    const dy = e.clientY - dragRef.current.y
    const sens = 0.4   // deg per px
    // ``+dy`` so that dragging UP on screen (dy < 0) DECREASES
    // elevation (camera tilts more horizontal; you see more of the
    // upper scene), and dragging DOWN increases elevation (looking
    // down on the scene from above). Inverted from the previous
    // convention; the user found "drag-down = view-up" backwards.
    const nextAz = dragRef.current.az + dx * sens
    const nextEl = Math.max(5, Math.min(85, dragRef.current.el + dy * sens))
    onIsoCameraChange(nextAz, nextEl)
  }
  const onIsoPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragRef.current) return
    ;(e.currentTarget as SVGSVGElement).releasePointerCapture?.(e.pointerId)
    dragRef.current = null
  }

  // Reachability guides — outer circle = max reach, inner = min reach.
  // For orthographic views the sphere projects to a circle of the
  // same radius. For iso it ALSO projects to a circle of the same
  // radius (parallel projection of a sphere is always its
  // silhouette circle) — so the same render works for all four.
  const outerR = maxReachMm * pxPerMm
  const innerR = minReachMm * pxPerMm

  // Floor plane line for side + front views.
  const floorY = oy

  return (
    <div className="flex flex-col items-center">
      <div className="mb-1 flex w-full justify-between text-[9px] uppercase tracking-wider text-slate-500">
        <span>
          {axes === 'xz' ? 'side view'
            : axes === 'xy' ? 'top view'
            : axes === 'yz' ? 'front view'
            : 'isometric view'}
        </span>
        <span className="font-mono">
          {axes === 'xz' ? 'X → / Z ↑'
            : axes === 'xy' ? 'X → / Y ↑'
            : axes === 'yz' ? 'Y → / Z ↑'
            : `drag to orbit · az ${Math.round(((camAzDeg % 360) + 360) % 360)}° / el ${Math.round(camElDeg)}°`}
        </span>
      </div>
      <svg
        width={W}
        height={H}
        onClick={onSvgClick}
        className={`rounded border border-slate-800 bg-slate-950 ${isIso ? (dragRef.current ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-crosshair'}`}
        onPointerDown={isIso ? onIsoPointerDown : (e) => e.stopPropagation()}
        onPointerMove={isIso ? onIsoPointerMove : undefined}
        onPointerUp={isIso ? onIsoPointerUp : undefined}
        onPointerCancel={isIso ? onIsoPointerUp : undefined}
      >
        {/* ─── Background: reach + scene scaffolding ─────────────
            Order matters — anything drawn here sits BEHIND the arm,
            so it can't occlude the foreground. */}
        {/* Reachability outline. Sphere silhouettes are circles in
            any parallel projection — same render path for all four
            views. */}
        <circle cx={ox} cy={oy} r={outerR} fill="none" stroke="#1e293b" strokeDasharray="3 3" />
        {innerR > 1 && (
          <circle cx={ox} cy={oy} r={innerR} fill="none" stroke="#1e293b" strokeDasharray="2 2" />
        )}
        {!isIso ? (
          <>
            {/* Orthographic crosshair + flat floor line. */}
            <line x1={0} y1={oy} x2={W} y2={oy} stroke="#1e293b" />
            <line x1={ox} y1={0} x2={ox} y2={H} stroke="#1e293b" />
            {axes !== 'xy' && (
              <line x1={0} y1={floorY} x2={W} y2={floorY} stroke="#334155" strokeWidth={2} />
            )}
          </>
        ) : (() => {
          // ── Iso scene: floor grid + workspace box + axis arrows ──
          // The floor grid is the strongest depth cue — parallel
          // lines converging (visually) to the rotation centre make
          // the orientation legible at a glance. Spacing is chosen
          // to give 6–8 cells across the workspace at default zoom.
          const R = maxReachMm
          const step = (() => {
            const raw = R / 6
            const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))))
            // Round to nearest "nice" step: 1, 2, 5, or 10 × magnitude.
            const choices = [1, 2, 5, 10].map((m) => m * mag)
            return choices.reduce((best, c) =>
              Math.abs(c - raw) < Math.abs(best - raw) ? c : best, choices[0])
          })()
          const lines: JSX.Element[] = []
          for (let k = -R; k <= R + 0.001; k += step) {
            // Lines parallel to Y (varying x)
            const [ax, ay] = projectIso([k, -R, 0])
            const [bx, by] = projectIso([k, +R, 0])
            const major = Math.abs(k) < 0.001
            lines.push(
              <line key={`gx-${k.toFixed(2)}`}
                x1={ax} y1={ay} x2={bx} y2={by}
                stroke={major ? '#334155' : '#1f2937'}
                strokeWidth={major ? 1.2 : 0.6}
              />
            )
            // Lines parallel to X (varying y)
            const [cx, cy] = projectIso([-R, k, 0])
            const [dx, dy] = projectIso([+R, k, 0])
            lines.push(
              <line key={`gy-${k.toFixed(2)}`}
                x1={cx} y1={cy} x2={dx} y2={dy}
                stroke={major ? '#334155' : '#1f2937'}
                strokeWidth={major ? 1.2 : 0.6}
              />
            )
          }
          // Workspace box — 8 corners, 12 edges, the bounding cube
          // of the reach volume at ±R. Gives the eye a strong 3D
          // anchor when the floor grid alone isn't enough.
          const c = [
            [-R, -R, 0], [+R, -R, 0], [+R, +R, 0], [-R, +R, 0],
            [-R, -R, R], [+R, -R, R], [+R, +R, R], [-R, +R, R],
          ].map((p) => projectIso(p as [number, number, number]))
          const edges: [number, number][] = [
            [0, 1], [1, 2], [2, 3], [3, 0],            // floor
            [4, 5], [5, 6], [6, 7], [7, 4],            // ceiling
            [0, 4], [1, 5], [2, 6], [3, 7],            // verticals
          ]
          const boxEdges = edges.map(([i, j], idx) => (
            <line key={`box-${idx}`}
              x1={c[i][0]} y1={c[i][1]} x2={c[j][0]} y2={c[j][1]}
              stroke="#1f2937" strokeWidth={0.8} strokeDasharray="4 4"
            />
          ))
          // Coloured axes with arrowheads + labels at the tips.
          // Red=X, green=Y, blue=Z is universal 3D convention.
          const axLen = R * 1.1
          const [xEx, xEy] = projectIso([axLen, 0, 0])
          const [yEx, yEy] = projectIso([0, axLen, 0])
          const [zEx, zEy] = projectIso([0, 0, axLen])
          return (
            <g>
              {lines}
              {boxEdges}
              <g strokeWidth={1.5}>
                <line x1={ox} y1={oy} x2={xEx} y2={xEy} stroke="#dc2626" />
                <line x1={ox} y1={oy} x2={yEx} y2={yEy} stroke="#16a34a" />
                <line x1={ox} y1={oy} x2={zEx} y2={zEy} stroke="#2563eb" />
              </g>
              <text x={xEx + 4} y={xEy + 4} fill="#f87171" fontSize={11} fontFamily="monospace" fontWeight="bold">X</text>
              <text x={yEx + 4} y={yEy + 4} fill="#4ade80" fontSize={11} fontFamily="monospace" fontWeight="bold">Y</text>
              <text x={zEx + 4} y={zEy - 2} fill="#60a5fa" fontSize={11} fontFamily="monospace" fontWeight="bold">Z</text>
            </g>
          )
        })()}
        {/* Iso-only drop-shadows: project each joint to z=0, draw a
            faint ellipse on the floor + a dashed vertical from the
            joint down to its shadow. Vertical-from-the-joint is the
            classic "where is this point in 3D space?" depth cue. */}
        {isIso && positions.map((p, i) => {
          const [wx, wy, wz] = p
          if (wz < 0.5) return null   // already on or below floor — skip
          const [jsx, jsy] = projectIso([wx, wy, wz])
          const [fsx, fsy] = projectIso([wx, wy, 0])
          return (
            <g key={`drop-${i}`}>
              <line
                x1={jsx} y1={jsy} x2={fsx} y2={fsy}
                stroke="#334155" strokeWidth={0.8} strokeDasharray="2 3"
              />
              <ellipse
                cx={fsx} cy={fsy}
                rx={4} ry={1.6}
                fill="#0b1220" stroke="#334155" strokeWidth={0.8}
              />
            </g>
          )
        })}
        {/* The arm — each link rendered as a "bone": a semicircular
            bulb at the proximal joint tapering linearly to a point
            at the distal joint. Reads as a 3D envelope rather than
            a flat green line. Bulb radius scales with segment
            length and caps at ~14 px so short segments don't bloat
            into circles. Zero-length segments (e.g. base+shoulder
            co-located in the default model) are skipped. */}
        {positions.length >= 2 && positions.slice(0, -1).map((from, i) => {
          const to = positions[i + 1]
          const [fx, fy] = projectWorld(from)
          const [tx, ty] = projectWorld(to)
          const dx = tx - fx
          const dy = ty - fy
          const len = Math.sqrt(dx * dx + dy * dy)
          if (len < 0.5) return null
          const ux = dx / len
          const uy = dy / len
          // Perpendicular (CCW rotation by 90° in screen space).
          const perpX = -uy
          const perpY = ux
          // Bulb radius — proportional to segment length, capped so
          // long links don't render as elongated ovals AND short
          // links don't bloom into circles.
          const r = Math.min(len * 0.16, 14)
          const topX = fx + perpX * r
          const topY = fy + perpY * r
          const botX = fx - perpX * r
          const botY = fy - perpY * r
          // Path: top-of-bulb → arc around the proximal joint → bot
          // of-bulb → line to the distal tip → close (auto line back
          // to top-of-bulb). sweep=1 (positive-angle = CW visually
          // in SVG's y-down frame) keeps the arc bulging AWAY from
          // the distal joint, producing the teardrop silhouette.
          const d = `M ${topX} ${topY} A ${r} ${r} 0 0 1 ${botX} ${botY} L ${tx} ${ty} Z`
          return (
            <path
              key={`bone-${i}`}
              d={d}
              fill={armColor}
              fillOpacity={0.18}
              stroke={armColor}
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
          )
        })}
        {positions.map((p, i) => {
          const [sx, sy] = projectWorld(p)
          const isEnd = i === positions.length - 1
          return (
            <circle
              key={`joint-${i}`}
              cx={sx} cy={sy}
              r={isEnd ? 5 : 4}
              fill={isEnd ? armColor : '#0f172a'}
              stroke={armColor} strokeWidth={2}
            />
          )
        })}
        {/* Path overlay — line from begin to end + sample dots.
            Sky-blue so it never collides with the arm (green/amber)
            or the target (also green/amber). The currently-playing
            sample (if any) is rendered larger + filled. */}
        {path && (() => {
          const [bx, by] = projectWorld(path.begin)
          const [ex, ey] = projectWorld(path.end)
          return (
            <g>
              <line
                x1={bx} y1={by} x2={ex} y2={ey}
                stroke="#38bdf8" strokeWidth={1.5} strokeDasharray="4 3"
              />
              {path.samples.map((p, i) => {
                const [sx, sy] = projectWorld(p)
                const isCur = path.currentIndex === i
                return (
                  <circle
                    key={`pwp-${i}`}
                    cx={sx} cy={sy} r={isCur ? 4 : 2}
                    fill={isCur ? '#38bdf8' : '#0f172a'}
                    stroke="#38bdf8" strokeWidth={1.5}
                  />
                )
              })}
            </g>
          )
        })()}
        {/* Target marker — ✕ at the requested point. */}
        {(() => {
          const [tx, ty] = projectWorld([target.x, target.y, target.z])
          const targetColor = status === 'reachable' ? '#10b981' : '#f59e0b'
          return (
            <g stroke={targetColor} strokeWidth={2}>
              <line x1={tx - 6} y1={ty - 6} x2={tx + 6} y2={ty + 6} />
              <line x1={tx - 6} y1={ty + 6} x2={tx + 6} y2={ty - 6} />
            </g>
          )
        })()}
        {/* Scale tick — small ruler in the bottom-right corner.
            Always 100 mm so the operator can eyeball distances. */}
        <g>
          <line
            x1={W - 110} y1={H - 8}
            x2={W - 110 + 100 * pxPerMm} y2={H - 8}
            stroke="#64748b" strokeWidth={1}
          />
          <text x={W - 110} y={H - 12} fill="#64748b" fontSize={9} fontFamily="monospace">
            100mm
          </text>
        </g>
      </svg>
    </div>
  )
}


// ─── main component ────────────────────────────────────────────────


export default function IKSolverFullView({ proxy }: { proxy: ServiceProxy }) {
  const wsClient = useWsClient()
  const proxyId = proxy.id ?? proxy.name ?? ''
  const stateTopic = `/ik_solver/${proxyId}/state`
  const solutionTopic = `/ik_solver/${proxyId}/solution`
  const controlTopic = `/ik_solver/${proxyId}/control`

  const [state, setState] = useState<IKState>({})
  // Draft target — operator-edited; commits on Solve. Defaults
  // populated from state.last_target so re-opens come back to the
  // last solved point.
  const [tx, setTx] = useState<number>(200)
  const [ty, setTy] = useState<number>(0)
  const [tz, setTz] = useState<number>(100)

  // Iso camera — hoisted here so a drag in the iso panel survives
  // re-renders driven by other state changes. Defaults to the
  // classic (1,1,1) corner view.
  const ISO_DEFAULT_AZ = 45
  const ISO_DEFAULT_EL = 35.264
  const [isoAz, setIsoAz] = useState<number>(ISO_DEFAULT_AZ)
  const [isoEl, setIsoEl] = useState<number>(ISO_DEFAULT_EL)
  const onIsoCameraChange = useCallback((az: number, el: number) => {
    setIsoAz(az)
    setIsoEl(el)
  }, [])
  const onIsoCameraReset = useCallback(() => {
    setIsoAz(ISO_DEFAULT_AZ)
    setIsoEl(ISO_DEFAULT_EL)
  }, [])

  // ─── subscribe to /state and /solution ───────────────────────────
  useEffect(() => {
    if (!proxyId) return
    const offState = wsClient.subscribe(stateTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      setState(f.payload as IKState)
    })
    const offSol = wsClient.subscribe(solutionTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const sol = f.payload as IKSolution
      // Refresh the embedded last_solution in state so a late
      // /state subscriber doesn't overwrite our fresh solution.
      setState((prev) => ({ ...prev, last_solution: sol, last_target: sol.target ?? prev.last_target }))
    })
    return () => { offState(); offSol() }
  }, [proxyId, stateTopic, solutionTopic, wsClient])

  // Mirror state.last_target into the draft inputs ONCE on load —
  // don't fight the user mid-edit.
  const [draftPopulated, setDraftPopulated] = useState(false)
  useEffect(() => {
    if (draftPopulated) return
    const t = state.last_target
    if (t) {
      setTx(t.x); setTy(t.y); setTz(t.z)
      setDraftPopulated(true)
    }
  }, [state.last_target, draftPopulated])

  // ─── available servo proxies for the link dropdown ──────────────
  const [servoProxies, setServoProxies] = useState<Record<string, { connected?: boolean; angle?: number }>>({})
  useEffect(() => {
    const off = wsClient.subscribe('/servo/+/state', (f: InboundFrame) => {
      if (f.method !== 'message') return
      const m = (f.topic ?? '').match(/^\/servo\/([^/]+)\/state$/)
      if (!m) return
      const id = m[1]
      const p = (f.payload ?? {}) as { attached?: boolean; angle?: number; current_angle?: number }
      setServoProxies((prev) => ({
        ...prev,
        [id]: {
          connected: !!p.attached,
          angle: typeof p.current_angle === 'number' ? p.current_angle : p.angle,
        },
      }))
    })
    return off
  }, [wsClient])

  // ─── actions ─────────────────────────────────────────────────────
  const solveReq = useServiceRequest<IKSolution>(controlTopic, {
    timeoutMs: 5_000,
    errorField: 'reason',
    replyPrefix: `ik-${proxyId}-solve`,
  })
  const sendReq = useServiceRequest<{ dispatched: number }>(controlTopic, {
    timeoutMs: 3_000,
    errorField: 'reason',
    replyPrefix: `ik-${proxyId}-send`,
  })
  // set_model commits the draft joints + links. Backend validates +
  // persists; the /state subscription pushes the new shape back so
  // we can clear the dirty flag.
  const setModelReq = useServiceRequest<{ joints?: JointSpec[]; links?: LinkSpec[] }>(controlTopic, {
    timeoutMs: 5_000,
    errorField: 'reason',
    replyPrefix: `ik-${proxyId}-model`,
  })
  // set_calibration updates ONE joint's calibration. Caller bundles
  // every changed field into one request; the backend accepts a
  // partial update so we don't have to re-send unchanged fields.
  const setCalReq = useServiceRequest<unknown>(controlTopic, {
    timeoutMs: 4_000,
    errorField: 'reason',
    replyPrefix: `ik-${proxyId}-cal`,
  })

  // ─── model library + poses (P1/P2) ───────────────────────────────
  const libReq = useServiceRequest<{ models?: ModelRow[]; id?: string }>(controlTopic, {
    timeoutMs: 6_000,
    errorField: 'reason',
    replyPrefix: `ik-${proxyId}-lib`,
  })
  const [models, setModels] = useState<ModelRow[]>([])
  const [libError, setLibError] = useState<string | null>(null)
  const [saveId, setSaveId] = useState('')
  const [saveTitle, setSaveTitle] = useState('')
  const [saveIncludePose, setSaveIncludePose] = useState(true)
  const [poseName, setPoseName] = useState('')

  const refreshModels = useCallback(async () => {
    try {
      const r = await libReq.request('list_models')
      setModels(((r as { models?: ModelRow[] })?.models ?? []) as ModelRow[])
      setLibError(null)
    } catch (e) {
      setLibError(String((e as Error)?.message ?? e))
    }
  }, [libReq])
  // Fetch the library once per proxy (filesystem-derived, not in /state).
  useEffect(() => { void refreshModels() }, [proxyId])  // eslint-disable-line react-hooks/exhaustive-deps

  const onLoadModel = useCallback(async (id: string) => {
    try { await libReq.request('load_model', { id }); setModelInitialised(false); setCalInitialised(false); await refreshModels() }
    catch (e) { setLibError(String((e as Error)?.message ?? e)) }
  }, [libReq, refreshModels])
  const onSaveToLibrary = useCallback(async () => {
    const id = saveId.trim()
    if (!id) return
    try {
      await libReq.request('save_model', {
        id, title: saveTitle.trim() || undefined, include_current_pose: saveIncludePose,
      })
      setSaveId(''); setSaveTitle(''); await refreshModels()
    } catch (e) { setLibError(String((e as Error)?.message ?? e)) }
  }, [libReq, saveId, saveTitle, saveIncludePose, refreshModels])
  const onDeleteModel = useCallback(async (id: string) => {
    try { await libReq.request('delete_model', { id }); await refreshModels() }
    catch (e) { setLibError(String((e as Error)?.message ?? e)) }
  }, [libReq, refreshModels])
  const onExportModel = useCallback(async (id?: string) => {
    try {
      const m = await libReq.request('export_model', id ? { id } : {})
      downloadJson(`${id || (m as { id?: string })?.id || 'model'}.json`, m)
    } catch (e) { setLibError(String((e as Error)?.message ?? e)) }
  }, [libReq])
  const onCapturePose = useCallback(async () => {
    const name = poseName.trim()
    if (!name) return
    try { await libReq.request('save_pose', { name }); setPoseName('') }
    catch (e) { setLibError(String((e as Error)?.message ?? e)) }
  }, [libReq, poseName])
  const onApplyPose = useCallback(async (name: string) => {
    try { await libReq.request('apply_pose', { name }) }
    catch (e) { setLibError(String((e as Error)?.message ?? e)) }
  }, [libReq])
  const onDeletePose = useCallback(async (name: string) => {
    try { await libReq.request('delete_pose', { name }) }
    catch (e) { setLibError(String((e as Error)?.message ?? e)) }
  }, [libReq])

  const bundledModels = useMemo(() => models.filter((m) => m.root === 'bundled'), [models])
  const userModels = useMemo(() => models.filter((m) => m.root === 'user'), [models])

  // ─── editable model (joints + links) ────────────────────────────
  // Draft state mirrors state.joints/links but is operator-edited.
  // Initialised from /state on first arrival; manual resyncs happen
  // only via the Reset button so the operator's edits aren't blown
  // away by every state event. Declared AFTER ``setModelReq`` because
  // ``onSaveModel`` below depends on it (hook init order matters —
  // React's render-time hook dispatch hits a TDZ otherwise).
  const [draftJoints, setDraftJoints] = useState<JointSpec[]>([])
  const [draftLinks, setDraftLinks] = useState<LinkSpec[]>([])
  const [modelInitialised, setModelInitialised] = useState(false)
  useEffect(() => {
    if (modelInitialised) return
    if (state.joints && state.links) {
      setDraftJoints(state.joints.map((j) => ({ ...j })))
      setDraftLinks(state.links.map((l) => ({ ...l })))
      setModelInitialised(true)
    }
  }, [state.joints, state.links, modelInitialised])

  // Resync after a successful set_model — /state arrives ~immediately
  // and we want the draft to mirror the new server-side shape so the
  // dirty indicator clears.
  const resyncModel = useCallback(() => {
    if (state.joints && state.links) {
      setDraftJoints(state.joints.map((j) => ({ ...j })))
      setDraftLinks(state.links.map((l) => ({ ...l })))
    }
  }, [state.joints, state.links])

  // ── Model edit ops ──
  const updateJointAt = useCallback((idx: number, patch: Partial<JointSpec>) => {
    setDraftJoints((prev) => prev.map((j, i) => (i === idx ? { ...j, ...patch } : j)))
  }, [])
  const updateLinkAt = useCallback((idx: number, lengthMm: number) => {
    setDraftLinks((prev) => prev.map((l, i) => (i === idx ? { ...l, length_mm: lengthMm } : l)))
  }, [])
  const addJoint = useCallback(() => {
    // New joint defaults — mirror a typical in-plane joint with
    // symmetric ±150° range + 120mm follow-on link. Operator can
    // rename + retune; name conflicts are caught by validation.
    setDraftJoints((prev) => {
      const n = prev.length
      const proposedName = `joint${n}`
      return [...prev, { name: proposedName, type: 'revolute', min_deg: -150, max_deg: 150 }]
    })
    setDraftLinks((prev) => [...prev, { length_mm: 120 }])
  }, [])
  const removeJointAt = useCallback((idx: number) => {
    setDraftJoints((prev) => prev.filter((_, i) => i !== idx))
    // The link aligned with this joint: for joints[1..N-1] the link
    // index is (idx - 1) since base owns no link. Removing the base
    // is blocked at the UI level so idx >= 1 here.
    setDraftLinks((prev) => prev.filter((_, i) => i !== idx - 1))
  }, [])

  // ── Validation ──
  // Backend will also validate via set_model; we mirror the basics
  // for an inline preview so the operator doesn't have to round-trip
  // for "did I pick a unique name?".
  const modelError = useMemo<string | null>(() => {
    if (draftJoints.length === 0) return 'at least one joint required'
    const baseIdx = draftJoints.findIndex((j) => j.name === 'base')
    if (baseIdx === -1) return 'first joint must be named "base"'
    if (baseIdx !== 0) return '"base" must be the first joint'
    const names = new Set<string>()
    for (const j of draftJoints) {
      const n = (j.name ?? '').trim()
      if (!n) return 'joint name cannot be empty'
      if (names.has(n)) return `duplicate joint name: ${n}`
      names.add(n)
      const lo = j.min_deg ?? -180
      const hi = j.max_deg ?? 180
      if (lo > hi) return `joint "${n}": min (${lo}) > max (${hi})`
    }
    // Each in-plane joint (every joint after base) needs a link.
    const expectedLinks = draftJoints.length - 1
    if (draftLinks.length !== expectedLinks) {
      return `expected ${expectedLinks} link(s), have ${draftLinks.length}`
    }
    for (let i = 0; i < draftLinks.length; i++) {
      const len = draftLinks[i].length_mm
      if (!(len > 0)) return `link ${i + 1} length must be > 0 (got ${len})`
    }
    return null
  }, [draftJoints, draftLinks])

  const modelDirty = useMemo(() => {
    if (!state.joints || !state.links) return false
    if (state.joints.length !== draftJoints.length) return true
    if (state.links.length !== draftLinks.length) return true
    for (let i = 0; i < draftJoints.length; i++) {
      const a = state.joints[i]
      const b = draftJoints[i]
      if (a.name !== b.name) return true
      if ((a.min_deg ?? -180) !== (b.min_deg ?? -180)) return true
      if ((a.max_deg ?? 180) !== (b.max_deg ?? 180)) return true
    }
    for (let i = 0; i < draftLinks.length; i++) {
      if (state.links[i].length_mm !== draftLinks[i].length_mm) return true
    }
    return false
  }, [state.joints, state.links, draftJoints, draftLinks])

  const onSaveModel = useCallback(async () => {
    if (modelError || !modelDirty || setModelReq.inFlight) return
    await setModelReq.request('set_model', {
      joints: draftJoints.map((j) => ({
        name: j.name,
        type: j.type ?? 'revolute',
        min_deg: j.min_deg ?? -180,
        max_deg: j.max_deg ?? 180,
      })),
      links: draftLinks.map((l) => ({ length_mm: l.length_mm })),
    })
  }, [modelError, modelDirty, setModelReq, draftJoints, draftLinks])

  // ─── editable calibration ───────────────────────────────────────
  // Draft cal mirrors state.calibration. Per-joint edits stage in the
  // local draft; Save calibration commits each dirty row via the
  // backend's set_calibration action (one request per dirty joint).
  // Initialise once, then resync after a successful save.
  const [draftCal, setDraftCal] = useState<JointCalibration[]>([])
  const [calInitialised, setCalInitialised] = useState(false)
  useEffect(() => {
    if (calInitialised) return
    if (state.calibration) {
      setDraftCal(state.calibration.map((c) => ({ ...c })))
      setCalInitialised(true)
    }
  }, [state.calibration, calInitialised])
  const resyncCal = useCallback(() => {
    if (state.calibration) setDraftCal(state.calibration.map((c) => ({ ...c })))
  }, [state.calibration])

  const updateCalAt = useCallback((joint: string, patch: Partial<JointCalibration>) => {
    setDraftCal((prev) => prev.map((c) => (c.joint === joint ? { ...c, ...patch } : c)))
  }, [])

  // Validation — match the backend rules so dirty rows can't be
  // submitted with nonsense values.
  const calError = useMemo<string | null>(() => {
    for (const c of draftCal) {
      const s = c.scale ?? 1
      if (!Number.isFinite(s) || s === 0) return `joint "${c.joint}": scale must be non-zero`
      const lo = c.servo_min_deg ?? 0
      const hi = c.servo_max_deg ?? 180
      if (lo > hi) return `joint "${c.joint}": servo min (${lo}) > max (${hi})`
    }
    return null
  }, [draftCal])

  // Which rows differ from the committed state — only those get
  // re-sent on Save.
  const dirtyCalJoints = useMemo<Set<string>>(() => {
    const out = new Set<string>()
    const baseline = new Map((state.calibration ?? []).map((c) => [c.joint, c]))
    for (const d of draftCal) {
      const b = baseline.get(d.joint)
      if (!b) { out.add(d.joint); continue }
      if ((b.zero_offset_deg ?? 0) !== (d.zero_offset_deg ?? 0)) { out.add(d.joint); continue }
      if ((b.direction ?? 1) !== (d.direction ?? 1)) { out.add(d.joint); continue }
      if ((b.scale ?? 1) !== (d.scale ?? 1)) { out.add(d.joint); continue }
      if ((b.servo_min_deg ?? 0) !== (d.servo_min_deg ?? 0)) { out.add(d.joint); continue }
      if ((b.servo_max_deg ?? 180) !== (d.servo_max_deg ?? 180)) { out.add(d.joint); continue }
    }
    return out
  }, [state.calibration, draftCal])

  const onSaveCal = useCallback(async () => {
    if (calError || dirtyCalJoints.size === 0 || setCalReq.inFlight) return
    for (const joint of dirtyCalJoints) {
      const c = draftCal.find((x) => x.joint === joint)
      if (!c) continue
      await setCalReq.request('set_calibration', {
        joint,
        zero_offset_deg: c.zero_offset_deg ?? 0,
        direction: c.direction ?? 1,
        scale: c.scale ?? 1,
        servo_min_deg: c.servo_min_deg ?? 0,
        servo_max_deg: c.servo_max_deg ?? 180,
      })
    }
  }, [calError, dirtyCalJoints, setCalReq, draftCal])

  // Live joint angles — kept in a ref because ``currentAngles`` is
  // computed AFTER this callback in the component body (derived from
  // ``state`` + ``servoProxies``). Updating a ref out-of-band (via a
  // useEffect lower down) means onSolve can read the freshest map
  // without needing to be redeclared every time currentAngles
  // changes (which would happen on every /servo/+/state tick).
  const currentAnglesRef = useRef<Record<string, number>>({})

  const onSolve = useCallback((e?: FormEvent) => {
    e?.preventDefault()
    if (solveReq.inFlight) return
    void solveReq.request('solve', {
      target: { x: tx, y: ty, z: tz },
      // The hint biases the analytic branch selection + numerical
      // seed toward the current pose, so a solve for "the point I'm
      // already at" returns the same joint config rather than
      // teleporting the servos to a mirror configuration.
      current_angles: currentAnglesRef.current,
    })
  }, [tx, ty, tz, solveReq])

  const onSend = useCallback(() => {
    if (sendReq.inFlight) return
    void sendReq.request('send_to_servos')
  }, [sendReq])

  // ─── path playback ──────────────────────────────────────────────
  // Linear-interpolate between (bx,by,bz) and (ex,ey,ez) over
  // ``pathSteps`` samples; for each: solve, send_to_servos with the
  // solution's joint_angles, sleep(pathDelayMs), advance. Aborted
  // via the ref flag so a re-render can't outrun the in-flight
  // request and skip the abort check.
  const [bx, setBx] = useState<number>(200)
  const [by, setBy] = useState<number>(-100)
  const [bz, setBz] = useState<number>(100)
  const [ex, setEx] = useState<number>(200)
  const [ey, setEy] = useState<number>(100)
  const [ez, setEz] = useState<number>(100)
  const [pathSteps, setPathSteps] = useState<number>(10)
  const [pathDelayMs, setPathDelayMs] = useState<number>(300)
  const [playing, setPlaying] = useState<boolean>(false)
  const [playIndex, setPlayIndex] = useState<number | null>(null)
  const [pathError, setPathError] = useState<string | null>(null)
  const abortRef = useRef<boolean>(false)

  // Pre-compute the sample points so the projection overlay updates
  // immediately as the operator tweaks begin/end/steps — without
  // waiting for Play.
  const pathSamples = useMemo<Array<[number, number, number]>>(() => {
    const n = Math.max(2, Math.min(200, Math.floor(pathSteps)))
    const out: Array<[number, number, number]> = []
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1)
      out.push([
        bx + (ex - bx) * t,
        by + (ey - by) * t,
        bz + (ez - bz) * t,
      ])
    }
    return out
  }, [bx, by, bz, ex, ey, ez, pathSteps])

  const onUseCurrentAsBegin = useCallback(() => {
    setBx(tx); setBy(ty); setBz(tz)
  }, [tx, ty, tz])
  const onUseCurrentAsEnd = useCallback(() => {
    setEx(tx); setEy(ty); setEz(tz)
  }, [tx, ty, tz])

  const onPlay = useCallback(async () => {
    if (playing) return
    abortRef.current = false
    setPlaying(true)
    setPathError(null)
    try {
      for (let i = 0; i < pathSamples.length; i++) {
        if (abortRef.current) break
        setPlayIndex(i)
        const [px, py, pz] = pathSamples[i]
        // The draft tx/ty/tz mirrors the active sample so the ✕
        // marker tracks playback — handy when the path goes off-
        // screen on one projection.
        setTx(px); setTy(py); setTz(pz)
        // Pass current_angles so each step's IK biases toward the
        // freshly-commanded prior step's pose (or the live one) —
        // avoids the analytic branch flip mid-path that would jerk
        // the arm through a mirror configuration.
        const reply = await solveReq.request('solve', {
          target: { x: px, y: py, z: pz },
          current_angles: currentAnglesRef.current,
        })
        if (abortRef.current) break
        if (!reply || !reply.reachable) {
          setPathError(reply?.detail ?? reply?.reason ?? 'step unreachable')
          break
        }
        // Reuse the freshly-computed joint_angles instead of relying
        // on send_to_servos' default (which would re-read
        // _last_solution server-side — a race against the next solve).
        const angles: Record<string, number> = {}
        for (const [name, entry] of Object.entries(reply.joint_angles ?? {})) {
          angles[name] = typeof entry === 'object' && entry && 'math' in entry
            ? (entry as { math: number }).math : (entry as unknown as number)
        }
        if (Object.keys(angles).length > 0) {
          await sendReq.request('send_to_servos', { joint_angles: angles })
          if (abortRef.current) break
        }
        if (i < pathSamples.length - 1) {
          await new Promise<void>((res) => setTimeout(res, Math.max(0, pathDelayMs)))
        }
      }
    } finally {
      setPlaying(false)
      setPlayIndex(null)
    }
  }, [playing, pathSamples, pathDelayMs, solveReq, sendReq])

  const onStop = useCallback(() => {
    abortRef.current = true
  }, [])

  // ``sendAction`` — bare publish for actions where we don't need
  // the reply (link/unlink). The /state subscription delivers the
  // updated config; UI re-renders.
  const sendAction = useCallback((payload: Record<string, unknown>) => {
    wsClient.publish(controlTopic, payload)
  }, [controlTopic, wsClient])

  const onLink = useCallback((joint: string, proxyIdLink: string) => {
    sendAction({ action: 'link_servo', joint, proxy_id: proxyIdLink })
  }, [sendAction])
  const onUnlink = useCallback((joint: string) => {
    sendAction({ action: 'unlink_servo', joint })
  }, [sendAction])
  // Auto-fit: ask the backend to map the joint's math range
  // (min_deg..max_deg) onto its servo range so full servo travel spans
  // the joint — the same fit link_servo applies. ``direction`` flips it.
  // We sync the draft straight from the action result (which carries the
  // refreshed calibration) so the table reflects it without waiting on a
  // separate state delivery and without clobbering it as a "dirty" edit.
  const onAutoFit = useCallback(async (joint: string, direction?: number) => {
    const res = await setCalReq.request(
      'auto_calibrate', direction === undefined ? { joint } : { joint, direction },
    )
    const cals = (res as { calibration?: JointCalibration[] } | undefined)?.calibration
    if (Array.isArray(cals)) setDraftCal(cals.map((c) => ({ ...c })))
  }, [setCalReq])

  // ─── derived ────────────────────────────────────────────────────
  const joints = state.joints ?? []
  const links = state.links ?? []
  const calibration = state.calibration ?? []
  const maxReach = state.max_reach_mm ?? 340
  const minReach = state.min_reach_mm ?? 20
  const sol = state.last_solution ?? null

  // Live joint angles derived from the linked servos' current_angle.
  // Walks every calibration entry that has a ``servo_proxy_id``; for
  // each, looks up the live ``current_angle`` from ``servoProxies``
  // (populated by the /servo/+/state subscription) and converts via
  // the inverse calibration: ``math = (servo - offset) / (dir*scale)``.
  // Joints with no live data are omitted — the consumer below falls
  // back to the IK solution's angles for those, then to zero. This is
  // the FK-from-hardware direction of data flow: physical servo
  // position → math angle → arm visualization, complementing the IK
  // direction (target → math angle → servo command).
  const liveAngles: Record<string, number> = useMemo(() => {
    const out: Record<string, number> = {}
    for (const c of calibration) {
      if (!c.servo_proxy_id) continue
      const sp = servoProxies[c.servo_proxy_id]
      if (!sp || typeof sp.angle !== 'number') continue
      const dir = c.direction ?? 1
      const scale = c.scale ?? 1
      const offset = c.zero_offset_deg ?? 0
      const denom = dir * scale
      if (denom === 0) continue
      out[c.joint] = (sp.angle - offset) / denom
    }
    return out
  }, [calibration, servoProxies])

  // Current rendered joint angles. Priority:
  //   1. Live servo-derived angle (FK from hardware) — what the arm
  //      actually IS right now
  //   2. Last IK-solution angle — the planner's most recent plan
  //   3. Zero — neutral default so the arm renders something sensible
  //      (straight-out) before any solve or any servo data
  const currentAngles: Record<string, number> = useMemo(() => {
    const out: Record<string, number> = {}
    for (const j of joints) {
      if (j.name in liveAngles) {
        out[j.name] = liveAngles[j.name]
        continue
      }
      const entry = sol?.joint_angles?.[j.name]
      out[j.name] = entry ? entry.math : 0
    }
    return out
  }, [joints, liveAngles, sol])

  // Mirror into the ref declared earlier in the actions section so
  // ``onSolve`` and the path-playback loop can read the freshest map
  // without rebuilding their callbacks on every /servo/+/state tick.
  useEffect(() => { currentAnglesRef.current = currentAngles }, [currentAngles])

  // For the stats strip — "tracking N/M servos" so the operator knows
  // how many joints are driven by live hardware vs IK plan.
  const liveCount = Object.keys(liveAngles).length
  const linkedCount = calibration.filter((c) => !!c.servo_proxy_id).length

  const positions = useMemo(
    () => jointWorldPositions(joints, links, currentAngles),
    [joints, links, currentAngles],
  )

  const projectionStatus: 'idle' | 'reachable' | 'unreachable' =
    sol === null ? 'idle'
    : sol.reachable ? 'reachable'
    : 'unreachable'

  // Servo dropdown options — every running servo proxy, regardless
  // of which joint (if any) it's already bound to.
  const availableServoIds = useMemo(
    () => Object.keys(servoProxies).sort(),
    [servoProxies],
  )

  const anyLinked = calibration.some((c) => !!c.servo_proxy_id)
  const canSend = projectionStatus === 'reachable' && anyLinked

  return (
    <div
      className="flex h-full min-w-[1440px] flex-col gap-3 p-3 text-xs"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* ─── Model Library ───────────────────────────────────────────
          Browse + load bundled examples (InMoov) and shared user models,
          save the live model out (optionally capturing the current pose),
          and manage named poses. Backend: list/load/save/delete/export_model
          + save/apply/delete_pose @service_methods. */}
      <section className="rounded border border-slate-800 bg-slate-900/40 p-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">Model Library</span>
          <span className="font-mono text-[10px] text-slate-400">
            {state.model_title || state.model_id || 'unsaved model'}
            {state.model_source ? <span className="ml-1 text-slate-600">· {state.model_source}</span> : null}
          </span>
        </div>
        <div className="flex flex-wrap gap-4">
          {/* Examples (bundled, read-only) */}
          <div className="min-w-[220px] flex-1">
            <div className="mb-1 text-[9px] uppercase tracking-wider text-sky-300">Examples</div>
            <ul className="space-y-1">
              {bundledModels.length === 0 && <li className="text-[10px] text-slate-600">none bundled</li>}
              {bundledModels.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 rounded border border-slate-800 bg-slate-950 px-2 py-1">
                  <span className="min-w-0 truncate">
                    <span className="truncate text-slate-200">{m.title}</span>
                    <span className="ml-1 font-mono text-[9px] text-slate-500">{m.id} · {m.joints ?? 0}j</span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => void onLoadModel(m.id)} disabled={libReq.inFlight}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="nodrag nopan rounded bg-sky-600 px-1.5 py-0.5 text-[10px] text-white hover:bg-sky-500 disabled:opacity-50">Load</button>
                    <button type="button" onClick={() => void onExportModel(m.id)} title="Download JSON"
                      onPointerDown={(e) => e.stopPropagation()}
                      className="nodrag nopan rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500">↓</button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {/* Your models (shared user library, writable) */}
          <div className="min-w-[220px] flex-1">
            <div className="mb-1 text-[9px] uppercase tracking-wider text-slate-400">Your models</div>
            <ul className="space-y-1">
              {userModels.length === 0 && <li className="text-[10px] text-slate-600">none saved yet</li>}
              {userModels.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 rounded border border-slate-800 bg-slate-950 px-2 py-1">
                  <span className="min-w-0 truncate">
                    <span className="truncate text-slate-200">{m.title}</span>
                    <span className="ml-1 font-mono text-[9px] text-slate-500">{m.id} · {m.joints ?? 0}j</span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => void onLoadModel(m.id)} disabled={libReq.inFlight}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="nodrag nopan rounded bg-sky-600 px-1.5 py-0.5 text-[10px] text-white hover:bg-sky-500 disabled:opacity-50">Load</button>
                    <button type="button" onClick={() => void onExportModel(m.id)} title="Download JSON"
                      onPointerDown={(e) => e.stopPropagation()}
                      className="nodrag nopan rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500">↓</button>
                    <button type="button" onClick={() => void onDeleteModel(m.id)} title="Delete"
                      onPointerDown={(e) => e.stopPropagation()}
                      className="nodrag nopan rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-rose-300 hover:border-rose-500"><Trash2 className="h-3 w-3" /></button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {/* Save-as */}
          <div className="min-w-[220px] flex-1">
            <div className="mb-1 text-[9px] uppercase tracking-wider text-slate-400">Save current model</div>
            <div className="flex flex-col gap-1">
              <input value={saveId} onChange={(e) => setSaveId(e.target.value)} placeholder="id (a-z0-9_-)"
                onPointerDown={(e) => e.stopPropagation()}
                className="nodrag nopan rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[11px]" />
              <input value={saveTitle} onChange={(e) => setSaveTitle(e.target.value)} placeholder="title (optional)"
                onPointerDown={(e) => e.stopPropagation()}
                className="nodrag nopan rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px]" />
              <label className="flex items-center gap-1 text-[10px] text-slate-400">
                <input type="checkbox" checked={saveIncludePose} onChange={(e) => setSaveIncludePose(e.target.checked)}
                  onPointerDown={(e) => e.stopPropagation()} className="nodrag nopan" />
                capture current pose as “home”
              </label>
              <button type="button" onClick={() => void onSaveToLibrary()} disabled={!saveId.trim() || libReq.inFlight}
                onPointerDown={(e) => e.stopPropagation()}
                className="nodrag nopan flex items-center justify-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-[10px] text-white hover:bg-emerald-500 disabled:opacity-50">
                {libReq.inFlight && <Loader2 className="h-3 w-3 animate-spin" />} Save model
              </button>
            </div>
          </div>
          {/* Poses */}
          <div className="min-w-[220px] flex-1">
            <div className="mb-1 text-[9px] uppercase tracking-wider text-slate-400">Poses</div>
            <ul className="mb-1 space-y-1">
              {(state.poses ?? []).length === 0 && <li className="text-[10px] text-slate-600">no poses</li>}
              {(state.poses ?? []).map((p) => (
                <li key={p.name} className="flex items-center justify-between gap-2 rounded border border-slate-800 bg-slate-950 px-2 py-1">
                  <span className="min-w-0 truncate text-slate-200">
                    {p.name}{p.is_initial ? <span className="ml-1 text-[9px] text-emerald-400">(home)</span> : null}
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => void onApplyPose(p.name)}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="nodrag nopan rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500">Apply</button>
                    <button type="button" onClick={() => void onDeletePose(p.name)} title="Delete pose"
                      onPointerDown={(e) => e.stopPropagation()}
                      className="nodrag nopan rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-rose-300 hover:border-rose-500"><Trash2 className="h-3 w-3" /></button>
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex gap-1">
              <input value={poseName} onChange={(e) => setPoseName(e.target.value)} placeholder="capture pose name"
                onPointerDown={(e) => e.stopPropagation()}
                className="nodrag nopan min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px]" />
              <button type="button" onClick={() => void onCapturePose()} disabled={!poseName.trim()}
                onPointerDown={(e) => e.stopPropagation()}
                className="nodrag nopan flex shrink-0 items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 disabled:opacity-50"><Plus className="h-3 w-3" /></button>
            </div>
          </div>
        </div>
        {libError && (
          <div className="mt-1 truncate font-mono text-[10px] text-rose-300" title={libError}>{libError}</div>
        )}
      </section>

      {/* Stats strip. ``tracking N/M`` indicates how many linked
          joints have live servo data driving the FK render — when N
          equals the linked count, the arm visualisation is fully
          following the hardware. */}
      <section className="flex items-center justify-between gap-3 rounded border border-slate-800 bg-slate-900/40 px-2 py-1 font-mono text-[10px] text-slate-400">
        <span>
          {joints.length} joints · {links.length} links · max {maxReach.toFixed(0)}mm · min {minReach.toFixed(0)}mm
        </span>
        <span className="flex items-center gap-3">
          {linkedCount > 0 && (
            <span
              className={liveCount === linkedCount ? 'text-sky-300' : 'text-slate-500'}
              title="Joints whose live servo position is driving the FK render. The arm visualisation prefers live servo data over the last IK solution."
            >
              ● tracking {liveCount}/{linkedCount}
            </span>
          )}
          {sol && (
            <span className={sol.reachable ? 'text-emerald-300' : 'text-amber-300'}>
              {sol.reachable
                ? `● reachable, err ${(sol.position_error_mm ?? 0).toFixed(2)}mm`
                : `● ${sol.reason}`}
            </span>
          )}
          {/* Soft warnings — servo-range / floor / etc. The solve
              still succeeds; the operator sees them so calibration
              issues stay visible. ``title`` carries the full list
              for hover-to-inspect. */}
          {sol?.warnings && sol.warnings.length > 0 && (
            <span
              className="text-amber-300"
              title={sol.warnings.map((w) => `${w.kind}: ${w.detail}`).join('\n')}
            >
              ⚠ {sol.warnings.length} warning{sol.warnings.length === 1 ? '' : 's'}
            </span>
          )}
        </span>
      </section>

      {/* Projections — iso is the primary view (4× linear so 16× area
          of an ortho). The three orthographic views (side XZ, top
          XY, front YZ) sit in a column to the right; they take
          clicks to set their two visible world axes so the operator
          can triangulate by alternating views. Iso uses drag-to-
          orbit instead of click-to-target (a 2D click on a 3D scene
          would be ambiguous). */}
      <section className="flex flex-wrap items-start gap-3">
        <div className="flex flex-col items-center gap-1">
          <ArmProjection
            positions={positions}
            target={{ x: tx, y: ty, z: tz }}
            axes="iso"
            maxReachMm={maxReach}
            minReachMm={minReach}
            status={projectionStatus}
            path={{ begin: [bx, by, bz], end: [ex, ey, ez], samples: pathSamples, currentIndex: playIndex }}
            width={1120}
            height={880}
            isoCamera={{ azDeg: isoAz, elDeg: isoEl }}
            onIsoCameraChange={onIsoCameraChange}
          />
          <button
            type="button"
            onClick={onIsoCameraReset}
            onPointerDown={(e) => e.stopPropagation()}
            title="Reset iso camera to default angle"
            className="nodrag nopan rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:border-slate-500"
          >reset view</button>
        </div>
        <div className="flex flex-col gap-2">
          <ArmProjection
            positions={positions}
            target={{ x: tx, y: ty, z: tz }}
            axes="xz"
            maxReachMm={maxReach}
            minReachMm={minReach}
            onClick={(x, z) => { setTx(x); setTz(z) }}
            status={projectionStatus}
            path={{ begin: [bx, by, bz], end: [ex, ey, ez], samples: pathSamples, currentIndex: playIndex }}
          />
          <ArmProjection
            positions={positions}
            target={{ x: tx, y: ty, z: tz }}
            axes="xy"
            maxReachMm={maxReach}
            minReachMm={minReach}
            onClick={(x, y) => { setTx(x); setTy(y) }}
            status={projectionStatus}
            path={{ begin: [bx, by, bz], end: [ex, ey, ez], samples: pathSamples, currentIndex: playIndex }}
          />
          <ArmProjection
            positions={positions}
            target={{ x: tx, y: ty, z: tz }}
            axes="yz"
            maxReachMm={maxReach}
            minReachMm={minReach}
            onClick={(y, z) => { setTy(y); setTz(z) }}
            status={projectionStatus}
            path={{ begin: [bx, by, bz], end: [ex, ey, ez], samples: pathSamples, currentIndex: playIndex }}
          />
          {/* Live end-effector readout. Reads the LAST element of
              ``positions`` — which is derived from ``currentAngles``,
              which already prefers live servo-derived angles over the
              IK solution. So this readout updates continuously as the
              physical arm moves, independent of when a Solve fires. */}
          {(() => {
            const ee = positions[positions.length - 1]
            if (!ee) return null
            const [eex, eey, eez] = ee
            return (
              <div className="rounded border border-slate-800 bg-slate-900/40 px-2 py-1 font-mono text-[10px] text-slate-400">
                <div className="mb-0.5 text-[9px] uppercase tracking-wider text-slate-500">
                  end effector · live
                </div>
                <div className="flex justify-between gap-2 text-slate-300">
                  <span>x <span className="text-slate-100">{eex.toFixed(1)}</span></span>
                  <span>y <span className="text-slate-100">{eey.toFixed(1)}</span></span>
                  <span>z <span className="text-slate-100">{eez.toFixed(1)}</span></span>
                  <span className="text-slate-500">mm</span>
                </div>
              </div>
            )
          })()}
        </div>
      </section>

      {/* Target editor + actions */}
      <section className="rounded border border-slate-800 bg-slate-900/40 p-2">
        <form onSubmit={onSolve} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col">
            <span className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">x (mm)</span>
            <NumberInput
              value={tx}
              step={5}
              onChange={setTx}
              onPointerDown={(e) => e.stopPropagation()}
              className="nodrag nopan w-20 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[11px]"
            />
          </label>
          <label className="flex flex-col">
            <span className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">y (mm)</span>
            <NumberInput
              value={ty}
              step={5}
              onChange={setTy}
              onPointerDown={(e) => e.stopPropagation()}
              className="nodrag nopan w-20 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[11px]"
            />
          </label>
          <label className="flex flex-col">
            <span className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">z (mm)</span>
            <NumberInput
              value={tz}
              step={5}
              onChange={setTz}
              onPointerDown={(e) => e.stopPropagation()}
              className="nodrag nopan w-20 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[11px]"
            />
          </label>
          <button
            type="submit"
            disabled={solveReq.inFlight}
            onPointerDown={(e) => e.stopPropagation()}
            className="nodrag nopan inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {solveReq.inFlight && <Loader2 className="h-3 w-3 animate-spin" />}
            {solveReq.inFlight ? 'Solving…' : 'Solve'}
          </button>
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend || sendReq.inFlight}
            onPointerDown={(e) => e.stopPropagation()}
            title={!canSend ? 'Reachable solution + at least one linked servo required' : 'Fan out joint angles to linked servos'}
            className="nodrag nopan inline-flex items-center gap-1.5 rounded border border-sky-700 bg-sky-900/40 px-3 py-1 text-[11px] text-sky-200 hover:border-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sendReq.inFlight && <Loader2 className="h-3 w-3 animate-spin" />}
            {sendReq.inFlight ? 'Sending…' : 'Send to servos'}
          </button>
        </form>
        {(solveReq.error || sendReq.error) && (
          <div className="mt-2 truncate font-mono text-[10px] text-rose-300" title={solveReq.error ?? sendReq.error ?? ''}>
            {sol?.detail ?? solveReq.error ?? sendReq.error}
          </div>
        )}
      </section>

      {/* Path — begin + end + steps + delay + play. The arm sweeps
          the line segment by solving IK at each interpolated sample
          and dispatching the resulting joint_angles to the linked
          servos. Stop aborts at the next step boundary. */}
      <section className="rounded border border-slate-800 bg-slate-900/40 p-2">
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500">
          <span>path</span>
          {playing && (
            <span className="font-mono text-sky-300">
              step {(playIndex ?? 0) + 1}/{pathSamples.length}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {/* Begin row */}
          <div className="flex items-end gap-1">
            <span className="mr-1 text-[10px] uppercase tracking-wider text-slate-500">begin</span>
            {[
              { label: 'x', value: bx, set: setBx },
              { label: 'y', value: by, set: setBy },
              { label: 'z', value: bz, set: setBz },
            ].map(({ label, value, set }) => (
              <label key={`b-${label}`} className="flex flex-col">
                <span className="mb-0.5 text-[9px] uppercase tracking-wider text-slate-500">{label}</span>
                <NumberInput
                  value={value}
                  step={5}
                  disabled={playing}
                  onChange={set}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 font-mono text-[11px] disabled:opacity-50"
                />
              </label>
            ))}
            <button
              type="button"
              disabled={playing}
              onClick={onUseCurrentAsBegin}
              onPointerDown={(e) => e.stopPropagation()}
              title="Copy current target into Begin"
              className="nodrag nopan rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 disabled:opacity-40"
            >use ✕</button>
          </div>
          {/* End row */}
          <div className="flex items-end gap-1">
            <span className="mr-1 text-[10px] uppercase tracking-wider text-slate-500">end</span>
            {[
              { label: 'x', value: ex, set: setEx },
              { label: 'y', value: ey, set: setEy },
              { label: 'z', value: ez, set: setEz },
            ].map(({ label, value, set }) => (
              <label key={`e-${label}`} className="flex flex-col">
                <span className="mb-0.5 text-[9px] uppercase tracking-wider text-slate-500">{label}</span>
                <NumberInput
                  value={value}
                  step={5}
                  disabled={playing}
                  onChange={set}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 font-mono text-[11px] disabled:opacity-50"
                />
              </label>
            ))}
            <button
              type="button"
              disabled={playing}
              onClick={onUseCurrentAsEnd}
              onPointerDown={(e) => e.stopPropagation()}
              title="Copy current target into End"
              className="nodrag nopan rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 disabled:opacity-40"
            >use ✕</button>
          </div>
          {/* Step count + delay */}
          <label className="flex flex-col">
            <span className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">steps</span>
            <NumberInput
              value={pathSteps}
              min={2}
              max={200}
              step={1}
              disabled={playing}
              onChange={(n) => setPathSteps(Math.max(2, Math.min(200, Math.floor(n))))}
              onPointerDown={(e) => e.stopPropagation()}
              className="nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 font-mono text-[11px] disabled:opacity-50"
            />
          </label>
          <label className="flex flex-col">
            <span className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">delay (ms)</span>
            <NumberInput
              value={pathDelayMs}
              min={0}
              step={50}
              disabled={playing}
              onChange={(n) => setPathDelayMs(Math.max(0, Math.floor(n)))}
              onPointerDown={(e) => e.stopPropagation()}
              className="nodrag nopan w-20 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 font-mono text-[11px] disabled:opacity-50"
            />
          </label>
          {/* Play / Stop */}
          {!playing ? (
            <button
              type="button"
              onClick={onPlay}
              onPointerDown={(e) => e.stopPropagation()}
              title={anyLinked
                ? 'Solve + send each interpolated sample to linked servos'
                : 'Dry-run: solve along the path (no servos are linked, so no motion)'}
              className="nodrag nopan inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
            >Play{!anyLinked && <span className="opacity-70"> (dry-run)</span>}</button>
          ) : (
            <button
              type="button"
              onClick={onStop}
              onPointerDown={(e) => e.stopPropagation()}
              className="nodrag nopan inline-flex items-center gap-1.5 rounded bg-rose-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-rose-500"
            >
              <Loader2 className="h-3 w-3 animate-spin" />Stop
            </button>
          )}
        </div>
        {pathError && (
          <div className="mt-2 truncate font-mono text-[10px] text-amber-300" title={pathError}>
            ● aborted at step {(playIndex ?? 0) + 1}: {pathError}
          </div>
        )}
      </section>

      {/* Joints + links — editable model + live state.
          Each row is one joint: name, min°, max°, length of the
          link emanating from this joint (— for the base, since
          base+first-in-plane share the origin), the live math/servo
          angles, the servo binding, and a remove × (locked for
          base). "+ add joint" appends a new in-plane joint with a
          default-length link. Edits stage in the local draft;
          changes commit when the operator hits Save model. The
          BACKEND validates the result via set_model and returns the
          new state, which clears the dirty indicator.

          ``w-fit`` sizes the panel to its content rather than the full
          width of the parent, since the table is narrow by design
          (8 compact columns of small inputs). */}
      <section className="w-fit rounded border border-slate-800 bg-slate-900/40 p-2">
        <div className="mb-1 flex items-center justify-between gap-4 text-[10px] uppercase tracking-wider text-slate-500">
          <span>model · joints + links</span>
          <span className="flex items-center gap-2">
            {modelError && <span className="font-mono text-rose-300">● {modelError}</span>}
            {!modelError && modelDirty && <span className="font-mono text-amber-300">● unsaved changes</span>}
            {!modelError && !modelDirty && setModelReq.inFlight === false && <span className="font-mono text-slate-500">in sync</span>}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); resyncModel() }}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={!modelDirty}
              title="Discard draft edits and reload from server"
              className="nodrag nopan inline-flex items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw className="h-3 w-3" />reset
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); void onSaveModel() }}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={!!modelError || !modelDirty || setModelReq.inFlight}
              title={modelError ?? (modelDirty ? 'Commit model to the IK service (set_model)' : 'No changes to save')}
              className="nodrag nopan inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {setModelReq.inFlight && <Loader2 className="h-3 w-3 animate-spin" />}
              {setModelReq.inFlight ? 'saving…' : 'save model'}
            </button>
          </span>
        </div>
        <table className="font-mono text-[11px]">
          <thead className="text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="text-left">name</th>
              <th className="text-right">min°</th>
              <th className="text-right">max°</th>
              <th className="text-right">length (mm)</th>
              <th className="text-right pl-2">math</th>
              <th className="text-right">servo</th>
              <th className="text-left pl-3">link</th>
              <th className="w-6"></th>
            </tr>
          </thead>
          <tbody>
            {draftJoints.map((j, idx) => {
              const isBase = j.name === 'base' || idx === 0
              const a = sol?.joint_angles?.[j.name]
              const cal = calibration.find((c) => c.joint === j.name)
              const linked = !!cal?.servo_proxy_id
              const linkIdx = idx - 1   // base owns no link
              const linkLen = linkIdx >= 0 ? draftLinks[linkIdx]?.length_mm ?? 0 : null
              return (
                <tr key={`joint-${idx}`} className="border-t border-slate-800">
                  <td className="py-1">
                    <input
                      type="text"
                      value={j.name}
                      readOnly={isBase}
                      onChange={(e) => updateJointAt(idx, { name: e.target.value })}
                      onPointerDown={(e) => e.stopPropagation()}
                      title={isBase ? 'The base joint anchors the chain — name is locked' : 'Joint name'}
                      className={`nodrag nopan w-24 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 font-mono text-[11px] ${isBase ? 'opacity-70 cursor-not-allowed' : ''}`}
                    />
                  </td>
                  <td className="py-1 text-right">
                    <NumberInput
                      value={j.min_deg ?? -180}
                      step={5}
                      onChange={(n) => updateJointAt(idx, { min_deg: n })}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-right font-mono text-[11px]"
                    />
                  </td>
                  <td className="py-1 text-right">
                    <NumberInput
                      value={j.max_deg ?? 180}
                      step={5}
                      onChange={(n) => updateJointAt(idx, { max_deg: n })}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-right font-mono text-[11px]"
                    />
                  </td>
                  <td className="py-1 text-right">
                    {linkIdx < 0 ? (
                      <span className="text-slate-600">—</span>
                    ) : (
                      <NumberInput
                        value={linkLen ?? 0}
                        step={5}
                        min={1}
                        onChange={(n) => updateLinkAt(linkIdx, n)}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-right font-mono text-[11px]"
                      />
                    )}
                  </td>
                  <td className="py-1 pl-2 text-right text-slate-300">
                    {a ? `${a.math.toFixed(1)}°` : '—'}
                  </td>
                  <td className="py-1 text-right text-slate-400">
                    {a ? `${a.servo.toFixed(1)}°` : '—'}
                  </td>
                  <td className="py-1 pl-3">
                    {linked ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onUnlink(j.name) }}
                        onPointerDown={(e) => e.stopPropagation()}
                        title="Click to unlink"
                        className="nodrag nopan rounded bg-emerald-900/60 px-1.5 py-0.5 text-[10px] text-emerald-200 hover:bg-rose-900/60 hover:text-rose-200"
                      >
                        ● {cal?.servo_proxy_id}
                      </button>
                    ) : (
                      <select
                        value=""
                        onChange={(e) => { if (e.target.value) onLink(j.name, e.target.value) }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        className="nodrag nopan rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[10px]"
                      >
                        <option value="">○ unlinked</option>
                        {availableServoIds.map((id) => (
                          <option key={id} value={id}>{id}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="py-1 text-right">
                    {!isBase && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeJointAt(idx) }}
                        onPointerDown={(e) => e.stopPropagation()}
                        title="Remove this joint (and its link)"
                        className="nodrag nopan rounded p-1 text-slate-400 hover:bg-rose-900/40 hover:text-rose-300"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="mt-1 flex items-center justify-between">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); addJoint() }}
            onPointerDown={(e) => e.stopPropagation()}
            title="Append a new in-plane joint with a default-length follow-on link"
            className="nodrag nopan inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:border-slate-500"
          >
            <Plus className="h-3 w-3" />add joint
          </button>
          {setModelReq.error && (
            <span className="truncate font-mono text-[10px] text-rose-300" title={setModelReq.error}>
              ● {setModelReq.error}
            </span>
          )}
        </div>
      </section>

      {/* Calibration — math° → servo°. Each row is one joint. The
          servo command is computed as ``math · direction · scale +
          offset°``, then validated against ``servo_min..max``. The IK
          solver REJECTS solutions whose commanded servo angle falls
          outside the range — operator sees a clear "servo X would be
          240° outside [0, 180]" instead of the servo silently
          clamping at runtime. Defaults are identity (offset=0,
          direction=+1, scale=1.0) + a standard 0..180° hobby servo
          window. */}
      <section className="w-fit rounded border border-slate-800 bg-slate-900/40 p-2">
        <div className="mb-1 flex items-center justify-between gap-4 text-[10px] uppercase tracking-wider text-slate-500">
          <span>calibration · math° → servo°</span>
          <span className="flex items-center gap-2">
            {calError && <span className="font-mono text-rose-300">● {calError}</span>}
            {!calError && dirtyCalJoints.size > 0 && (
              <span className="font-mono text-amber-300">● {dirtyCalJoints.size} unsaved</span>
            )}
            {!calError && dirtyCalJoints.size === 0 && (
              <span className="font-mono text-slate-500">in sync</span>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); resyncCal() }}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={dirtyCalJoints.size === 0}
              title="Discard draft edits and reload from server"
              className="nodrag nopan inline-flex items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw className="h-3 w-3" />reset
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); void onSaveCal() }}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={!!calError || dirtyCalJoints.size === 0 || setCalReq.inFlight}
              title={calError ?? (dirtyCalJoints.size === 0 ? 'No changes to save' : `Commit ${dirtyCalJoints.size} joint(s)`)}
              className="nodrag nopan inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {setCalReq.inFlight && <Loader2 className="h-3 w-3 animate-spin" />}
              {setCalReq.inFlight ? 'saving…' : 'save calibration'}
            </button>
          </span>
        </div>
        <table className="font-mono text-[11px]">
          <thead className="text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="text-left">joint</th>
              <th className="text-right pl-3">dir</th>
              <th className="text-right pl-3">offset°</th>
              <th className="text-right pl-3">scale</th>
              <th className="text-right pl-3">servo min°</th>
              <th className="text-right pl-3">servo max°</th>
              <th className="text-right pl-3">cmd°</th>
            </tr>
          </thead>
          <tbody>
            {draftCal.map((c) => {
              const dirty = dirtyCalJoints.has(c.joint)
              const live = sol?.joint_angles?.[c.joint]
              // Re-compute the commanded servo angle using the DRAFT
              // calibration so the operator sees "if I save this, the
              // servo would be commanded to X°" before they hit save.
              const dir = c.direction ?? 1
              const scale = c.scale ?? 1
              const offset = c.zero_offset_deg ?? 0
              const cmdServo = live ? live.math * dir * scale + offset : null
              const outOfRange =
                cmdServo !== null &&
                (cmdServo < (c.servo_min_deg ?? 0) - 1e-3 ||
                  cmdServo > (c.servo_max_deg ?? 180) + 1e-3)
              return (
                <tr
                  key={`cal-${c.joint}`}
                  className={`border-t border-slate-800 ${dirty ? 'bg-amber-900/10' : ''}`}
                >
                  <td className="py-1 pr-3 text-slate-300">
                    <div className="flex items-center gap-1">
                      <span className="font-mono">{c.joint}</span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void onAutoFit(c.joint) }}
                        onPointerDown={(e) => e.stopPropagation()}
                        title="Auto-fit: map the joint's math range onto the servo range"
                        className="nodrag nopan rounded bg-sky-900/60 px-1 py-0.5 text-[9px] text-sky-200 hover:bg-sky-800/60"
                      >
                        Auto
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void onAutoFit(c.joint, (c.direction ?? 1) < 0 ? 1 : -1) }}
                        onPointerDown={(e) => e.stopPropagation()}
                        title="Reverse servo direction and re-fit"
                        className="nodrag nopan rounded border border-slate-700 px-1 py-0.5 text-[9px] text-slate-400 hover:border-slate-500"
                      >
                        Flip
                      </button>
                    </div>
                  </td>
                  <td className="py-1 pl-3 text-right">
                    <select
                      value={String(c.direction ?? 1)}
                      onChange={(e) => updateCalAt(c.joint, { direction: Number(e.target.value) })}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      title="Sign flip — -1 for mirror-mounted servos"
                      className="nodrag nopan rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[11px]"
                    >
                      <option value="1">+1</option>
                      <option value="-1">-1</option>
                    </select>
                  </td>
                  <td className="py-1 pl-3 text-right">
                    <NumberInput
                      value={c.zero_offset_deg ?? 0}
                      step={5}
                      onChange={(n) => updateCalAt(c.joint, { zero_offset_deg: n })}
                      onPointerDown={(e) => e.stopPropagation()}
                      title="Servo angle when the joint is at math zero"
                      className="nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-right font-mono text-[11px]"
                    />
                  </td>
                  <td className="py-1 pl-3 text-right">
                    <NumberInput
                      value={c.scale ?? 1}
                      step={0.1}
                      onChange={(n) => updateCalAt(c.joint, { scale: n })}
                      onPointerDown={(e) => e.stopPropagation()}
                      title="Gear ratio — math° per servo° (1.0 = direct drive)"
                      className="nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-right font-mono text-[11px]"
                    />
                  </td>
                  <td className="py-1 pl-3 text-right">
                    <NumberInput
                      value={c.servo_min_deg ?? 0}
                      step={5}
                      onChange={(n) => updateCalAt(c.joint, { servo_min_deg: n })}
                      onPointerDown={(e) => e.stopPropagation()}
                      title="Physical lower bound of the linked servo"
                      className="nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-right font-mono text-[11px]"
                    />
                  </td>
                  <td className="py-1 pl-3 text-right">
                    <NumberInput
                      value={c.servo_max_deg ?? 180}
                      step={5}
                      onChange={(n) => updateCalAt(c.joint, { servo_max_deg: n })}
                      onPointerDown={(e) => e.stopPropagation()}
                      title="Physical upper bound of the linked servo"
                      className="nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-right font-mono text-[11px]"
                    />
                  </td>
                  <td
                    className={`py-1 pl-3 text-right font-mono ${
                      cmdServo === null ? 'text-slate-600' : outOfRange ? 'text-rose-300' : 'text-slate-300'
                    }`}
                    title={
                      cmdServo === null
                        ? 'No solution yet — solve to see the commanded servo angle'
                        : outOfRange
                        ? `Would be commanded outside [${c.servo_min_deg ?? 0}, ${c.servo_max_deg ?? 180}]`
                        : 'Current commanded servo angle'
                    }
                  >
                    {cmdServo === null ? '—' : `${cmdServo.toFixed(1)}°`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {setCalReq.error && (
          <div className="mt-1 truncate font-mono text-[10px] text-rose-300" title={setCalReq.error}>
            ● {setCalReq.error}
          </div>
        )}
      </section>
    </div>
  )
}
