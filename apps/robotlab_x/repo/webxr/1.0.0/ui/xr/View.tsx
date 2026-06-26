// WebXR immersive client (xr.js) — opened ON THE HEADSET (Quest 3).
//
// Served full-page at /r/<runtime>/xr/<proxy> (see host XrView). Enters
// an immersive-vr session, reads head + controller pose/buttons/axes
// each XRFrame, and publishes them to /webxr/<id>/input over the runtime
// bus (the service frame-converts + republishes for actuators). Also
// renders the service's configured feed panels (camera MJPEG, telemetry)
// so the operator can fly the robot first-person.
//
// Stack: @react-three/xr v6 (createXRStore / <XR> / useXRInputSourceState)
// on react-three-fiber v8 — the same r3f the other service UIs bundle.
// Controllers/hands render by default in v6; we only READ their state.
//
// Dev secure-context: WebXR needs HTTPS except on localhost. Reach the
// runtime from the Quest via `adb reverse tcp:8998 tcp:8998` (USB) so it
// appears at http://localhost:8998 (a secure context) — no TLS.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Grid, Text } from '@react-three/drei'
import { createXRStore, XR, useXRInputSourceState } from '@react-three/xr'
import html2canvas from 'html2canvas'
import { useWsClient } from '@rlx/ui'
import type { ServiceProxy, InboundFrame, WsClient } from '@rlx/ui'

// One store for the page. createXRStore configures the session; inputs
// (controllers/hands) are included by default in v6. emulate:false keeps
// the IWER desktop emulator (and its bundled synthetic-environment GLBs)
// out — this bundle targets a real headset.
const store = createXRStore({ emulate: false })

type Pose = { position: number[]; orientation: number[] }
type Anchor = 'world' | 'head' | 'body' | 'wrist'
type PanelCfg = {
  id: string; title?: string
  source: { kind: string; ref: string }
  placement?: Anchor; lazy?: number
  transform: { pos: number[]; quat: number[]; width_m: number; height_m: number; scale: number }
  shape?: string; enabled?: boolean
}
type PanelsMsg = { publish_rate_hz?: number; panels?: PanelCfg[] }

// ── per-frame telemetry reader → bus ─────────────────────────────────
// Lives INSIDE <XR> so useXRInputSourceState has context, and inside
// <Canvas> so useFrame runs each XR frame. Batches head + both
// controllers into one /input message, throttled to the configured rate.
function Telemetry({ topic, ws, rateHz }: { topic: string; ws: WsClient; rateHz: number }) {
  const left = useXRInputSourceState('controller', 'left')
  const right = useXRInputSourceState('controller', 'right')
  const { camera } = useThree()
  const acc = useRef(0)
  const fps = useRef(0)
  const tmpP = useMemo(() => new THREE.Vector3(), [])
  const tmpQ = useMemo(() => new THREE.Quaternion(), [])

  const poseOf = (obj: THREE.Object3D | undefined | null): Pose | undefined => {
    if (!obj) return undefined
    obj.getWorldPosition(tmpP)
    obj.getWorldQuaternion(tmpQ)
    return { position: [tmpP.x, tmpP.y, tmpP.z], orientation: [tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w] }
  }

  // Map a controller's gamepad into a snapshot. We enumerate EVERY
  // component the controller exposes (trigger, squeeze, thumbstick,
  // a/b/x/y, thumbrest, …) with its full state — analog value, x/y axes,
  // and state (default | touched | pressed) — so nothing is dropped and
  // any actuator mapping can reach any input. ``buttons``/``axes`` are
  // kept as convenience aliases for the common mappings.
  const readCtrl = (c: typeof left) => {
    if (!c) return null
    const ray = poseOf(c.object)
    if (!ray) return null
    const gp = c.gamepad ?? {}
    const comp = (id: string) => gp[id]
    const pressed = (id: string) => comp(id)?.state === 'pressed'
    const ts = comp('xr-standard-thumbstick')
    // Generic: every component the WebXR gamepad reports for this device.
    const components: Record<string, { state: string; value: number; x: number; y: number }> = {}
    for (const id in gp) {
      const s = gp[id]
      if (!s) continue
      components[id] = {
        state: s.state ?? 'default',
        value: s.button ?? (s.state === 'pressed' ? 1 : 0),
        x: s.xAxis ?? 0,
        y: s.yAxis ?? 0,
      }
    }
    return {
      ray, grip: ray,
      buttons: {
        trigger: comp('xr-standard-trigger')?.button ?? 0,
        grip: comp('xr-standard-squeeze')?.button ?? 0,
        a: pressed('a-button'), b: pressed('b-button'),
        x: pressed('x-button'), y: pressed('y-button'),
        thumb: pressed('xr-standard-thumbstick'),
      },
      axes: { x: ts?.xAxis ?? 0, y: ts?.yAxis ?? 0 },
      components,
    }
  }

  useFrame((_, dt) => {
    fps.current = dt > 0 ? 1 / dt : 0
    acc.current += dt
    const period = 1 / Math.max(1, rateHz)
    if (acc.current < period) return
    acc.current = 0
    camera.getWorldPosition(tmpP)
    camera.getWorldQuaternion(tmpQ)
    const head: Pose = {
      position: [tmpP.x, tmpP.y, tmpP.z],
      orientation: [tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w],
    }
    ws.publish(topic, {
      ts: Date.now() / 1000,
      session: { active: true, mode: 'immersive-vr', fps: Math.round(fps.current) },
      head,
      controllers: { left: readCtrl(left), right: readCtrl(right) },
    })
  })
  return null
}

