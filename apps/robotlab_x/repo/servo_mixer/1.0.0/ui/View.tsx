import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Octagon, Play, Pause, Square, Plus, X } from 'lucide-react'
import type { ServiceProxy } from '@rlx/ui'
import { type InboundFrame } from '@rlx/ui'
import { useWsClient } from '@rlx/ui'

// servo_mixer card — orchestrate a collection of servos. Three tabs:
//   Drive     — a live fader per member (publishes straight to each servo)
//   Poses     — capture/apply named snapshots (synchronized arrival)
//   Sequences — ordered poses with transition+hold, played by the backend
// Member live angles come from a /servo/+/state wildcard subscription;
// mixer ops go to /servo_mixer/{id}/control.

interface MemberState {
  servo_id: string
  label: string
  enabled: boolean
  online: boolean
  current_angle: number | null
  min_angle: number
  max_angle: number
}
interface Pose { id: string; name: string; positions: Record<string, number> }
interface SeqStep { pose_id: string; transition_ms: number; hold_ms: number; easing?: string; speak?: string; blocking?: boolean }
interface Sequence { id: string; name: string; loop: boolean; steps: SeqStep[] }
interface Keyframe { t_ms: number; angle: number; easing?: string }
interface TimelineTrack { servo_id: string; keyframes: Keyframe[] }
interface Timeline { id: string; name: string; duration_ms: number; loop: boolean; tracks: TimelineTrack[] }
interface Player {
  playing: boolean; paused: boolean
  current_sequence: string | null; current_step: number
  current_timeline?: string | null; playhead_ms?: number
}
interface MixerState {
  members?: MemberState[]
  poses?: Pose[]
  sequences?: Sequence[]
  timelines?: Timeline[]
  default_transition_ms?: number
  speak_target?: string | null
  player?: Player
  last_error?: string | null
}
interface ServoLive { current_angle?: number; angle?: number; min_angle?: number; max_angle?: number }

type Tab = 'drive' | 'poses' | 'sequences' | 'timeline'
const EASINGS = ['linear', 'ease_in', 'ease_out', 'ease_in_out']

const field = 'rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200'
const btn = 'rounded px-2 py-1 text-xs disabled:opacity-40'

