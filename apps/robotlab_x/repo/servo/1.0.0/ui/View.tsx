import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { ServiceProxy } from '@rlx/ui'
import type { ServiceMeta } from '@rlx/ui'
import { type InboundFrame } from '@rlx/ui'
import { useWsClient, useApiFetch } from '@rlx/ui'

// The wire contract every servo_controller implements — these are the
// actions we send to the attached controller's /control topic. The
// servo service knows nothing about Arduino / PCA9685 / etc.; it only
// knows this triplet.
const SERVO_INTERFACE = 'servo_controller'

interface ServoState {
  controller_type?: string | null
  controller_id?: string | null
  pin?: number | null
  angle?: number              // committed target (what was last written)
  current_angle?: number      // live position (matches angle when at rest)
  moving?: boolean            // true while a speed-controlled motion is in flight
  sweeping?: boolean          // true while a back-and-forth sweep is running
  // Master switch (since 2026-06-07) — when false, writes are instant
  // single-packet servo_writes; when true, writes interpolate at
  // ``speed_deg_per_s``. Was previously overloaded onto
  // ``speed_deg_per_s=0`` which was easy to trip into by accident.
  speed_control_enabled?: boolean
  speed_deg_per_s?: number    // default speed used when write() omits the override; >=1 when speed_control_enabled
  min_angle?: number
  max_angle?: number
  attached?: boolean
}

interface ControllerCandidate {
  id: string                  // proxy id (e.g. "arduino-1")
  type: string                // service type (e.g. "arduino")
  status: string              // current proxy status
  metaId: string              // service_meta_id (e.g. "arduino@1.0.0")
}

