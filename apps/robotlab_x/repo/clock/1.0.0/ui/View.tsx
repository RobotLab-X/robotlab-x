import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { ServiceProxy } from '@rlx/ui'
import { type InboundFrame } from '@rlx/ui'
import { useWsClient } from '@rlx/ui'

interface TickPayload {
  seq: number
  interval_ms: number
  now: number
}
interface StatePayload {
  paused: boolean
  interval_ms?: number
}

function fmtClock(epochSec: number): { hms: string; ms: string } {
  const d = new Date(epochSec * 1000)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return {
    hms: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    ms: pad(d.getMilliseconds(), 3),
  }
}

const MIN_INTERVAL_MS = 50

export default function ClockFullView({ proxy }: { proxy: ServiceProxy }) {
  const wsClient = useWsClient()
  const proxyId = proxy.id ?? proxy.name ?? ''
  const tickTopic = `/clock/${proxyId}/tick`
  const stateTopic = `/clock/${proxyId}/state`
  const controlTopic = `/clock/${proxyId}/control`

  // Last tick from the bus. Null until the first tick arrives — we render
  // a placeholder until then. After the first tick we keep showing the
  // most-recent timestamp even if ticks pause.
  const [lastTick, setLastTick] = useState<TickPayload | null>(null)
  const [paused, setPaused] = useState<boolean | null>(null)
  // Authoritative interval comes from the service via /state. We mirror
  // it into ``intervalDraft`` only when the input isn't being edited; once
  // the user types, the draft holds their value until Apply.
  const [serviceInterval, setServiceInterval] = useState<number | null>(null)
  const [intervalDraft, setIntervalDraft] = useState<string>('')
  const [editingInterval, setEditingInterval] = useState(false)

  useEffect(() => {
    if (!proxyId) return
    const offTick = wsClient.subscribe(tickTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      setLastTick(f.payload as TickPayload)
    })
    const offState = wsClient.subscribe(stateTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const p = f.payload as StatePayload
      setPaused(!!p?.paused)
      if (typeof p?.interval_ms === 'number') {
        setServiceInterval(p.interval_ms)
      }
    })
    return () => { offTick(); offState() }
  }, [proxyId, tickTopic, stateTopic, wsClient])

  // Sync the draft with the live service value while the input isn't being
  // edited. The first time we see an interval the field gets populated;
  // subsequent service-side changes (e.g. another tab applying a new
  // value) also flow through. Editing locks the draft until Apply / Reset.
  useEffect(() => {
    if (editingInterval) return
    if (serviceInterval !== null) setIntervalDraft(String(serviceInterval))
  }, [serviceInterval, editingInterval])

  const sendControl = useCallback(
    (payload: Record<string, unknown>) => {
      wsClient.publish(controlTopic, payload)
    },
    [controlTopic, wsClient],
  )

  const applyInterval = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault()
      const parsed = Number.parseInt(intervalDraft, 10)
      if (Number.isNaN(parsed)) return
      const clamped = Math.max(MIN_INTERVAL_MS, parsed)
      sendControl({ action: 'set_interval', interval_ms: clamped })
      setEditingInterval(false)
    },
    [intervalDraft, sendControl],
  )

  const serviceRunning = proxy.status === 'running' || proxy.status === 'starting'
  const time = lastTick ? fmtClock(lastTick.now) : null
  const draftDiffers =
    editingInterval &&
    serviceInterval !== null &&
    Number.parseInt(intervalDraft, 10) !== serviceInterval

  return (
    <div className="flex min-w-[260px] flex-col gap-2 p-3">
      <div className="rounded bg-slate-950/80 px-3 py-2 text-center font-mono">
        {time ? (
          <>
            <span className="text-3xl tracking-wider text-emerald-300">{time.hms}</span>
            <span className="ml-1 text-xs text-emerald-500/70">.{time.ms}</span>
          </>
        ) : (
          <span className="text-sm text-slate-500">
            {serviceRunning ? 'waiting for tick…' : 'service not running'}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500">
        <span>tick #{lastTick?.seq ?? '—'}</span>
        <span>{lastTick ? `every ${lastTick.interval_ms}ms` : ''}</span>
        <span>
          {paused === null ? 'state ?' : paused ? 'paused' : 'ticking'}
        </span>
      </div>

      {/* Interval editor. The input + Apply button live inside a form so
          pressing Enter applies the change. nodrag + nopan + stopPropagation
          on the input keep React Flow from grabbing focus / dragging the
          node while you type. */}
      <form
        onSubmit={applyInterval}
        className="flex items-center gap-2"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <label className="text-[10px] uppercase tracking-wider text-slate-500">
          interval ms
        </label>
        <input
          type="number"
          min={MIN_INTERVAL_MS}
          step={50}
          value={intervalDraft}
          onChange={(e) => { setIntervalDraft(e.target.value); setEditingInterval(true) }}
          onFocus={() => setEditingInterval(true)}
          onClick={(e) => e.stopPropagation()}
          className="nodrag nopan w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100 focus:border-slate-500 focus:outline-none"
        />
        <button
          type="submit"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={!serviceRunning || !draftDiffers}
          className="nodrag nopan rounded border border-slate-700 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-200 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Apply
        </button>
      </form>

      {/* React Flow uses pointer events to grab clicks for pan / node
          selection before our onClick can fire. nodrag + nopan classes
          turn that off for these elements, and onPointerDown
          stopPropagation guards the rest. Together they make the
          buttons receive the click instead of just gaining focus. */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); sendControl({ action: 'start_clock' }) }}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={!serviceRunning || paused === false}
          className="nodrag nopan flex-1 rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Start clock
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); sendControl({ action: 'stop_clock' }) }}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={!serviceRunning || paused === true}
          className="nodrag nopan flex-1 rounded border border-slate-700 px-2 py-1 text-xs font-medium text-slate-200 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Stop clock
        </button>
      </div>
    </div>
  )
}
