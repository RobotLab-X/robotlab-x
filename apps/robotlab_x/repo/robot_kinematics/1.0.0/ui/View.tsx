// ─────────────────────────────────────────────────────────────────────
// robot_kinematics — whole-body multi-chain IK view.
//
//  • Rig library — load bundled examples (InMoov) or saved user rigs.
//  • Two render modes (toggle):
//      Skeleton — fast 2-D iso projection of every link world position.
//      Skinned  — WebGL: the baked GLB, each link node driven by the
//                 solver's live world pose (rigid skinning). A 3-D
//                 TransformControls gizmo is the "true pendant" — drag
//                 the selected end-effector's target in space; IK follows.
//  • Numeric x/y/z pendants per end-effector (work in either mode).
//  • Solve / Reset / Send-to-servos, and "head → right hand" demo.
// ─────────────────────────────────────────────────────────────────────
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, TransformControls, useGLTF } from '@react-three/drei'
import {
  Physics, RigidBody, CuboidCollider, CylinderCollider, BallCollider, useFixedJoint,
} from '@react-three/rapier'
import type { RapierRigidBody } from '@react-three/rapier'
import { NumberInput, useWsClient, useServiceRequest } from '@rlx/ui'
import type { ServiceProxy, InboundFrame } from '@rlx/ui'

interface EEStatus {
  name: string; link: string
  mode: 'position' | 'pose' | 'look_at'
  pos_mm?: number[] | null; error_mm?: number | null
}
interface Target { x: number; y: number; z: number }
interface LinkPose { pos: number[]; quat: number[] }
interface Prop {
  id: string; type: string
  pose: { x: number; y: number; z: number }
  dims: Record<string, number>
  color: string
  graspable?: boolean
  grasp_link?: string
}
interface RKState {
  rig_id?: string | null; rig_title?: string | null
  visual?: string | null
  loaded?: boolean; error?: string | null
  end_effectors?: EEStatus[]
  targets?: Record<string, Target>
  props?: Prop[]
  link_positions?: Record<string, number[]>
  link_poses?: Record<string, LinkPose>
  link_parents?: Record<string, string>
  limit_violations?: string[]
  colliding_links?: string[]
  obstacle_clearance_mm?: number | null
  avoid_obstacles?: boolean
  follow_servos?: boolean
  hand_curl?: Record<string, number>
  calibration?: JointCal[]
  joint_limits?: Record<string, number[]>   // joint -> [lower_deg, upper_deg]
}
interface JointCal {
  joint: string
  servo_proxy_id?: string | null
  zero_offset_deg?: number
  direction?: number
  scale?: number
  servo_min_deg?: number
  servo_max_deg?: number
}
interface RigRow { rig_id: string; title: string; source?: string; root: 'bundled' | 'user'; end_effectors?: string[] }

const COS30 = Math.cos(Math.PI / 6)
const SIN30 = Math.sin(Math.PI / 6)
function iso(p: number[]): [number, number] {
  const [x, y, z] = p
  return [(x - y) * COS30, (x + y) * SIN30 - z]
}

// ─── Skinned (WebGL) ──────────────────────────────────────────────────

// ─── scene props (procedural: bar table, cup, box) ───────────────────
// three's CylinderGeometry axis is +Y; the world is Z-up, so vertical
// cylinders rotate +90° about X.

function BarTableMesh({ dims, color }: { dims: Record<string, number>; color: string }) {
  const topR = (dims.top_d ?? 480) / 2 / 1000
  const H = (dims.height ?? 1050) / 1000
  const poleR = (dims.pole_d ?? 60) / 2 / 1000
  const topT = (dims.top_thickness ?? 36) / 1000
  return (
    <group>
      <mesh position={[0, 0, 0.012]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[topR * 0.7, topR * 0.75, 0.024, 32]} />
        <meshStandardMaterial color={color} metalness={0.3} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0, H / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[poleR, poleR, H, 20]} />
        <meshStandardMaterial color={color} metalness={0.3} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0, H - topT / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[topR, topR, topT, 48]} />
        <meshStandardMaterial color={color} metalness={0.2} roughness={0.7} />
      </mesh>
    </group>
  )
}

function CupMesh({ dims, color }: { dims: Record<string, number>; color: string }) {
  const r = (dims.d ?? 72) / 2 / 1000
  const h = (dims.height ?? 95) / 1000
  return (
    <group>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[r, r * 0.9, h, 28, 1, true]} />
        <meshStandardMaterial color={color} side={THREE.DoubleSide} metalness={0.1} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0, -h / 2 + 0.004]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[r * 0.9, r * 0.9, 0.008, 28]} />
        <meshStandardMaterial color={color} metalness={0.1} roughness={0.5} />
      </mesh>
    </group>
  )
}

/** One scene prop placed at a world-frame center (meters) + orientation.
 *  ``held`` brightens it while attached to the hand. */
function PropMesh({ prop, centerPos, quat, held }: {
  prop: Prop; centerPos: [number, number, number]
  quat: [number, number, number, number]; held: boolean
}) {
  const color = held ? '#f4a261' : prop.color
  let shape
  if (prop.type === 'bar_table') shape = <BarTableMesh dims={prop.dims} color={color} />
  else if (prop.type === 'cup') shape = <CupMesh dims={prop.dims} color={color} />
  else {
    const s = (k: string, d: number) => (prop.dims[k] ?? d) / 1000
    shape = (
      <mesh><boxGeometry args={[s('x', 60), s('y', 60), s('z', 60)]} />
        <meshStandardMaterial color={color} /></mesh>
    )
  }
  return <group position={centerPos} quaternion={quat}>{shape}</group>
}

