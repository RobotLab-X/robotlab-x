import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import type { ServiceProxy } from '@rlx/ui'
import { type InboundFrame } from '@rlx/ui'
import { useWsClient } from '@rlx/ui'
import { useServiceRequest } from '@rlx/ui'

// How long to wait for a connect/disconnect reply before unlocking the
// UI. Telemetrix's arduino_wait is 4s + serial settle; 10s is a ceiling.
const CONNECT_REPLY_TIMEOUT_MS = 10_000
const HEARTBEAT_FRESH_MS = 2500

interface SerialPort {
  device: string
  description?: string
  available?: boolean
}

interface PinSnapshot {
  mode?: string
  value?: number
}

interface PixelState {
  pin?: number | null
  count?: number
  width?: number
  height?: number
  serpentine?: boolean
  brightness?: number
}

interface TlmState {
  connected?: boolean
  port?: string | null
  ports?: SerialPort[]
  firmware_name?: string | null
  firmware_version?: string | null
  pins?: Record<string, PinSnapshot>
  pixel?: PixelState
  connect_error?: string | null
  last_port?: string | null
  last_baud?: number | null
}

// "#rrggbb" → [r, g, b].
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

export default function ArduinoTelemetrixView({ proxy }: { proxy: ServiceProxy }) {
  const wsClient = useWsClient()
  const proxyId = proxy.id ?? proxy.name ?? ''
  const stateTopic = `/arduino_telemetrix/${proxyId}/state`
  const heartbeatTopic = `/arduino_telemetrix/${proxyId}/heartbeat`
  const controlTopic = `/arduino_telemetrix/${proxyId}/control`

  const [state, setState] = useState<TlmState>({})
  const [lastBeat, setLastBeat] = useState<number | null>(null)
  const [, setNowTick] = useState(0)

  useEffect(() => {
    if (!proxyId) return
    const offState = wsClient.subscribe(stateTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      setState((prev) => ({ ...prev, ...(f.payload as TlmState) }))
    })
    const offBeat = wsClient.subscribe(heartbeatTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const p = f.payload as { ts?: number }
      if (typeof p?.ts === 'number') setLastBeat(p.ts * 1000)
    })
    const timer = setInterval(() => setNowTick((t) => t + 1), 1000)
    return () => { offState(); offBeat(); clearInterval(timer) }
  }, [proxyId, stateTopic, heartbeatTopic, wsClient])

  const send = useCallback(
    (action: string, args: Record<string, unknown> = {}) => {
      wsClient.publish(controlTopic, { action, ...args })
    },
    [controlTopic, wsClient],
  )

  const connectReq = useServiceRequest<{ connected?: boolean; error?: string }>(controlTopic, {
    timeoutMs: CONNECT_REPLY_TIMEOUT_MS,
    errorField: 'error',
    replyPrefix: `tlm-${proxyId}-connect`,
  })
  const disconnectReq = useServiceRequest<{ connected?: boolean; error?: string }>(controlTopic, {
    timeoutMs: CONNECT_REPLY_TIMEOUT_MS,
    errorField: 'error',
    replyPrefix: `tlm-${proxyId}-disconnect`,
  })
  const connecting = connectReq.inFlight || disconnectReq.inFlight

  const serviceRunning = proxy.status === 'running' || proxy.status === 'starting'
  const heartbeatFresh = lastBeat !== null && Date.now() - lastBeat < HEARTBEAT_FRESH_MS
  const connected = !!state.connected
  const ports = state.ports ?? []

  // ─── connection form ─────────────────────────────────────────────
  const [selPort, setSelPort] = useState('')
  const effectivePort = selPort || state.last_port || (ports[0]?.device ?? '')

  const onConnect = useCallback((e: FormEvent) => {
    e.preventDefault()
    const baud = state.last_baud ?? 115200
    if (effectivePort) void connectReq.request('connect', { port: effectivePort, baud })
  }, [connectReq, effectivePort, state.last_baud])

  const connectError = connectReq.error || disconnectReq.error || state.connect_error || null

  // ─── pixel strip panel ───────────────────────────────────────────
  const pixel = state.pixel ?? {}
  const pixelConfigured = pixel.pin !== null && pixel.pin !== undefined && (pixel.count ?? 0) > 0
  const [pxPin, setPxPin] = useState('6')
  const [pxCount, setPxCount] = useState('8')
  const [pxWidth, setPxWidth] = useState('0')
  const [pxHeight, setPxHeight] = useState('0')
  const [pxSerpentine, setPxSerpentine] = useState(false)
  const [pxColor, setPxColor] = useState('#ff0000')
  const [pxIndex, setPxIndex] = useState('0')

  const onConfigure = useCallback((e: FormEvent) => {
    e.preventDefault()
    send('pixel_configure', {
      pin: Number(pxPin), count: Number(pxCount),
      width: Number(pxWidth), height: Number(pxHeight),
      serpentine: pxSerpentine,
    })
  }, [send, pxPin, pxCount, pxWidth, pxHeight, pxSerpentine])

  const fill = useCallback(() => {
    const [r, g, b] = hexToRgb(pxColor)
    send('pixel_fill', { r, g, b, show: true })
  }, [send, pxColor])

  const setOne = useCallback(() => {
    const [r, g, b] = hexToRgb(pxColor)
    send('pixel_set', { index: Number(pxIndex), r, g, b, show: true })
  }, [send, pxColor, pxIndex])

  const pinList = useMemo(
    () => Object.entries(state.pins ?? {}).map(([p, s]) => ({ pin: Number(p), ...s })).sort((a, b) => a.pin - b.pin),
    [state.pins],
  )

  const fieldCls = 'rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200'
  const btnCls = 'rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-40'

  return (
    <div className="flex flex-col gap-3 p-3 text-slate-200">
      {/* ─── status header ─── */}
      <div className="flex items-center gap-2 text-xs">
        <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-slate-600'}`} />
        <span className="font-medium">{connected ? 'Connected' : 'Disconnected'}</span>
        {state.port && <span className="text-slate-400">{state.port}</span>}
        {state.firmware_name && (
          <span className="text-slate-500">{state.firmware_name} {state.firmware_version ?? ''}</span>
        )}
        <span className="ml-auto flex items-center gap-1 text-slate-500">
          <span className={`h-1.5 w-1.5 rounded-full ${serviceRunning && heartbeatFresh ? 'bg-emerald-400' : 'bg-slate-700'}`} />
          {serviceRunning ? (heartbeatFresh ? 'live' : 'stale') : 'stopped'}
        </span>
      </div>

      {/* ─── connection ─── */}
      <form onSubmit={onConnect} className="flex flex-wrap items-center gap-2">
        <select
          className={fieldCls}
          value={effectivePort}
          onChange={(e) => setSelPort(e.target.value)}
          disabled={connected || connecting}
        >
          {ports.length === 0 && <option value="">(no serial ports)</option>}
          {ports.map((p) => (
            <option key={p.device} value={p.device}>
              {p.device}{p.description ? ` — ${p.description}` : ''}
            </option>
          ))}
        </select>
        {!connected ? (
          <button type="submit" className={btnCls} disabled={connecting || !effectivePort}>
            {connecting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Connect'}
          </button>
        ) : (
          <button type="button" className={btnCls} disabled={connecting}
            onClick={() => void disconnectReq.request('disconnect')}>
            {connecting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Disconnect'}
          </button>
        )}
        <button type="button" className={btnCls} onClick={() => send('list_ports')} disabled={connecting}>
          Rescan
        </button>
      </form>
      {connectError && (
        <div className="flex items-center gap-2 rounded border border-rose-800 bg-rose-950/40 px-2 py-1 text-xs text-rose-300">
          <span className="flex-1">{connectError}</span>
          <button type="button" className="text-rose-400 hover:text-rose-200" onClick={() => send('clear_error')}>
            dismiss
          </button>
        </div>
      )}

      {/* ─── pixel strip ─── */}
      <div className="rounded border border-slate-800 p-2">
        <div className="mb-2 text-xs font-medium text-slate-300">NeoPixel strip / matrix</div>
        <form onSubmit={onConfigure} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-[10px] text-slate-500">pin
            <input className={`${fieldCls} w-14`} value={pxPin} onChange={(e) => setPxPin(e.target.value)} />
          </label>
          <label className="flex flex-col text-[10px] text-slate-500">count
            <input className={`${fieldCls} w-16`} value={pxCount} onChange={(e) => setPxCount(e.target.value)} />
          </label>
          <label className="flex flex-col text-[10px] text-slate-500">width
            <input className={`${fieldCls} w-14`} value={pxWidth} onChange={(e) => setPxWidth(e.target.value)} />
          </label>
          <label className="flex flex-col text-[10px] text-slate-500">height
            <input className={`${fieldCls} w-14`} value={pxHeight} onChange={(e) => setPxHeight(e.target.value)} />
          </label>
          <label className="flex items-center gap-1 text-[10px] text-slate-500">
            <input type="checkbox" checked={pxSerpentine} onChange={(e) => setPxSerpentine(e.target.checked)} />
            serpentine
          </label>
          <button type="submit" className={btnCls} disabled={!connected}>Configure</button>
        </form>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input type="color" value={pxColor} onChange={(e) => setPxColor(e.target.value)}
            className="h-7 w-10 rounded border border-slate-700 bg-slate-900" />
          <button type="button" className={btnCls} onClick={fill} disabled={!pixelConfigured}>Fill</button>
          <button type="button" className={btnCls} onClick={() => send('pixel_clear', { show: true })} disabled={!pixelConfigured}>Clear</button>
          <label className="flex items-center gap-1 text-[10px] text-slate-500">@
            <input className={`${fieldCls} w-14`} value={pxIndex} onChange={(e) => setPxIndex(e.target.value)} />
          </label>
          <button type="button" className={btnCls} onClick={setOne} disabled={!pixelConfigured}>Set pixel</button>
        </div>

        <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-500">
          <span>brightness</span>
          <input type="range" min={0} max={255} defaultValue={pixel.brightness ?? 255}
            onChange={(e) => send('pixel_set_brightness', { value: Number(e.target.value) })}
            disabled={!pixelConfigured} className="flex-1" />
          <span className="w-8 text-right">{pixel.brightness ?? 255}</span>
        </div>
      </div>

      {/* ─── pin snapshot ─── */}
      {pinList.length > 0 && (
        <div className="rounded border border-slate-800 p-2 text-[11px]">
          <div className="mb-1 font-medium text-slate-400">Pins</div>
          <div className="grid grid-cols-3 gap-1">
            {pinList.map((p) => (
              <div key={p.pin} className="flex items-center justify-between rounded bg-slate-900 px-1.5 py-0.5">
                <span className="text-slate-300">D{p.pin}</span>
                <span className="text-slate-500">{p.mode ?? ''}</span>
                <span className="text-slate-400">{p.value ?? ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
