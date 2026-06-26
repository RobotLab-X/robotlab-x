// SerialFullView — diagnostic console for the serial service.
//
// Three sections:
//   1. Attachment — port dropdown, baud + framing, Connect / Disconnect
//   2. Stats strip — connection state + counters
//   3. Console — switchable decoder (hex / hexdump / ascii / dec /
//      lines) over a coalesced RX + TX scrollback buffer, autoscroll
//      + pause + clear + timestamps toggles, TX input with ascii /
//      hex / dec encoder + EOL menu, file-send picker.
//
// All bytes ride the bus as base64 payloads under
//   /serial/<id>/rx   — incoming bytes
//   /serial/<id>/tx   — outgoing echo (so both directions render in
//                       one scroll buffer with distinct colouring)
//   /serial/<id>/state — connection + stats snapshot (retained)
//
// The scrollback is held in component state and capped at
// ``MAX_ROWS`` so a long debugging session doesn't unbounded-grow
// the DOM. ``Clear`` resets the buffer; the bus topics are
// non-retained so a fresh subscription doesn't replay history.
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type FormEvent, type KeyboardEvent,
} from 'react'
import { Loader2 } from 'lucide-react'

import type { ServiceProxy } from '@rlx/ui'
import type { InboundFrame } from '@rlx/ui'
import { useWsClient } from '@rlx/ui'
import { useServiceRequest } from '@rlx/ui'


// ─── types ───────────────────────────────────────────────────────────


interface PortHolder {
  pid: number
  proxy_id?: string | null
  service_type?: string | null
  name?: string | null
}

interface PortInfo {
  device: string
  description?: string
  hwid?: string
  /** Other processes currently holding this device open. Empty for
   *  available ports. The backend's ``_scan_port_holders`` populates
   *  this from /proc on Linux; macOS/Windows leave it empty. */
  holders?: PortHolder[]
  /** Convenience boolean — true iff the holders list is empty. The
   *  UI further filters: "held by my own proxy" still counts as
   *  available because we want to allow re-Connect on the same
   *  port for a service that's already attached. */
  available?: boolean
}

interface SerialState {
  connected?: boolean
  port?: string | null
  baudrate?: number
  bytesize?: number
  parity?: string
  stopbits?: number
  rx_bytes?: number
  tx_bytes?: number
  errors?: number
  last_error?: string | null
  ports?: PortInfo[]
  last_port?: string | null
  last_baud?: number
  connected_at?: string | null
}

/** One coalesced chunk in the scrollback. */
interface Chunk {
  /** Monotonic sequence id so React's keying is stable. */
  key: number
  /** "rx" (from the port) | "tx" (to the port). */
  dir: 'rx' | 'tx'
  /** Raw bytes — kept in a Uint8Array so all decoders can read from
   *  one source without re-parsing base64 per render. */
  bytes: Uint8Array
  /** Service-supplied timestamp (epoch seconds). */
  ts: number
  /** Action name on TX chunks ("write_bytes" / "send_file"); empty
   *  for RX. */
  source?: string
}

type Decoder = 'hex' | 'hexdump' | 'ascii' | 'dec' | 'lines'
type TxEncoding = 'ascii' | 'hex' | 'dec'

const DECODER_OPTIONS: Array<{ value: Decoder; label: string }> = [
  { value: 'hexdump', label: 'Hex + ASCII' },
  { value: 'hex', label: 'Hex' },
  { value: 'ascii', label: 'ASCII' },
  { value: 'dec', label: 'Decimal' },
  { value: 'lines', label: 'Lines' },
]

const TX_ENCODING_OPTIONS: Array<{ value: TxEncoding; label: string }> = [
  { value: 'ascii', label: 'ASCII' },
  { value: 'hex', label: 'Hex' },
  { value: 'dec', label: 'Decimal' },
]

const EOL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'None' },
  { value: '\n', label: 'LF (\\n)' },
  { value: '\r\n', label: 'CRLF (\\r\\n)' },
  { value: '\r', label: 'CR (\\r)' },
]

const BAUD_OPTIONS = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600]
const PARITY_OPTIONS = [['N', 'None'], ['E', 'Even'], ['O', 'Odd'], ['M', 'Mark'], ['S', 'Space']]
const STOPBIT_OPTIONS = [1, 1.5, 2]
const BYTESIZE_OPTIONS = [5, 6, 7, 8]