export default function ServoFullView({ proxy }: { proxy: ServiceProxy }) {
  const wsClient = useWsClient()
  const apiFetch = useApiFetch()
  const proxyId = proxy.id ?? proxy.name ?? ''
  const stateTopic = `/servo/${proxyId}/state`
  const controlTopic = `/servo/${proxyId}/control`

  const [state, setState] = useState<ServoState>({})
  const [candidates, setCandidates] = useState<ControllerCandidate[]>([])
  const [candidatesError, setCandidatesError] = useState<string | null>(null)
  // Local draft inputs — independent of authoritative state until the
  // user clicks Attach/Write/etc. so a stale render doesn't fight an
  // in-flight edit.
  const [selectedController, setSelectedController] = useState<string>('')
  const [pinDraft, setPinDraft] = useState<string>('9')
  const [angleDraft, setAngleDraft] = useState<number>(90)
  const [draggingAngle, setDraggingAngle] = useState(false)
  // Speed draft — the interpolation rate in deg/sec. Always >= 1
  // under the new contract; whether interpolation is USED at all is
  // controlled by ``state.speed_control_enabled``, NOT by a sentinel
  // value here. (The old "0 means instant" overload was removed
  // because dragging this slider toward zero would silently flip
  // the servo into snap-to-target mode — exactly the kind of footgun
  // that hurts when a robot is mid-motion.) Mirrors
  // state.speed_deg_per_s outside of user edits.
  const [speedDraft, setSpeedDraft] = useState<number>(90)
  const [draggingSpeed, setDraggingSpeed] = useState(false)

  // ─── subscribe to /state ───────────────────────────────────────────
  useEffect(() => {
    if (!proxyId) return
    const off = wsClient.subscribe(stateTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const next = f.payload as ServoState
      setState((prev) => ({ ...prev, ...next }))
    })
    return off
  }, [proxyId, stateTopic, wsClient])

  // Mirror service angle into the slider when the user isn't dragging
  // (mid-drag, the slider IS the source of truth).
  useEffect(() => {
    if (draggingAngle) return
    if (typeof state.angle === 'number') setAngleDraft(state.angle)
  }, [state.angle, draggingAngle])
  // Same mirror for the speed slider.
  useEffect(() => {
    if (draggingSpeed) return
    if (typeof state.speed_deg_per_s === 'number') setSpeedDraft(state.speed_deg_per_s)
  }, [state.speed_deg_per_s, draggingSpeed])

  // Auto-select the dropdown:
  //   1. If state has a current attachment, prefer that (so reopening
  //      the view doesn't surprise the user with a different choice).
  //   2. Otherwise default to the first candidate so the underlying
  //      state matches what the user sees in the <select> — HTML shows
  //      the first option when value="" but our gate checks against
  //      state, which would silently leave Attach disabled.
  useEffect(() => {
    if (selectedController) return
    if (state.controller_id) {
      setSelectedController(state.controller_id)
      return
    }
    if (candidates.length > 0) setSelectedController(candidates[0].id)
  }, [state.controller_id, selectedController, candidates])

  // Mirror pin from state once the user hasn't typed anything yet.
  useEffect(() => {
    if (typeof state.pin === 'number') setPinDraft(String(state.pin))
  }, [state.pin])

  // ─── fetch + filter compatible controllers ─────────────────────────
  // Run on mount and refresh every 5s so newly-started controllers show
  // up without a page reload. Cross-references service_meta.implements
  // (capability declaration) with service_proxy (running instances).
  const refreshCandidates = useCallback(async () => {
    try {
      const [metas, proxies] = await Promise.all([
        apiFetch<ServiceMeta[]>('/v1/service-meta-list'),
        apiFetch<ServiceProxy[]>('/v1/service-proxy-list'),
      ])
      const compatibleMetaIds = new Set<string>()
      const typeForMeta = new Map<string, string>()
      for (const m of metas) {
        const impls = Array.isArray(m.implements) ? m.implements : []
        if (impls.includes(SERVO_INTERFACE)) {
          const id = `${m.name}@${m.version}`
          compatibleMetaIds.add(id)
          typeForMeta.set(id, m.name)
        }
      }
      const found: ControllerCandidate[] = []
      for (const p of proxies) {
        if (!compatibleMetaIds.has(p.service_meta_id)) continue
        const pid = p.id ?? p.name
        if (!pid) continue
        found.push({
          id: pid,
          type: typeForMeta.get(p.service_meta_id) ?? p.service_meta_id.split('@')[0],
          status: p.status ?? 'unknown',
          metaId: p.service_meta_id,
        })
      }
      setCandidates(found)
      setCandidatesError(null)
    } catch (e) {
      setCandidatesError(e instanceof Error ? e.message : String(e))
    }
  }, [apiFetch])

  useEffect(() => {
    refreshCandidates()
    const t = setInterval(refreshCandidates, 5000)
    return () => clearInterval(t)
  }, [refreshCandidates])

  // ─── action helpers ────────────────────────────────────────────────
  const sendAction = useCallback(
    (payload: Record<string, unknown>) => wsClient.publish(controlTopic, payload),
    [controlTopic, wsClient],
  )

  const onAttach = useCallback((e?: FormEvent) => {
    e?.preventDefault()
    const c = candidates.find((x) => x.id === selectedController)
    if (!c) {
      console.warn('[servo] attach aborted — no candidate matched', { selectedController, candidates })
      return
    }
    const pin = Number.parseInt(pinDraft, 10)
    if (Number.isNaN(pin) || pin < 0) {
      console.warn('[servo] attach aborted — bad pin', { pinDraft })
      return
    }
    const payload = { action: 'attach', controller_type: c.type, controller_id: c.id, pin }
    console.info('[servo] publishing attach', { topic: controlTopic, payload })
    sendAction(payload)
  }, [candidates, selectedController, pinDraft, sendAction, controlTopic])

  const onDetach = useCallback(() => sendAction({ action: 'detach' }), [sendAction])

  const sendWrite = useCallback((angle: number) => {
    sendAction({ action: 'write', angle })
  }, [sendAction])

  // ─── derived ───────────────────────────────────────────────────────
  const attached = !!state.attached
  const min = state.min_angle ?? 0
  const max = state.max_angle ?? 180
  const angle = typeof state.angle === 'number' ? state.angle : 90
  const hasNoCandidates = candidates.length === 0
  const selectedCandidate = candidates.find((c) => c.id === selectedController)
  const selectedCandidateRunning = selectedCandidate?.status === 'running'

  return (
    <div className="flex min-w-[420px] flex-col gap-3 p-3 text-xs">
      <Attachment
        candidates={candidates}
        candidatesError={candidatesError}
        attached={attached}
        currentControllerType={state.controller_type ?? null}
        currentControllerId={state.controller_id ?? null}
        currentPin={state.pin ?? null}
        selectedController={selectedController}
        onSelect={setSelectedController}
        pinDraft={pinDraft}
        onPinChange={setPinDraft}
        hasNoCandidates={hasNoCandidates}
        selectedCandidateRunning={selectedCandidateRunning}
        onAttach={onAttach}
        onDetach={onDetach}
        onRefresh={refreshCandidates}
      />
      <Position
        attached={attached}
        min={min}
        max={max}
        angle={angle}
        currentAngle={state.current_angle ?? angle}
        moving={!!state.moving}
        angleDraft={angleDraft}
        setAngleDraft={setAngleDraft}
        setDraggingAngle={setDraggingAngle}
        speed={state.speed_deg_per_s ?? 90}
        speedControlEnabled={state.speed_control_enabled ?? true}
        speedDraft={speedDraft}
        setSpeedDraft={setSpeedDraft}
        setDraggingSpeed={setDraggingSpeed}
        onSetSpeed={(s) => sendAction({ action: 'set_speed', speed_deg_per_s: s })}
        onSetSpeedControlEnabled={(enabled) => sendAction({ action: 'set_speed_control_enabled', enabled })}
        onWrite={sendWrite}
        onStop={() => sendAction({ action: 'stop' })}
        sweeping={!!state.sweeping}
        onSweep={(s, e) => sendAction({ action: 'sweep', start: s, end: e })}
        onStopSweep={() => sendAction({ action: 'stop_sweep' })}
      />
      <Limits
        min={min}
        max={max}
        onApply={(lo, hi) => sendAction({ action: 'set_limits', min_angle: lo, max_angle: hi })}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Attachment section — pick a servo_controller-implementing service
// ─────────────────────────────────────────────────────────────────────

function Attachment({
  candidates, candidatesError, attached,
  currentControllerType, currentControllerId, currentPin,
  selectedController, onSelect, pinDraft, onPinChange,
  hasNoCandidates, selectedCandidateRunning,
  onAttach, onDetach, onRefresh,
}: {
  candidates: { id: string; type: string; status: string; metaId: string }[]
  candidatesError: string | null
  attached: boolean
  currentControllerType: string | null
  currentControllerId: string | null
  currentPin: number | null
  selectedController: string
  onSelect: (id: string) => void
  pinDraft: string
  onPinChange: (s: string) => void
  hasNoCandidates: boolean
  selectedCandidateRunning: boolean
  onAttach: (e?: FormEvent) => void
  onDetach: () => void
  onRefresh: () => void
}) {
  return (
    <Section title="Attachment">
      <form className="flex flex-col gap-2" onSubmit={onAttach} onPointerDown={(e) => e.stopPropagation()}>
        {attached && (
          <div className="rounded border border-emerald-700 bg-emerald-950/40 p-2 font-mono leading-snug text-emerald-200">
            attached → {currentControllerType}/{currentControllerId} pin {currentPin}
          </div>
        )}
        <div className="flex items-center gap-2">
          <select
            value={selectedController}
            onChange={(e) => onSelect(e.target.value)}
            disabled={attached || hasNoCandidates}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="nodrag nopan flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-200 focus:border-slate-500 focus:outline-none disabled:opacity-50"
          >
            {hasNoCandidates && <option value="">(no servo_controller services running)</option>}
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id}  — {c.type}  · {c.status}
              </option>
            ))}
          </select>
          <ActionButton onClick={onRefresh}>↻</ActionButton>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] uppercase tracking-wider text-slate-500">pin</label>
          <input
            type="number"
            min={0}
            value={pinDraft}
            onChange={(e) => onPinChange(e.target.value)}
            disabled={attached}
            onPointerDown={(e) => e.stopPropagation()}
            className="nodrag nopan w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100 focus:border-slate-500 focus:outline-none disabled:opacity-50"
          />
          {!attached ? (
            <ActionButton
              tone="primary"
              onClick={() => onAttach()}
              disabled={hasNoCandidates || !selectedController || !selectedCandidateRunning}
            >
              Attach
            </ActionButton>
          ) : (
            <ActionButton onClick={onDetach}>Detach</ActionButton>
          )}
          {!attached && selectedController && !selectedCandidateRunning && (
            <span className="text-amber-300">controller not running</span>
          )}
        </div>
        {candidatesError && (
          <div className="rounded border border-rose-700 bg-rose-950/40 px-2 py-1 font-mono text-[11px] text-rose-200">
            could not load controllers — {candidatesError}
          </div>
        )}
        {hasNoCandidates && !candidatesError && (
          <div className="text-slate-500">
            No services declaring <span className="font-mono">implements: [servo_controller]</span> are running.
            Start an Arduino (or any other implementation) and click ↻.
          </div>
        )}
      </form>
    </Section>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Position section — slider + numeric + sweep
