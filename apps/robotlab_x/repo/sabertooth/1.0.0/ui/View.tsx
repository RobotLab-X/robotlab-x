// SabertoothFullView — driver UI for the sabertooth motor_controller.
//
// The Sabertooth owns a serial port and speaks Packetized Serial, so
// this view is about the *link* and *driver-level* concerns:
//   1. Connection — serial port dropdown + baud + address, Connect /
//      Disconnect, connectivity light.
//   2. Safety — max-output clamp, hardware serial timeout, ramping,
//      deadband.
//   3. Manual test — a per-motor slider + stop so the operator can
//      exercise the driver directly without a motor_control attached.
//
// High-level control (channels, limits, e-stop, multi-controller) lives
// in the motor_control service / MotorControl.tsx — this view drives one
// Sabertooth directly. The space/enter = STOP convention lives in the
// motor_control view; here a plain Stop-all button is enough.
import {
  useCallback, useEffect, useState, type FormEvent,
} from 'react'
import { Loader2 } from 'lucide-react'

import type { ServiceProxy } from '@rlx/ui'
import type { InboundFrame } from '@rlx/ui'
import { useWsClient } from '@rlx/ui'
import { useServiceRequest } from '@rlx/ui'


// Only these baud rates are valid in Packetized Serial mode.
const BAUD_OPTIONS = [2400, 9600, 19200, 38400, 115200]
// DIP-switch addresses 128..135.
const ADDRESS_OPTIONS = [128, 129, 130, 131, 132, 133, 134, 135]


interface PortInfo {
  device: string
  description?: string
  hwid?: string
  holders?: { proxy_id?: string | null; pid: number; service_type?: string | null; name?: string | null }[]
}

interface SabertoothState {
  connected?: boolean
  port?: string | null
  baudrate?: number
  address?: number
  channels?: number[]
  motors?: Record<string, number>   // commanded value per channel, -1..1
  has_feedback?: boolean
  max_output?: number
  serial_timeout_ms?: number
  ramping?: number
  deadband?: number
  ports?: PortInfo[]
  last_port?: string | null
  last_baud?: number
  errors?: number
  last_error?: string | null
  connected_at?: string | null
}