// ── feed panels ──────────────────────────────────────────────────────
// Build the MJPEG <img> URL from a panel ref. Accepts:
//   • a runtime stream id ("video/video-1") → /v1/stream/<id>/mjpeg
//   • a same-origin path ("/v1/stream/…")   → used as-is
//   • an absolute URL (external IP camera)   → used as-is
// Same-origin runtime streams get the access token appended (the <img>
// tag can't send an Authorization header; the route auths via ?token=).
// The token is whatever the host login stored — same key the bus uses.
function mjpegUrl(ref: string): string {
  let u: string
  const r = ref.trim()
  if (/^https?:\/\//i.test(r)) return r                       // external, as-is
  if (r.startsWith('/')) u = r                                 // same-origin path
  else u = `/v1/stream/${encodeURIComponent(r)}/mjpeg`         // a stream id
  let tok: string | null = null
  try { tok = localStorage.getItem('robotlab_x.access_token') } catch { /* ignore */ }
  if (tok && !u.includes('token=')) u += (u.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(tok)
  return u
}

// Shared manipulation refs (P4): the manager moves a grabbed panel's
// <group> directly via this id→group map; hoverRef names the panel the
// right ray is currently over.
type PanelRefs = React.MutableRefObject<Map<string, THREE.Group>>
type HoverRef = React.MutableRefObject<string | null>

// Panel CONTENT renders at the wrapper group's LOCAL origin (the
// ManipulablePanel <group> owns the world transform). Content never
// positions itself — so manipulation is uniform across feed types.
function VideoContent({ p }: { p: PanelCfg }) {
  const tex = useMemo(() => {
    const u = mjpegUrl(p.source.ref)
    const img = new Image()
    if (/^https?:\/\//i.test(u)) img.crossOrigin = 'anonymous'  // CORS only for external
    img.src = u                        // MJPEG multipart stream keeps updating the <img>
    const t = new THREE.Texture(img)
    t.colorSpace = THREE.SRGBColorSpace
    img.onload = () => { t.needsUpdate = true }
    return t
  }, [p.source.ref])
  useFrame(() => { if (tex.image && (tex.image as HTMLImageElement).complete) tex.needsUpdate = true })
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <mesh>
      <planeGeometry args={[p.transform.width_m, p.transform.height_m]} />
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  )
}

function TelemetryContent({ p, ws }: { p: PanelCfg; ws: WsClient }) {
  const [text, setText] = useState('(waiting…)')
  useEffect(() => {
    if (!p.source.ref) return
    const off = ws.subscribe(p.source.ref, (f: InboundFrame) => {
      if (f.method !== 'message') return
      try { setText(JSON.stringify(f.payload, null, 1).slice(0, 600)) }
      catch { setText(String(f.payload)) }
    })
    return () => off()
  }, [ws, p.source.ref])
  return (
    <>
      <mesh>
        <planeGeometry args={[p.transform.width_m, p.transform.height_m]} />
        <meshBasicMaterial color="#0b1220" transparent opacity={0.85} />
      </mesh>
      <Text position={[-p.transform.width_m / 2 + 0.04, p.transform.height_m / 2 - 0.06, 0.01]}
        anchorX="left" anchorY="top" fontSize={0.035} maxWidth={p.transform.width_m - 0.08}
        color="#9fe7ff">
        {`${p.title ?? p.source.ref}\n${text}`}
      </Text>
    </>
  )
}

// Forward one synthetic pointer interaction into a same-origin iframe at
// its document coords (px, py). React (17+) delegates events at the root,
// so native bubbling events trigger the embedded SPA's onClick / onPointer*
// handlers. `phase`: hover (move), press (down), release (up + click +
// focus). Same-origin is required — elementFromPoint/dispatchEvent on a
// cross-origin frame throws (we swallow it).
function dispatchIframe(
  iframe: HTMLIFrameElement | null, px: number, py: number, phase: 'move' | 'down' | 'up',
): void {
  const win = iframe?.contentWindow as (Window & typeof globalThis) | null | undefined
  const doc = iframe?.contentDocument
  if (!win || !doc?.body) return
  let target: Element | null
  try { target = doc.elementFromPoint(px, py) } catch { return }
  if (!target) return
  const PE = (win as unknown as { PointerEvent?: typeof PointerEvent }).PointerEvent ?? win.MouseEvent
  const base = { bubbles: true, cancelable: true, composed: true, view: win, clientX: px, clientY: py, button: 0 }
  const fire = (Ctor: typeof win.MouseEvent, type: string, extra?: Record<string, unknown>) => {
    try { target!.dispatchEvent(new Ctor(type, { ...base, ...extra })) } catch { /* ignore */ }
  }
  const ptr = { pointerId: 1, pointerType: 'mouse', isPrimary: true }
  if (phase === 'move') {
    fire(PE as typeof win.MouseEvent, 'pointermove', ptr)
    fire(win.MouseEvent, 'mousemove')
  } else if (phase === 'down') {
    fire(PE as typeof win.MouseEvent, 'pointerover', ptr)
    fire(PE as typeof win.MouseEvent, 'pointerdown', { ...ptr, buttons: 1 })
    fire(win.MouseEvent, 'mousedown', { buttons: 1 })
  } else {
    fire(PE as typeof win.MouseEvent, 'pointerup', ptr)
    fire(win.MouseEvent, 'mouseup')
    fire(win.MouseEvent, 'click')
    const t = target as HTMLElement
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) {
      try { t.focus() } catch { /* ignore */ }
    }
  }
}

// The text field (in some browser panel's iframe) the VR keyboard types
// into. `win` is the iframe realm — its HTMLInputElement/Event ctors must
// be used to mutate + notify elements that live in that realm.
type KbField = { win: Window & typeof globalThis; el: HTMLElement }

// Dispatch a best-effort keyboard event into the iframe realm.
function fireKey(win: KbField['win'], el: HTMLElement, type: string, key: string, keyCode: number): void {
  try {
    el.dispatchEvent(new win.KeyboardEvent(type, {
      key, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true, view: win,
    } as KeyboardEventInit))
  } catch { /* ignore */ }
}

// Type one key into the focused field. `key` is a printable char or
// 'Backspace'/'Enter'. Controlled React inputs only update when the value
// is set through the prototype's native setter AND an 'input' event fires —
// so we splice the value at the caret, set it that way, then notify.
function typeInto(field: KbField | null, key: string): void {
  const win = field?.win
  const el = field?.el
  if (!win || !el || !el.isConnected) return
  try { el.focus() } catch { /* ignore */ }
  const kc = key === 'Backspace' ? 8 : key === 'Enter' ? 13 : key.charCodeAt(0)
  fireKey(win, el, 'keydown', key, kc)
  const isText = el instanceof win.HTMLInputElement || el instanceof win.HTMLTextAreaElement
  if (isText) {
    const input = el as HTMLInputElement | HTMLTextAreaElement
    const start = input.selectionStart ?? input.value.length
    const end = input.selectionEnd ?? input.value.length
    let val = input.value
    let caret = start
    if (key === 'Backspace') {
      if (start === end && start > 0) { val = val.slice(0, start - 1) + val.slice(end); caret = start - 1 }
      else { val = val.slice(0, start) + val.slice(end); caret = start }
    } else if (key === 'Enter') {
      if (el instanceof win.HTMLTextAreaElement) { val = val.slice(0, start) + '\n' + val.slice(end); caret = start + 1 }
      else { fireKey(win, el, 'keyup', key, kc); return }   // single-line: Enter submits, never inserts
    } else {
      val = val.slice(0, start) + key + val.slice(end); caret = start + key.length
    }
    const proto = el instanceof win.HTMLTextAreaElement ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    if (setter) setter.call(input, val); else input.value = val
    try { input.setSelectionRange(caret, caret) } catch { /* ignore */ }
    input.dispatchEvent(new win.Event('input', { bubbles: true }))
  } else if (el.isContentEditable) {
    try {
      const d = win.document as Document & { execCommand?: (c: string, ui?: boolean, v?: string) => boolean }
      if (key === 'Backspace') d.execCommand?.('delete')
      else if (key === 'Enter') d.execCommand?.('insertLineBreak')
      else d.execCommand?.('insertText', false, key)
    } catch { /* ignore */ }
  }
  fireKey(win, el, 'keyup', key, kc)
}

// Browser panel — surface a same-origin web UI (a service's "Open in
// window" dock view) as a live, INTERACTIVE texture. DOM can't be
// composited into an immersive WebXR scene, so we load the UI in a hidden,
// off-screen same-origin iframe and rasterize it to a CanvasTexture with
// html2canvas a few times a second. Being same-origin, the iframe shares
// localStorage — the dock SPA boots already authenticated, exactly as the
// desktop "Open in window" popup does.
//
// Interactivity: the right-controller ray drives r3f pointer events on the
// plane (the XR trigger maps to pointer down/up/click). We read the hit UV,
// map it to iframe pixels (UV origin is bottom-left, DOM is top-left), and
// forward synthetic events into the iframe so you can press buttons in VR.
// Disabled while ARRANGING — in arrange mode the grab overlay occludes the
// plane and the trigger means "move the panel", not "click".
function BrowserContent({ p, arrange, onField }: {
  p: PanelCfg; arrange: boolean; onField?: (f: KbField) => void
}) {
  // Capture/iframe pixel size — tracks the panel aspect so text stays
  // legible without distortion. Drives both the texture canvas and the UV→
  // pixel mapping, so they can never drift apart.
  const size = useMemo(() => {
    const w = 1536          // crisper text; html2canvas is gated by `busy` so it just runs as fast as it can
    const aspect = p.transform.height_m / Math.max(0.01, p.transform.width_m)
    return { w, h: Math.max(256, Math.round(w * aspect)) }
  }, [p.transform.width_m, p.transform.height_m])

  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  // One persistent canvas backs the texture; each capture is drawn onto it
  // (html2canvas hands back a NEW canvas per call). LinearFilter + a little
  // anisotropy keeps text sharp at grazing/oblique viewing angles.
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = size.w
    c.height = size.h
    const ctx = c.getContext('2d')
    if (ctx) { ctx.fillStyle = '#0b1220'; ctx.fillRect(0, 0, c.width, c.height) }
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    t.minFilter = THREE.LinearFilter
    t.generateMipmaps = false
    t.anisotropy = 8
    return t
  }, [size])

  useEffect(() => {
    const ref = (p.source.ref || '').trim()
    if (!ref) return
    const canvas = tex.image as HTMLCanvasElement
    const ctx = canvas.getContext('2d')
    // Hidden but laid out at the capture resolution (NOT display:none, which
    // would zero its size) so the SPA renders at a real desktop width.
    const iframe = document.createElement('iframe')
    iframe.src = ref
    iframe.width = String(canvas.width)
    iframe.height = String(canvas.height)
    Object.assign(iframe.style, {
      position: 'fixed', left: '-10000px', top: '0px', border: '0',
      width: `${canvas.width}px`, height: `${canvas.height}px`,
      opacity: '0', pointerEvents: 'none', zIndex: '-1',
    })
    document.body.appendChild(iframe)
    iframeRef.current = iframe

    let stopped = false
    let busy = false
    const tick = async () => {
      if (stopped || busy) return
      const doc = iframe.contentDocument
      if (!doc?.body) return                          // not loaded / cross-origin
      busy = true
      try {
        const shot = await html2canvas(doc.documentElement, {
          backgroundColor: '#0b1220', logging: false, useCORS: true, scale: 1,
          width: canvas.width, height: canvas.height,
          windowWidth: canvas.width, windowHeight: canvas.height,
        })
        if (!stopped && ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          ctx.drawImage(shot, 0, 0, canvas.width, canvas.height)
          tex.needsUpdate = true
        }
      } catch { /* transient layout/paint race — retry next tick */ }
      finally { busy = false }
    }
    const interval = window.setInterval(() => { void tick() }, 100)
    return () => {
      stopped = true
      window.clearInterval(interval)
      iframeRef.current = null
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
    }
  }, [p.source.ref, tex])

  useEffect(() => () => tex.dispose(), [tex])

  // UV (bottom-left origin) → iframe document pixels (top-left origin).
  const forward = useCallback((uv: THREE.Vector2 | undefined, phase: 'move' | 'down' | 'up') => {
    if (arrange || !uv) return
    dispatchIframe(iframeRef.current, uv.x * size.w, (1 - uv.y) * size.h, phase)
  }, [arrange, size])

  // After a tap, surface the now-focused text field to the VR keyboard.
  const onUp = useCallback((uv: THREE.Vector2 | undefined) => {
    forward(uv, 'up')
    const win = iframeRef.current?.contentWindow as (Window & typeof globalThis) | null | undefined
    const act = iframeRef.current?.contentDocument?.activeElement as HTMLElement | null
    if (win && act && (/^(INPUT|TEXTAREA)$/.test(act.tagName) || act.isContentEditable)) {
      onField?.({ win, el: act })
    }
  }, [forward, onField])

  return (
    <mesh
      onPointerMove={(e) => { if (!arrange) { e.stopPropagation(); forward(e.uv, 'move') } }}
      onPointerDown={(e) => { if (!arrange) { e.stopPropagation(); forward(e.uv, 'down') } }}
      onPointerUp={(e) => { if (!arrange) { e.stopPropagation(); onUp(e.uv) } }}
    >
      <planeGeometry args={[p.transform.width_m, p.transform.height_m]} />
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  )
}