// ─── physics (Rapier) ─────────────────────────────────────────────────
// Opt-in: cup = dynamic body, table/floor = static, the grasp hand = a
// kinematic collider driven by the link pose. Grasp = a fixed joint
// hand↔cup; release removes it and the cup falls under gravity. World is
// Z-up, so gravity is along -Z (not Rapier's default -Y).

/** Invisible kinematic collider tracking a hand link's live pose so the
 *  hand can knock the cup and anchor the grasp joint. Each frame it teleports
 *  to the latest IK pose; a generous radius keeps contact despite the
 *  discrete jumps between solves. */
function HandBody({ bodyRef, pose }: {
  bodyRef?: React.MutableRefObject<RapierRigidBody | null>
  pose?: LinkPose
}) {
  const internal = useRef<RapierRigidBody | null>(null)
  const ref = bodyRef ?? internal
  const poseRef = useRef<LinkPose | undefined>(pose)
  poseRef.current = pose
  useFrame(() => {
    const b = ref.current, p = poseRef.current
    if (!b || !p) return
    b.setNextKinematicTranslation({ x: p.pos[0] / 1000, y: p.pos[1] / 1000, z: p.pos[2] / 1000 })
    b.setNextKinematicRotation({ x: p.quat[0], y: p.quat[1], z: p.quat[2], w: p.quat[3] })
  })
  return (
    <RigidBody ref={ref} type="kinematicPosition" colliders={false}>
      <BallCollider args={[0.07]} />
    </RigidBody>
  )
}

/** Fixed joint locking the cup to the hand (small palm offset). Mounted
 *  only while grasped — unmounting removes the joint so the cup drops. */
function Grasp({ handRef, cupRef }: {
  handRef: React.MutableRefObject<RapierRigidBody | null>
  cupRef: React.MutableRefObject<RapierRigidBody | null>
}) {
  useFixedJoint(handRef, cupRef, [[0, 0, 0.04], [0, 0, 0, 1], [0, 0, 0], [0, 0, 0, 1]])
  return null
}

/** Physics subtree: floor + table (static), cup (dynamic, CCD), one
 *  kinematic collider per hand link, and the grasp joint while held.
 *  Remount (via key) to reset positions. ``debug`` draws collider
 *  wireframes so you can see whether the hand colliders track the hands. */
function PhysicsProps({ props, handLinks, graspLink, linkPoses, grabbedCupId, debug }: {
  props: Prop[]; handLinks: string[]; graspLink: string
  linkPoses: Record<string, LinkPose>; grabbedCupId: string | null; debug: boolean
}) {
  const handRef = useRef<RapierRigidBody | null>(null)
  const cupRef = useRef<RapierRigidBody | null>(null)
  const cup = props.find((p) => p.graspable)
  return (
    <Physics gravity={[0, 0, -9.81]} debug={debug}>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[2, 2, 0.01]} position={[0, 0, -0.011]} />
      </RigidBody>
      {handLinks.map((link) => (
        <HandBody key={link} pose={linkPoses[link]}
          bodyRef={link === graspLink ? handRef : undefined} />
      ))}
      {props.map((p) => {
        if (p.type === 'bar_table') {
          const topR = (p.dims.top_d ?? 480) / 2 / 1000
          const H = (p.dims.height ?? 1050) / 1000
          const topT = (p.dims.top_thickness ?? 36) / 1000
          const poleR = (p.dims.pole_d ?? 60) / 2 / 1000
          return (
            <RigidBody key={p.id} type="fixed" colliders={false}
              position={[p.pose.x / 1000, p.pose.y / 1000, 0]}>
              <BarTableMesh dims={p.dims} color={p.color} />
              {/* full solid: top disc + pole + base disc */}
              <CylinderCollider args={[topT / 2, topR]} position={[0, 0, H - topT / 2]}
                rotation={[Math.PI / 2, 0, 0]} />
              <CylinderCollider args={[(H - topT) / 2, poleR]} position={[0, 0, (H - topT) / 2]}
                rotation={[Math.PI / 2, 0, 0]} />
              <CylinderCollider args={[0.012, topR * 0.72]} position={[0, 0, 0.012]}
                rotation={[Math.PI / 2, 0, 0]} />
            </RigidBody>
          )
        }
        if (p.type === 'cup') {
          const r = (p.dims.d ?? 72) / 2 / 1000
          const h = (p.dims.height ?? 95) / 1000
          return (
            <RigidBody key={p.id} ref={cupRef} type="dynamic" colliders={false} ccd mass={0.2}
              position={[p.pose.x / 1000, p.pose.y / 1000, (p.pose.z + h / 2) / 1000]}>
              <CupMesh dims={p.dims} color={p.color} />
              <CylinderCollider args={[h / 2, r]} rotation={[Math.PI / 2, 0, 0]} />
            </RigidBody>
          )
        }
        return null
      })}
      {cup && grabbedCupId === cup.id && <Grasp handRef={handRef} cupRef={cupRef} />}
    </Physics>
  )
}

/** Loads the baked GLB and rigidly drives each link node by its world
 *  pose. Link nodes are flat children of the scene root (the bake emits
 *  one node per link), so each node's local transform IS its world
 *  transform once the root is neutralised. */
function SkinnedRobot({ url, poses }: { url: string; poses: Record<string, LinkPose> }) {
  const gltf = useGLTF(url)
  const scene = gltf.scene
  useEffect(() => {
    scene.position.set(0, 0, 0); scene.rotation.set(0, 0, 0); scene.scale.set(1, 1, 1)
  }, [scene])
  useEffect(() => {
    for (const link in poses) {
      const n = scene.getObjectByName(link)
      if (!n) continue
      const p = poses[link]
      n.position.set(p.pos[0] / 1000, p.pos[1] / 1000, p.pos[2] / 1000)
      n.quaternion.set(p.quat[0], p.quat[1], p.quat[2], p.quat[3])
    }
  }, [scene, poses])
  return <primitive object={scene} />
}