// ─────────────────────────────────────────────────────────────────────

function Position({
  attached, min, max, angle, currentAngle, moving, sweeping,
  angleDraft, setAngleDraft, setDraggingAngle,
  speed, speedControlEnabled, speedDraft, setSpeedDraft, setDraggingSpeed,
  onSetSpeed, onSetSpeedControlEnabled,
  onWrite, onStop, onSweep, onStopSweep,
}: {
  attached: boolean
  min: number
  max: number
  angle: number
  currentAngle: number
  moving: boolean
  sweeping: boolean
  angleDraft: number
  setAngleDraft: (n: number) => void
  setDraggingAngle: (b: boolean) => void
  speed: number
  speedControlEnabled: boolean
  speedDraft: number
  setSpeedDraft: (n: number) => void
  setDraggingSpeed: (b: boolean) => void
  onSetSpeed: (speed: number) => void
  onSetSpeedControlEnabled: (enabled: boolean) => void
  onWrite: (angle: number) => void
  onStop: () => void
  onSweep: (start: number, end: number) => void
  onStopSweep: () => void
}) {
  // Sweep range — both endpoints are user-controlled via a dual-thumb
  // slider so the relationship between min/max sweep is obvious. They
  // default to the soft limits the user just configured; widening the
  // limits doesn't auto-widen sweep until the user drags the thumbs
  // (avoids a "I just bumped max and my sweep silently changed"
  // surprise). The reverse — narrowing limits below an existing sweep
  // endpoint — is clamped on display so the thumb can't sit outside
  // the visible track.
  const [sweepStart, setSweepStart] = useState<number>(min)
  const [sweepEnd, setSweepEnd] = useState<number>(max)
  // When the soft limits move, clamp the sweep endpoints into the new
  // valid range so the slider thumbs never render off-track. This is
  // visual-only — we don't auto-widen on limit-widening (see above).
  useEffect(() => {
    setSweepStart((v) => Math.max(min, Math.min(max - 1, v)))
    setSweepEnd((v) => Math.max(min + 1, Math.min(max, v)))
  }, [min, max])

  if (!attached) {
    return (
      <Section title="Position">
        <div className="rounded border border-slate-800 bg-slate-950/70 p-2 text-slate-500">
          Attach to a controller first.
        </div>
      </Section>
    )
  }

  return (
    <Section title="Position">
      <div className="flex flex-col gap-3" onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">{min}°</span>
          <input
            type="range"
            min={min}
            max={max}
            step={1}
            value={angleDraft}
            className="nodrag nopan flex-1 accent-emerald-500"
            onPointerDown={() => setDraggingAngle(true)}
            onPointerUp={() => setDraggingAngle(false)}
            onChange={(e) => {
              const v = Number(e.target.value)
              setAngleDraft(v)
              onWrite(v)   // live write while dragging — feels responsive
            }}
          />
          <span className="text-[10px] uppercase tracking-wider text-slate-500">{max}°</span>
          <input
            type="number"
            min={min}
            max={max}
            step={1}
            value={angleDraft}
            onChange={(e) => setAngleDraft(Number(e.target.value))}
            onBlur={() => onWrite(angleDraft)}
            className="nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100 focus:border-slate-500 focus:outline-none"
          />
        </div>
        <div className="flex items-center justify-between font-mono text-slate-400">
          <span>
            target {angle}°
            {moving && (
              <>
                {' · '}
                <span className="text-amber-300">
                  live {currentAngle}°
                </span>
                {' '}
                <span className="text-amber-300/70 animate-pulse">moving</span>
              </>
            )}
          </span>
          <div className="flex gap-2">
            {moving && <ActionButton onClick={onStop}>Stop</ActionButton>}
            <ActionButton onClick={() => onWrite(angleDraft)}>Write</ActionButton>
          </div>
        </div>
        {/* Speed control — a master toggle + a deg/sec rate.
            Decoupling these (vs. the old "0 means instant" overload)
            prevents the slider from accidentally landing on snap-to-
            target while the operator is just trying to dial speed
            down. When the toggle is OFF, writes are instant single-
            packet servo_writes; when ON, writes interpolate at the
            slider value. The slider hard floor is 1 deg/sec — there
            is no "off" value inside the rate any more. */}
        <div className="border-t border-slate-800 pt-2">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">speed control</span>
            <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[10px] text-slate-300">
              <input
                type="checkbox"
                checked={speedControlEnabled}
                onChange={(e) => onSetSpeedControlEnabled(e.target.checked)}
                onPointerDown={(e) => e.stopPropagation()}
                className="nodrag nopan accent-emerald-500"
              />
              <span className={speedControlEnabled ? 'text-emerald-300' : 'text-slate-500'}>
                {speedControlEnabled ? 'interpolated' : 'instant'}
              </span>
            </label>
          </div>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className={`font-mono text-[10px] ${speedControlEnabled ? 'text-slate-400' : 'text-slate-600'}`}>
              {speedControlEnabled
                ? `${speedDraft} °/sec`
                : 'writes snap directly to target (no host interpolation)'}
              {speedControlEnabled && speed !== speedDraft && (
                <span className="ml-1 text-amber-400" title="Drag finished — release will commit">*</span>
              )}
            </span>
          </div>
          <div className={`flex items-center gap-2 ${speedControlEnabled ? '' : 'opacity-40'}`}>
            <input
              type="range"
              min={1}
              max={360}
              step={5}
              value={speedDraft}
              disabled={!speedControlEnabled}
              className="nodrag nopan flex-1 accent-sky-500 disabled:cursor-not-allowed"
              onPointerDown={() => setDraggingSpeed(true)}
              onPointerUp={() => {
                setDraggingSpeed(false)
                if (speedControlEnabled) onSetSpeed(speedDraft)
              }}
              onChange={(e) => setSpeedDraft(Number(e.target.value))}
            />
            <input
              type="number"
              min={1}
              max={360}
              step={5}
              value={speedDraft}
              disabled={!speedControlEnabled}
              onChange={(e) => setSpeedDraft(Math.max(1, Number(e.target.value)))}
              onBlur={() => { if (speedControlEnabled) onSetSpeed(speedDraft) }}
              className="nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100 focus:border-slate-500 focus:outline-none disabled:cursor-not-allowed"
            />
          </div>
        </div>
        <div className="border-t border-slate-800 pt-2">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">
              sweep{sweeping && <span className="ml-1 text-emerald-400 animate-pulse">running</span>}
            </span>
            <span className="font-mono text-[10px] text-slate-400">
              {sweepStart}° – {sweepEnd}°
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-slate-500 w-8 text-right">{min}°</span>
            <DualRangeSlider
              min={min}
              max={max}
              low={sweepStart}
              high={sweepEnd}
              onChange={(lo, hi) => { setSweepStart(lo); setSweepEnd(hi) }}
            />
            <span className="font-mono text-[10px] text-slate-500 w-8">{max}°</span>
          </div>
          <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-400">
            <div className="ml-auto flex gap-2">
              <ActionButton onClick={onStopSweep} disabled={!sweeping}>Stop</ActionButton>
              <ActionButton
                tone="primary"
                onClick={() => onSweep(sweepStart, sweepEnd)}
              >
                Run
              </ActionButton>
            </div>
          </div>
        </div>
      </div>
    </Section>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Limits section — soft min/max envelope
// ─────────────────────────────────────────────────────────────────────

function Limits({
  min, max, onApply,
}: {
  min: number
  max: number
  onApply: (min: number, max: number) => void
}) {
  const [loDraft, setLoDraft] = useState<string>(String(min))
  const [hiDraft, setHiDraft] = useState<string>(String(max))
  useEffect(() => { setLoDraft(String(min)) }, [min])
  useEffect(() => { setHiDraft(String(max)) }, [max])
  const dirty = useMemo(
    () => Number(loDraft) !== min || Number(hiDraft) !== max,
    [loDraft, hiDraft, min, max],
  )

  return (
    <Section title="Limits">
      <div className="flex items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
        <label className="text-[10px] uppercase tracking-wider text-slate-500">min</label>
        <input
          type="number" min={0} max={180} step={1}
          value={loDraft}
          onChange={(e) => setLoDraft(e.target.value)}
          className="nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100"
        />
        <label className="text-[10px] uppercase tracking-wider text-slate-500">max</label>
        <input
          type="number" min={0} max={180} step={1}
          value={hiDraft}
          onChange={(e) => setHiDraft(e.target.value)}
          className="nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100"
        />
        <ActionButton
          tone="primary"
          disabled={!dirty}
          onClick={() => {
            const lo = Number.parseInt(loDraft, 10)
            const hi = Number.parseInt(hiDraft, 10)
            if (!Number.isNaN(lo) && !Number.isNaN(hi)) onApply(lo, hi)
          }}
        >
          Apply
        </ActionButton>
      </div>
    </Section>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Common sub-components (copied from Arduino.tsx for visual parity)
// ─────────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-slate-800 bg-slate-900/40 p-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
      {children}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────
// DualRangeSlider — two-thumb range input for sweep endpoints.
// Both thumbs share one visible track; the highlighted segment between
// them shows the active sweep range. Dragging one thumb past the other
// is clamped so low < high stays invariant (otherwise sweep gets a
// zero-width range and never moves).
// ─────────────────────────────────────────────────────────────────────

function DualRangeSlider({
  min, max, low, high, onChange,
}: {
  min: number
  max: number
  low: number
  high: number
  onChange: (low: number, high: number) => void
}) {
  // Guard against degenerate ranges (min===max) — would divide by zero
  // when computing thumb positions; fall back to 0/100% in that case.
  const span = Math.max(1, max - min)
  const loPct = ((low - min) / span) * 100
  const hiPct = ((high - min) / span) * 100
  return (
    <div
      className="dual-range nodrag nopan relative h-6 flex-1"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Background track */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded bg-slate-700" />
      {/* Selected segment between the two thumbs */}
      <div
        className="absolute top-1/2 -translate-y-1/2 h-1 rounded bg-sky-500"
        style={{ left: `${loPct}%`, right: `${100 - hiPct}%` }}
      />
      <input
        type="range"
        className="dual-thumb"
        min={min} max={max} step={1}
        value={low}
        onChange={(e) => {
          const v = Math.min(Number(e.target.value), high - 1)
          onChange(v, high)
        }}
        aria-label="sweep start angle"
      />
      <input
        type="range"
        className="dual-thumb"
        min={min} max={max} step={1}
        value={high}
        onChange={(e) => {
          const v = Math.max(Number(e.target.value), low + 1)
          onChange(low, v)
        }}
        aria-label="sweep end angle"
      />
    </div>
  )
}

function ActionButton({
  children, onClick, disabled, tone = 'normal', type = 'button',
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  tone?: 'normal' | 'primary'
  type?: 'button' | 'submit'
}) {
  const base = tone === 'primary'
    ? 'bg-emerald-600 text-white hover:bg-emerald-500'
    : 'border border-slate-700 text-slate-200 hover:border-slate-500'
  return (
    <button
      type={type}
      onClick={(e) => { e.stopPropagation(); onClick?.() }}
      onPointerDown={(e) => e.stopPropagation()}
      disabled={disabled}
      className={`nodrag nopan rounded px-2 py-1 text-xs font-medium ${base} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  )
}