// Wraps any content with the shared transform group + (in arrange mode) a
// grab frame the right-controller ray can hover/grab. The transform is
// applied IMPERATIVELY from config so a re-render (or the manager moving
// the group mid-grab) never gets clobbered by a JSX prop.
function ManipulablePanel({ p, arrange, panelRefs, hoverRef, children }: {
  p: PanelCfg; arrange: boolean; panelRefs: PanelRefs; hoverRef: HoverRef; children: React.ReactNode
}) {
  const ref = useRef<THREE.Group>(null)
  const [hover, setHover] = useState(false)
  // Register the group so PanelSystem can position it each frame (per its
  // anchor) + move it during grab. PanelSystem owns the transform entirely.
  useEffect(() => {
    const g = ref.current
    if (g) panelRefs.current.set(p.id, g)
    return () => { panelRefs.current.delete(p.id) }
  }, [p.id, panelRefs])
  const pad = 0.06
  return (
    <group ref={ref}>
      {children}
      {arrange && (
        <mesh
          position={[0, 0, 0.002]}
          onPointerOver={() => { setHover(true); hoverRef.current = p.id }}
          onPointerOut={() => { setHover(false); if (hoverRef.current === p.id) hoverRef.current = null }}
        >
          <planeGeometry args={[p.transform.width_m + pad, p.transform.height_m + pad]} />
          <meshBasicMaterial color={hover ? '#22d3ee' : '#64748b'} transparent opacity={hover ? 0.28 : 0.12}
            side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
    </group>
  )
}

function Panels({ panels, ws, arrange, panelRefs, hoverRef, onField }: {
  panels: PanelCfg[]; ws: WsClient; arrange: boolean; panelRefs: PanelRefs; hoverRef: HoverRef
  onField?: (f: KbField) => void
}) {
  return (
    <>
      {panels.filter((p) => p.enabled !== false).map((p) => (
        <ManipulablePanel key={p.id} p={p} arrange={arrange} panelRefs={panelRefs} hoverRef={hoverRef}>
          {p.source.kind === 'telemetry'
            ? <TelemetryContent p={p} ws={ws} />
            : p.source.kind === 'video_mjpeg'
              ? <VideoContent p={p} />
              : p.source.kind === 'browser'
                ? <BrowserContent p={p} arrange={arrange} onField={onField} />
                : null}
        </ManipulablePanel>
      ))}
    </>
  )
}

// Right-controller grab: in arrange mode, hold the trigger while the ray
// is over a panel to move + rotate it (6-DOF rigid follow). While held,
// right thumbstick Y = push/pull along the ray (nearer/farther without
// walking), thumbstick X = scale. Commits pos/quat/scale on release via
// onCommit (→ set_panel).
const PUSH_SPEED = 1.6     // metres/sec along the ray at full stick
const SCALE_SPEED = 1.6    // scale factor/sec at full stick
const STICK_DEAD = 0.15
const SCALE_MIN = 0.2
const SCALE_MAX = 6

// PanelSystem — owns ALL panel placement each frame. Every panel's
// transform is interpreted in its ANCHOR frame; this drives the group's
// world pose toward anchor·offset (lazy for head/body, snap for
// world/wrist). The grabbed panel is exempt — the right controller drives
// it in world space (move/rotate + thumbstick push-pull/scale); on
// release its world pose is converted back into the anchor frame and
// committed as the new offset.
function PanelSystem({ panels, arrange, panelRefs, hoverRef, onCommit }: {
  panels: PanelCfg[]; arrange: boolean; panelRefs: PanelRefs; hoverRef: HoverRef
  onCommit: (id: string, t: { pos: number[]; quat: number[]; scale: number }) => void
}) {
  const right = useXRInputSourceState('controller', 'right')
  const left = useXRInputSourceState('controller', 'left')
  const { camera } = useThree()
  const grab = useRef<{ id: string; offPos: THREE.Vector3; offQuat: THREE.Quaternion } | null>(null)
  const prevTrig = useRef(false)
  const byId = useMemo(() => new Map(panels.map((p) => [p.id, p])), [panels])

  // scratch
  const mAnchor = useMemo(() => new THREE.Matrix4(), [])
  const mOffset = useMemo(() => new THREE.Matrix4(), [])
  const mWorld = useMemo(() => new THREE.Matrix4(), [])
  const mLocal = useMemo(() => new THREE.Matrix4(), [])
  const pos = useMemo(() => new THREE.Vector3(), [])
  const quat = useMemo(() => new THREE.Quaternion(), [])
  const scl = useMemo(() => new THREE.Vector3(), [])
  const ONE = useMemo(() => new THREE.Vector3(1, 1, 1), [])
  const qYaw = useMemo(() => new THREE.Quaternion(), [])
  const eul = useMemo(() => new THREE.Euler(0, 0, 0, 'YXZ'), [])
  const cPos = useMemo(() => new THREE.Vector3(), [])
  const cQuat = useMemo(() => new THREE.Quaternion(), [])

  // Fill `out` with the anchor's world matrix; return false for 'world'.
  const fillAnchor = (placement: Anchor, out: THREE.Matrix4): boolean => {
    if (placement === 'head') {
      camera.updateWorldMatrix(true, false)
      camera.matrixWorld.decompose(cPos, cQuat, scl)
      out.compose(cPos, cQuat, ONE)
      return true
    }
    if (placement === 'body') {
      camera.updateWorldMatrix(true, false)
      camera.matrixWorld.decompose(cPos, cQuat, scl)
      eul.setFromQuaternion(cQuat, 'YXZ')        // yaw only
      qYaw.setFromEuler(eul.set(0, eul.y, 0, 'YXZ'))
      out.compose(cPos, qYaw, ONE)
      return true
    }
    if (placement === 'wrist' && left?.object) {
      left.object.updateWorldMatrix(true, false)
      left.object.matrixWorld.decompose(cPos, cQuat, scl)
      out.compose(cPos, cQuat, ONE)
      return true
    }
    return false
  }

  const offsetMatrixOf = (p: PanelCfg, out: THREE.Matrix4) => {
    pos.set(p.transform.pos[0], p.transform.pos[1], p.transform.pos[2])
    quat.set(p.transform.quat[0], p.transform.quat[1], p.transform.quat[2], p.transform.quat[3])
    out.compose(pos, quat, ONE)
  }

  const commit = () => {
    const gb = grab.current
    grab.current = null
    if (!gb) return
    const g = panelRefs.current.get(gb.id)
    if (!g) return
    g.updateWorldMatrix(true, false)
    const placement = (byId.get(gb.id)?.placement ?? 'world') as Anchor
    if (fillAnchor(placement, mAnchor)) {
      mWorld.copy(mAnchor).invert().multiply(g.matrixWorld)   // offset in anchor frame
    } else {
      mWorld.copy(g.matrixWorld)
    }
    mWorld.decompose(pos, quat, scl)
    onCommit(gb.id, {
      pos: [pos.x, pos.y, pos.z],
      quat: [quat.x, quat.y, quat.z, quat.w],
      scale: g.scale.x,
    })
  }

  useFrame((_, dt) => {
    const obj = right?.object
    const gp = right?.gamepad
    const trig = ((gp?.['xr-standard-trigger']?.button) ?? 0) > 0.5

    // ── grab (right controller, arrange mode only) ──
    if (arrange && obj) {
      obj.updateWorldMatrix(true, false)
      if (trig && !prevTrig.current && !grab.current) {            // grab start
        const id = hoverRef.current
        const g = id ? panelRefs.current.get(id) : null
        if (id && g) {
          g.updateWorldMatrix(true, false)
          mLocal.copy(obj.matrixWorld).invert().multiply(g.matrixWorld)
          const offPos = new THREE.Vector3()
          const offQuat = new THREE.Quaternion()
          mLocal.decompose(offPos, offQuat, scl)
          grab.current = { id, offPos, offQuat }
        }
      }
      if (trig && grab.current) {                                  // follow + push/pull + scale
        const g = panelRefs.current.get(grab.current.id)
        if (g) {
          const stick = gp?.['xr-standard-thumbstick']
          const sy = stick?.yAxis ?? 0
          const sx = stick?.xAxis ?? 0
          if (Math.abs(sy) > STICK_DEAD) grab.current.offPos.z += sy * PUSH_SPEED * dt   // up → farther
          if (Math.abs(sx) > STICK_DEAD) {
            const s = Math.min(SCALE_MAX, Math.max(SCALE_MIN, g.scale.x * (1 + sx * SCALE_SPEED * dt)))
            g.scale.setScalar(s)
          }
          mLocal.compose(grab.current.offPos, grab.current.offQuat, ONE)
          mWorld.copy(obj.matrixWorld).multiply(mLocal)
          if (g.parent) { g.parent.updateWorldMatrix(true, false); mWorld.premultiply(mLocal.copy(g.parent.matrixWorld).invert()) }
          mWorld.decompose(pos, quat, scl)
          g.position.copy(pos)
          g.quaternion.copy(quat)
        }
      }
      if (!trig && grab.current) commit()                          // release
    } else if (grab.current) {
      commit()
    }
    prevTrig.current = trig

    // ── anchor placement for every non-grabbed panel ──
    for (const [id, g] of panelRefs.current) {
      if (grab.current?.id === id) continue
      const p = byId.get(id)
      if (!p) continue
      const placement = (p.placement ?? 'world') as Anchor
      offsetMatrixOf(p, mOffset)
      if (fillAnchor(placement, mAnchor)) mWorld.copy(mAnchor).multiply(mOffset)
      else mWorld.copy(mOffset)
      if (g.parent) { g.parent.updateWorldMatrix(true, false); mLocal.copy(g.parent.matrixWorld).invert().multiply(mWorld) }
      else mLocal.copy(mWorld)
      mLocal.decompose(pos, quat, scl)
      const lazy = (placement === 'head' || placement === 'body')
      const f = lazy ? Math.min(1, (p.lazy ?? 0.12) * dt * 60) : 1
      if (f >= 1) { g.position.copy(pos); g.quaternion.copy(quat) }
      else { g.position.lerp(pos, f); g.quaternion.slerp(quat, f) }
      g.scale.setScalar(p.transform.scale)
    }
  })
  return null
}

// A sensible default offset for a freshly-set anchor (so "lock to head"
// snaps the panel directly ahead, etc.). The operator then grabs to
// fine-tune. Shared by the in-VR menu + the desktop anchor selector.
export function defaultOffsetForAnchor(anchor: Anchor): { pos: number[]; quat: number[] } {
  switch (anchor) {
    case 'head': return { pos: [0, 0, -1.5], quat: [0, 0, 0, 1] }
    case 'body': return { pos: [0, -0.1, -1.4], quat: [0, 0, 0, 1] }
    case 'wrist': return { pos: [0, 0.04, -0.08], quat: [0, 0, 0, 1] }
    default: return { pos: [0, 1.4, -1.5], quat: [0, 0, 0, 1] }   // world
  }
}

// Left Y button toggles arrange mode (edge-detected).
function ArrangeToggle({ onToggle }: { onToggle: () => void }) {
  const left = useXRInputSourceState('controller', 'left')
  const prev = useRef(false)
  useFrame(() => {
    const pressed = (left?.gamepad?.['y-button']?.state) === 'pressed'
    if (pressed && !prev.current) onToggle()
    prev.current = pressed
  })
  return null
}

// ── menu (gaze-pinned gear → menu panel) ─────────────────────────────
// Rigidly head-locks its children to a fixed spot in view — used for the
// always-there gear + the menu (chrome that should never drift).
function HeadLocked({ offset, children }: { offset: [number, number, number]; children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null)
  const { camera } = useThree()
  const p = useMemo(() => new THREE.Vector3(), [])
  const q = useMemo(() => new THREE.Quaternion(), [])
  const s = useMemo(() => new THREE.Vector3(), [])
  const off = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const g = ref.current
    if (!g) return
    camera.updateWorldMatrix(true, false)
    camera.matrixWorld.decompose(p, q, s)
    off.set(offset[0], offset[1], offset[2]).applyQuaternion(q)
    g.position.copy(p).add(off)
    g.quaternion.copy(q)
  })
  return <group ref={ref}>{children}</group>
}