export default function ServoMixerView({ proxy }: { proxy: ServiceProxy }) {
  const wsClient = useWsClient()
  const proxyId = proxy.id ?? proxy.name ?? ''
  const stateTopic = `/servo_mixer/${proxyId}/state`
  const controlTopic = `/servo_mixer/${proxyId}/control`

  const [state, setState] = useState<MixerState>({})
  const [servoLive, setServoLive] = useState<Record<string, ServoLive>>({})
  const [tab, setTab] = useState<Tab>('drive')

  useEffect(() => {
    if (!proxyId) return
    const offState = wsClient.subscribe(stateTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      setState((prev) => ({ ...prev, ...(f.payload as MixerState) }))
    })
    // Discover servos + track live angles for the faders.
    const offServos = wsClient.subscribe('/servo/+/state', (f: InboundFrame) => {
      if (f.method !== 'message') return
      const m = (f.topic ?? '').match(/^\/servo\/([^/]+)\/state$/)
      if (!m) return
      setServoLive((prev) => ({ ...prev, [m[1]]: (f.payload ?? {}) as ServoLive }))
    })
    return () => { offState(); offServos() }
  }, [proxyId, stateTopic, wsClient])

  const send = useCallback((action: string, args: Record<string, unknown> = {}) => {
    wsClient.publish(controlTopic, { action, ...args })
  }, [wsClient, controlTopic])

  // Live fader → straight to the servo (snappy, no mixer hop).
  const writeServo = useCallback((servoId: string, angle: number) => {
    wsClient.publish(`/servo/${servoId}/control`, { action: 'write', angle })
  }, [wsClient])

  const members = state.members ?? []
  const poses = state.poses ?? []
  const sequences = state.sequences ?? []
  const player = state.player
  const transition = state.default_transition_ms ?? 1000

  const memberIds = useMemo(() => new Set(members.map((m) => m.servo_id)), [members])
  const addable = useMemo(
    () => Object.keys(servoLive).filter((id) => !memberIds.has(id)).sort(),
    [servoLive, memberIds],
  )

  return (
    <div className="flex flex-col gap-2 p-3 text-slate-200">
      {/* header + ALL STOP */}
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium">Servo Mixer</span>
        <span className="text-slate-500">{members.length} member{members.length === 1 ? '' : 's'}</span>
        {state.last_error && <span className="truncate text-rose-400">{state.last_error}</span>}
        <button type="button" onClick={() => send('stop_all')}
          className={`${btn} ml-auto flex items-center gap-1 bg-rose-700 text-white hover:bg-rose-600`}>
          <Octagon className="h-3.5 w-3.5" /> ALL STOP
        </button>
      </div>

      {/* tabs */}
      <div className="flex rounded border border-slate-700 text-xs">
        {(['drive', 'poses', 'sequences', 'timeline'] as Tab[]).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`flex-1 px-2 py-1 capitalize ${tab === t ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'drive' && (
        <DriveTab
          members={members} servoLive={servoLive} addable={addable} transition={transition}
          onWrite={writeServo} onSend={send}
        />
      )}
      {tab === 'poses' && (
        <PosesTab poses={poses} transition={transition} onSend={send} />
      )}
      {tab === 'sequences' && (
        <SequencesTab sequences={sequences} poses={poses} player={player}
          speakTarget={state.speak_target ?? ''} onSend={send} />
      )}
      {tab === 'timeline' && (
        <TimelineTab timelines={state.timelines ?? []} members={members} player={player} onSend={send} />
      )}
    </div>
  )
}

// ─── Drive ─────────────────────────────────────────────────────────────
function DriveTab({ members, servoLive, addable, transition, onWrite, onSend }: {
  members: MemberState[]
  servoLive: Record<string, ServoLive>
  addable: string[]
  transition: number
  onWrite: (servoId: string, angle: number) => void
  onSend: (action: string, args?: Record<string, unknown>) => void
}) {
  const [pick, setPick] = useState('')
  return (
    <div className="flex flex-col gap-2">
      {members.length === 0 && <div className="text-[11px] text-slate-500">No members yet. Add a servo below.</div>}
      {members.map((m) => {
        const live = servoLive[m.servo_id] ?? {}
        const lo = live.min_angle ?? m.min_angle ?? 0
        const hi = live.max_angle ?? m.max_angle ?? 180
        const angle = (live.current_angle ?? m.current_angle ?? lo) as number
        return (
          <MemberFader key={m.servo_id} label={m.label} enabled={m.enabled} online={m.servo_id in servoLive}
            min={lo} max={hi} angle={angle}
            onWrite={(a) => onWrite(m.servo_id, a)}
            onToggle={(e) => onSend('set_member_enabled', { servo_id: m.servo_id, enabled: e })}
            onRemove={() => onSend('remove_member', { servo_id: m.servo_id })}
          />
        )
      })}

      {/* add member */}
      <div className="mt-1 flex items-center gap-1.5">
        <select className={`${field} flex-1`} value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">add servo…</option>
          {addable.map((id) => (<option key={id} value={id}>{id}</option>))}
        </select>
        <button type="button" className={`${btn} bg-slate-800 text-slate-200 hover:bg-slate-700`} disabled={!pick}
          onClick={() => { onSend('add_member', { servo_id: pick }); setPick('') }}>
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
        <span>transition</span>
        <input type="number" min={0} step={100} defaultValue={transition} className={`${field} w-20`}
          onBlur={(e) => onSend('set_default_transition', { transition_ms: Number(e.target.value) })} />
        <span>ms</span>
        <button type="button" className={`${btn} ml-auto bg-slate-800 text-slate-300 hover:bg-slate-700`}
          onClick={() => onSend('relax_all')} title="Detach all members (release torque)">relax</button>
      </div>
    </div>
  )
}

function MemberFader({ label, enabled, online, min, max, angle, onWrite, onToggle, onRemove }: {
  label: string; enabled: boolean; online: boolean; min: number; max: number; angle: number
  onWrite: (a: number) => void; onToggle: (e: boolean) => void; onRemove: () => void
}) {
  const [draft, setDraft] = useState(angle)
  const dragging = useRef(false)
  useEffect(() => { if (!dragging.current) setDraft(angle) }, [angle])
  return (
    <div className={`rounded border border-slate-800 p-2 ${enabled ? '' : 'opacity-50'}`}>
      <div className="mb-1 flex items-center gap-2 text-[11px]">
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} title="enabled" />
        <span className="truncate font-mono text-slate-200">{label}</span>
        {!online && <span className="text-amber-400">offline</span>}
        <span className="ml-auto font-mono text-slate-400">{draft}°</span>
        <button type="button" className="text-slate-500 hover:text-rose-300" onClick={onRemove}><X className="h-3 w-3" /></button>
      </div>
      <input type="range" min={min} max={max} step={1} value={draft} disabled={!enabled}
        className="w-full accent-emerald-500"
        onPointerDown={() => { dragging.current = true }}
        onPointerUp={() => { dragging.current = false }}
        onChange={(e) => { const v = Number(e.target.value); setDraft(v); onWrite(v) }}
      />
    </div>
  )
}

// ─── Poses ─────────────────────────────────────────────────────────────
function PosesTab({ poses, transition, onSend }: {
  poses: Pose[]; transition: number; onSend: (action: string, args?: Record<string, unknown>) => void
}) {
  const [name, setName] = useState('')
  const [applyMs, setApplyMs] = useState(transition)
  useEffect(() => { setApplyMs(transition) }, [transition])
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <input className={`${field} flex-1`} placeholder="pose name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" className={`${btn} bg-sky-700 text-white hover:bg-sky-600`} disabled={!name.trim()}
          onClick={() => { onSend('capture_pose', { name: name.trim() }); setName('') }}>Capture</button>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-slate-400">
        <span>apply over</span>
        <input type="number" min={0} step={100} value={applyMs} className={`${field} w-20`}
          onChange={(e) => setApplyMs(Number(e.target.value))} />
        <span>ms</span>
      </div>
      {poses.length === 0 && <div className="text-[11px] text-slate-500">No poses. Drive the servos, then Capture.</div>}
      <ul className="flex flex-col gap-1">
        {poses.map((p) => (
          <li key={p.id} className="flex items-center gap-2 rounded border border-slate-800 px-2 py-1 text-[11px]">
            <span className="truncate font-mono text-slate-200">{p.name}</span>
            <span className="text-slate-500">{Object.keys(p.positions).length} servo{Object.keys(p.positions).length === 1 ? '' : 's'}</span>
            <button type="button" className={`${btn} ml-auto bg-emerald-800 text-emerald-100 hover:bg-emerald-700`}
              onClick={() => onSend('apply_pose', { id: p.id, transition_ms: applyMs })}>Apply</button>
            <button type="button" className="text-slate-500 hover:text-rose-300" onClick={() => onSend('delete_pose', { id: p.id })}><X className="h-3 w-3" /></button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─── Sequences ─────────────────────────────────────────────────────────
function SequencesTab({ sequences, poses, player, speakTarget, onSend }: {
  sequences: Sequence[]; poses: Pose[]; player?: Player; speakTarget: string
  onSend: (action: string, args?: Record<string, unknown>) => void
}) {
  const poseName = (id: string) => poses.find((p) => p.id === id)?.name ?? id
  const [name, setName] = useState('')
  const [loop, setLoop] = useState(false)
  const [steps, setSteps] = useState<SeqStep[]>([])
  const [pick, setPick] = useState('')

  const addStep = () => {
    if (!pick) return
    setSteps((s) => [...s, { pose_id: pick, transition_ms: 1000, hold_ms: 0, speak: '', blocking: false }])
  }
  const setStep = (i: number, patch: Partial<SeqStep>) =>
    setSteps((s) => s.map((st, j) => (j === i ? { ...st, ...patch } : st)))
  const moveStep = (i: number, d: number) =>
    setSteps((s) => {
      const j = i + d
      if (j < 0 || j >= s.length) return s
      const next = [...s]; const t = next[i]; next[i] = next[j]; next[j] = t; return next
    })
  const save = () => {
    if (!name.trim() || steps.length === 0) return
    onSend('save_sequence', { name: name.trim(), loop, steps })
    setName(''); setLoop(false); setSteps([])
  }

  return (
    <div className="flex flex-col gap-2">
      {/* player */}
      {player?.playing && (
        <div className="flex items-center gap-2 rounded border border-emerald-800 bg-emerald-950/30 px-2 py-1 text-[11px]">
          <span className="text-emerald-300">▶ {player.current_sequence} · step {player.current_step + 1}</span>
          <div className="ml-auto flex gap-1">
            {player.paused
              ? <button type="button" className={`${btn} bg-slate-800 text-slate-200`} onClick={() => onSend('resume')}><Play className="h-3 w-3" /></button>
              : <button type="button" className={`${btn} bg-slate-800 text-slate-200`} onClick={() => onSend('pause')}><Pause className="h-3 w-3" /></button>}
            <button type="button" className={`${btn} bg-slate-800 text-slate-200`} onClick={() => onSend('stop')}><Square className="h-3 w-3" /></button>
          </div>
        </div>
      )}

      {/* saved sequences */}
      {sequences.length === 0 && <div className="text-[11px] text-slate-500">No sequences. Build one below from your poses.</div>}
      <ul className="flex flex-col gap-1">
        {sequences.map((s) => (
          <li key={s.id} className="flex items-center gap-2 rounded border border-slate-800 px-2 py-1 text-[11px]">
            <span className="truncate font-mono text-slate-200">{s.name}</span>
            <span className="text-slate-500">{s.steps.length} step{s.steps.length === 1 ? '' : 's'}{s.loop ? ' · loop' : ''}{s.steps.some((st) => st.speak) ? ' · 🔊' : ''}</span>
            <button type="button" className={`${btn} ml-auto bg-emerald-800 text-emerald-100 hover:bg-emerald-700`}
              onClick={() => onSend('play_sequence', { id: s.id })}><Play className="h-3 w-3" /></button>
            <button type="button" className="text-slate-500 hover:text-rose-300" onClick={() => onSend('delete_sequence', { id: s.id })}><X className="h-3 w-3" /></button>
          </li>
        ))}
      </ul>

      {/* speak target */}
      <div className="flex items-center gap-2 text-[11px] text-slate-400">
        <span>speak →</span>
        <input className={`${field} flex-1 font-mono`} placeholder="control topic e.g. /chat/chat-1/control"
          defaultValue={speakTarget}
          onBlur={(e) => onSend('set_speak_target', { topic: e.target.value.trim() || null })} />
      </div>

      {/* builder */}
      <div className="rounded border border-slate-800 p-2">
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">new sequence</div>
        <div className="mb-1.5 flex items-center gap-1.5">
          <input className={`${field} flex-1`} placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="flex items-center gap-1 text-[11px] text-slate-400">
            <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> loop
          </label>
        </div>
        <ul className="mb-1.5 flex flex-col gap-1">
          {steps.map((st, i) => (
            <li key={i} className="flex flex-col gap-1 rounded border border-slate-800/60 p-1 text-[11px]">
              <div className="flex items-center gap-1">
                <span className="w-4 text-slate-500">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-slate-200">{poseName(st.pose_id)}</span>
                <input type="number" min={0} step={100} value={st.transition_ms} title="transition ms"
                  className={`${field} w-16`} onChange={(e) => setStep(i, { transition_ms: Number(e.target.value) })} />
                <input type="number" min={0} step={100} value={st.hold_ms} title="hold ms"
                  className={`${field} w-16`} onChange={(e) => setStep(i, { hold_ms: Number(e.target.value) })} />
                <button type="button" className="text-slate-500 hover:text-slate-200" onClick={() => moveStep(i, -1)}>↑</button>
                <button type="button" className="text-slate-500 hover:text-slate-200" onClick={() => moveStep(i, 1)}>↓</button>
                <button type="button" className="text-slate-500 hover:text-rose-300" onClick={() => setSteps((s) => s.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button>
              </div>
              <div className="flex items-center gap-1 pl-5">
                <span className="text-slate-500">🔊</span>
                <input className={`${field} flex-1`} placeholder="speak (optional)" value={st.speak ?? ''}
                  onChange={(e) => setStep(i, { speak: e.target.value })} />
                <label className="flex items-center gap-1 text-slate-400" title="wait for speech to finish before next step">
                  <input type="checkbox" checked={!!st.blocking} onChange={(e) => setStep(i, { blocking: e.target.checked })} /> block
                </label>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-1.5">
          <select className={`${field} flex-1`} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">add pose…</option>
            {poses.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>
          <button type="button" className={`${btn} bg-slate-800 text-slate-200 hover:bg-slate-700`} disabled={!pick} onClick={addStep}><Plus className="h-3.5 w-3.5" /></button>
          <button type="button" className={`${btn} bg-sky-700 text-white hover:bg-sky-600`} disabled={!name.trim() || steps.length === 0} onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}

// ─── Timeline (keyframe animation) ──────────────────────────────────────
function TimelineTab({ timelines, members, player, onSend }: {
  timelines: Timeline[]; members: MemberState[]; player?: Player
  onSend: (action: string, args?: Record<string, unknown>) => void
}) {
  const [selId, setSelId] = useState('')
  const [newName, setNewName] = useState('')
  const [head, setHead] = useState(0)
  const [selKf, setSelKf] = useState<{ servo_id: string; t_ms: number } | null>(null)
  const seekRef = useRef(0)

  useEffect(() => { if (!selId && timelines[0]) setSelId(timelines[0].id) }, [timelines, selId])
  const tl = timelines.find((t) => t.id === selId) ?? timelines[0]
  const tid = tl?.id
  const duration = tl?.duration_ms ?? 4000
  const playingThis = !!player?.playing && player?.current_timeline === tid

  // Mirror the live playhead while this timeline plays.
  useEffect(() => {
    if (playingThis && typeof player?.playhead_ms === 'number') setHead(player.playhead_ms)
  }, [playingThis, player?.playhead_ms])

  const doSeek = useCallback((t: number) => {
    setHead(t)
    const now = Date.now()
    if (now - seekRef.current < 80 || !tid) return
    seekRef.current = now
    onSend('seek', { timeline_id: tid, t_ms: Math.round(t) })
  }, [onSend, tid])

  // Drag a keyframe dot: horizontal = time, vertical = angle. Live position
  // is held in dragPos (visual only); the move is committed on release.
  const [dragPos, setDragPos] = useState<{ servo_id: string; orig_t_ms: number; t_ms: number; angle: number } | null>(null)
  const startDrag = useCallback((e: ReactPointerEvent<HTMLButtonElement>, servoId: string,
                                 lo: number, hi: number, kf: Keyframe) => {
    e.preventDefault()
    e.stopPropagation()
    setSelKf({ servo_id: servoId, t_ms: kf.t_ms })
    const trackEl = e.currentTarget.parentElement as HTMLElement | null
    if (!trackEl || !tid) return
    const rect = trackEl.getBoundingClientRect()
    const orig = kf.t_ms
    const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
    const onMove = (ev: PointerEvent) => {
      const x = clamp01((ev.clientX - rect.left) / rect.width)
      const y = clamp01((ev.clientY - rect.top) / rect.height)
      setDragPos({
        servo_id: servoId, orig_t_ms: orig,
        t_ms: Math.round(x * duration),
        angle: Math.round(hi - y * (hi - lo)),
      })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDragPos((dp) => {
        if (dp && (dp.t_ms !== orig || dp.angle !== kf.angle)) {
          onSend('move_keyframe', { timeline_id: tid, servo_id: servoId, t_ms: orig, new_t_ms: dp.t_ms, new_angle: dp.angle })
          setSelKf({ servo_id: servoId, t_ms: dp.t_ms })
        }
        return null
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [duration, tid, onSend])

  return (
    <div className="flex flex-col gap-2">
      {/* timeline picker + new */}
      <div className="flex items-center gap-1.5">
        <select className={`${field} flex-1`} value={tid ?? ''} onChange={(e) => { setSelId(e.target.value); setSelKf(null); setHead(0) }}>
          {timelines.length === 0 && <option value="">(no timelines)</option>}
          {timelines.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
        </select>
        {tid && <button type="button" className="text-slate-500 hover:text-rose-300" onClick={() => onSend('delete_timeline', { id: tid })}><X className="h-3.5 w-3.5" /></button>}
      </div>
      <div className="flex items-center gap-1.5">
        <input className={`${field} flex-1`} placeholder="new timeline name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button type="button" className={`${btn} bg-slate-800 text-slate-200 hover:bg-slate-700`} disabled={!newName.trim()}
          onClick={() => { onSend('save_timeline', { name: newName.trim() }); setNewName('') }}>New</button>
      </div>

      {tl && (
        <>
          {/* transport + duration + loop */}
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            {playingThis
              ? <button type="button" className={`${btn} bg-slate-800 text-slate-200`} onClick={() => onSend('stop')}><Square className="h-3 w-3" /></button>
              : <button type="button" className={`${btn} bg-emerald-800 text-emerald-100`} onClick={() => onSend('play_timeline', { id: tl.id })}><Play className="h-3 w-3" /></button>}
            <span>dur</span>
            <input type="number" min={1} step={100} defaultValue={duration} className={`${field} w-20`}
              onBlur={(e) => onSend('update_timeline', { id: tl.id, duration_ms: Number(e.target.value) })} />
            <span>ms</span>
            <label className="flex items-center gap-1"><input type="checkbox" checked={tl.loop} onChange={(e) => onSend('update_timeline', { id: tl.id, loop: e.target.checked })} /> loop</label>
            <span className="ml-auto font-mono text-slate-300">{Math.round(head)}ms</span>
          </div>

          {/* scrubber */}
          <input type="range" min={0} max={duration} step={10} value={head}
            className="w-full accent-sky-500" onChange={(e) => doSeek(Number(e.target.value))} />

          {/* per-servo tracks — dots positioned by (time, angle), draggable */}
          <div className="flex flex-col gap-1.5">
            {members.length === 0 && <div className="text-[11px] text-slate-500">Add members in the Drive tab first.</div>}
            {members.map((m) => {
              const lo = m.min_angle ?? 0
              const hi = m.max_angle ?? 180
              const span = Math.max(1, hi - lo)
              const track = tl.tracks.find((t) => t.servo_id === m.servo_id)
              const kfs = [...(track?.keyframes ?? [])].sort((a, b) => a.t_ms - b.t_ms)
              const xPct = (t: number) => Math.min(100, Math.max(0, (t / duration) * 100))
              const yPct = (ang: number) => Math.min(100, Math.max(0, (1 - (ang - lo) / span) * 100))
              const liveKf = (kf: Keyframe) =>
                (dragPos && dragPos.servo_id === m.servo_id && dragPos.orig_t_ms === kf.t_ms)
                  ? { t_ms: dragPos.t_ms, angle: dragPos.angle } : { t_ms: kf.t_ms, angle: kf.angle }
              const pts = kfs.map((kf) => { const v = liveKf(kf); return `${xPct(v.t_ms)},${yPct(v.angle)}` }).join(' ')
              return (
                <div key={m.servo_id} className="flex items-center gap-2 text-[11px]">
                  <span className="w-14 shrink-0 truncate font-mono text-slate-300" title={`${m.label} (${lo}–${hi}°)`}>{m.label}</span>
                  <div className="relative h-14 flex-1 rounded bg-slate-800">
                    {kfs.length > 1 && (
                      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
                        <polyline points={pts} fill="none" stroke="#34d399" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                      </svg>
                    )}
                    <div className="absolute top-0 h-full w-px bg-sky-400" style={{ left: `${xPct(head)}%` }} />
                    {kfs.map((kf) => {
                      const v = liveKf(kf)
                      const sel = selKf?.servo_id === m.servo_id && selKf?.t_ms === kf.t_ms
                      return (
                        <button key={kf.t_ms} type="button" title={`${v.t_ms}ms → ${v.angle}° (${kf.easing ?? 'linear'}) — drag to move`}
                          onPointerDown={(e) => startDrag(e, m.servo_id, lo, hi, kf)}
                          className={`absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border active:cursor-grabbing ${sel ? 'border-white bg-amber-400' : 'border-slate-900 bg-emerald-400'}`}
                          style={{ left: `${xPct(v.t_ms)}%`, top: `${yPct(v.angle)}%` }} />
                      )
                    })}
                  </div>
                  <button type="button" className={`${btn} shrink-0 bg-slate-800 text-slate-200 hover:bg-slate-700`}
                    title="Add keyframe at the playhead (captures current angle)"
                    onClick={() => onSend('add_keyframe', { timeline_id: tl.id, servo_id: m.servo_id, t_ms: Math.round(head) })}>+KF</button>
                </div>
              )
            })}
          </div>

          {/* selected keyframe editor */}
          {selKf && (() => {
            const track = tl.tracks.find((t) => t.servo_id === selKf.servo_id)
            const kf = track?.keyframes.find((k) => k.t_ms === selKf.t_ms)
            if (!kf) return null
            const args = (extra: Record<string, unknown>) => ({ timeline_id: tl.id, servo_id: selKf.servo_id, t_ms: selKf.t_ms, ...extra })
            return (
              <div key={`${selKf.servo_id}:${selKf.t_ms}`} className="flex flex-wrap items-center gap-1.5 rounded border border-amber-800/50 bg-amber-950/20 p-2 text-[11px]">
                <span className="font-mono text-amber-300">{selKf.servo_id}</span>
                <label className="flex items-center gap-1">t<input type="number" min={0} step={10} defaultValue={kf.t_ms} className={`${field} w-20`}
                  onBlur={(e) => { onSend('move_keyframe', args({ new_t_ms: Number(e.target.value) })); setSelKf({ servo_id: selKf.servo_id, t_ms: Number(e.target.value) }) }} /></label>
                <label className="flex items-center gap-1">°<input type="number" min={0} max={180} defaultValue={kf.angle} className={`${field} w-16`}
                  onBlur={(e) => onSend('move_keyframe', args({ new_angle: Number(e.target.value) }))} /></label>
                <select className={field} defaultValue={kf.easing ?? 'linear'} onChange={(e) => onSend('move_keyframe', args({ easing: e.target.value }))}>
                  {EASINGS.map((ez) => (<option key={ez} value={ez}>{ez}</option>))}
                </select>
                <button type="button" className="ml-auto text-slate-500 hover:text-rose-300"
                  onClick={() => { onSend('remove_keyframe', args({})); setSelKf(null) }}><X className="h-3 w-3" /></button>
              </div>
            )
          })()}
        </>
      )}
    </div>
  )
}