export default function SabertoothFullView({ proxy }: { proxy: ServiceProxy }) {
  const wsClient = useWsClient()
  const proxyId = proxy.id ?? proxy.name ?? ''
  const stateTopic = `/sabertooth/${proxyId}/state`
  const controlTopic = `/sabertooth/${proxyId}/control`

  const [state, setState] = useState<SabertoothState>({})

  // Connect-form drafts (separate from authoritative state).
  const [portDraft, setPortDraft] = useState<string>('')
  const [baudDraft, setBaudDraft] = useState<number>(9600)
  const [addressDraft, setAddressDraft] = useState<number>(128)

  // ─── subscribe to /state ───────────────────────────────────────────
  useEffect(() => {
    if (!proxyId) return
    const off = wsClient.subscribe(stateTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      setState(f.payload as SabertoothState)
    })
    return off
  }, [proxyId, stateTopic, wsClient])

  // Pre-fill connect drafts from state while not connected.
  useEffect(() => {
    if (state.connected) return
    if (state.last_port && !portDraft) setPortDraft(state.last_port)
    if (state.last_baud) setBaudDraft(state.last_baud)
    if (typeof state.address === 'number') setAddressDraft(state.address)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.last_port, state.last_baud, state.address, state.connected])

  // ─── actions ───────────────────────────────────────────────────────
  const sendAction = useCallback(
    (payload: Record<string, unknown>) => { wsClient.publish(controlTopic, payload) },
    [controlTopic, wsClient],
  )
  const connectRequest = useServiceRequest<SabertoothState>(controlTopic, {
    timeoutMs: 10_000, errorField: 'last_error', replyPrefix: `sabertooth-${proxyId}-connect`,
  })
  const disconnectRequest = useServiceRequest<SabertoothState>(controlTopic, {
    timeoutMs: 5_000, errorField: 'last_error', replyPrefix: `sabertooth-${proxyId}-disconnect`,
  })

  const onConnect = useCallback((e?: FormEvent) => {
    e?.preventDefault()
    if (!portDraft || connectRequest.inFlight) return
    void connectRequest.request('connect', { port: portDraft, baudrate: baudDraft, address: addressDraft })
  }, [portDraft, baudDraft, addressDraft, connectRequest])

  const onDisconnect = useCallback(() => {
    if (disconnectRequest.inFlight) return
    void disconnectRequest.request('disconnect')
  }, [disconnectRequest])

  const onRefreshPorts = useCallback(() => sendAction({ action: 'list_ports' }), [sendAction])

  const connected = !!state.connected
  const channels = state.channels ?? [1, 2]
  const error = connectRequest.error ?? disconnectRequest.error ?? state.last_error

  // Keep the operator's draft selectable even if not in the live list.
  const ports = state.ports ?? []
  const portDevices = new Set(ports.map((p) => p.device))

  return (
    <div
      className="flex min-w-[460px] flex-col gap-3 p-3 text-xs"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* ── connection ─────────────────────────────────────────────── */}
      <Section title="Connection">
        <form onSubmit={onConnect} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col">
            <span className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">port</span>
            <div className="flex items-center gap-1">
              <select
                value={portDraft}
                onChange={(e) => setPortDraft(e.target.value)}
                disabled={connected}
                onPointerDown={(e) => e.stopPropagation()}
                className="nodrag nopan w-60 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100 focus:border-slate-500 focus:outline-none disabled:opacity-50"
              >
                {!portDraft && <option value="">(pick a port)</option>}
                {ports.map((p) => {
                  const others = (p.holders ?? []).filter((h) => h.proxy_id !== proxyId)
                  const ownedByOther = others.length > 0
                  return (
                    <option key={p.device} value={p.device} disabled={ownedByOther}>
                      {p.device}{p.description ? `  — ${p.description}` : ''}
                      {ownedByOther ? '  (in use)' : ''}
                    </option>
                  )
                })}
                {portDraft && !portDevices.has(portDraft) && (
                  <option value={portDraft}>{portDraft}  — (not detected)</option>
                )}
              </select>
              <button
                type="button" onClick={onRefreshPorts} disabled={connected}
                onPointerDown={(e) => e.stopPropagation()} title="Refresh port list"
                className="nodrag nopan rounded border border-slate-700 px-2 py-1 text-[11px] hover:border-slate-500 disabled:opacity-50"
              >↻</button>
            </div>
          </label>
          <label className="flex flex-col">
            <span className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">baud</span>
            <select
              value={baudDraft} onChange={(e) => setBaudDraft(Number(e.target.value))} disabled={connected}
              onPointerDown={(e) => e.stopPropagation()}
              className="nodrag nopan w-24 rounded border border-slate-700 bg-slate-950 px-1 py-1 font-mono text-[11px] text-slate-100 disabled:opacity-50"
            >
              {BAUD_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label className="flex flex-col">
            <span className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">address</span>
            <select
              value={addressDraft} onChange={(e) => setAddressDraft(Number(e.target.value))} disabled={connected}
              onPointerDown={(e) => e.stopPropagation()}
              className="nodrag nopan w-20 rounded border border-slate-700 bg-slate-950 px-1 py-1 font-mono text-[11px] text-slate-100 disabled:opacity-50"
            >
              {ADDRESS_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <div className="ml-auto flex items-center gap-2">
            {/* Connectivity light */}
            <span className="flex items-center gap-1.5 font-mono text-[10px]">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${connected ? 'bg-emerald-400 shadow-[0_0_6px_1px] shadow-emerald-500/60' : 'bg-slate-600'}`} />
              <span className={connected ? 'text-emerald-300' : 'text-slate-500'}>
                {connected ? 'connected' : 'offline'}
              </span>
            </span>
            {!connected ? (
              <button
                type="submit" disabled={!portDraft || connectRequest.inFlight} aria-busy={connectRequest.inFlight}
                onPointerDown={(e) => e.stopPropagation()}
                className="nodrag nopan inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {connectRequest.inFlight && <Loader2 className="h-3 w-3 animate-spin" />}
                {connectRequest.inFlight ? 'Connecting…' : 'Connect'}
              </button>
            ) : (
              <button
                type="button" onClick={onDisconnect} disabled={disconnectRequest.inFlight} aria-busy={disconnectRequest.inFlight}
                onPointerDown={(e) => e.stopPropagation()}
                className="nodrag nopan inline-flex items-center gap-1.5 rounded border border-slate-700 px-3 py-1 text-[11px] hover:border-rose-500 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {disconnectRequest.inFlight && <Loader2 className="h-3 w-3 animate-spin" />}
                {disconnectRequest.inFlight ? 'Disconnecting…' : 'Disconnect'}
              </button>
            )}
          </div>
        </form>
        {error && (
          <div className="mt-2 truncate font-mono text-[10px] text-rose-300" title={error}>
            error: {error}
          </div>
        )}
      </Section>

      {/* ── safety ─────────────────────────────────────────────────── */}
      <SafetySection
        maxOutput={state.max_output ?? 1}
        serialTimeoutMs={state.serial_timeout_ms ?? 1000}
        ramping={state.ramping ?? 0}
        deadband={state.deadband ?? 0}
        onSetMaxOutput={(v) => sendAction({ action: 'set_max_output', max_output: v })}
        onSetOptions={(opts) => sendAction({ action: 'set_options', ...opts })}
      />

      {/* ── manual test ────────────────────────────────────────────── */}
      <Section title="Manual test">
        {!connected ? (
          <div className="rounded border border-slate-800 bg-slate-950/70 p-2 text-slate-500">
            Connect to drive motors directly. (For limits + e-stop + multi-motor control, use a motor_control service.)
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {channels.map((ch) => (
              <MotorSlider
                key={ch}
                channel={ch}
                value={state.motors?.[String(ch)] ?? 0}
                onSet={(v) => sendAction({ action: 'motor_set', motor: ch, value: v })}
                onStop={() => sendAction({ action: 'motor_stop', motor: ch })}
              />
            ))}
            <button
              type="button"
              onClick={() => sendAction({ action: 'motor_stop_all' })}
              onPointerDown={(e) => e.stopPropagation()}
              className="nodrag nopan rounded bg-rose-600 px-3 py-2 text-sm font-bold uppercase tracking-wide text-white hover:bg-rose-500"
            >
              ■ Stop all
            </button>
          </div>
        )}
      </Section>
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────
// One motor channel's bidirectional slider (-1 … +1) + stop.
// ─────────────────────────────────────────────────────────────────────

function MotorSlider({
  channel, value, onSet, onStop,
}: {
  channel: number
  value: number
  onSet: (v: number) => void
  onStop: () => void
}) {
  const [draft, setDraft] = useState<number>(value)
  const [dragging, setDragging] = useState(false)
  useEffect(() => { if (!dragging) setDraft(value) }, [value, dragging])
  const pct = Math.round(draft * 100)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between font-mono text-[10px] text-slate-400">
        <span className="uppercase tracking-wider text-slate-500">motor {channel}</span>
        <span className={pct === 0 ? 'text-slate-500' : pct > 0 ? 'text-emerald-300' : 'text-amber-300'}>
          {pct > 0 ? '+' : ''}{pct}%
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="range" min={-1} max={1} step={0.01} value={draft}
          className="nodrag nopan flex-1 accent-emerald-500"
          onPointerDown={() => setDragging(true)}
          onPointerUp={() => setDragging(false)}
          onChange={(e) => { const v = Number(e.target.value); setDraft(v); onSet(v) }}
        />
        <button
          type="button" onClick={() => { setDraft(0); onStop() }}
          onPointerDown={(e) => e.stopPropagation()}
          className="nodrag nopan rounded border border-slate-700 px-2 py-1 text-[10px] hover:border-rose-500 hover:text-rose-300"
        >stop</button>
      </div>
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────
// Safety section — max-output clamp + hardware options.
// ─────────────────────────────────────────────────────────────────────

function SafetySection({
  maxOutput, serialTimeoutMs, ramping, deadband, onSetMaxOutput, onSetOptions,
}: {
  maxOutput: number
  serialTimeoutMs: number
  ramping: number
  deadband: number
  onSetMaxOutput: (v: number) => void
  onSetOptions: (opts: { serial_timeout_ms?: number; ramping?: number; deadband?: number }) => void
}) {
  const [maxDraft, setMaxDraft] = useState<number>(maxOutput)
  const [dragging, setDragging] = useState(false)
  const [timeoutDraft, setTimeoutDraft] = useState<string>(String(serialTimeoutMs))
  const [rampDraft, setRampDraft] = useState<string>(String(ramping))
  const [deadDraft, setDeadDraft] = useState<string>(String(deadband))
  useEffect(() => { if (!dragging) setMaxDraft(maxOutput) }, [maxOutput, dragging])
  useEffect(() => { setTimeoutDraft(String(serialTimeoutMs)) }, [serialTimeoutMs])
  useEffect(() => { setRampDraft(String(ramping)) }, [ramping])
  useEffect(() => { setDeadDraft(String(deadband)) }, [deadband])

  return (
    <Section title="Safety">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between font-mono text-[10px]">
            <span className="uppercase tracking-wider text-slate-500">max output</span>
            <span className="text-amber-300">{Math.round(maxDraft * 100)}%</span>
          </div>
          <input
            type="range" min={0} max={1} step={0.01} value={maxDraft}
            className="nodrag nopan accent-amber-500"
            onPointerDown={() => setDragging(true)}
            onPointerUp={() => { setDragging(false); onSetMaxOutput(maxDraft) }}
            onChange={(e) => setMaxDraft(Number(e.target.value))}
          />
          <span className="text-[10px] text-slate-500">
            Hard clamp on output magnitude — caps motor power regardless of what's commanded.
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">timeout (ms)</span>
            <input
              type="number" min={0} step={100} value={timeoutDraft}
              onChange={(e) => setTimeoutDraft(e.target.value)}
              onBlur={() => onSetOptions({ serial_timeout_ms: Math.max(0, Number(timeoutDraft) || 0) })}
              onPointerDown={(e) => e.stopPropagation()}
              className="nodrag nopan rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">ramping (0-80)</span>
            <input
              type="number" min={0} max={80} value={rampDraft}
              onChange={(e) => setRampDraft(e.target.value)}
              onBlur={() => onSetOptions({ ramping: Math.max(0, Math.min(80, Number(rampDraft) || 0)) })}
              onPointerDown={(e) => e.stopPropagation()}
              className="nodrag nopan rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">deadband (0-127)</span>
            <input
              type="number" min={0} max={127} value={deadDraft}
              onChange={(e) => setDeadDraft(e.target.value)}
              onBlur={() => onSetOptions({ deadband: Math.max(0, Math.min(127, Number(deadDraft) || 0)) })}
              onPointerDown={(e) => e.stopPropagation()}
              className="nodrag nopan rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100"
            />
          </label>
        </div>
        <span className="text-[10px] text-slate-500">
          Serial timeout is the hardware failsafe — motors stop if the link goes quiet for this long. 0 disables.
        </span>
      </div>
    </Section>
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