function MenuButton({ label, onClick, width = 0.74, color = '#1e293b' }: {
  label: string; onClick: () => void; width?: number; color?: string
}) {
  const [hover, setHover] = useState(false)
  return (
    <group>
      <mesh
        onClick={(e) => { e.stopPropagation(); onClick() }}
        onPointerOver={() => setHover(true)}
        onPointerOut={() => setHover(false)}
      >
        <planeGeometry args={[width, 0.09]} />
        <meshBasicMaterial color={hover ? '#0ea5e9' : color} transparent opacity={0.92} />
      </mesh>
      <Text position={[0, 0, 0.006]} fontSize={0.04} color="#e2e8f0" anchorX="center" anchorY="middle">
        {label}
      </Text>
    </group>
  )
}

const ANCHOR_CYCLE: Anchor[] = ['world', 'head', 'body', 'wrist']

type SvcLite = { id: string; label: string; running: boolean }

function MenuSystem({ panels, arrange, services, onToggleArrange, onRecenter, onSetAnchor, onToggleEnabled, publishPanel, onRefreshServices, onAddService }: {
  panels: PanelCfg[]; arrange: boolean; services: SvcLite[]
  onToggleArrange: () => void; onRecenter: () => void
  onSetAnchor: (id: string, anchor: Anchor) => void; onToggleEnabled: (id: string) => void
  publishPanel: (panel: PanelCfg) => void
  onRefreshServices: () => void; onAddService: (proxyId: string) => void
}) {
  const [open, setOpen] = useState(false)
  // 'main' = controls + panel list · 'services' = pick a service to surface.
  const [mode, setMode] = useState<'main' | 'services'>('main')
  const [page, setPage] = useState(0)
  const { camera } = useThree()
  const cPos = useMemo(() => new THREE.Vector3(), [])
  const cQuat = useMemo(() => new THREE.Quaternion(), [])
  const cScl = useMemo(() => new THREE.Vector3(), [])
  const yawQ = useMemo(() => new THREE.Quaternion(), [])
  const eul = useMemo(() => new THREE.Euler(0, 0, 0, 'YXZ'), [])
  const F = useMemo(() => new THREE.Matrix4(), [])
  const lp = useMemo(() => new THREE.Vector3(), [])
  const ONE = useMemo(() => new THREE.Vector3(1, 1, 1), [])

  // Gather enabled panels into a level fan in front of the CURRENT gaze.
  // world panels → world poses ahead of you; head/body/wrist → reset to
  // dead-ahead in their own frame. Persists via publishPanel (set_panel).
  const onBringFront = () => {
    const list = panels.filter((p) => p.enabled !== false)
    if (!list.length) return
    camera.updateWorldMatrix(true, false)
    camera.matrixWorld.decompose(cPos, cQuat, cScl)
    eul.setFromQuaternion(cQuat, 'YXZ')
    yawQ.setFromEuler(eul.set(0, eul.y, 0, 'YXZ'))   // level (yaw-only)
    F.compose(cPos, yawQ, ONE)
    const D = 1.6, step = 0.7
    list.forEach((p, i) => {
      const fanX = (i - (list.length - 1) / 2) * step
      const anchor = (p.placement ?? 'world') as Anchor
      let pos: number[], quat: number[]
      if (anchor === 'world') {
        lp.set(fanX, 0, -D).applyMatrix4(F)          // world point ahead of gaze
        pos = [lp.x, lp.y, lp.z]
        quat = [yawQ.x, yawQ.y, yawQ.z, yawQ.w]      // face the user, level
      } else {
        pos = [fanX, 0, -D]                          // dead-ahead in anchor frame
        quat = [0, 0, 0, 1]
      }
      publishPanel({ ...p, transform: { ...p.transform, pos, quat } })
    })
  }

  const openServices = () => { onRefreshServices(); setPage(0); setMode('services') }
  const toggleOpen = () => setOpen((o) => { if (o) setMode('main'); return !o })

  const rows = panels.length
  const h = 0.66 + rows * 0.12              // main menu height
  const PAGE = 7
  const pageCount = Math.max(1, Math.ceil(services.length / PAGE))
  const pageItems = services.slice(page * PAGE, page * PAGE + PAGE)
  const hS = 0.34 + PAGE * 0.118            // services-picker height (fixed)

  return (
    <>
      {/* gear — bottom of view, always present */}
      <HeadLocked offset={[0, -0.5, -1.1]}>
        <group onClick={(e) => { e.stopPropagation(); toggleOpen() }}>
          <mesh><circleGeometry args={[0.05, 28]} /><meshBasicMaterial color={open ? '#0ea5e9' : '#334155'} /></mesh>
          <Text position={[0, 0, 0.006]} fontSize={0.05} anchorX="center" anchorY="middle">⚙</Text>
        </group>
      </HeadLocked>
      {open && mode === 'main' && (
        <HeadLocked offset={[0, 0.05, -1.0]}>
          <group>
            <mesh position={[0, 0, -0.01]}>
              <planeGeometry args={[0.9, h]} />
              <meshBasicMaterial color="#0b1220" transparent opacity={0.94} />
            </mesh>
            {/* global controls */}
            <group position={[0, h / 2 - 0.1, 0]}>
              <MenuButton label={`Arrange: ${arrange ? 'ON' : 'off'}`} onClick={onToggleArrange}
                color={arrange ? '#0e7490' : '#1e293b'} />
            </group>
            <group position={[0, h / 2 - 0.21, 0]}>
              <MenuButton label="Add service UI  ▸" onClick={openServices} color="#0e7490" />
            </group>
            <group position={[0, h / 2 - 0.32, 0]}>
              <MenuButton label="Bring panels to front" onClick={onBringFront} color="#1e293b" />
            </group>
            <group position={[0, h / 2 - 0.43, 0]}>
              <MenuButton label="Recenter pose origin" onClick={onRecenter} />
            </group>
            {/* per-panel: anchor cycle + show/hide */}
            {panels.map((p, i) => {
              const y = h / 2 - 0.58 - i * 0.12
              const anchor = (p.placement ?? 'world') as Anchor
              const next = ANCHOR_CYCLE[(ANCHOR_CYCLE.indexOf(anchor) + 1) % ANCHOR_CYCLE.length]
              return (
                <group key={p.id} position={[0, y, 0]}>
                  <group position={[-0.2, 0, 0]}>
                    <MenuButton label={`${(p.title || p.id).slice(0, 8)} · ${anchor}`} width={0.5}
                      onClick={() => onSetAnchor(p.id, next)} />
                  </group>
                  <group position={[0.27, 0, 0]}>
                    <MenuButton label={p.enabled === false ? 'show' : 'hide'} width={0.18}
                      onClick={() => onToggleEnabled(p.id)} color="#334155" />
                  </group>
                </group>
              )
            })}
          </group>
        </HeadLocked>
      )}
      {open && mode === 'services' && (
        <HeadLocked offset={[0, 0.05, -1.0]}>
          <group>
            <mesh position={[0, 0, -0.01]}>
              <planeGeometry args={[0.9, hS]} />
              <meshBasicMaterial color="#0b1220" transparent opacity={0.94} />
            </mesh>
            {/* header: back · title · pager */}
            <group position={[-0.3, hS / 2 - 0.1, 0]}>
              <MenuButton label="‹ back" width={0.26} onClick={() => setMode('main')} color="#334155" />
            </group>
            <Text position={[0.02, hS / 2 - 0.1, 0.006]} fontSize={0.034} color="#7dd3fc"
              anchorX="center" anchorY="middle">{`services ${page + 1}/${pageCount}`}</Text>
            <group position={[0.26, hS / 2 - 0.1, 0]}>
              <MenuButton label="◀" width={0.1} color="#334155"
                onClick={() => setPage((q) => Math.max(0, q - 1))} />
            </group>
            <group position={[0.38, hS / 2 - 0.1, 0]}>
              <MenuButton label="▶" width={0.1} color="#334155"
                onClick={() => setPage((q) => Math.min(pageCount - 1, q + 1))} />
            </group>
            {/* one button per service → creates a browser panel for it */}
            {pageItems.length === 0 && (
              <Text position={[0, hS / 2 - 0.3, 0.006]} fontSize={0.032} color="#64748b"
                anchorX="center" anchorY="middle">no services found</Text>
            )}
            {pageItems.map((s, i) => (
              <group key={s.id} position={[0, hS / 2 - 0.25 - i * 0.118, 0]}>
                <MenuButton label={`${s.running ? '●' : '○'} ${s.label.slice(0, 20)}`} width={0.78}
                  color={s.running ? '#1e293b' : '#0f1830'}
                  onClick={() => onAddService(s.id)} />
              </group>
            ))}
          </group>
        </HeadLocked>
      )}
    </>
  )
}