/** A draggable 3-D pendant. The marker sphere sits at the target; when its
 *  end-effector is selected a TransformControls gizmo attaches to it so the
 *  operator can drag the target through space — release commits set_target.
 *
 *  The gizmo is attached via ``object={ref}`` (NOT by wrapping children):
 *  wrapping moves a parent group, leaving the mesh's own position stale, so
 *  the commit would send the original value. With ``object`` the gizmo
 *  mutates the mesh's position directly — and since the mesh is a direct
 *  child of the scene root, that local position IS the world position. */
function PendantMarker({
  ee, target, selected, orbitRef, onSelect, onCommit,
}: {
  ee: EEStatus; target: Target; selected: boolean
  orbitRef: React.MutableRefObject<{ enabled: boolean } | null>
  onSelect: (name: string) => void
  onCommit: (name: string, x: number, y: number, z: number) => void
}) {
  const ref = useRef<THREE.Mesh>(null!)
  // Position imperatively so external edits (numeric inputs, a solve, another
  // EE) move the marker without fighting the gizmo's own mutations.
  useEffect(() => {
    if (ref.current) ref.current.position.set(target.x / 1000, target.y / 1000, target.z / 1000)
  }, [target.x, target.y, target.z])
  const color = ee.mode === 'look_at' ? '#a78bfa' : selected ? '#f59e0b' : '#38bdf8'
  return (
    <>
      <mesh ref={ref} onClick={(e) => { e.stopPropagation(); onSelect(ee.name) }}>
        <sphereGeometry args={[0.03, 20, 20]} />
        <meshStandardMaterial color={color} emissive={color}
          emissiveIntensity={selected ? 0.6 : 0.3} />
      </mesh>
      {selected && (
        <TransformControls
          object={ref} mode="translate" size={0.75}
          onMouseDown={() => { if (orbitRef.current) orbitRef.current.enabled = false }}
          onMouseUp={() => {
            if (orbitRef.current) orbitRef.current.enabled = true
            const p = ref.current.position
            onCommit(ee.name, p.x * 1000, p.y * 1000, p.z * 1000)
          }}
        />
      )}
    </>
  )
}

/** Resolve a prop's render center (meters) + orientation. Held/dropped
 *  props follow the grasp link's live pose; static props sit at their own
 *  pose (cup centered half-its-height above its base). */
function propTransform(
  p: Prop, grabbed: string | null,
  dropped: Record<string, LinkPose>, linkPoses: Record<string, LinkPose>,
): { centerPos: [number, number, number]; quat: [number, number, number, number]; held: boolean } {
  const held = grabbed === p.id
  const lp = held ? linkPoses[p.grasp_link ?? ''] : undefined
  const src = lp ?? (!held ? dropped[p.id] : undefined)
  if (src) {
    return { centerPos: [src.pos[0] / 1000, src.pos[1] / 1000, src.pos[2] / 1000],
             quat: src.quat as [number, number, number, number], held }
  }
  if (p.type === 'bar_table') {
    return { centerPos: [p.pose.x / 1000, p.pose.y / 1000, 0], quat: [0, 0, 0, 1], held }
  }
  const h = p.dims.height ?? 0
  return { centerPos: [p.pose.x / 1000, p.pose.y / 1000, (p.pose.z + h / 2) / 1000],
           quat: [0, 0, 0, 1], held }
}

function SkinnedScene({
  url, state, selected, grabbed, dropped, physics, physicsDebug, resetKey, onSelect, onCommit,
}: {
  url: string; state: RKState; selected: string
  grabbed: string | null; dropped: Record<string, LinkPose>
  physics: boolean; physicsDebug: boolean; resetKey: number
  onSelect: (n: string) => void
  onCommit: (n: string, x: number, y: number, z: number) => void
}) {
  const orbitRef = useRef<{ enabled: boolean } | null>(null)
  const cupProp = (state.props ?? []).find((p) => p.graspable)
  // Hand links get kinematic colliders: every non-look_at end-effector.
  const handLinks = (state.end_effectors ?? [])
    .filter((e) => e.mode !== 'look_at').map((e) => e.link)
  return (
    <Canvas camera={{ up: [0, 0, 1], position: [1.3, -1.3, 1.4], fov: 50, near: 0.05, far: 50 }}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[2, 2, 4]} intensity={0.9} />
      <directionalLight position={[-2, -1, 1]} intensity={0.3} />
      {/* floor + grid (Z-up: plane normal is already +Z) */}
      <mesh position={[0, 0, -0.002]}>
        <planeGeometry args={[4, 4]} />
        <meshStandardMaterial color="#0b1220" />
      </mesh>
      <gridHelper args={[4, 16, '#334155', '#1e293b']} rotation={[Math.PI / 2, 0, 0]} />
      {url && (
        <Suspense fallback={null}>
          <SkinnedRobot url={url} poses={state.link_poses ?? {}} />
        </Suspense>
      )}
      {physics ? (
        <PhysicsProps key={resetKey} props={state.props ?? []} handLinks={handLinks}
          graspLink={cupProp?.grasp_link ?? ''} linkPoses={state.link_poses ?? {}}
          grabbedCupId={grabbed} debug={physicsDebug} />
      ) : (
        (state.props ?? []).map((p) => {
          const { centerPos, quat, held } = propTransform(p, grabbed, dropped, state.link_poses ?? {})
          return <PropMesh key={p.id} prop={p} centerPos={centerPos} quat={quat} held={held} />
        })
      )}
      {(state.end_effectors ?? []).map((ee) => (
        <PendantMarker key={ee.name} ee={ee} target={state.targets?.[ee.name] ?? { x: 0, y: 0, z: 0 }}
          selected={selected === ee.name} orbitRef={orbitRef} onSelect={onSelect} onCommit={onCommit} />
      ))}
      {/* red glow at any link currently colliding with an obstacle */}
      {(state.colliding_links ?? []).map((link) => {
        const lp = state.link_poses?.[link]
        if (!lp) return null
        return (
          <mesh key={`col-${link}`} position={[lp.pos[0] / 1000, lp.pos[1] / 1000, lp.pos[2] / 1000]}>
            <sphereGeometry args={[0.06, 16, 16]} />
            <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0.8}
              transparent opacity={0.45} />
          </mesh>
        )
      })}
      {/* @ts-expect-error drei ref typing is loose */}
      <OrbitControls ref={orbitRef} makeDefault target={[0, 0, 1.0]} />
    </Canvas>
  )
}

