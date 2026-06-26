// Modular UI for the local (host-playback) speaker — a generic player.
// Drives the shared control interface (connect/disconnect/mute/unmute +
// device select) and the input selector: play the default sink, another
// bus topic, a server file path, or a URL (decoded + played by the backend
// device). The meter is computed from the frames the speaker plays
// (/speaker/{id}/audio — the backend republishes file/url frames there).
import { useCallback, useEffect, useRef, useState } from 'react'
import { useWsClient, useServiceRequest, type InboundFrame, type ServiceProxy } from '@rlx/ui'

interface Dev { id: string; label: string; default?: boolean }
interface Track { kind: string; ref: string; name?: string }
interface SpkState {
  connected?: boolean; muted?: boolean; device_id?: string | null
  last_connected_source?: string | null; devices?: Dev[]
  sample_rate?: number; source?: string; last_error?: string | null; level_rms?: number
  input_kind?: string | null; input_ref?: string | null
  volume?: number; playing?: boolean; paused?: boolean; position_s?: number; duration_s?: number
  playlist?: Track[]; playlist_index?: number; repeat?: string; shuffle?: boolean
}
function fmtTime(s?: number): string {
  if (!s || s < 0) return '0:00'
  const m = Math.floor(s / 60); const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}
// Uniform compact transport button — same size + neutral color for all.
const TBTN = 'flex h-7 w-7 items-center justify-center rounded bg-slate-800 text-sm leading-none text-slate-300 hover:bg-slate-700 hover:text-white'
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