// ── in-VR keyboard (text entry for browser panels) ───────────────────
// Head-locked QWERTY, shown only while a text field in a browser panel is
// focused. Each cap forwards a synthetic key (via typeInto) into that
// field's iframe realm. ⇧ toggles case, ✕ dismisses.
function KeyCap({ label, x, y, w, color, onTap }: {
  label: string; x: number; y: number; w: number; color?: string; onTap: () => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <group position={[x, y, 0]}>
      <mesh onClick={(e) => { e.stopPropagation(); onTap() }}
        onPointerOver={() => setHover(true)} onPointerOut={() => setHover(false)}>
        <planeGeometry args={[w, 0.075]} />
        <meshBasicMaterial color={hover ? '#0ea5e9' : (color ?? '#1e293b')} transparent opacity={0.96} />
      </mesh>
      <Text position={[0, 0, 0.006]} fontSize={0.034} color="#e2e8f0" anchorX="center" anchorY="middle">{label}</Text>
    </group>
  )
}

const KB_DIGITS = '1234567890'.split('')
const KB_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'].map((r) => r.split(''))
const KB_SYMS = '@.-_/:'.split('')
const KB_SP = 0.092          // horizontal step between key centers
const KB_RH = 0.088          // vertical step between rows

function VRKeyboard({ field, onType, onClose }: {
  field: KbField; onType: (key: string) => void; onClose: () => void
}) {
  const [shift, setShift] = useState(false)
  const caps: React.ReactNode[] = []
  let y = KB_RH * 2
  // digits + backspace (n+1 columns so backspace sits at the right end)
  const dn = KB_DIGITS.length + 1
  KB_DIGITS.forEach((d, i) => caps.push(
    <KeyCap key={`d${i}`} label={d} w={0.085} x={(i - (dn - 1) / 2) * KB_SP} y={y} onTap={() => onType(d)} />))
  caps.push(<KeyCap key="bk" label="⌫" w={0.11} color="#334155"
    x={(KB_DIGITS.length - (dn - 1) / 2) * KB_SP} y={y} onTap={() => onType('Backspace')} />)
  y -= KB_RH
  // letter rows (case follows shift)
  KB_ROWS.forEach((row, r) => {
    row.forEach((c, i) => {
      const ch = shift ? c.toUpperCase() : c
      caps.push(<KeyCap key={`l${r}-${i}`} label={ch} w={0.085} x={(i - (row.length - 1) / 2) * KB_SP} y={y}
        onTap={() => onType(ch)} />)
    })
    y -= KB_RH
  })
  // bottom row: shift · symbols · space · enter · close — laid out by width
  const bottom: { label: string; key?: string; w: number; color?: string; onTap?: () => void }[] = [
    { label: '⇧', w: 0.1, color: shift ? '#0e7490' : '#334155', onTap: () => setShift((s) => !s) },
    ...KB_SYMS.map((s) => ({ label: s, key: s, w: 0.075 })),
    { label: '␣  space', key: ' ', w: 0.22 },
    { label: '⏎', key: 'Enter', w: 0.1, color: '#0e7490' },
    { label: '✕', w: 0.09, color: '#7f1d1d', onTap: onClose },
  ]
  const totalW = bottom.reduce((a, b) => a + b.w + 0.01, -0.01)
  let bx = -totalW / 2
  bottom.forEach((b, i) => {
    const x = bx + b.w / 2
    bx += b.w + 0.01
    caps.push(<KeyCap key={`b${i}`} label={b.label} w={b.w} color={b.color} x={x} y={y}
      onTap={b.onTap ?? (() => { if (b.key !== undefined) onType(b.key) })} />)
  })
  const name = field.el.getAttribute?.('placeholder') || field.el.getAttribute?.('name') || field.el.tagName.toLowerCase()
  return (
    <HeadLocked offset={[0, -0.45, -0.85]}>
      <group>
        <mesh position={[0, 0, -0.01]}>
          <planeGeometry args={[1.16, KB_RH * 6]} />
          <meshBasicMaterial color="#0b1220" transparent opacity={0.95} />
        </mesh>
        <Text position={[0, KB_RH * 2 + 0.06, 0.006]} fontSize={0.03} color="#7dd3fc" anchorX="center" anchorY="middle">
          {`typing → ${String(name).slice(0, 24)}`}
        </Text>
        {caps}
      </group>
    </HeadLocked>
  )
}

