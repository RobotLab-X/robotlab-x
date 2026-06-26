import { useCallback, useEffect, useRef, useState } from 'react'
import { Keyboard } from 'lucide-react'
import type { ServiceProxy } from '@rlx/ui'
import { type InboundFrame } from '@rlx/ui'
import { useWsClient } from '@rlx/ui'
import { KeymapEditor, type KeyBinding } from '@rlx/ui'

// Browser keyboard capture (Level C). The card captures DOM keydown/keyup
// — while the card is focused ('card' scope) or the whole tab ('document')
// — normalizes each into the canonical key-event shape, and publishes it to
// /keyboard/{id}/event. The backend owns capturing state + the keymap, and
// drives this card via /keyboard/{id}/cmd.

interface KeyEvent {
  type?: string
  key?: string
  code?: string
  modifiers?: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean }
  repeat?: boolean
}

interface KbState {
  capturing?: boolean
  scope?: string
  suppress?: boolean
  bindings?: KeyBinding[]
  pressed?: string[]
  last_event?: KeyEvent | null
  last_error?: string | null
}

const HEARTBEAT_MS = 2000

export default function KeyboardBrowserView({ proxy }: { proxy: ServiceProxy }) {
  const wsClient = useWsClient()
  const proxyId = proxy.id ?? proxy.name ?? ''
  const stateTopic = `/keyboard/${proxyId}/state`
  const cmdTopic = `/keyboard/${proxyId}/cmd`
  const eventTopic = `/keyboard/${proxyId}/event`
  const reportTopic = `/keyboard/${proxyId}/report`
  const controlTopic = `/keyboard/${proxyId}/control`

  const [state, setState] = useState<KbState>({})
  // Browser-side capture state, driven by /cmd from the backend.
  const [armed, setArmed] = useState(false)
  const [scope, setScope] = useState('card')
  const [suppress, setSuppress] = useState(false)
  const [focused, setFocused] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  // Keep mutable copies for the native key handlers (which close over the
  // first render otherwise).
  const suppressRef = useRef(suppress)
  suppressRef.current = suppress

  const publishReport = useCallback((capturing: boolean, error?: string) => {
    wsClient.publish(reportTopic, { capturing, error: error ?? null, ts: Date.now() / 1000 })
  }, [wsClient, reportTopic])

  const send = useCallback((action: string, args: Record<string, unknown> = {}) => {
    wsClient.publish(controlTopic, { action, ...args })
  }, [wsClient, controlTopic])

  // ─── backend state + commands ─────────────────────────────────────
  useEffect(() => {
    if (!proxyId) return
    const offState = wsClient.subscribe(stateTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      setState((prev) => ({ ...prev, ...(f.payload as KbState) }))
    })
    const offCmd = wsClient.subscribe(cmdTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const p = f.payload as { action?: string; scope?: string; suppress?: boolean }
      if (p.action === 'start') {
        if (typeof p.scope === 'string') setScope(p.scope)
        if (typeof p.suppress === 'boolean') setSuppress(p.suppress)
        setArmed(true)
      } else if (p.action === 'stop') {
        setArmed(false)
      } else if (p.action === 'set_scope' && typeof p.scope === 'string') {
        setScope(p.scope)
      } else if (p.action === 'set_suppress' && typeof p.suppress === 'boolean') {
        setSuppress(p.suppress)
      }
    })
    return () => { offState(); offCmd() }
  }, [proxyId, stateTopic, cmdTopic, wsClient])

  // ─── DOM key capture ──────────────────────────────────────────────
  useEffect(() => {
    if (!armed || !proxyId) return
    const target: EventTarget = scope === 'document' ? window : (cardRef.current ?? window)

    const emit = (e: KeyboardEvent, type: 'down' | 'up') => {
      // While armed, keep keys from also driving the canvas; preventDefault
      // only when suppressing so browser defaults (scroll, find) are blocked.
      e.stopPropagation()
      if (suppressRef.current) e.preventDefault()
      wsClient.publish(eventTopic, {
        type,
        key: (e.key || '').toLowerCase(),
        code: e.code || '',
        modifiers: { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey },
        repeat: e.repeat,
        ts: Date.now() / 1000,
        source: 'browser',
      })
    }
    const onDown = (e: Event) => emit(e as KeyboardEvent, 'down')
    const onUp = (e: Event) => emit(e as KeyboardEvent, 'up')
    target.addEventListener('keydown', onDown)
    target.addEventListener('keyup', onUp)
    publishReport(true)
    const hb = setInterval(() => publishReport(true), HEARTBEAT_MS)
    return () => {
      target.removeEventListener('keydown', onDown)
      target.removeEventListener('keyup', onUp)
      clearInterval(hb)
    }
  }, [armed, scope, proxyId, eventTopic, wsClient, publishReport])

  const capturing = !!state.capturing && armed
  const pressed = state.pressed ?? []
  const bindings = state.bindings ?? []
  const last = state.last_event ?? null
  const needsFocus = armed && scope === 'card' && !focused

  const fmtEvent = (e: KeyEvent | null): string => {
    if (!e) return '—'
    const m = e.modifiers ?? {}
    const mods = [m.ctrl && 'ctrl', m.alt && 'alt', m.shift && 'shift', m.meta && 'meta'].filter(Boolean)
    return `${e.type === 'up' ? '▲' : '▼'} ${[...mods, e.code || e.key].join('+')}`
  }

  const btn = 'rounded px-2 py-1 text-xs disabled:opacity-40'

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={`flex flex-col gap-3 p-3 text-slate-200 outline-none ${
        capturing ? 'ring-2 ring-emerald-500/60' : ''
      } ${needsFocus ? 'ring-2 ring-amber-500/50' : ''}`}
    >
      {/* status header */}
      <div className="flex items-center gap-2 text-xs">
        <Keyboard className="h-4 w-4 text-slate-400" />
        <span className={`h-2 w-2 rounded-full ${capturing ? 'bg-emerald-400' : 'bg-slate-600'}`} />
        <span className="font-medium">{capturing ? 'Capturing' : 'Idle'}</span>
        <span className="text-slate-500">{scope}</span>
        {state.last_error && <span className="ml-auto text-rose-400">{state.last_error}</span>}
      </div>

      {/* controls */}
      <div className="flex flex-wrap items-center gap-2">
        {!capturing ? (
          <button type="button" className={`${btn} bg-emerald-700 text-white hover:bg-emerald-600`}
            onClick={() => { cardRef.current?.focus(); send('start_capture') }}>
            Arm
          </button>
        ) : (
          <button type="button" className={`${btn} bg-slate-700 text-slate-100 hover:bg-slate-600`}
            onClick={() => send('stop_capture')}>
            Disarm
          </button>
        )}
        <select
          className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
          value={scope}
          onChange={(e) => send('set_scope', { scope: e.target.value })}
        >
          <option value="card">card focus</option>
          <option value="document">whole tab</option>
        </select>
        <label className="flex items-center gap-1 text-[11px] text-slate-400">
          <input type="checkbox" checked={suppress} onChange={(e) => send('set_suppress', { suppress: e.target.checked })} />
          suppress
        </label>
      </div>

      {needsFocus && (
        <div className="rounded border border-amber-700/60 bg-amber-950/30 px-2 py-1 text-[11px] text-amber-300">
          Click this card to focus it — keys are only captured while it has focus.
        </div>
      )}

      {/* live readout */}
      <div className="rounded border border-slate-800 p-2 text-[11px]">
        <div className="mb-1 flex items-center justify-between text-slate-500">
          <span>last</span>
          <span className="font-mono text-slate-300">{fmtEvent(last)}</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {pressed.length === 0 && <span className="text-slate-600">no keys held</span>}
          {pressed.map((k) => (
            <span key={k} className="rounded bg-emerald-900/50 px-1.5 py-0.5 font-mono text-emerald-200">{k}</span>
          ))}
        </div>
      </div>

      {/* keymap editor (shared @rlx/ui component) */}
      <KeymapEditor
        bindings={bindings}
        onBind={(b) => send('bind', b as Record<string, unknown>)}
        onUnbind={(id) => send('unbind', { id })}
        onClear={() => send('clear_bindings')}
      />
    </div>
  )
}
