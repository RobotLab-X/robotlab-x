// Modular UI for the local (host-capture) microphone. Drives the shared
// audio-device control interface (list_devices / select_device / connect /
// disconnect / mute / unmute) + save-to-file (start_recording /
// stop_recording with a pre-loaded, editable filename), and shows a live
// level meter computed from the audio frames on /microphone/{id}/audio.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useWsClient, type InboundFrame, type ServiceProxy } from '@rlx/ui'

interface MicDevice { id: string; label: string; default?: boolean }
interface MicState {
  connected?: boolean
  muted?: boolean
  device_id?: string | null
  last_connected_source?: string | null
  devices?: MicDevice[]
  sample_rate?: number
  channels?: number
  level_rms?: number
  last_error?: string | null
  source?: string
  recording?: boolean
  recording_path?: string | null
  recording_suggested_path?: string | null
  recorded_bytes?: number
}
interface AudioFrame { sample_rate: number; data: string }

function b64ToInt16(b64: string): Int16Array {
  const bin = atob(b64)
  const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return new Int16Array(u8.buffer, 0, u8.length >> 1)
}
function rms16(a: Int16Array): number {
  if (!a.length) return 0
  let s = 0
  for (let i = 0; i < a.length; i++) { const v = a[i] / 32768; s += v * v }
  return Math.min(1, Math.sqrt(s / a.length))
}

export default function MicLocalView({ proxy }: { proxy: ServiceProxy }) {
  const wsClient = useWsClient()
  const proxyId = proxy.id ?? proxy.name ?? ''
  const stateTopic = `/microphone/${proxyId}/state`
  const controlTopic = `/microphone/${proxyId}/control`
  const audioTopic = `/microphone/${proxyId}/audio`

  const [state, setState] = useState<MicState>({})
  const [level, setLevel] = useState(0)
  const [monitor, setMonitor] = useState(false)
  const [filename, setFilename] = useState('')
  const filenameEdited = useRef(false)

  const sendAction = useCallback(
    (action: string, args: Record<string, unknown> = {}) => wsClient.publish(controlTopic, { action, ...args }),
    [wsClient, controlTopic],
  )

  useEffect(() => {
    if (!proxyId) return
    const off = wsClient.subscribe(stateTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const s = (f.payload as MicState) ?? {}
      setState(s)
      // Pre-load the suggested filename unless the user edited the field.
      if (!filenameEdited.current && s.recording_suggested_path) setFilename(s.recording_suggested_path)
    })
    sendAction('list_devices')
    return off
  }, [proxyId, stateTopic, wsClient, sendAction])

  // WebAudio monitor (lazy).
  const ctxRef = useRef<AudioContext | null>(null)
  const nextTimeRef = useRef(0)
  useEffect(() => {
    if (!monitor) { ctxRef.current?.close().catch(() => {}); ctxRef.current = null; return }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    ctxRef.current = new Ctor()
    nextTimeRef.current = 0
    return () => { ctxRef.current?.close().catch(() => {}); ctxRef.current = null }
  }, [monitor])

  useEffect(() => {
    if (!proxyId) return
    const off = wsClient.subscribe(audioTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const frame = f.payload as AudioFrame
      if (!frame?.data) return
      const pcm = b64ToInt16(frame.data)
      setLevel(rms16(pcm))
      const ctx = ctxRef.current
      if (!ctx) return
      const buf = ctx.createBuffer(1, pcm.length, frame.sample_rate || 16000)
      const ch = buf.getChannelData(0)
      for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(ctx.destination)
      const at = Math.max(ctx.currentTime + 0.02, nextTimeRef.current)
      src.start(at)
      nextTimeRef.current = at + buf.duration
    })
    return off
  }, [proxyId, audioTopic, wsClient])

  const connected = !!state.connected
  const muted = !!state.muted
  const recording = !!state.recording
  const devices = state.devices ?? []

  return (
    <div className="rlx-drag-handle space-y-3 p-3 text-sm text-slate-200">
      <div className="flex items-center justify-between">
        <span className="font-semibold">Microphone</span>
        <span className="text-[10px] uppercase tracking-wide text-cyan-400">{state.source ?? 'local'}</span>
      </div>

      <label className="block space-y-1">
        <span className="text-xs text-slate-400">Device</span>
        <select value={state.device_id ?? ''} onChange={(e) => sendAction('select_device', { device_id: e.target.value || null })}
          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs">
          <option value="">(default device)</option>
          {devices.map((d) => <option key={d.id} value={d.id}>{d.label}{d.default ? ' ★' : ''}</option>)}
        </select>
        {state.last_connected_source != null && (
          <span className="block text-[10px] text-slate-500">last connected: {state.last_connected_source}</span>
        )}
      </label>

      <div className="flex items-center gap-2">
        {connected ? (
          <button type="button" onClick={() => sendAction('disconnect')}
            className="rounded bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-500">Disconnect</button>
        ) : (
          <button type="button" onClick={() => sendAction('connect')}
            className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500">Connect</button>
        )}
        <button type="button" disabled={!connected} onClick={() => sendAction(muted ? 'unmute' : 'mute')}
          className={`rounded border px-2 py-1 text-xs disabled:opacity-50 ${muted ? 'border-amber-500 text-amber-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}>
          {muted ? 'Unmute' : 'Mute'}
        </button>
        <label className="ml-auto flex items-center gap-1 text-xs text-slate-400">
          <input type="checkbox" checked={monitor} onChange={(e) => setMonitor(e.target.checked)} /> Monitor
        </label>
      </div>

      <div className="h-2 w-full overflow-hidden rounded bg-slate-800">
        <div className="h-full bg-cyan-400 transition-[width] duration-75"
          style={{ width: `${Math.round((connected && !muted ? level : 0) * 100)}%` }} />
      </div>

      {/* Save to file */}
      <div className="space-y-1 border-t border-slate-800 pt-2">
        <span className="text-xs text-slate-400">Save to file</span>
        <input type="text" value={filename} onChange={(e) => { setFilename(e.target.value); filenameEdited.current = true }}
          placeholder="auto filename" disabled={recording}
          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] disabled:opacity-60" />
        <div className="flex items-center gap-2">
          {recording ? (
            <button type="button" onClick={() => sendAction('stop_recording')}
              className="rounded bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-500">Stop saving</button>
          ) : (
            <button type="button" onClick={() => { sendAction('start_recording', { path: filename || undefined }); filenameEdited.current = false }}
              className="rounded border border-emerald-700 px-3 py-1 text-xs font-medium text-emerald-300 hover:border-emerald-500">Record to file</button>
          )}
          {recording && <span className="text-[10px] text-emerald-400">● {Math.round((state.recorded_bytes ?? 0) / 1024)} KB</span>}
        </div>
      </div>

      <div className="flex justify-between text-[10px] text-slate-500">
        <span>{state.sample_rate ?? '—'} Hz · {state.channels === 2 ? 'stereo' : 'mono'}</span>
        <span className={connected ? (muted ? 'text-amber-400' : 'text-emerald-400') : ''}>
          {connected ? (muted ? 'muted' : 'live') : 'disconnected'}
        </span>
      </div>
      {state.last_error && <div className="text-[10px] text-rose-400">{state.last_error}</div>}
    </div>
  )
}