// ── reference scene ──────────────────────────────────────────────────
function Reference() {
  return (
    <>
      <ambientLight intensity={0.8} />
      <directionalLight position={[2, 4, 2]} intensity={0.6} />
      <Grid args={[10, 10]} cellSize={0.5} cellColor="#334155" sectionColor="#475569"
        infiniteGrid fadeDistance={20} position={[0, 0, 0]} />
      {/* origin axes so the operator can see "forward" before feeds load */}
      <axesHelper args={[0.5]} position={[0, 0.01, 0]} />
    </>
  )
}

// ── component ────────────────────────────────────────────────────────
export default function WebXRImmersiveView({ proxy }: { proxy: ServiceProxy }) {
  const ws = useWsClient()
  const proxyId = proxy.id ?? proxy.name ?? ''
  const [type] = (proxy.service_meta_id ?? 'webxr@1.0.0').split('@')
  const inputTopic = `/${type}/${proxyId}/input`
  const panelsTopic = `/${type}/${proxyId}/panels`
  const controlTopic = `/${type}/${proxyId}/control`

  const [panels, setPanels] = useState<PanelCfg[]>([])
  const [rateHz, setRateHz] = useState(60)
  const [supported, setSupported] = useState<boolean | null>(null)
  const [entering, setEntering] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [arrange, setArrange] = useState(false)
  // The browser-panel text field the in-VR keyboard types into (null = hidden).
  const [kbField, setKbField] = useState<KbField | null>(null)

  // Manipulation (P4): id→group map + the panel the right ray is over.
  const panelRefs = useRef<Map<string, THREE.Group>>(new Map())
  const hoverRef = useRef<string | null>(null)

  // Arrange mode repurposes the trigger to move panels — dismiss the
  // keyboard so a grab-tap can't also type.
  useEffect(() => { if (arrange) setKbField(null) }, [arrange])

  // Commit a moved panel back to the service (grab-release only) → it
  // re-publishes panels retained, keeping desktop + config + headset in
  // sync. Bus is the single source of truth.
  const onCommit = useCallback((id: string, t: { pos: number[]; quat: number[]; scale: number }) => {
    const p = panels.find((x) => x.id === id)
    if (!p) return
    const panel = { ...p, transform: { ...p.transform, pos: t.pos, quat: t.quat, scale: t.scale } }
    ws.publish(controlTopic, { action: 'set_panel', panel })
  }, [panels, ws, controlTopic])

  // Menu actions — each persists via set_panel/recenter (saved to config,
  // reloaded on restart). Changing anchor snaps the panel to a sensible
  // default for that frame (then grab to fine-tune).
  const onSetAnchor = useCallback((id: string, anchor: Anchor) => {
    const p = panels.find((x) => x.id === id)
    if (!p) return
    const off = defaultOffsetForAnchor(anchor)
    const panel = { ...p, placement: anchor, transform: { ...p.transform, pos: off.pos, quat: off.quat } }
    ws.publish(controlTopic, { action: 'set_panel', panel })
  }, [panels, ws, controlTopic])
  const onToggleEnabled = useCallback((id: string) => {
    const p = panels.find((x) => x.id === id)
    if (!p) return
    ws.publish(controlTopic, { action: 'set_panel', panel: { ...p, enabled: p.enabled === false } })
  }, [panels, ws, controlTopic])
  const onRecenter = useCallback(() => ws.publish(controlTopic, { action: 'recenter' }), [ws, controlTopic])
  const publishPanel = useCallback((panel: PanelCfg) => ws.publish(controlTopic, { action: 'set_panel', panel }), [ws, controlTopic])

  // Runtime id from the page URL (/r/<runtimeId>/xr/<proxyId>) — used to
  // build the dock URL a browser panel points at.
  const runtimeId = useMemo(() => {
    const m = window.location.pathname.match(/^\/r\/([^/]+)/)
    return m ? decodeURIComponent(m[1]) : 'runtime'
  }, [])

  // Service list for the in-VR "Add service UI" picker. Same root REST the
  // desktop uses; the access token (shared via localStorage, same key the
  // mjpeg panels use) authorizes it. Self (this webxr instance) is omitted.
  const [services, setServices] = useState<SvcLite[]>([])
  const refreshServices = useCallback(() => {
    let tok: string | null = null
    try { tok = localStorage.getItem('robotlab_x.access_token') } catch { /* ignore */ }
    fetch('/v1/service-proxy-list', { headers: tok ? { Authorization: `Bearer ${tok}` } : {} })
      .then((r) => (r.ok ? r.json() : []))
      .then((raw: unknown) => {
        const list = (Array.isArray(raw) ? raw : ((raw as { items?: unknown[] })?.items ?? [])) as Array<Record<string, unknown>>
        const out: SvcLite[] = list
          .map((p) => ({
            id: String(p.id ?? p.name ?? ''),
            label: String(p.name ?? p.id ?? ''),
            running: (p.state ?? p.status) === 'running',
          }))
          .filter((s) => s.id && s.id !== proxyId)
          .sort((a, b) => (Number(b.running) - Number(a.running)) || a.id.localeCompare(b.id))
        setServices(out)
      })
      .catch(() => { /* leave list as-is */ })
  }, [proxyId])
  useEffect(() => { refreshServices() }, [refreshServices])

  // Surface a service's web UI as a browser panel — same dock view as the
  // desktop "Open in window" (default view shape). New panels fan out in
  // the body frame so several don't pile up on one spot.
  const onAddService = useCallback((pid: string) => {
    const ref = `/r/${encodeURIComponent(runtimeId)}/dock/${encodeURIComponent(pid)}`
    const n = panels.filter((p) => p.source.kind === 'browser').length
    const x = ((n % 3) - 1) * 0.55
    ws.publish(controlTopic, {
      action: 'set_panel',
      panel: {
        id: `web-${pid}-${Date.now().toString(36)}`,
        title: pid,
        source: { kind: 'browser', ref },
        placement: 'body',
        transform: { pos: [x, 0, -1.4], quat: [0, 0, 0, 1], width_m: 1.0, height_m: 0.7, scale: 1 },
        enabled: true,
      },
    })
  }, [runtimeId, panels, ws, controlTopic])

  // Feed config (retained) from the service.
  useEffect(() => {
    const off = ws.subscribe(panelsTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const m = f.payload as PanelsMsg
      setPanels(m.panels ?? [])
      if (m.publish_rate_hz) setRateHz(m.publish_rate_hz)
    })
    return () => off()
  }, [ws, panelsTopic])

  // Probe immersive-vr support (drives the button message).
  useEffect(() => {
    const xr = (navigator as Navigator & { xr?: { isSessionSupported(m: string): Promise<boolean> } }).xr
    if (!xr) { setSupported(false); return }
    xr.isSessionSupported('immersive-vr').then(setSupported).catch(() => setSupported(false))
  }, [])

  const onEnter = async () => {
    setErr(null); setEntering(true)
    try { await store.enterVR() }
    catch (e) { setErr(String((e as Error)?.message ?? e)) }
    finally { setEntering(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0b1220', color: '#e2e8f0' }}>
      {/* 2-D overlay (shown on the flat page before entering VR). */}
      <div style={{ position: 'absolute', zIndex: 10, top: 0, left: 0, right: 0, padding: 16,
        display: 'flex', alignItems: 'center', gap: 12, fontFamily: 'system-ui, sans-serif' }}>
        <strong>WebXR Teleop · {proxyId}</strong>
        <button onClick={onEnter} disabled={supported === false || entering}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #334155',
            background: supported === false ? '#334155' : '#0ea5e9', color: '#fff',
            fontSize: 16, cursor: supported === false ? 'not-allowed' : 'pointer' }}>
          {entering ? 'Entering…' : 'Enter VR'}
        </button>
        <span style={{ fontSize: 12, opacity: 0.8 }}>
          {supported === null ? 'checking WebXR…'
            : supported ? `${panels.length} panel(s) · ${rateHz}Hz · press left Y in VR to arrange panels`
            : 'immersive-vr not available (open on a headset over HTTPS / adb reverse)'}
        </span>
        {err && <span style={{ fontSize: 12, color: '#fda4af' }}>{err}</span>}
      </div>

      <Canvas camera={{ position: [0, 1.6, 0], fov: 70 }} style={{ position: 'absolute', inset: 0 }}>
        <XR store={store}>
          <Suspense fallback={null}>
            <Reference />
            <Panels panels={panels} ws={ws} arrange={arrange} panelRefs={panelRefs} hoverRef={hoverRef}
              onField={setKbField} />
          </Suspense>
          <Telemetry topic={inputTopic} ws={ws} rateHz={rateHz} />
          <ArrangeToggle onToggle={() => setArrange((v) => !v)} />
          <PanelSystem panels={panels} arrange={arrange} panelRefs={panelRefs} hoverRef={hoverRef} onCommit={onCommit} />
          <MenuSystem panels={panels} arrange={arrange} services={services}
            onToggleArrange={() => setArrange((v) => !v)} onRecenter={onRecenter}
            onSetAnchor={onSetAnchor} onToggleEnabled={onToggleEnabled} publishPanel={publishPanel}
            onRefreshServices={refreshServices} onAddService={onAddService} />
          {arrange && (
            <Text position={[0, 2.3, -1.5]} fontSize={0.07} color="#22d3ee" anchorX="center">
              ARRANGE — point at a panel, hold trigger to move · left Y to exit
            </Text>
          )}
          {!arrange && kbField && (
            <VRKeyboard field={kbField} onType={(k) => typeInto(kbField, k)} onClose={() => setKbField(null)} />
          )}
        </XR>
      </Canvas>
    </div>
  )
}