// Cap the scrollback so a long stream doesn't unboundedly grow the
// DOM. 2k chunks ≈ 80kB at typical coalesced sizes — generous
// without leaking memory. Operator can Clear to reset.
const MAX_ROWS = 2000


// ─── helpers ────────────────────────────────────────────────────────


function b64ToBytes(b64: string): Uint8Array {
  // atob is supported in every modern browser; fast path for the
  // common case (no need to pull base-js).
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function bytesToHex(bytes: Uint8Array, sep = ' '): string {
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i++) {
    parts.push(bytes[i].toString(16).padStart(2, '0'))
  }
  return parts.join(sep)
}

function bytesToDec(bytes: Uint8Array): string {
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i++) {
    parts.push(bytes[i].toString().padStart(3, ' '))
  }
  return parts.join(' ')
}

function bytesToAscii(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    if (b === 0x0a) out += '\n'
    else if (b === 0x0d) out += '\r'
    else if (b === 0x09) out += '\t'
    else if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b)
    else out += '·'   // middle-dot for non-printable (avoids confusion with the typed period)
  }
  return out
}

/** Classic 16-bytes-per-line hexdump. */
function bytesToHexdump(bytes: Uint8Array, offset = 0): string {
  const lines: string[] = []
  for (let i = 0; i < bytes.length; i += 16) {
    const slice = bytes.subarray(i, Math.min(i + 16, bytes.length))
    const off = (offset + i).toString(16).padStart(6, '0')
    const hex = bytesToHex(slice).padEnd(48, ' ')
    const asc = bytesToAscii(slice).replace(/[\n\r\t]/g, '·')
    lines.push(`${off}  ${hex}  ${asc}`)
  }
  return lines.join('\n')
}

function bytesToLines(bytes: Uint8Array): string[] {
  // Split on LF; strip CR so CRLF terminators render cleanly. Keeps
  // partial lines visible (the operator sees data as it arrives).
  const text = bytesToAscii(bytes)
  return text.split('\n').map((s) => s.replace(/\r$/, ''))
}

/** Parse the TX input field into bytes according to the picked
 *  encoding. Returns null on invalid input (caller renders an
 *  error). ``eol`` only applies to ascii mode. */
function encodeTxBytes(input: string, encoding: TxEncoding, eol: string): Uint8Array | null {
  if (encoding === 'ascii') {
    const enc = new TextEncoder()
    return enc.encode(input + (eol ?? ''))
  }
  if (encoding === 'hex') {
    const cleaned = input.replace(/[^0-9a-fA-F]/g, '')
    if (cleaned.length % 2) return null
    const out = new Uint8Array(cleaned.length / 2)
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(cleaned.substr(i * 2, 2), 16)
    }
    return out
  }
  // decimal — accept any non-digit separator
  if (!input.trim()) return new Uint8Array(0)
  const tokens = input.trim().split(/[^0-9]+/).filter(Boolean)
  const out = new Uint8Array(tokens.length)
  for (let i = 0; i < tokens.length; i++) {
    const n = Number(tokens[i])
    if (!Number.isInteger(n) || n < 0 || n > 255) return null
    out[i] = n
  }
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}


// ─── component ──────────────────────────────────────────────────────


