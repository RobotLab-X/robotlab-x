// JoystickFullView — UI for the joystick service.
//
// The layout is fully DYNAMIC: every controller exposes a different
// number of axes / buttons / hats / balls, so this view reads the
// component counts from /state and builds the right number of each
// control, then overlays the live values streamed on /input.
//
//   /joystick/{id}/state  — device list, attached device + component
//                           counts, enabled flag (slow, retained)
//   /joystick/{id}/input  — live values snapshot (fast, on-change)
//
// Sections:
//   1. Device — dropdown + Attach/Detach + connectivity light + enable
//      toggle + poll/deadzone params.
//   2. Stats  — component counts for the attached device.
//   3. Axes / Buttons / Hats / Balls — one block per present component
//      type, each rendering ``count`` live controls.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'

import type { ServiceProxy } from '@rlx/ui'
import type { InboundFrame } from '@rlx/ui'
import { useWsClient } from '@rlx/ui'


interface DeviceMeta {
  index: number
  name: string
  guid: string
  num_axes: number
  num_buttons: number
  num_hats: number
  num_balls: number
}

interface JoystickState {
  attached?: boolean
  enabled?: boolean
  devices?: DeviceMeta[]
  device?: DeviceMeta | null
  components?: { axes: number; buttons: number; hats: number; balls: number }
  poll_hz?: number
  deadzone?: number
  last_index?: number | null
  last_error?: string | null
}

interface InputSnapshot {
  axes?: number[]
  buttons?: number[]
  hats?: number[][]
  balls?: number[][]
  ts?: number
}


