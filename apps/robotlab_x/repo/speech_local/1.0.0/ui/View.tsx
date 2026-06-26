// Modular UI for the local (offline) speech / text-to-speech service.
// Drives the shared `speech` control interface: type text → Say (queued) or
// Say now (interrupt), pick a voice, mute, Stop (interrupt), set rate/volume,
// and manage the WAV cache. The meter + scope ride the frames the service
// streams on /speech/{id}/audio — the same frames a speaker plays, so this
// view shows exactly what's going out on the bus.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useWsClient, type InboundFrame, type ServiceProxy } from '@rlx/ui'

interface Voice { id: string; label?: string; downloaded?: boolean }
interface SpeechState {
  voice?: string | null; voices?: Voice[]
  sample_rate?: number; channels?: number; format?: string
  volume?: number; rate?: number; muted?: boolean
  speaking?: boolean; synthesizing?: boolean; current_text?: string | null
  queue?: string[]; cache_count?: number; cache_bytes?: number
  level_rms?: number; last_error?: string | null; source?: string
}
function b64ToInt16(b64: string): Int16Array {
  const bin = atob(b64); const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return new Int16Array(u8.buffer, 0, u8.length >> 1)
}
function rms16(a: Int16Array): number {
  if (!a.length) return 0
  let s = 0; for (let i = 0; i < a.length; i++) { const v = a[i] / 32768; s += v * v }
  return Math.min(1, Math.sqrt(s / a.length))
}
function fmtBytes(n?: number): string {
  if (!n) return '0 KB'
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`
}

export default function SpeechLocalView({ proxy }: { proxy: ServiceProxy }) {
  const wsClient = useWsClient()
  const proxyId = proxy.id ?? proxy.name ?? ''
  const T = (s: string) => `/speech/${proxyId}/${s}`

  const [state, setState] = useState<SpeechState>({})
  const [text, setText] = useState('')
  const [frameLevel, setFrameLevel] = useState(0)

  const sendAction = useCallback(
    (action: string, args: Record<string, unknown> = {}) => wsClient.publish(T('control'), { action, ...args }),
    [wsClient, proxyId],
  )

  useEffect(() => {
    if (!proxyId) return
    const off = wsClient.subscribe(T('state'), (f: InboundFrame) => {
      if (f.method !== 'message') return
      setState((f.payload as SpeechState) ?? {})
    })
    sendAction('list_voices')
    return off
  }, [proxyId, wsClient, sendAction])

  // Waveform ring buffer fed from the streamed frames.
  const ringRef = useRef<Float32Array>(new Float32Array(256))
  const pushSamples = useCallback((i16: Int16Array) => {
    const ring = ringRef.current
    const m = i16.length
    if (m === 0) return
    const f = new Float32Array(m)
    for (let i = 0; i < m; i++) f[i] = i16[i] / 32768
    if (m >= ring.length) ring.set(f.slice(-ring.length))
    else { ring.copyWithin(0, m); ring.set(f, ring.length - m) }
  }, [])

  useEffect(() => {
    if (!proxyId) return
    return wsClient.subscribe(T('audio'), (f: InboundFrame) => {
      if (f.method !== 'message') return
      const fr = f.payload as { data?: string }
      if (!fr?.data) return
      const i16 = b64ToInt16(fr.data)
      setFrameLevel(rms16(i16)); pushSamples(i16)
    })
  }, [proxyId, wsClient, pushSamples])

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const cv = canvasRef.current
      const g = cv?.getContext('2d')
      if (!cv || !g) return
      const w = cv.width, h = cv.height
      g.clearRect(0, 0, w, h); g.fillStyle = '#0f172a'; g.fillRect(0, 0, w, h)
      const ring = ringRef.current
      g.strokeStyle = '#22d3ee'; g.beginPath(); g.lineWidth = 1.5
      for (let i = 0; i < ring.length; i++) { const x = (i / (ring.length - 1)) * w; const y = h / 2 - ring[i] * h * 0.46; i ? g.lineTo(x, y) : g.moveTo(x, y) }
      g.stroke()
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  const say = (interrupt: boolean) => {
    const t = text.trim()
    if (!t) return
    sendAction('speak', { text: t, interrupt })
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); say(false) }
  }

  const muted = !!state.muted
  const voices = state.voices ?? []
  const level = muted ? 0 : frameLevel
  const queue = state.queue ?? []
  const status = state.synthesizing ? 'synthesizing…' : (state.speaking ? 'speaking' : 'idle')

  return (
    <div className="rlx-drag-handle space-y-3 p-3 text-sm text-slate-200">
      <div className="flex items-center justify-between">
        <span className="font-semibold">Speech</span>
        <span className="text-[10px] uppercase tracking-wide text-cyan-400">{state.source ?? 'local'}</span>
      </div>

      <textarea
        className="nodrag nopan w-full resize-y rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
        rows={3} value={text} placeholder="Type something to say…  (⌘/Ctrl+Enter = Say)"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        onChange={(e) => setText(e.target.value)} />

      <div className="flex gap-2">
        <button type="button" onClick={() => say(false)}
          className="nodrag nopan flex-1 rounded bg-cyan-600 px-2 py-1 text-xs font-medium text-white hover:bg-cyan-500"
          onPointerDownCapture={(e) => e.stopPropagation()}>Say</button>
        <button type="button" onClick={() => say(true)} title="Interrupt anything playing and say this now"
          className="nodrag nopan rounded border border-cyan-700 px-2 py-1 text-xs text-cyan-300 hover:border-cyan-500"
          onPointerDownCapture={(e) => e.stopPropagation()}>Say now</button>
        <button type="button" onClick={() => sendAction('stop')} title="Interrupt + clear queue"
          className="nodrag nopan rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-rose-500 hover:text-rose-300"
          onPointerDownCapture={(e) => e.stopPropagation()}>Stop</button>
        <button type="button" onClick={() => sendAction(muted ? 'unmute' : 'mute')}
          className={`nodrag nopan rounded border px-2 py-1 text-xs ${muted ? 'border-amber-500 text-amber-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}
          onPointerDownCapture={(e) => e.stopPropagation()}>{muted ? 'Unmute' : 'Mute'}</button>
      </div>

      <label className="block space-y-1">
        <span className="text-xs text-slate-400">Voice</span>
        <select value={state.voice ?? ''} onChange={(e) => sendAction('set_voice', { voice: e.target.value || null })}
          className="nodrag nopan w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
          onPointerDown={(e) => e.stopPropagation()}>
          <option value="">(default voice)</option>
          {voices.map((v) => <option key={v.id} value={v.id}>{v.label ?? v.id}{v.downloaded ? '' : ' ⤓'}</option>)}
        </select>
      </label>

      {/* Level meter + scope */}
      <div className="h-2 w-full overflow-hidden rounded bg-slate-800">
        <div className="h-full bg-cyan-400 transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
      </div>
      <canvas ref={canvasRef} width={256} height={48} className="h-12 w-full rounded border border-slate-800" />

      <label className="flex items-center gap-2 text-[10px] text-slate-500">
        <span className="w-9 shrink-0 uppercase tracking-wide">Rate</span>
        <input type="range" min={0.5} max={2} step={0.05} value={state.rate ?? 1}
          onChange={(e) => sendAction('set_rate', { rate: Number(e.target.value) })}
          className="nodrag nopan flex-1 accent-cyan-400" onPointerDown={(e) => e.stopPropagation()} />
        <span className="w-8 text-right tabular-nums text-slate-400">{(state.rate ?? 1).toFixed(2)}×</span>
      </label>
      <label className="flex items-center gap-2 text-[10px] text-slate-500">
        <span className="w-9 shrink-0 uppercase tracking-wide">Vol</span>
        <input type="range" min={0} max={1} step={0.01} value={state.volume ?? 1}
          onChange={(e) => sendAction('set_volume', { volume: Number(e.target.value) })}
          className="nodrag nopan flex-1 accent-cyan-400" onPointerDown={(e) => e.stopPropagation()} />
        <span className="w-8 text-right tabular-nums text-slate-400">{Math.round((state.volume ?? 1) * 100)}</span>
      </label>

      {state.current_text && (
        <div className="truncate text-[11px] text-slate-400" title={state.current_text}>▶ {state.current_text}</div>
      )}
      {queue.length > 0 && <div className="text-[10px] text-slate-500">queued: {queue.length}</div>}

      <div className="flex items-center justify-between border-t border-slate-800 pt-2 text-[10px] text-slate-500">
        <span>cache: {state.cache_count ?? 0} · {fmtBytes(state.cache_bytes)}</span>
        <div className="flex items-center gap-2">
          <span className={muted ? 'text-amber-400' : (state.speaking || state.synthesizing ? 'text-emerald-400' : 'text-slate-500')}>{status}</span>
          <button type="button" onClick={() => sendAction('clear_cache')}
            className="nodrag nopan rounded border border-slate-700 px-1.5 py-0.5 text-slate-400 hover:border-rose-500 hover:text-rose-300"
            onPointerDownCapture={(e) => e.stopPropagation()}>Clear cache</button>
        </div>
      </div>
      {state.last_error && <div className="text-[10px] text-rose-400">{state.last_error}</div>}
    </div>
  )
}