export default function SpeakerLocalView({ proxy }: { proxy: ServiceProxy }) {
  const wsClient = useWsClient()
  const proxyId = proxy.id ?? proxy.name ?? ''
  const T = (s: string) => `/speaker/${proxyId}/${s}`

  const [state, setState] = useState<SpkState>({})
  const [frameLevel, setFrameLevel] = useState(0)   // sink/topic: metered from incoming frames
  const [kind, setKind] = useState('')   // '' = sink (draft selection)
  const [ref, setRef] = useState('')
  const [browseOpen, setBrowseOpen] = useState(false)
  const [browseTarget, setBrowseTarget] = useState<'input' | 'playlist'>('input')
  const [vizMode, setVizMode] = useState<'wave' | 'bars'>('wave')
  // The input dropdown/field is a DRAFT until "Set". Once the user edits it,
  // incoming state must not clobber their in-progress choice (the bug where
  // it kept snapping back). Cleared once a selection is applied.
  const inputDirty = useRef(false)

  const sendAction = useCallback(
    (action: string, args: Record<string, unknown> = {}) => wsClient.publish(T('control'), { action, ...args }),
    [wsClient, proxyId],
  )

  // Server-side file browser (the file lives on the server; the speaker
  // subprocess lists it via the browse_files @service_method).
  interface BrowseReply { path: string; parent: string | null; dirs: string[]; files: { name: string; size: number }[]; roots: { label: string; path: string }[]; warn?: string | null }
  const browse = useServiceRequest<BrowseReply>(T('control'), { replyPrefix: 'spk-browse', timeoutMs: 8000 })
  const navigate = useCallback((path?: string) => { void browse.request('browse_files', { path }) }, [browse])
  const pickFile = (name: string) => {
    const dir = browse.reply?.path ?? ''
    const full = `${dir.replace(/\/$/, '')}/${name}`
    if (browseTarget === 'playlist') {
      sendAction('playlist_add', { items: [{ kind: 'file', ref: full, name }] })
      return   // keep the browser open so several files can be added
    }
    setRef(full)
    sendAction('select_input', { kind: 'file', ref: full })
    inputDirty.current = false
    setBrowseOpen(false)
  }
  const openBrowse = (target: 'input' | 'playlist') => {
    setBrowseTarget(target); setBrowseOpen(true); navigate(ref || undefined)
  }

  useEffect(() => {
    if (!proxyId) return
    const off = wsClient.subscribe(T('state'), (f: InboundFrame) => {
      if (f.method !== 'message') return
      const s = (f.payload as SpkState) ?? {}; setState(s)
      // Don't overwrite the user's in-progress draft selection.
      if (!inputDirty.current) { setKind(s.input_kind ?? ''); setRef(s.input_ref ?? '') }
    })
    sendAction('list_devices')
    return off
  }, [proxyId, wsClient, sendAction])

  // Waveform ring buffer, fed from whatever carries samples for the current
  // input: sink/topic → the /audio (or source topic) frames; file/url → the
  // backend's /viz frames (the device-played audio sampled at the audible
  // position). Both meter + feed the scope.
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
    const onFrame = (f: InboundFrame) => {
      if (f.method !== 'message') return
      const fr = f.payload as { data?: string }
      if (!fr?.data) return
      const i16 = b64ToInt16(fr.data)
      setFrameLevel(rms16(i16))
      pushSamples(i16)
    }
    const offs = [wsClient.subscribe(T('audio'), onFrame), wsClient.subscribe(T('viz'), onFrame)]
    if (state.input_kind === 'topic' && state.input_ref) offs.push(wsClient.subscribe(state.input_ref, onFrame))
    return () => offs.forEach((o) => o())
  }, [proxyId, wsClient, state.input_kind, state.input_ref, pushSamples])

  // Draw the scope on rAF from the ring buffer.
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
      g.strokeStyle = '#22d3ee'; g.fillStyle = '#22d3ee'
      if (vizMode === 'wave') {
        g.beginPath(); g.lineWidth = 1.5
        for (let i = 0; i < ring.length; i++) { const x = (i / (ring.length - 1)) * w; const y = h / 2 - ring[i] * h * 0.46; i ? g.lineTo(x, y) : g.moveTo(x, y) }
        g.stroke()
      } else {
        const n = 40, step = Math.max(1, Math.floor(ring.length / n))
        for (let b = 0; b < n; b++) { let m = 0; for (let j = 0; j < step; j++) m = Math.max(m, Math.abs(ring[b * step + j] || 0)); const bh = Math.min(1, m) * h; g.fillRect((b / n) * w + 1, h - bh, w / n - 2, bh) }
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [vizMode])

  const applyInput = () => { sendAction('select_input', { kind: kind || null, ref: ref || null }); inputDirty.current = false }
  const muted = !!state.muted
  const devices = state.devices ?? []
  const isBuffer = state.input_kind === 'file' || state.input_kind === 'url'
  const level = isBuffer ? (state.level_rms ?? 0) : frameLevel
  const playlist = state.playlist ?? []
  const plIdx = state.playlist_index ?? -1
  const repeat = state.repeat ?? 'off'
  const shuffle = !!state.shuffle
  const cycleRepeat = () => sendAction('set_repeat', { mode: repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off' })

  return (
    <div className="rlx-drag-handle space-y-3 p-3 text-sm text-slate-200">
      <div className="flex items-center justify-between">
        <span className="font-semibold">Speaker</span>
        <span className="text-[10px] uppercase tracking-wide text-cyan-400">{state.source ?? 'local'}</span>
      </div>

      <label className="block space-y-1">
        <span className="text-xs text-slate-400">Output device</span>
        <select value={state.device_id ?? ''} onChange={(e) => sendAction('select_device', { device_id: e.target.value || null })}
          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs">
          <option value="">(default device)</option>
          {devices.map((d) => <option key={d.id} value={d.id}>{d.label}{d.default ? ' ★' : ''}</option>)}
        </select>
        {state.last_connected_source != null && <span className="block text-[10px] text-slate-500">last connected: {state.last_connected_source}</span>}
      </label>

      {/* Input source — generic player */}
      <div className="space-y-1 border-t border-slate-800 pt-2">
        <span className="text-xs text-slate-400">Input</span>
        <div className="flex gap-2">
          <select value={kind} onChange={(e) => { setKind(e.target.value); inputDirty.current = true; setBrowseOpen(false) }} className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs">
            <option value="">Sink</option>
            <option value="topic">Topic</option>
            <option value="file">File</option>
            <option value="url">URL</option>
          </select>
          {kind !== '' && (
            <input type="text" value={ref} onChange={(e) => { setRef(e.target.value); inputDirty.current = true }}
              placeholder={kind === 'topic' ? '/microphone/mic-1/audio' : kind === 'file' ? '/path/on/server.wav' : 'https://…/audio.mp3'}
              className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px]" />
          )}
          {kind === 'file' && (
            <button type="button" onClick={() => (browseOpen && browseTarget === 'input' ? setBrowseOpen(false) : openBrowse('input'))}
              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500">Browse…</button>
          )}
          <button type="button" onClick={applyInput} className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500">Set</button>
        </div>

        {/* Server file browser (input file picker + playlist add) */}
        {browseOpen && (
          <div className="mt-1 rounded border border-slate-700 bg-slate-950/80 text-xs">
            <div className="flex items-center gap-2 border-b border-slate-800 px-2 py-1">
              {(browse.reply?.roots ?? []).map((r) => (
                <button key={r.path} type="button" onClick={() => navigate(r.path)} className="text-[10px] text-sky-400 hover:text-sky-300">{r.label}</button>
              ))}
              {browseTarget === 'playlist' && browse.reply?.path && (
                <button type="button" onClick={() => { sendAction('playlist_add_folder', { path: browse.reply!.path }); setBrowseOpen(false) }} className="rounded border border-slate-700 px-1.5 text-[10px] text-emerald-300 hover:border-emerald-500">+ folder</button>
              )}
              <span className="ml-auto truncate font-mono text-[10px] text-slate-500" title={browse.reply?.path}>{browse.reply?.path ?? '…'}</span>
              <button type="button" onClick={() => setBrowseOpen(false)} className="text-[10px] text-slate-500 hover:text-slate-300">✕</button>
            </div>
            <div className="max-h-40 overflow-y-auto p-1">
              {browse.inFlight && <div className="px-1 py-0.5 text-slate-500">loading…</div>}
              {browse.error && <div className="px-1 py-0.5 text-rose-400">{browse.error}</div>}
              {browse.reply?.parent && (
                <button type="button" onClick={() => navigate(browse.reply!.parent!)} className="block w-full truncate px-1 py-0.5 text-left text-slate-300 hover:bg-slate-800/60">📁 ..</button>
              )}
              {(browse.reply?.dirs ?? []).map((d) => (
                <button key={d} type="button" onClick={() => navigate(`${(browse.reply!.path).replace(/\/$/, '')}/${d}`)} className="block w-full truncate px-1 py-0.5 text-left text-slate-300 hover:bg-slate-800/60">📁 {d}</button>
              ))}
              {(browse.reply?.files ?? []).map((f) => (
                <button key={f.name} type="button" onClick={() => pickFile(f.name)} className="flex w-full items-center justify-between gap-2 px-1 py-0.5 text-left text-cyan-300 hover:bg-slate-800/60">
                  <span className="truncate">🎵 {f.name}</span>
                  <span className="shrink-0 text-[9px] text-slate-500">{Math.round(f.size / 1024)} KB</span>
                </button>
              ))}
              {browse.reply && browse.reply.dirs.length === 0 && browse.reply.files.length === 0 && !browse.inFlight && (
                <div className="px-1 py-0.5 text-slate-500">no audio files here{browse.reply.warn ? ` (${browse.reply.warn})` : ''}</div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => sendAction(muted ? 'unmute' : 'mute')}
          className={`rounded border px-2 py-1 text-xs ${muted ? 'border-amber-500 text-amber-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}>{muted ? 'Unmute' : 'Mute'}</button>
      </div>

      <div className="h-2 w-full overflow-hidden rounded bg-slate-800">
        <div className="h-full bg-cyan-400 transition-[width] duration-75" style={{ width: `${Math.round((!muted ? level : 0) * 100)}%` }} />
      </div>

      {/* Waveform / spectrum viewport */}
      <div className="relative">
        <canvas ref={canvasRef} width={256} height={56} className="h-14 w-full rounded border border-slate-800" />
        <div className="absolute right-1 top-1 flex gap-1">
          <button type="button" title="Waveform" onClick={() => setVizMode('wave')} className={`rounded px-1 text-[10px] ${vizMode === 'wave' ? 'bg-cyan-600 text-white' : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'}`}>∿</button>
          <button type="button" title="Spectrum" onClick={() => setVizMode('bars')} className={`rounded px-1 text-[10px] ${vizMode === 'bars' ? 'bg-cyan-600 text-white' : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'}`}>▥</button>
        </div>
      </div>

      {/* Transport (file/url) — uniform compact icon buttons */}
      {(state.input_kind === 'file' || state.input_kind === 'url') && (
        <div className="space-y-1">
          <div className="flex items-center justify-center gap-1">
            {playlist.length > 0 && <button type="button" title="Previous track" onClick={() => sendAction('previous_track')} className={TBTN}>|◀</button>}
            <button type="button" title="Rewind 10s" onClick={() => sendAction('skip', { delta_seconds: -10 })} className={TBTN}>◀◀</button>
            <button type="button" title="Stop" onClick={() => sendAction('stop')} className={TBTN}>■</button>
            <button type="button" title={state.playing && !state.paused ? 'Pause' : 'Play'} onClick={() => sendAction(state.playing && !state.paused ? 'pause' : 'play')} className={TBTN}>{state.playing && !state.paused ? '❚❚' : '▶'}</button>
            <button type="button" title="Forward 10s" onClick={() => sendAction('skip', { delta_seconds: 10 })} className={TBTN}>▶▶</button>
            {playlist.length > 0 && <button type="button" title="Next track" onClick={() => sendAction('next_track')} className={TBTN}>▶|</button>}
          </div>
          <input type="range" min={0} max={Math.max(1, state.duration_s ?? 1)} step={0.1} value={state.position_s ?? 0}
            onChange={(e) => sendAction('seek', { seconds: Number(e.target.value) })} className="w-full accent-cyan-400" />
          <div className="flex justify-between text-[9px] text-slate-500"><span>{fmtTime(state.position_s)}</span><span>{fmtTime(state.duration_s)}</span></div>
        </div>
      )}

      {/* Volume (always) */}
      <label className="flex items-center gap-2 text-[10px] text-slate-500">
        <span className="w-8 shrink-0 uppercase tracking-wide">Vol</span>
        <input type="range" min={0} max={1} step={0.01} value={state.volume ?? 1}
          onChange={(e) => sendAction('set_volume', { volume: Number(e.target.value) })} className="flex-1 accent-cyan-400" />
        <span className="w-7 text-right tabular-nums text-slate-400">{Math.round((state.volume ?? 1) * 100)}</span>
      </label>

      {/* Play set (playlist) */}
      <div className="space-y-1 border-t border-slate-800 pt-2">
        <div className="flex items-center gap-1 text-[10px]">
          <span className="mr-auto uppercase tracking-wide text-slate-400">Play set ({playlist.length})</span>
          <button type="button" title="Shuffle" onClick={() => sendAction('set_shuffle', { enabled: !shuffle })}
            className={`rounded px-1.5 py-0.5 ${shuffle ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>⇄</button>
          <button type="button" title={`Repeat: ${repeat}`} onClick={cycleRepeat}
            className={`rounded px-1.5 py-0.5 ${repeat !== 'off' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>{repeat === 'one' ? '↻¹' : '↻'}</button>
          <button type="button" onClick={() => openBrowse('playlist')} className="rounded border border-slate-700 px-1.5 py-0.5 text-slate-300 hover:border-slate-500">+ Files / Folder</button>
          {playlist.length > 0 && <button type="button" onClick={() => sendAction('playlist_clear')} className="rounded border border-slate-700 px-1.5 py-0.5 text-slate-400 hover:border-rose-500 hover:text-rose-300">Clear</button>}
        </div>
        {playlist.length > 0 && (
          <ul className="max-h-32 overflow-y-auto rounded border border-slate-800">
            {playlist.map((t, i) => (
              <li key={i} className={`flex items-center gap-1 px-1.5 py-0.5 text-[11px] ${i === plIdx ? 'bg-cyan-500/10 text-cyan-200' : 'text-slate-300 hover:bg-slate-800/50'}`}>
                <button type="button" onClick={() => sendAction('play_index', { index: i })} className="min-w-0 flex-1 truncate text-left" title={t.ref}>
                  {i === plIdx && (state.playing && !state.paused) ? '▶ ' : ''}{t.name || t.ref}
                </button>
                <button type="button" title="Up" disabled={i === 0} onClick={() => sendAction('playlist_move', { index: i, to: i - 1 })} className="px-0.5 text-slate-500 hover:text-slate-200 disabled:opacity-30">↑</button>
                <button type="button" title="Down" disabled={i === playlist.length - 1} onClick={() => sendAction('playlist_move', { index: i, to: i + 1 })} className="px-0.5 text-slate-500 hover:text-slate-200 disabled:opacity-30">↓</button>
                <button type="button" title="Remove" onClick={() => sendAction('playlist_remove', { index: i })} className="px-0.5 text-slate-500 hover:text-rose-300">✕</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-between text-[10px] text-slate-500">
        <span>plays: {state.input_kind ? `${state.input_kind}:${state.input_ref ?? ''}` : `/speaker/${proxyId}/audio`}</span>
        <span className={muted ? 'text-amber-400' : 'text-emerald-400'}>{muted ? 'muted' : (state.playing && !state.paused ? 'playing' : 'idle')}</span>
      </div>
      {state.last_error && <div className="text-[10px] text-rose-400">{state.last_error}</div>}
    </div>
  )
}
