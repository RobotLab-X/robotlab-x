// Modular UI for the local (offline) speech-to-text service. Drives the
// shared `transcription` control interface: pick which microphone topic to
// transcribe, start/stop continuous recognition, mute, choose a model — and
// watch live partials + finalized utterances stream in on /stt/{id}/text.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useWsClient, type InboundFrame, type ServiceProxy } from '@rlx/ui'

interface Model { id: string; label?: string; downloaded?: boolean }
interface SttState {
  model?: string | null; models?: Model[]
  input_kind?: string | null; input_ref?: string | null
  sample_rate?: number; muted?: boolean; listening?: boolean; continuous?: boolean
  downloading?: boolean; ready?: boolean; queued?: number
  level_rms?: number; last_partial?: string; last_final?: string; last_error?: string | null; source?: string
}
interface TextFrame { text?: string; final?: boolean; seq?: number; ts?: number }

export default function SttLocalView({ proxy }: { proxy: ServiceProxy }) {
  const wsClient = useWsClient()
  const proxyId = proxy.id ?? proxy.name ?? ''
  const T = (s: string) => `/stt/${proxyId}/${s}`

  const [state, setState] = useState<SttState>({})
  const [ref, setRef] = useState('')
  const [partial, setPartial] = useState('')
  const [finals, setFinals] = useState<string[]>([])
  const refDirty = useRef(false)

  const sendAction = useCallback(
    (action: string, args: Record<string, unknown> = {}) => wsClient.publish(T('control'), { action, ...args }),
    [wsClient, proxyId],
  )

  useEffect(() => {
    if (!proxyId) return
    const offState = wsClient.subscribe(T('state'), (f: InboundFrame) => {
      if (f.method !== 'message') return
      const s = (f.payload as SttState) ?? {}; setState(s)
      if (!refDirty.current) setRef(s.input_ref ?? '')
    })
    const offText = wsClient.subscribe(T('text'), (f: InboundFrame) => {
      if (f.method !== 'message') return
      const t = f.payload as TextFrame
      const txt = (t?.text ?? '').trim()
      if (t?.final) {
        setPartial('')
        if (txt) setFinals((prev) => [...prev.slice(-49), txt])
      } else {
        setPartial(txt)
      }
    })
    sendAction('list_models')
    return () => { offState(); offText() }
  }, [proxyId, wsClient, sendAction])

  // Keep the transcript scrolled to the newest line.
  const logRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight }, [finals, partial])

  const applyInput = () => {
    sendAction('select_input', { kind: ref.trim() ? 'topic' : null, ref: ref.trim() || null })
    refDirty.current = false
  }
  const muted = !!state.muted
  const listening = !!state.listening
  const models = state.models ?? []
  const level = muted ? 0 : (state.level_rms ?? 0)
  const status = state.downloading ? 'downloading model…'
    : !state.ready && listening ? 'starting…'
    : listening ? 'listening' : 'idle'

  return (
    <div className="rlx-drag-handle space-y-3 p-3 text-sm text-slate-200">
      <div className="flex items-center justify-between">
        <span className="font-semibold">Speech-to-text</span>
        <span className="text-[10px] uppercase tracking-wide text-cyan-400">{state.source ?? 'local'}</span>
      </div>

      {/* Source microphone topic */}
      <label className="block space-y-1">
        <span className="text-xs text-slate-400">Microphone audio topic</span>
        <div className="flex gap-2">
          <input type="text" value={ref} onChange={(e) => { setRef(e.target.value); refDirty.current = true }}
            placeholder="/microphone/mic_local-1/audio"
            className="nodrag nopan min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px]"
            onPointerDown={(e) => e.stopPropagation()} />
          <button type="button" onClick={applyInput}
            className="nodrag nopan rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500"
            onPointerDownCapture={(e) => e.stopPropagation()}>Set</button>
        </div>
      </label>

      {/* Model */}
      <label className="block space-y-1">
        <span className="text-xs text-slate-400">Model</span>
        <select value={state.model ?? ''} onChange={(e) => sendAction('set_model', { model: e.target.value || null })}
          className="nodrag nopan w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
          onPointerDown={(e) => e.stopPropagation()}>
          <option value="">(default model)</option>
          {models.map((m) => <option key={m.id} value={m.id}>{m.label ?? m.id}{m.downloaded ? '' : ' ⤓'}</option>)}
        </select>
      </label>

      {/* Transport */}
      <div className="flex gap-2">
        <button type="button" onClick={() => sendAction(listening ? 'stop' : 'start')}
          className={`nodrag nopan flex-1 rounded px-2 py-1 text-xs font-medium ${listening ? 'border border-rose-600 text-rose-300 hover:bg-rose-950/40' : 'bg-cyan-600 text-white hover:bg-cyan-500'}`}
          onPointerDownCapture={(e) => e.stopPropagation()}>{listening ? 'Stop' : 'Start'}</button>
        <button type="button" onClick={() => sendAction(muted ? 'unmute' : 'mute')}
          className={`nodrag nopan rounded border px-2 py-1 text-xs ${muted ? 'border-amber-500 text-amber-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}
          onPointerDownCapture={(e) => e.stopPropagation()}>{muted ? 'Unmute' : 'Mute'}</button>
      </div>

      {/* Level meter */}
      <div className="h-2 w-full overflow-hidden rounded bg-slate-800">
        <div className="h-full bg-cyan-400 transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
      </div>

      {/* Transcript */}
      <div ref={logRef} className="max-h-40 min-h-[3rem] space-y-1 overflow-y-auto rounded border border-slate-800 bg-slate-950/60 p-2 text-[12px] leading-snug">
        {finals.length === 0 && !partial && <div className="text-slate-600">…transcript appears here…</div>}
        {finals.map((t, i) => <div key={i} className="text-slate-200">{t}</div>)}
        {partial && <div className="text-cyan-300/80 italic">{partial}</div>}
      </div>

      <div className="flex items-center justify-between text-[10px] text-slate-500">
        <span>queued: {state.queued ?? 0}</span>
        <span className={muted ? 'text-amber-400' : (state.downloading ? 'text-sky-400' : (listening ? 'text-emerald-400' : 'text-slate-500'))}>{status}</span>
      </div>
      {state.last_error && <div className="text-[10px] text-rose-400">{state.last_error}</div>}
    </div>
  )
}