export default function SerialFullView({ proxy }: { proxy: ServiceProxy }) {
  const wsClient = useWsClient()
  const proxyId = proxy.id ?? proxy.name ?? ''
  const stateTopic = `/serial/${proxyId}/state`
  const rxTopic = `/serial/${proxyId}/rx`
  const txTopic = `/serial/${proxyId}/tx`
  const controlTopic = `/serial/${proxyId}/control`

  const [state, setState] = useState<SerialState>({})
  const [chunks, setChunks] = useState<Chunk[]>([])
  // Monotonic key generator — React's reconciler is happiest with
  // stable string keys.
  const keyCounterRef = useRef(0)

  // Connect form drafts (separate from authoritative state so a
  // mid-edit re-render doesn't clobber what the operator's typing).
  const [portDraft, setPortDraft] = useState<string>('')
  const [baudDraft, setBaudDraft] = useState<number>(115200)
  const [bytesizeDraft, setBytesizeDraft] = useState<number>(8)
  const [parityDraft, setParityDraft] = useState<string>('N')
  const [stopbitsDraft, setStopbitsDraft] = useState<number>(1)

  // Display options
  const [decoder, setDecoder] = useState<Decoder>('hexdump')
  const [autoscroll, setAutoscroll] = useState(true)
  const [paused, setPaused] = useState(false)
  const [timestamps, setTimestamps] = useState(false)

  // TX section drafts
  const [txInput, setTxInput] = useState('')
  const [txEncoding, setTxEncoding] = useState<TxEncoding>('ascii')
  const [txEol, setTxEol] = useState<string>('\n')
  const [txError, setTxError] = useState<string | null>(null)

  // Pausing keeps capturing but parks new chunks in a side buffer so
  // the console freezes for inspection. Resume drains them in order.
  const pausedBufferRef = useRef<Chunk[]>([])

  // ─── subscribe to /state ──────────────────────────────────────────
  useEffect(() => {
    if (!proxyId) return
    const off = wsClient.subscribe(stateTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      setState(f.payload as SerialState)
    })
    return off
  }, [proxyId, stateTopic, wsClient])

  // Pre-fill connect drafts from state when not actively connecting
  // (i.e. on first render or after a disconnect).
  useEffect(() => {
    if (state.connected) return
    if (state.last_port && !portDraft) setPortDraft(state.last_port)
    if (state.last_baud) setBaudDraft(state.last_baud)
    if (typeof state.bytesize === 'number') setBytesizeDraft(state.bytesize)
    if (state.parity) setParityDraft(state.parity)
    if (typeof state.stopbits === 'number') setStopbitsDraft(state.stopbits)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.last_port, state.last_baud, state.bytesize, state.parity, state.stopbits, state.connected])

  // ─── subscribe to /rx + /tx ───────────────────────────────────────
  const ingest = useCallback(
    (dir: 'rx' | 'tx', payload: { data?: string; ts?: number; source?: string }) => {
      if (!payload || typeof payload.data !== 'string') return
      let bytes: Uint8Array
      try {
        bytes = b64ToBytes(payload.data)
      } catch {
        return
      }
      keyCounterRef.current += 1
      const chunk: Chunk = {
        key: keyCounterRef.current,
        dir,
        bytes,
        ts: payload.ts ?? Date.now() / 1000,
        source: payload.source,
      }
      if (paused) {
        // Side-buffer — flushed when the operator unpauses. Cap so a
        // long pause doesn't OOM the tab.
        pausedBufferRef.current.push(chunk)
        if (pausedBufferRef.current.length > MAX_ROWS) {
          pausedBufferRef.current.splice(0, pausedBufferRef.current.length - MAX_ROWS)
        }
        return
      }
      setChunks((prev) => {
        const next = prev.length >= MAX_ROWS ? prev.slice(prev.length - MAX_ROWS + 1) : prev.slice()
        next.push(chunk)
        return next
      })
    },
    [paused],
  )

  useEffect(() => {
    if (!proxyId) return
    const offRx = wsClient.subscribe(rxTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      ingest('rx', (f.payload ?? {}) as { data?: string; ts?: number })
    })
    const offTx = wsClient.subscribe(txTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      ingest('tx', (f.payload ?? {}) as { data?: string; ts?: number; source?: string })
    })
    return () => { offRx(); offTx() }
  }, [proxyId, rxTopic, txTopic, wsClient, ingest])

  // ─── unpause drain ────────────────────────────────────────────────
  // When the operator unpauses, append everything we captured during
  // the pause to the visible buffer in arrival order.
  useEffect(() => {
    if (paused) return
    if (pausedBufferRef.current.length === 0) return
    const drained = pausedBufferRef.current
    pausedBufferRef.current = []
    setChunks((prev) => {
      const merged = prev.concat(drained)
      return merged.length > MAX_ROWS ? merged.slice(merged.length - MAX_ROWS) : merged
    })
  }, [paused])

  // ─── actions ──────────────────────────────────────────────────────
  const sendAction = useCallback(
    (payload: Record<string, unknown>) => { wsClient.publish(controlTopic, payload) },
    [controlTopic, wsClient],
  )
  // Connect / Disconnect use the shared reply-tracking hook so the
  // button shows a spinner while in flight, debounces re-clicks, and
  // surfaces the backend's ``last_error`` if the OS open fails (port
  // already held, permission denied, device gone). Match arduino's
  // 10s ceiling for the reply timeout — that's long enough for a
  // slow USB enumerate but short enough to fail visibly.
  const connectRequest = useServiceRequest<SerialState>(controlTopic, {
    timeoutMs: 10_000,
    errorField: 'last_error',
    replyPrefix: `serial-${proxyId}-connect`,
  })
  const disconnectRequest = useServiceRequest<SerialState>(controlTopic, {
    timeoutMs: 5_000,
    errorField: 'last_error',
    replyPrefix: `serial-${proxyId}-disconnect`,
  })

  const onConnect = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault()
      if (!portDraft || connectRequest.inFlight) return
      void connectRequest.request('connect', {
        port: portDraft,
        baudrate: baudDraft,
        bytesize: bytesizeDraft,
        parity: parityDraft,
        stopbits: stopbitsDraft,
      })
    },
    [portDraft, baudDraft, bytesizeDraft, parityDraft, stopbitsDraft, connectRequest],
  )

  const onDisconnect = useCallback(() => {
    if (disconnectRequest.inFlight) return
    void disconnectRequest.request('disconnect')
  }, [disconnectRequest])

  const onRefreshPorts = useCallback(() => sendAction({ action: 'list_ports' }), [sendAction])
  const onClearCounters = useCallback(() => sendAction({ action: 'clear_counters' }), [sendAction])
  const onClearBuffer = useCallback(() => {
    setChunks([])
    pausedBufferRef.current = []
  }, [])

  const onSendTx = useCallback(() => {
    setTxError(null)
    const bytes = encodeTxBytes(txInput, txEncoding, txEncoding === 'ascii' ? txEol : '')
    if (bytes === null) {
      setTxError(`invalid ${txEncoding}`)
      return
    }
    if (bytes.length === 0) return
    sendAction({ action: 'write_bytes', data: bytesToBase64(bytes) })
  }, [txInput, txEncoding, txEol, sendAction])

  const onSendFile = useCallback(async (file: File) => {
    setTxError(null)
    try {
      const buf = await file.arrayBuffer()
      const bytes = new Uint8Array(buf)
      sendAction({ action: 'send_file', data: bytesToBase64(bytes), chunk_bytes: 4096 })
    } catch (err) {
      setTxError(`file read failed: ${err}`)
    }
  }, [sendAction])

  // Enter on TX input submits; Shift-Enter inserts a newline. The
  // textarea is multi-line so multi-byte hex paste works without
  // the form auto-firing.
  const onTxKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSendTx()
    }
  }, [onSendTx])

  // ─── autoscroll ───────────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // useLayoutEffect — DOM is committed but pre-paint, so the scroll
  // position update lands atomically with the new row(s).
  useLayoutEffect(() => {
    if (!autoscroll) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [chunks, autoscroll])

  // ─── derived view ────────────────────────────────────────────────
  const rendered = useMemo(() => {
    return chunks.map((c) => ({
      key: c.key,
      dir: c.dir,
      ts: c.ts,
      source: c.source,
      // Decode per the currently-selected decoder. lines decoder
      // returns an array; everything else a single string.
      decoded:
        decoder === 'hex' ? bytesToHex(c.bytes)
        : decoder === 'hexdump' ? bytesToHexdump(c.bytes)
        : decoder === 'ascii' ? bytesToAscii(c.bytes)
        : decoder === 'dec' ? bytesToDec(c.bytes)
        : bytesToLines(c.bytes).join('\n'),
      len: c.bytes.length,
    }))
  }, [chunks, decoder])

  const connected = !!state.connected
  const statsLine = useMemo(() => {
    const port = state.port ?? state.last_port ?? '—'
    const framing = `${state.baudrate ?? '?'} ${state.bytesize ?? '?'}${state.parity ?? '?'}${state.stopbits ?? '?'}`
    return `${port}  ${framing}  ·  RX ${(state.rx_bytes ?? 0).toLocaleString()} B  ·  TX ${(state.tx_bytes ?? 0).toLocaleString()} B  ·  errors ${state.errors ?? 0}`
  }, [state])

  // Pre-resolved port list, with the operator's draft kept selectable
  // even if it's not in the live list (e.g. a USB device that just
  // unplugged but the operator wants to wait for it to come back).
  // Each option also gets a ``ownedByOther`` flag — true when some
  // OTHER process (not this serial proxy) currently has the device
  // open. The dropdown uses it to grey out unavailable ports and
  // append an owner hint. Re-Connecting on a port we ourselves
  // already hold is fine, so we exclude our own proxy id from the
  // "other holder" check.
  const portOptions = useMemo(() => {
    const list = state.ports ?? []
    const augmented = list.map((p) => {
      const others = (p.holders ?? []).filter(
        (h) => h.proxy_id !== proxyId,
      )
      const ownedByOther = others.length > 0
      const ownerLabel = others.length === 0
        ? ''
        : others
            .map((h) => h.proxy_id ?? `${h.service_type ?? h.name ?? 'pid'} ${h.pid}`)
            .join(', ')
      return { ...p, ownedByOther, ownerLabel }
    })
    const devices = new Set(augmented.map((p) => p.device))
    if (portDraft && !devices.has(portDraft)) {
      augmented.push({
        device: portDraft,
        description: '(not detected)',
        hwid: '',
        ownedByOther: false,
        ownerLabel: '',
      })
    }
    return augmented
  }, [state.ports, portDraft, proxyId])

  return (
    <div
      className="flex h-full min-w-[520px] flex-col gap-3 p-3 text-xs"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* ── attachment / connect form ─────────────────────────────── */}
      <section className="rounded border border-slate-800 bg-slate-900/40 p-2">
        <form onSubmit={onConnect} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col">
            <span className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">port</span>
            <div className="flex items-center gap-1">
              <select
                value={portDraft}
                onChange={(e) => setPortDraft(e.target.value)}
                disabled={connected}
                onPointerDown={(e) => e.stopPropagation()}
                className="nodrag nopan w-72 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100 focus:border-slate-500 focus:outline-none disabled:opacity-50"
              >
                {!portDraft && <option value="">(pick a port)</option>}
                {portOptions.map((p) => (
                  // ``disabled`` greys out + blocks selection on
                  // ports another service is already holding. The
                  // suffix names the owning proxy when known so the
                  // operator knows what to release first.
                  <option
                    key={p.device}
                    value={p.device}
                    disabled={p.ownedByOther}
                  >
                    {p.device}
                    {p.description ? `  — ${p.description}` : ''}
                    {p.ownedByOther ? `  (in use by ${p.ownerLabel})` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={onRefreshPorts}
                disabled={connected}
                onPointerDown={(e) => e.stopPropagation()}
                title="Refresh port list"
                className="nodrag nopan rounded border border-slate-700 px-2 py-1 text-[11px] hover:border-slate-500 disabled:opacity-50"
              >
                ↻
              </button>
            </div>
          </label>
          <label className="flex flex-col">
            <span className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">baud</span>
            <select
              value={baudDraft}
              onChange={(e) => setBaudDraft(Number(e.target.value))}
              disabled={connected}
              onPointerDown={(e) => e.stopPropagation()}
              className="nodrag nopan w-24 rounded border border-slate-700 bg-slate-950 px-1 py-1 font-mono text-[11px] text-slate-100 focus:border-slate-500 focus:outline-none disabled:opacity-50"
            >
              {BAUD_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label className="flex flex-col">
            <span className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">bits</span>
            <select
              value={bytesizeDraft}
              onChange={(e) => setBytesizeDraft(Number(e.target.value))}
              disabled={connected}
              onPointerDown={(e) => e.stopPropagation()}
              className="nodrag nopan w-14 rounded border border-slate-700 bg-slate-950 px-1 py-1 font-mono text-[11px] disabled:opacity-50"
            >
              {BYTESIZE_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label className="flex flex-col">
            <span className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">parity</span>
            <select
              value={parityDraft}
              onChange={(e) => setParityDraft(e.target.value)}
              disabled={connected}
              onPointerDown={(e) => e.stopPropagation()}
              className="nodrag nopan w-20 rounded border border-slate-700 bg-slate-950 px-1 py-1 font-mono text-[11px] disabled:opacity-50"
            >
              {PARITY_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </label>
          <label className="flex flex-col">
            <span className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">stop</span>
            <select
              value={stopbitsDraft}
              onChange={(e) => setStopbitsDraft(Number(e.target.value))}
              disabled={connected}
              onPointerDown={(e) => e.stopPropagation()}
              className="nodrag nopan w-14 rounded border border-slate-700 bg-slate-950 px-1 py-1 font-mono text-[11px] disabled:opacity-50"
            >
              {STOPBIT_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <div className="ml-auto flex items-center gap-2">
            {!connected ? (
              <button
                type="submit"
                disabled={!portDraft || connectRequest.inFlight}
                aria-busy={connectRequest.inFlight}
                onPointerDown={(e) => e.stopPropagation()}
                className="nodrag nopan inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {connectRequest.inFlight && <Loader2 className="h-3 w-3 animate-spin" />}
                {connectRequest.inFlight ? 'Connecting…' : 'Connect'}
              </button>
            ) : (
              <button
                type="button"
                onClick={onDisconnect}
                disabled={disconnectRequest.inFlight}
                aria-busy={disconnectRequest.inFlight}
                onPointerDown={(e) => e.stopPropagation()}
                className="nodrag nopan inline-flex items-center gap-1.5 rounded border border-slate-700 px-3 py-1 text-[11px] hover:border-rose-500 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {disconnectRequest.inFlight && <Loader2 className="h-3 w-3 animate-spin" />}
                {disconnectRequest.inFlight ? 'Disconnecting…' : 'Disconnect'}
              </button>
            )}
          </div>
        </form>
        {/* Error display — latest in-flight reply error overrides the
            retained server-side ``last_error`` so a fresh attempt's
            outcome is what's visible. */}
        {(connectRequest.error ?? disconnectRequest.error ?? state.last_error) && (
          <div
            className="mt-2 truncate font-mono text-[10px] text-rose-300"
            title={connectRequest.error ?? disconnectRequest.error ?? state.last_error ?? ''}
          >
            error: {connectRequest.error ?? disconnectRequest.error ?? state.last_error}
          </div>
        )}
      </section>

      {/* ── stats strip ──────────────────────────────────────────── */}
      <section className="flex items-center justify-between gap-3 rounded border border-slate-800 bg-slate-900/40 px-2 py-1 font-mono text-[10px] text-slate-400">
        <span>
          <span className={connected ? 'text-emerald-400' : 'text-slate-500'}>
            {connected ? '● connected' : '○ idle'}
          </span>
          {'  '}
          <span>{statsLine}</span>
        </span>
        <button
          type="button"
          onClick={onClearCounters}
          onPointerDown={(e) => e.stopPropagation()}
          title="Reset RX / TX / error counters"
          className="nodrag nopan rounded border border-slate-700 px-1.5 py-0.5 text-[9px] hover:border-slate-500"
        >
          reset counters
        </button>
      </section>

      {/* ── console ──────────────────────────────────────────────── */}
      <section className="flex min-h-0 flex-1 flex-col rounded border border-slate-800 bg-slate-900/40">
        <header className="flex items-center gap-2 border-b border-slate-800 px-2 py-1 text-[10px] text-slate-500">
          <label className="flex items-center gap-1">
            <span className="uppercase tracking-wider">view</span>
            <select
              value={decoder}
              onChange={(e) => setDecoder(e.target.value as Decoder)}
              onPointerDown={(e) => e.stopPropagation()}
              className="nodrag nopan rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[10px] text-slate-100 focus:border-slate-500 focus:outline-none"
            >
              {DECODER_OPTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={autoscroll}
              onChange={(e) => setAutoscroll(e.target.checked)}
              onPointerDown={(e) => e.stopPropagation()}
              className="nodrag nopan h-3 w-3 accent-emerald-500"
            />
            <span>autoscroll</span>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={paused}
              onChange={(e) => setPaused(e.target.checked)}
              onPointerDown={(e) => e.stopPropagation()}
              className="nodrag nopan h-3 w-3 accent-amber-500"
            />
            <span className={paused ? 'text-amber-300' : ''}>
              pause display{paused && pausedBufferRef.current.length > 0 && ` (${pausedBufferRef.current.length} buffered)`}
            </span>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={timestamps}
              onChange={(e) => setTimestamps(e.target.checked)}
              onPointerDown={(e) => e.stopPropagation()}
              className="nodrag nopan h-3 w-3 accent-sky-500"
            />
            <span>timestamps</span>
          </label>
          <span className="ml-auto font-mono">{chunks.length} chunks</span>
          <button
            type="button"
            onClick={onClearBuffer}
            onPointerDown={(e) => e.stopPropagation()}
            title="Clear the scrollback (counters unchanged)"
            className="nodrag nopan rounded border border-slate-700 px-1.5 py-0.5 text-[9px] hover:border-slate-500"
          >
            clear
          </button>
        </header>
        <div className="relative min-h-0 flex-1">
          <div
            ref={scrollRef}
            className="nodrag nopan absolute inset-0 overflow-y-auto p-2 font-mono text-[11px] leading-tight"
            onWheel={(e) => e.stopPropagation()}
          >
            {rendered.length === 0 ? (
              <div className="text-slate-600">
                {connected ? 'waiting for bytes…' : 'connect to a port to see traffic'}
              </div>
            ) : (
              rendered.map((c) => (
                <div
                  key={c.key}
                  className={
                    c.dir === 'rx'
                      ? 'whitespace-pre-wrap text-emerald-200'
                      : 'whitespace-pre-wrap text-sky-200'
                  }
                >
                  {timestamps && (
                    <span className="text-slate-600">
                      {new Date(c.ts * 1000).toISOString().slice(11, 23)}{' '}
                    </span>
                  )}
                  <span className="text-slate-500">{c.dir === 'rx' ? '<' : '>'}{c.source ? ` ${c.source}` : ''} [{c.len}]</span>
                  {' '}
                  {c.decoded}
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* ── TX input ─────────────────────────────────────────────── */}
      <section className="rounded border border-slate-800 bg-slate-900/40 p-2">
        <div className="flex items-end gap-2">
          <label className="flex flex-col">
            <span className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">enc</span>
            <select
              value={txEncoding}
              onChange={(e) => { setTxEncoding(e.target.value as TxEncoding); setTxError(null) }}
              onPointerDown={(e) => e.stopPropagation()}
              className="nodrag nopan rounded border border-slate-700 bg-slate-950 px-1 py-1 text-[11px]"
            >
              {TX_ENCODING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          {txEncoding === 'ascii' && (
            <label className="flex flex-col">
              <span className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">eol</span>
              <select
                value={txEol}
                onChange={(e) => setTxEol(e.target.value)}
                onPointerDown={(e) => e.stopPropagation()}
                className="nodrag nopan rounded border border-slate-700 bg-slate-950 px-1 py-1 text-[11px]"
              >
                {EOL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          )}
          <textarea
            value={txInput}
            onChange={(e) => { setTxInput(e.target.value); setTxError(null) }}
            onKeyDown={onTxKeyDown}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={!connected}
            placeholder={
              !connected ? 'connect first' :
              txEncoding === 'ascii' ? 'text — Enter sends, Shift-Enter newline' :
              txEncoding === 'hex' ? 'hex bytes — DE AD BE EF / DE:AD:BE:EF / DEADBEEF' :
              'decimal — 222 173 190 239'
            }
            rows={2}
            className="nodrag nopan min-h-[44px] flex-1 resize-none rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none disabled:opacity-50"
          />
          <div className="flex flex-col items-stretch gap-1">
            <button
              type="button"
              onClick={onSendTx}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={!connected || !txInput}
              className="nodrag nopan rounded bg-sky-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
            </button>
            <label
              className={
                connected
                  ? 'nodrag nopan cursor-pointer rounded border border-slate-700 px-3 py-1 text-center text-[10px] hover:border-slate-500'
                  : 'nodrag nopan cursor-not-allowed rounded border border-slate-700 px-3 py-1 text-center text-[10px] opacity-40'
              }
              title="Send a binary file"
            >
              File…
              <input
                type="file"
                disabled={!connected}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) {
                    onSendFile(f)
                    // Clear so the same file can be re-picked.
                    e.target.value = ''
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                className="hidden"
              />
            </label>
          </div>
        </div>
        {txError && (
          <div className="mt-1 font-mono text-[10px] text-rose-300">tx error: {txError}</div>
        )}
      </section>
    </div>
  )
}