export default function JoystickFullView({ proxy }: { proxy: ServiceProxy }) {
  const wsClient = useWsClient()
  const proxyId = proxy.id ?? proxy.name ?? ''
  const stateTopic = `/joystick/${proxyId}/state`
  const inputTopic = `/joystick/${proxyId}/input`
  const controlTopic = `/joystick/${proxyId}/control`

  const [state, setState] = useState<JoystickState>({})
  const [input, setInput] = useState<InputSnapshot>({})
  const [selectedIndex, setSelectedIndex] = useState<string>('')

  // ─── subscriptions ──────────────────────────────────────────────────
  useEffect(() => {
    if (!proxyId) return
    const offState = wsClient.subscribe(stateTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      setState(f.payload as JoystickState)
    })
    const offInput = wsClient.subscribe(inputTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      setInput(f.payload as InputSnapshot)
    })
    return () => { offState(); offInput() }
  }, [proxyId, stateTopic, inputTopic, wsClient])

  // When detached, drop stale live values so the controls reset to 0.
  useEffect(() => {
    if (!state.attached) setInput({})
  }, [state.attached])

  // Default the dropdown to the attached device, else the persisted
  // last_index, else the first detected device.
  const devices = useMemo(() => state.devices ?? [], [state.devices])
  useEffect(() => {
    if (selectedIndex) return
    if (state.device) { setSelectedIndex(String(state.device.index)); return }
    if (typeof state.last_index === 'number' && devices.some((d) => d.index === state.last_index)) {
      setSelectedIndex(String(state.last_index)); return
    }
    if (devices.length > 0) setSelectedIndex(String(devices[0].index))
  }, [state.device, state.last_index, devices, selectedIndex])

  // ─── actions ────────────────────────────────────────────────────────
  const sendAction = useCallback(
    (payload: Record<string, unknown>) => { wsClient.publish(controlTopic, payload) },
    [controlTopic, wsClient],
  )
  const onAttach = useCallback((e?: FormEvent) => {
    e?.preventDefault()
    const idx = Number.parseInt(selectedIndex, 10)
    if (Number.isNaN(idx)) return
    sendAction({ action: 'attach', index: idx })
  }, [selectedIndex, sendAction])
  const onDetach = useCallback(() => sendAction({ action: 'detach' }), [sendAction])
  const onRefresh = useCallback(() => sendAction({ action: 'list_devices' }), [sendAction])

  const attached = !!state.attached
  const enabled = state.enabled ?? true
  const comps = state.components ?? { axes: 0, buttons: 0, hats: 0, balls: 0 }
  const device = state.device ?? null
  const streaming = attached && enabled

  return (
    <div className="flex min-w-[480px] flex-col gap-3 p-3 text-xs" onPointerDown={(e) => e.stopPropagation()}>
      {/* ── device ──────────────────────────────────────────────────── */}
      <Section title="Device">
        <form onSubmit={onAttach} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col">
            <span className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">controller</span>
            <div className="flex items-center gap-1">
              <select
                value={selectedIndex}
                onChange={(e) => setSelectedIndex(e.target.value)}
                disabled={attached || devices.length === 0}
                onPointerDown={(e) => e.stopPropagation()}
                className="nodrag nopan w-72 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100 focus:border-slate-500 focus:outline-none disabled:opacity-50"
              >
                {devices.length === 0 && <option value="">(no joysticks detected)</option>}
                {devices.map((d) => (
                  <option key={`${d.index}:${d.guid}`} value={d.index}>
                    [{d.index}] {d.name} · {d.num_axes}a {d.num_buttons}b {d.num_hats}h
                  </option>
                ))}
              </select>
              <button
                type="button" onClick={onRefresh} disabled={attached}
                onPointerDown={(e) => e.stopPropagation()} title="Rescan devices"
                className="nodrag nopan rounded border border-slate-700 px-2 py-1 text-[11px] hover:border-slate-500 disabled:opacity-50"
              >↻</button>
            </div>
          </label>
          <div className="ml-auto flex items-center gap-2">
            {/* Connectivity light */}
            <span className="flex items-center gap-1.5 font-mono text-[10px]">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${
                attached ? (streaming ? 'bg-emerald-400 shadow-[0_0_6px_1px] shadow-emerald-500/60' : 'bg-amber-400') : 'bg-slate-600'
              }`} />
              <span className={attached ? (streaming ? 'text-emerald-300' : 'text-amber-300') : 'text-slate-500'}>
                {attached ? (streaming ? 'streaming' : 'paused') : 'detached'}
              </span>
            </span>
            {attached && (
              <label className="flex items-center gap-1 font-mono text-[10px] text-slate-300">
                <input
                  type="checkbox" checked={enabled}
                  onChange={(e) => sendAction({ action: 'set_enabled', enabled: e.target.checked })}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="nodrag nopan accent-emerald-500"
                />enabled
              </label>
            )}
            {!attached ? (
              <button
                type="submit" disabled={!selectedIndex || devices.length === 0}
                onPointerDown={(e) => e.stopPropagation()}
                className="nodrag nopan rounded bg-emerald-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              >Attach</button>
            ) : (
              <button
                type="button" onClick={onDetach}
                onPointerDown={(e) => e.stopPropagation()}
                className="nodrag nopan rounded border border-slate-700 px-3 py-1 text-[11px] hover:border-rose-500 hover:text-rose-300"
              >Detach</button>
            )}
          </div>
        </form>
        {state.last_error && (
          <div className="mt-2 truncate font-mono text-[10px] text-rose-300" title={state.last_error}>
            error: {state.last_error}
          </div>
        )}
        {devices.length === 0 && !state.last_error && (
          <div className="mt-1 text-slate-500">No joysticks detected. Plug one in and click ↻.</div>
        )}
      </Section>

      {!attached ? (
        <div className="rounded border border-slate-800 bg-slate-950/70 p-3 text-slate-500">
          Attach a controller to see its live axes, buttons, and hats.
        </div>
      ) : (
        <>
          {/* ── stats ─────────────────────────────────────────────────── */}
          <Section title="Components">
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
              {device && <span className="text-slate-300">{device.name}</span>}
              <Stat label="axes" n={comps.axes} />
              <Stat label="buttons" n={comps.buttons} />
              <Stat label="hats" n={comps.hats} />
              {comps.balls > 0 && <Stat label="balls" n={comps.balls} />}
              <span className="ml-auto text-slate-500">{state.poll_hz ?? 60} Hz · deadzone {state.deadzone ?? 0.05}</span>
            </div>
          </Section>

          {/* ── dynamic control blocks ────────────────────────────────── */}
          {comps.axes > 0 && (
            <Section title="Axes">
              <div className="flex flex-col gap-2">
                {Array.from({ length: comps.axes }, (_, i) => (
                  <AxisBar key={i} index={i} value={input.axes?.[i] ?? 0} />
                ))}
              </div>
            </Section>
          )}

          {comps.buttons > 0 && (
            <Section title="Buttons">
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: comps.buttons }, (_, i) => (
                  <ButtonDot key={i} index={i} pressed={!!input.buttons?.[i]} />
                ))}
              </div>
            </Section>
          )}

          {comps.hats > 0 && (
            <Section title="Hats">
              <div className="flex flex-wrap gap-4">
                {Array.from({ length: comps.hats }, (_, i) => (
                  <Hat key={i} index={i} xy={input.hats?.[i] ?? [0, 0]} />
                ))}
              </div>
            </Section>
          )}

          {comps.balls > 0 && (
            <Section title="Balls">
              <div className="flex flex-wrap gap-4 font-mono text-[11px] text-slate-300">
                {Array.from({ length: comps.balls }, (_, i) => {
                  const [dx, dy] = input.balls?.[i] ?? [0, 0]
                  return <span key={i}>ball {i}: Δx {dx} · Δy {dy}</span>
                })}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────
// Component renderers
// ─────────────────────────────────────────────────────────────────────

function Stat({ label, n }: { label: string; n: number }) {
  return (
    <span className="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 text-slate-300">
      {n} <span className="text-slate-500">{label}</span>
    </span>
  )
}

// A center-zero bar: fill grows left (negative) or right (positive)
// from the midline, so resting sticks sit centered and triggers (which
// rest at -1) read clearly.
function AxisBar({ index, value }: { index: number; value: number }) {
  const v = Math.max(-1, Math.min(1, value))
  const half = Math.abs(v) * 50 // percent of half-width
  const positive = v >= 0
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 font-mono text-[10px] text-slate-500">axis {index}</span>
      <div className="relative h-3 flex-1 rounded bg-slate-800">
        {/* center tick */}
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-slate-600" />
        <div
          className={`absolute top-0 h-full rounded ${positive ? 'bg-emerald-500' : 'bg-sky-500'}`}
          style={positive ? { left: '50%', width: `${half}%` } : { right: '50%', width: `${half}%` }}
        />
      </div>
      <span className={`w-14 text-right font-mono text-[10px] ${v === 0 ? 'text-slate-500' : 'text-slate-200'}`}>
        {v > 0 ? '+' : ''}{v.toFixed(2)}
      </span>
    </div>
  )
}

function ButtonDot({ index, pressed }: { index: number; pressed: boolean }) {
  return (
    <span
      title={`button ${index}`}
      className={`flex h-7 w-7 items-center justify-center rounded font-mono text-[10px] ${
        pressed
          ? 'bg-emerald-500 text-white shadow-[0_0_6px_1px] shadow-emerald-500/60'
          : 'border border-slate-700 bg-slate-950 text-slate-500'
      }`}
    >
      {index}
    </span>
  )
}

// 3x3 d-pad grid. pygame hats report x ∈ {-1,0,1} (left..right) and
// y ∈ {-1,0,1} where +1 is UP — so the active cell is row (1 - y),
// col (x + 1).
function Hat({ index, xy }: { index: number; xy: number[] }) {
  const x = xy[0] ?? 0
  const y = xy[1] ?? 0
  const centered = x === 0 && y === 0
  const activeRow = 1 - y   // +1 (up) → top row
  const activeCol = x + 1   // -1 (left) → left col
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="grid grid-cols-3 grid-rows-3 gap-0.5">
        {Array.from({ length: 9 }, (_, k) => {
          const row = Math.floor(k / 3)
          const col = k % 3
          const isCenter = row === 1 && col === 1
          const lit = !centered && row === activeRow && col === activeCol
          return (
            <span
              key={k}
              className={`h-3 w-3 rounded-sm ${
                lit ? 'bg-emerald-500' : isCenter ? 'bg-slate-700' : 'bg-slate-800'
              }`}
            />
          )
        })}
      </div>
      <span className="font-mono text-[10px] text-slate-500">hat {index} ({x},{y})</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-slate-800 bg-slate-900/40 p-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
      {children}
    </section>
  )
}
