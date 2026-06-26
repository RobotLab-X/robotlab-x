import { useEffect, useState } from 'react'
import { type InboundFrame } from '../runtime/wsClient'
import { useWsClient } from '../contexts/ActiveRuntimeContext'
import type {
  LogWidgetConfig,
  MetricWidgetConfig,
  StatusWidgetConfig,
  TopicStreamWidgetConfig,
  WidgetConfig,
} from './types'

// Generic widget chrome — header + body. Every widget shares this so
// the grid feels coherent.
function WidgetFrame({
  title,
  topic,
  onRemove,
  children,
}: {
  title: string
  topic: string
  onRemove: () => void
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900/80">
      <header className="flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 px-3 py-1.5 text-xs">
        <div className="flex flex-1 items-baseline gap-2 overflow-hidden">
          <span className="truncate font-semibold text-slate-100">{title}</span>
          <span className="truncate font-mono text-[10px] text-slate-500">{topic}</span>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 hover:border-rose-700 hover:text-rose-300"
          // Stop react-grid-layout's drag from swallowing the click.
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          ✕
        </button>
      </header>
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  )
}

// ─── log ──────────────────────────────────────────────────────────────

function getField(payload: unknown, path: string | undefined): unknown {
  if (!path) return payload
  let cur: unknown = payload
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined) return undefined
    if (typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

export function LogWidget({
  cfg,
  onRemove,
}: {
  cfg: LogWidgetConfig
  onRemove: () => void
}) {
  const wsClient = useWsClient()
  const [lines, setLines] = useState<string[]>([])
  const limit = 50

  useEffect(() => {
    const off = wsClient.subscribe(cfg.topic, (frame: InboundFrame) => {
      if (frame.method !== 'message') return
      const value = getField(frame.payload, cfg.field)
      const line =
        typeof value === 'string' ? value : JSON.stringify(value ?? frame.payload)
      setLines((prev) => {
        const next = prev.concat([line])
        return next.length > limit ? next.slice(next.length - limit) : next
      })
    })
    return () => off()
  }, [cfg.topic, cfg.field, wsClient])

  return (
    <WidgetFrame title={cfg.title} topic={cfg.topic} onRemove={onRemove}>
      <div className="h-full overflow-y-auto bg-slate-950 p-2 font-mono text-[11px] text-slate-200">
        {lines.length === 0 && <div className="text-slate-500">waiting…</div>}
        {lines.map((l, i) => (
          <div key={i} className="whitespace-pre-wrap">
            {l}
          </div>
        ))}
      </div>
    </WidgetFrame>
  )
}

// ─── topic stream ─────────────────────────────────────────────────────

export function TopicStreamWidget({
  cfg,
  onRemove,
}: {
  cfg: TopicStreamWidgetConfig
  onRemove: () => void
}) {
  const wsClient = useWsClient()
  const [frames, setFrames] = useState<InboundFrame[]>([])
  const limit = 20

  useEffect(() => {
    const off = wsClient.subscribe(cfg.topic, (frame: InboundFrame) => {
      if (frame.method !== 'message') return
      setFrames((prev) => {
        const next = prev.concat([frame])
        return next.length > limit ? next.slice(next.length - limit) : next
      })
    })
    return () => off()
  }, [cfg.topic, wsClient])

  return (
    <WidgetFrame title={cfg.title} topic={cfg.topic} onRemove={onRemove}>
      <div className="h-full overflow-y-auto bg-slate-950 p-2 font-mono text-[10px]">
        {frames.length === 0 && <div className="text-slate-500">waiting…</div>}
        {frames
          .slice()
          .reverse()
          .map((f, i) => (
            <pre key={i} className="border-b border-slate-900 py-1 last:border-0 text-slate-200">
              {JSON.stringify(f.payload, null, 2)}
            </pre>
          ))}
      </div>
    </WidgetFrame>
  )
}

// ─── metric (big number + sparkline) ──────────────────────────────────

export function MetricWidget({
  cfg,
  onRemove,
}: {
  cfg: MetricWidgetConfig
  onRemove: () => void
}) {
  const wsClient = useWsClient()
  const [samples, setSamples] = useState<number[]>([])
  const [latest, setLatest] = useState<number | null>(null)
  const histLimit = cfg.history ?? 60

  useEffect(() => {
    const off = wsClient.subscribe(cfg.topic, (frame: InboundFrame) => {
      if (frame.method !== 'message') return
      const v = getField(frame.payload, cfg.field)
      const num = typeof v === 'number' ? v : Number(v)
      if (!Number.isFinite(num)) return
      setLatest(num)
      setSamples((prev) => {
        const next = prev.concat([num])
        return next.length > histLimit ? next.slice(next.length - histLimit) : next
      })
    })
    return () => off()
  }, [cfg.topic, cfg.field, histLimit, wsClient])

  return (
    <WidgetFrame title={cfg.title} topic={cfg.topic} onRemove={onRemove}>
      <div className="flex h-full flex-col justify-between p-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">
            {cfg.field}
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-3xl font-semibold text-slate-100">
              {latest === null ? '—' : latest.toLocaleString(undefined, { maximumFractionDigits: 3 })}
            </span>
            {cfg.unit && <span className="text-xs text-slate-400">{cfg.unit}</span>}
          </div>
        </div>
        <Sparkline samples={samples} />
      </div>
    </WidgetFrame>
  )
}

function Sparkline({ samples }: { samples: number[] }) {
  if (samples.length < 2) {
    return <div className="h-8 text-[10px] text-slate-500">collecting samples…</div>
  }
  const min = Math.min(...samples)
  const max = Math.max(...samples)
  const range = max - min || 1
  const width = 200
  const height = 32
  const step = width / (samples.length - 1)
  const points = samples
    .map((v, i) => {
      const x = i * step
      const y = height - ((v - min) / range) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-2 h-8 w-full" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke="#38bdf8" strokeWidth="1.5" />
    </svg>
  )
}

// ─── status (single proxy) ────────────────────────────────────────────

const STATUS_TONE: Record<string, string> = {
  installed: 'bg-slate-700 text-slate-200',
  installing: 'bg-amber-700 text-amber-100',
  starting: 'bg-amber-700 text-amber-100',
  running: 'bg-emerald-700 text-emerald-100',
  stopping: 'bg-amber-700 text-amber-100',
  stopped: 'bg-slate-700 text-slate-200',
  error: 'bg-rose-700 text-rose-100',
}

export function StatusWidget({
  cfg,
  onRemove,
}: {
  cfg: StatusWidgetConfig
  onRemove: () => void
}) {
  const wsClient = useWsClient()
  const [proxy, setProxy] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    const off = wsClient.subscribe(cfg.topic, (frame: InboundFrame) => {
      if (frame.method !== 'message') return
      setProxy(frame.payload as Record<string, unknown>)
    })
    return () => off()
  }, [cfg.topic, wsClient])

  const status = (proxy?.status as string | undefined) ?? '—'
  const pid = (proxy?.pid as number | null | undefined) ?? null
  const tone = STATUS_TONE[status] ?? 'bg-slate-700 text-slate-200'

  return (
    <WidgetFrame title={cfg.title} topic={cfg.topic} onRemove={onRemove}>
      <div className="flex h-full flex-col justify-center gap-2 p-3 text-sm">
        <span className={`inline-block w-fit rounded px-2 py-0.5 text-xs font-medium ${tone}`}>
          {status}
        </span>
        {pid !== null && (
          <span className="font-mono text-[11px] text-slate-400">pid {pid}</span>
        )}
      </div>
    </WidgetFrame>
  )
}

// ─── dispatch ─────────────────────────────────────────────────────────

export function WidgetRenderer({
  cfg,
  onRemove,
}: {
  cfg: WidgetConfig
  onRemove: () => void
}) {
  switch (cfg.type) {
    case 'log':
      return <LogWidget cfg={cfg} onRemove={onRemove} />
    case 'topic_stream':
      return <TopicStreamWidget cfg={cfg} onRemove={onRemove} />
    case 'metric':
      return <MetricWidget cfg={cfg} onRemove={onRemove} />
    case 'status':
      return <StatusWidget cfg={cfg} onRemove={onRemove} />
    default:
      return null
  }
}