// ─── component ────────────────────────────────────────────────────────

/** Compact labelled number input for a calibration knob. Holds a local
 *  draft while the operator types and commits on blur / Enter — so a
 *  state re-render from the bus doesn't yank the value mid-edit. */
function CalNum({ label, value, step = 1, onCommit }: {
  label: string; value: number; step?: number; onCommit: (v: number) => void
}) {
  const [draft, setDraft] = useState<string>(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])
  const commit = () => {
    const v = parseFloat(draft)
    if (!Number.isNaN(v) && v !== value) onCommit(v)
    else setDraft(String(value))
  }
  return (
    <label className="flex items-center gap-1 font-mono text-[9px] text-slate-500">
      <span className="w-[52px] shrink-0">{label}</span>
      <input type="number" step={step} value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
        className="nodrag nopan w-full rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[10px] text-slate-200" />
    </label>
  )
}

export default function RobotKinematicsView({ proxy }: { proxy: ServiceProxy }) {
  const ws = useWsClient()
  const proxyId = proxy.id ?? proxy.name ?? ''
  const [type, version] = (proxy.service_meta_id ?? 'robot_kinematics@1.0.0').split('@')
  const control = `/${type}/${proxyId}/control`
  const [state, setState] = useState<RKState>({})
  const [rigs, setRigs] = useState<RigRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [skinned, setSkinned] = useState(true)
  const [selectedEE, setSelectedEE] = useState('')
  const [grabbed, setGrabbed] = useState<string | null>(null)
  const [dropped, setDropped] = useState<Record<string, LinkPose>>({})
  const [physics, setPhysics] = useState(false)
  const [physicsDebug, setPhysicsDebug] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const [servoProxies, setServoProxies] = useState<Record<string, { connected?: boolean; angle?: number }>>({})
  const [showServos, setShowServos] = useState(false)
  const [calOpen, setCalOpen] = useState<string | null>(null)   // joint whose calibration detail is expanded

  useEffect(() => {
    if (!proxyId) return
    const off = ws.subscribe(`/${type}/${proxyId}/state`, (f: InboundFrame) => {
      if (f.method === 'message' && f.payload && typeof f.payload === 'object') {
        setState(f.payload as RKState)
      }
    })
    return off
  }, [ws, type, proxyId])

  // Discover live servo@1.0.0 proxies (same as ik_solver) so joints can be
  // linked to them from the UI.
  useEffect(() => {
    const off = ws.subscribe('/servo/+/state', (f: InboundFrame) => {
      if (f.method !== 'message') return
      const m = (f.topic ?? '').match(/^\/servo\/([^/]+)\/state$/)
      if (!m) return
      const p = (f.payload ?? {}) as { attached?: boolean; angle?: number; current_angle?: number }
      setServoProxies((prev) => ({
        ...prev,
        [m[1]]: { connected: !!p.attached, angle: typeof p.current_angle === 'number' ? p.current_angle : p.angle },
      }))
    })
    return off
  }, [ws])

  // Auto-select the first end-effector once a rig loads, so its drag gizmo
  // is visible immediately (otherwise nothing shows until the operator
  // clicks a target/card and the "drag the gizmo" hint reads as a no-op).
  useEffect(() => {
    if (!selectedEE && state.end_effectors && state.end_effectors.length > 0) {
      setSelectedEE(state.end_effectors[0].name)
    }
  }, [state.end_effectors, selectedEE])

  const req = useServiceRequest<{ rigs?: RigRow[] }>(control, {
    timeoutMs: 30_000, errorField: 'error', replyPrefix: `rk-${proxyId}`,
  })
  const refreshRigs = useCallback(async () => {
    try { const r = await req.request('list_rigs'); setRigs((r as { rigs?: RigRow[] })?.rigs ?? []); setErr(null) }
    catch (e) { setErr(String((e as Error)?.message ?? e)) }
  }, [req])
  useEffect(() => { void refreshRigs() }, [proxyId])  // eslint-disable-line react-hooks/exhaustive-deps

  const call = useCallback(async (action: string, payload?: Record<string, unknown>) => {
    try { await req.request(action, payload); setErr(null) }
    catch (e) { setErr(String((e as Error)?.message ?? e)) }
  }, [req])

  const onLoadRig = (id: string) => void call('load_rig', { id })
  const onSetTarget = (ee: string, x: number, y: number, z: number) =>
    void call('set_target', { ee, x, y, z, solve: true })
  const onAimHeadAtHand = () => {
    const t = state.targets?.right_hand
    if (t) void call('set_target', { ee: 'head', x: t.x, y: t.y, z: t.z, solve: true })
  }

  // ─── grab pipeline (cup on the bar table) ────────────────────────
  const cup = useMemo(() => (state.props ?? []).find((p) => p.graspable), [state.props])
  const eeForLink = useCallback(
    (link?: string) => (state.end_effectors ?? []).find((e) => e.link === link)?.name,
    [state.end_effectors],
  )
  // Reach: aim the grasp link's end-effector at the cup's grasp point
  // (cup center = base + half height). Validated reachable on InMoov.
  const onReachForCup = useCallback(() => {
    if (!cup) return
    const ee = eeForLink(cup.grasp_link)
    if (!ee) return
    const gx = Math.round(cup.pose.x), gy = Math.round(cup.pose.y)
    const gz = Math.round(cup.pose.z + (cup.dims.height ?? 0) / 2)
    setSelectedEE(ee)
    // Aim the head at the cup too — "look at what you grab", and it keeps the
    // shared waist consistent with the reach. Then solve the hand to the cup.
    const head = (state.end_effectors ?? []).find((e) => e.mode === 'look_at')
    if (head) void call('set_target', { ee: head.name, x: gx, y: gy, z: gz, solve: false })
    void call('set_target', { ee, x: gx, y: gy, z: gz, solve: true })
  }, [cup, eeForLink, call, state.end_effectors])
  const onToggleAvoid = useCallback(() => {
    void call('set_obstacle_avoidance', { enabled: !(state.avoid_obstacles ?? true) })
  }, [call, state.avoid_obstacles])
  const onToggleFollow = useCallback(() => {
    void call('set_follow_servos', { enabled: !(state.follow_servos ?? false) })
  }, [call, state.follow_servos])
  const onLinkServo = useCallback((joint: string, proxyId: string) => {
    void call('link_servo', { joint, proxy_id: proxyId })   // auto-fits by default
  }, [call])
  const onUnlinkServo = useCallback((joint: string) => {
    void call('unlink_servo', { joint })
  }, [call])
  // Re-fit a joint's calibration to its math-range ↔ servo-range. dir
  // flips the mapping; omit to keep the current direction.
  const onAutoFit = useCallback((joint: string, direction?: number) => {
    void call('auto_calibrate', direction === undefined ? { joint } : { joint, direction })
  }, [call])
  const onSetCal = useCallback((joint: string, patch: Record<string, number>) => {
    void call('set_calibration', { joint, ...patch })
  }, [call])
  const servoIds = useMemo(() => Object.keys(servoProxies).sort(), [servoProxies])
  const linkedCount = (state.calibration ?? []).filter((c) => !!c.servo_proxy_id).length
  const onSetHand = useCallback((side: 'r' | 'l', amount: number) => {
    void call('set_hand', { side, amount })
  }, [call])
  const graspSide = (cup?.grasp_link ?? '').startsWith('l_') ? 'l' : 'r'
  const onGrasp = useCallback(() => {
    if (!cup) return
    setGrabbed(cup.id)
    void call('set_hand', { side: graspSide, amount: 1.0 })  // curl fingers around it
  }, [cup, call, graspSide])
  const onRelease = useCallback(() => {
    if (!cup) return
    const lp = state.link_poses?.[cup.grasp_link ?? '']
    if (lp) setDropped((d) => ({ ...d, [cup.id]: lp }))  // leave it where the hand let go
    setGrabbed(null)
    void call('set_hand', { side: graspSide, amount: 0.0 })  // open the hand
  }, [cup, state.link_poses, call, graspSide])
  const onResetScene = useCallback(() => {
    setGrabbed(null); setDropped({}); setResetKey((k) => k + 1)  // remount physics → cup back on table
  }, [])

  const glbUrl = state.visual ? `/repo/${type}/${version}/file/${state.visual}` : ''

  // skeleton projection (2-D fallback / fast mode)
  const view = useMemo(() => {
    const lp = state.link_positions ?? {}
    const names = Object.keys(lp)
    if (names.length === 0) return null
    const pts: Record<string, [number, number]> = {}
    for (const n of names) pts[n] = iso(lp[n])
    const xs = names.map((n) => pts[n][0]); const ys = names.map((n) => pts[n][1])
    for (const t of Object.values(state.targets ?? {})) { const [a, b] = iso([t.x, t.y, t.z]); xs.push(a); ys.push(b) }
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    const pad = 40, w = (maxX - minX) || 1, h = (maxY - minY) || 1
    return { pts, minX, minY, pad, vbW: w + pad * 2, vbH: h + pad * 2 }
  }, [state.link_positions, state.targets])
  const eeLinks = useMemo(() => new Set((state.end_effectors ?? []).map((e) => e.link)), [state.end_effectors])

  return (
    <div className="flex h-full min-h-[420px] min-w-[760px] gap-3 p-3 text-xs" onPointerDown={(e) => e.stopPropagation()}>
      {/* LEFT — viewport fills the available area */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-[9px] uppercase tracking-wider text-slate-400">
            {skinned ? 'Skinned — drag the arrows to move the selected target (orange) · pick one at right' : 'Skeleton (iso)'}
          </span>
          <div className="flex gap-1">
            {skinned && (
              <button type="button" onClick={() => setPhysics((p) => !p)}
                onPointerDown={(e) => e.stopPropagation()}
                title="Rapier physics — the cup falls, tips, and is held by a real joint"
                className={`nodrag nopan rounded px-1.5 py-0.5 text-[10px] ${physics ? 'bg-orange-700 text-orange-50' : 'border border-slate-800 text-slate-400 hover:border-slate-600'}`}>
                Physics {physics ? 'on' : 'off'}
              </button>
            )}
            {skinned && physics && (
              <button type="button" onClick={() => setPhysicsDebug((d) => !d)}
                onPointerDown={(e) => e.stopPropagation()}
                title="Draw Rapier collider wireframes (diagnose whether the hand colliders track the hands)"
                className={`nodrag nopan rounded px-1.5 py-0.5 text-[10px] ${physicsDebug ? 'bg-fuchsia-700 text-fuchsia-50' : 'border border-slate-800 text-slate-400 hover:border-slate-600'}`}>
                Debug
              </button>
            )}
            {(['Skinned', 'Skeleton'] as const).map((m) => {
              const on = (m === 'Skinned') === skinned
              return (
                <button key={m} type="button" onClick={() => setSkinned(m === 'Skinned')}
                  onPointerDown={(e) => e.stopPropagation()}
                  className={`nodrag nopan rounded px-1.5 py-0.5 text-[10px] ${on ? 'bg-slate-700 text-slate-100' : 'border border-slate-800 text-slate-400 hover:border-slate-600'}`}>{m}</button>
              )
            })}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden rounded border border-slate-800 bg-slate-950">
          {skinned ? (
            state.loaded && glbUrl ? (
              <SkinnedScene url={glbUrl} state={state} selected={selectedEE}
                grabbed={grabbed} dropped={dropped} physics={physics} physicsDebug={physicsDebug} resetKey={resetKey}
                onSelect={setSelectedEE}
                onCommit={(n, x, y, z) => onSetTarget(n, Math.round(x), Math.round(y), Math.round(z))} />
            ) : (
              <div className="flex h-full items-center justify-center text-slate-600">
                {state.loaded ? 'rig has no visual GLB' : 'load a rig to render'}
              </div>
            )
          ) : view ? (
            <svg viewBox={`0 0 ${view.vbW} ${view.vbH}`} className="h-full w-full">
              {Object.entries(state.link_parents ?? {}).map(([link, parent]) => {
                const a = view.pts[link], b = view.pts[parent]
                if (!a || !b) return null
                return <line key={link} x1={a[0] - view.minX + view.pad} y1={a[1] - view.minY + view.pad}
                  x2={b[0] - view.minX + view.pad} y2={b[1] - view.minY + view.pad} stroke="#475569" strokeWidth={1.5} />
              })}
              {Object.entries(view.pts).map(([n, p]) => (
                <circle key={n} cx={p[0] - view.minX + view.pad} cy={p[1] - view.minY + view.pad}
                  r={eeLinks.has(n) ? 4 : 1.5} fill={eeLinks.has(n) ? '#38bdf8' : '#64748b'} />
              ))}
              {Object.entries(state.targets ?? {}).map(([name, t]) => {
                const [px, py] = iso([t.x, t.y, t.z]); const cx = px - view.minX + view.pad, cy = py - view.minY + view.pad
                return <g key={name}><circle cx={cx} cy={cy} r={6} fill="none" stroke="#f59e0b" strokeWidth={1.5} />
                  <line x1={cx - 9} y1={cy} x2={cx + 9} y2={cy} stroke="#f59e0b" strokeWidth={1} />
                  <line x1={cx} y1={cy - 9} x2={cx} y2={cy + 9} stroke="#f59e0b" strokeWidth={1} /></g>
              })}
            </svg>
          ) : (
            <div className="flex h-full items-center justify-center text-slate-600">load a rig to render</div>
          )}
        </div>
        {state.limit_violations && state.limit_violations.length > 0 && (
          <div className="truncate font-mono text-[10px] text-amber-300" title={state.limit_violations.join(', ')}>
            ⚠ {state.limit_violations.length} joint(s) at limit
          </div>
        )}
        {state.colliding_links && state.colliding_links.length > 0 && (
          <div className="truncate font-mono text-[10px] text-rose-400" title={state.colliding_links.join(', ')}>
            ⚠ collision: {state.colliding_links.join(', ')}
          </div>
        )}
      </div>

      {/* RIGHT — sidebar column: rigs + per-end-effector pendants */}
      <div className="flex w-[280px] shrink-0 flex-col gap-2 overflow-y-auto">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">Whole-Body IK</span>
          <span className="min-w-0 truncate font-mono text-[10px] text-slate-400" title={state.rig_title ?? ''}>
            {state.rig_title || state.rig_id || 'no rig'}
          </span>
        </div>
        {state.error && <div className="truncate font-mono text-[10px] text-rose-300" title={state.error}>{state.error}</div>}

        {/* Rigs */}
        <div>
          <div className="mb-1 text-[9px] uppercase tracking-wider text-sky-300">Rigs</div>
          <ul className="space-y-1">
            {rigs.length === 0 && <li className="text-[10px] text-slate-600">none found</li>}
            {rigs.map((r) => (
              <li key={r.rig_id} className="flex items-center justify-between gap-2 rounded border border-slate-800 bg-slate-950 px-2 py-1">
                <span className="min-w-0 truncate">
                  <span className="truncate text-slate-200">{r.title}</span>
                  <span className="ml-1 font-mono text-[9px] text-slate-500">{r.root} · {(r.end_effectors ?? []).length}ee</span>
                </span>
                <button type="button" onClick={() => onLoadRig(r.rig_id)} disabled={req.inFlight}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="nodrag nopan rounded bg-sky-600 px-1.5 py-0.5 text-[10px] text-white hover:bg-sky-500 disabled:opacity-50">
                  {req.inFlight ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Load'}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-1">
            <button type="button" onClick={() => void call('solve', { iters: 200 })} disabled={!state.loaded || req.inFlight}
              onPointerDown={(e) => e.stopPropagation()}
              className="nodrag nopan rounded bg-emerald-600 px-2 py-0.5 text-[10px] text-white hover:bg-emerald-500 disabled:opacity-50">Solve</button>
            <button type="button" onClick={() => void call('reset')} disabled={!state.loaded}
              onPointerDown={(e) => e.stopPropagation()}
              className="nodrag nopan rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:border-slate-500">Reset</button>
            <button type="button" onClick={() => void call('send_to_servos')} disabled={!state.loaded}
              onPointerDown={(e) => e.stopPropagation()}
              className="nodrag nopan rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:border-slate-500">Send to servos</button>
            <button type="button" onClick={onAimHeadAtHand} disabled={!state.targets?.right_hand}
              onPointerDown={(e) => e.stopPropagation()} title="Point the head's look-at at the right hand's target"
              className="nodrag nopan rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:border-slate-500">Head → right hand</button>
          </div>
        </div>

        {/* Hands — tendon-style open/close (every finger joint curls proportionally) */}
        {(state.end_effectors ?? []).some((e) => e.mode !== 'look_at') && (
          <div>
            <div className="mb-1 text-[9px] uppercase tracking-wider text-slate-400">Hands</div>
            {(['r', 'l'] as const).map((side) => {
              const curl = state.hand_curl?.[side] ?? 0
              const closed = curl > 0.5
              return (
                <div key={side} className="mb-1 flex items-center gap-1">
                  <span className="w-9 text-[10px] text-slate-400">{side === 'r' ? 'Right' : 'Left'}</span>
                  <button type="button" onClick={() => onSetHand(side, 1)} disabled={!state.loaded}
                    onPointerDown={(e) => e.stopPropagation()}
                    className={`nodrag nopan rounded px-2 py-0.5 text-[10px] ${closed ? 'bg-slate-700 text-slate-100' : 'border border-slate-700 text-slate-300 hover:border-slate-500'}`}>Close</button>
                  <button type="button" onClick={() => onSetHand(side, 0)} disabled={!state.loaded}
                    onPointerDown={(e) => e.stopPropagation()}
                    className={`nodrag nopan rounded px-2 py-0.5 text-[10px] ${!closed ? 'bg-slate-700 text-slate-100' : 'border border-slate-700 text-slate-300 hover:border-slate-500'}`}>Open</button>
                  <span className="font-mono text-[9px] text-slate-500">{Math.round(curl * 100)}%</span>
                </div>
              )
            })}
          </div>
        )}

        {/* Grab pipeline — only when the rig ships a graspable prop (cup) */}
        {cup && (
          <div>
            <div className="mb-1 text-[9px] uppercase tracking-wider text-orange-300">Grab the cup</div>
            <div className="flex flex-wrap gap-1">
              <button type="button" onClick={onReachForCup} disabled={!state.loaded || req.inFlight}
                onPointerDown={(e) => e.stopPropagation()} title="Move the hand to the cup"
                className="nodrag nopan rounded bg-sky-600 px-2 py-0.5 text-[10px] text-white hover:bg-sky-500 disabled:opacity-50">1 · Reach</button>
              {grabbed === cup.id ? (
                <button type="button" onClick={onRelease}
                  onPointerDown={(e) => e.stopPropagation()} title="Let go — drops where the hand is"
                  className="nodrag nopan rounded bg-amber-600 px-2 py-0.5 text-[10px] text-white hover:bg-amber-500">3 · Release</button>
              ) : (
                <button type="button" onClick={onGrasp} disabled={!state.loaded}
                  onPointerDown={(e) => e.stopPropagation()} title="Attach the cup to the hand"
                  className="nodrag nopan rounded bg-emerald-600 px-2 py-0.5 text-[10px] text-white hover:bg-emerald-500 disabled:opacity-50">2 · Grasp</button>
              )}
              <button type="button" onClick={onResetScene}
                onPointerDown={(e) => e.stopPropagation()} title="Put the cup back on the table"
                className="nodrag nopan rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:border-slate-500">Reset cup</button>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <button type="button" onClick={onToggleAvoid} disabled={!state.loaded}
                onPointerDown={(e) => e.stopPropagation()}
                title="Collision-aware IK — the arm avoids driving through the table"
                className={`nodrag nopan rounded px-2 py-0.5 text-[10px] ${(state.avoid_obstacles ?? true) ? 'bg-teal-700 text-teal-50' : 'border border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                Avoid table {(state.avoid_obstacles ?? true) ? 'on' : 'off'}
              </button>
              {state.obstacle_clearance_mm != null && (
                <span className={`font-mono text-[10px] ${state.obstacle_clearance_mm < 0 ? 'text-rose-400' : 'text-slate-500'}`}>
                  clearance {state.obstacle_clearance_mm.toFixed(0)}mm
                </span>
              )}
            </div>
            <div className="mt-1 text-[9px] text-slate-500">
              Reach → Grasp → drag the hand pendant to lift → Release. {grabbed === cup.id ? '(holding)' : ''}
            </div>
          </div>
        )}

        {/* Per-EE pendants (stacked) */}
        <div>
          <div className="mb-1 text-[9px] uppercase tracking-wider text-slate-400">End-effectors</div>
          <div className="flex flex-col gap-2">
            {(state.end_effectors ?? []).map((ee) => {
              const t = state.targets?.[ee.name] ?? { x: 0, y: 0, z: 0 }
              const sel = selectedEE === ee.name
              return (
                <div key={ee.name}
                  onClick={() => setSelectedEE(ee.name)}
                  className={`cursor-pointer rounded border p-2 ${sel ? 'border-amber-500/60 bg-slate-900/60' : 'border-slate-800 bg-slate-900/40'}`}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-medium text-slate-200">{ee.name}</span>
                    <span className="font-mono text-[9px] text-slate-500">
                      {ee.mode}{ee.error_mm != null ? ` · err ${ee.error_mm.toFixed(0)}mm` : ''}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    {(['x', 'y', 'z'] as const).map((axis) => (
                      <label key={axis} className="flex flex-1 flex-col">
                        <span className="mb-0.5 text-[9px] uppercase text-slate-500">{axis} (mm)</span>
                        <NumberInput value={Math.round(t[axis])} step={10}
                          onChange={(v: number) => onSetTarget(ee.name, axis === 'x' ? v : t.x, axis === 'y' ? v : t.y, axis === 'z' ? v : t.z)}
                          onPointerDown={(e) => e.stopPropagation()}
                          className="nodrag nopan w-full rounded border border-slate-700 bg-slate-950 px-1 py-0.5 font-mono text-[11px]" />
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Servos — link joints to live servo@1.0.0 proxies (like ik_solver) */}
        {(state.calibration ?? []).length > 0 && (
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <button type="button" onClick={() => setShowServos((v) => !v)}
                onPointerDown={(e) => e.stopPropagation()}
                className="nodrag nopan flex-1 text-left text-[9px] uppercase tracking-wider text-slate-400 hover:text-slate-200">
                Servos · {linkedCount}/{(state.calibration ?? []).length} linked · {servoIds.length} found {showServos ? '▾' : '▸'}
              </button>
              <button type="button" onClick={onToggleFollow} disabled={!state.loaded || linkedCount === 0}
                onPointerDown={(e) => e.stopPropagation()}
                title="Mirror live servo angles onto the linked joints (display the hardware; pauses IK on those joints)"
                className={`nodrag nopan shrink-0 rounded px-2 py-0.5 text-[10px] ${state.follow_servos ? 'bg-amber-700 text-amber-50' : 'border border-slate-700 text-slate-400 hover:border-slate-500'} disabled:opacity-50`}>
                Follow {state.follow_servos ? 'on' : 'off'}
              </button>
            </div>
            {showServos && (
              <div className="max-h-[220px] space-y-0.5 overflow-y-auto rounded border border-slate-800 bg-slate-950/60 p-1">
                {servoIds.length === 0 && (
                  <div className="px-1 text-[10px] text-slate-600">no servo instances running — start servo@1.0.0 proxies</div>
                )}
                {(state.calibration ?? []).map((c) => {
                  const linked = !!c.servo_proxy_id
                  const lim = state.joint_limits?.[c.joint]
                  const open = calOpen === c.joint
                  return (
                    <div key={c.joint} className="rounded px-1 hover:bg-slate-900/40">
                      <div className="flex items-center justify-between gap-1">
                        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-300" title={c.joint}>{c.joint}</span>
                        {linked && (
                          <button type="button" onClick={() => setCalOpen(open ? null : c.joint)}
                            onPointerDown={(e) => e.stopPropagation()} title="Calibration"
                            className={`nodrag nopan shrink-0 rounded px-1 py-0.5 text-[10px] ${open ? 'text-sky-300' : 'text-slate-500 hover:text-slate-300'}`}>
                            ⚙
                          </button>
                        )}
                        {linked ? (
                          <button type="button" onClick={() => onUnlinkServo(c.joint)}
                            onPointerDown={(e) => e.stopPropagation()} title="Click to unlink"
                            className="nodrag nopan shrink-0 rounded bg-emerald-900/60 px-1.5 py-0.5 text-[10px] text-emerald-200 hover:bg-rose-900/60 hover:text-rose-200">
                            ● {c.servo_proxy_id}
                          </button>
                        ) : (
                          <select value="" onChange={(e) => { if (e.target.value) onLinkServo(c.joint, e.target.value) }}
                            onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
                            className="nodrag nopan shrink-0 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[10px]">
                            <option value="">○ unlinked</option>
                            {servoIds.map((id) => <option key={id} value={id}>{id}</option>)}
                          </select>
                        )}
                      </div>
                      {/* Calibration detail: math range → servo range, the
                          affine knobs, and Auto-fit / Flip. The mapping is
                          servo° = math°·dir·scale + offset; Auto-fit refits
                          it so full servo travel spans the joint range. */}
                      {linked && open && (
                        <div className="mb-1 ml-1 space-y-1 border-l border-slate-800 pl-2 pt-1">
                          <div className="flex items-center justify-between gap-1 font-mono text-[9px] text-slate-500">
                            <span>
                              math {lim ? `${lim[0].toFixed(0)}..${lim[1].toFixed(0)}°` : '?'} → servo {(c.servo_min_deg ?? 0).toFixed(0)}..{(c.servo_max_deg ?? 180).toFixed(0)}°
                            </span>
                          </div>
                          <div className="font-mono text-[9px] text-slate-600">
                            servo = math·{c.direction ?? 1}·{(c.scale ?? 1).toFixed(3)} + {(c.zero_offset_deg ?? 0).toFixed(1)}
                          </div>
                          <div className="flex items-center gap-1">
                            <button type="button" onClick={() => onAutoFit(c.joint)}
                              onPointerDown={(e) => e.stopPropagation()}
                              title="Fit the servo's full range onto the joint's math range"
                              className="nodrag nopan rounded bg-sky-900/60 px-1.5 py-0.5 text-[10px] text-sky-200 hover:bg-sky-800/60">
                              Auto-fit
                            </button>
                            <button type="button" onClick={() => onAutoFit(c.joint, (c.direction ?? 1) < 0 ? 1 : -1)}
                              onPointerDown={(e) => e.stopPropagation()}
                              title="Reverse the servo direction and re-fit"
                              className="nodrag nopan rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500">
                              Flip
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-1">
                            <CalNum label="offset" value={c.zero_offset_deg ?? 0}
                              onCommit={(v) => onSetCal(c.joint, { zero_offset_deg: v })} />
                            <CalNum label="scale" value={c.scale ?? 1} step={0.05}
                              onCommit={(v) => onSetCal(c.joint, { scale: v })} />
                            <CalNum label="servo min" value={c.servo_min_deg ?? 0}
                              onCommit={(v) => onSetCal(c.joint, { servo_min_deg: v })} />
                            <CalNum label="servo max" value={c.servo_max_deg ?? 180}
                              onCommit={(v) => onSetCal(c.joint, { servo_max_deg: v })} />
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {err && <div className="truncate font-mono text-[10px] text-rose-300" title={err}>{err}</div>}
      </div>
    </div>
  )
}
