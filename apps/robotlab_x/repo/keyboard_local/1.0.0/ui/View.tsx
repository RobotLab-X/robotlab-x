import { useCallback, useEffect, useState } from 'react'
import { Keyboard } from 'lucide-react'
import type { ServiceProxy } from '@rlx/ui'
import { type InboundFrame } from '@rlx/ui'
import { useWsClient } from '@rlx/ui'
import { KeymapEditor, type KeyBinding } from '@rlx/ui'

// Host keyboard control card (Levels A/B). Unlike the browser keyboard,
// capture happens on the HOST (evdev/pynput); this card only drives the
// service + shows live state — no DOM capture here.

interface KeyEvent {
  type?: string; key?: string; code?: string
  modifiers?: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean }
}
interface InputDevice { id?: string; name?: string }

interface KbState {
  capturing?: boolean
  scope?: string
  backend?: string
  device_id?: string | null
  grab?: boolean
  devices?: InputDevice[]
  available_backends?: string[]
  bindings?: KeyBinding[]
  pressed?: string[]
  last_event?: KeyEvent | null
  last_error?: string | null
}

export default function KeyboardLocalView({ proxy }: { proxy: ServiceProxy }) {
  const wsClient = useWsClient()
  const proxyId = proxy.id ?? proxy.name ?? ''
  const stateTopic = `/keyboard/${proxyId}/state`
  const controlTopic = `/keyboard/${proxyId}/control`

  const [state, setState] = useState<KbState>({})

  useEffect(() => {
    if (!proxyId) return
    const off = wsClient.subscribe(stateTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      setState((prev) => ({ ...prev, ...(f.payload as KbState) }))
    })
    return off
  }, [proxyId, stateTopic, wsClient])

  const send = useCallback((action: string, args: Record<string, unknown> = {}) => {
    wsClient.publish(controlTopic, { action, ...args })
  }, [wsClient, controlTopic])

  const capturing = !!state.capturing
  const pressed = state.pressed ?? []
  const bindings = state.bindings ?? []
  const devices = state.devices ?? []
  const available = state.available_backends ?? []
  const backend = state.backend ?? 'auto'
  const isEvdev = backend === 'evdev' || (backend === 'auto' && available.includes('evdev'))
  const last = state.last_event ?? null

  const fmtEvent = (e: KeyEvent | null): string => {
    if (!e) return '—'
    const m = e.modifiers ?? {}
    const mods = [m.ctrl && 'ctrl', m.alt && 'alt', m.shift && 'shift', m.meta && 'meta'].filter(Boolean)
    return `${e.type === 'up' ? '▲' : '▼'} ${[...mods, e.code || e.key].join('+')}`
  }

  const fieldCls = 'rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200'
  const btn = 'rounded px-2 py-1 text-xs disabled:opacity-40'

  return (
    <div className={`flex flex-col gap-3 p-3 text-slate-200 ${capturing ? 'rounded ring-2 ring-emerald-500/40' : ''}`}>
      {/* status */}
      <div className="flex items-center gap-2 text-xs">
        <Keyboard className="h-4 w-4 text-slate-400" />
        <span className={`h-2 w-2 rounded-full ${capturing ? 'bg-emerald-400' : 'bg-slate-600'}`} />
        <span className="font-medium">{capturing ? 'Capturing' : 'Idle'}</span>
        <span className="text-slate-500">{backend}{state.grab ? ' · grab' : ''}</span>
        {state.last_error && <span className="ml-auto truncate text-rose-400" title={state.last_error}>{state.last_error}</span>}
      </div>

      {/* controls */}
      <div className="flex flex-wrap items-center gap-2">
        {!capturing ? (
          <button type="button" className={`${btn} bg-emerald-700 text-white hover:bg-emerald-600`} onClick={() => send('start_capture')}>Arm</button>
        ) : (
          <button type="button" className={`${btn} bg-slate-700 text-slate-100 hover:bg-slate-600`} onClick={() => send('stop_capture')}>Disarm</button>
        )}
        <select className={fieldCls} value={backend} onChange={(e) => send('set_backend', { backend: e.target.value })}>
          <option value="auto">auto</option>
          {['evdev', 'pynput'].map((b) => (
            <option key={b} value={b} disabled={!available.includes(b)}>{b}{available.includes(b) ? '' : ' (n/a)'}</option>
          ))}
        </select>
        <select className={fieldCls} value={state.scope ?? 'global'} onChange={(e) => send('set_scope', { scope: e.target.value })}>
          <option value="global">global</option>
          <option value="focused">focused</option>
        </select>
        <label className="flex items-center gap-1 text-[11px] text-slate-400" title={isEvdev ? 'Exclusive grab — keys do not reach other apps (teleop)' : 'Grab is evdev/Linux only'}>
          <input type="checkbox" checked={!!state.grab} disabled={!isEvdev} onChange={(e) => send('set_grab', { grab: e.target.checked })} />
          grab
        </label>
      </div>

      {/* evdev device picker */}
      {isEvdev && (
        <div className="flex flex-wrap items-center gap-2">
          <select className={`${fieldCls} max-w-[220px]`} value={state.device_id ?? ''} onChange={(e) => send('select_device', { device_id: e.target.value || null })}>
            <option value="">all keyboards</option>
            {devices.map((d) => (<option key={d.id} value={d.id}>{d.name ?? d.id}</option>))}
          </select>
          <button type="button" className={`${btn} bg-slate-800 text-slate-200 hover:bg-slate-700`} onClick={() => send('list_devices')}>Rescan</button>
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
          {pressed.map((k) => (<span key={k} className="rounded bg-emerald-900/50 px-1.5 py-0.5 font-mono text-emerald-200">{k}</span>))}
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
