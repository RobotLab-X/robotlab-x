import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Banner from '../components/Banner'
import { wsClient, type TrafficEvent } from '../runtime/wsClient'

const MAX_HISTORY = 500  // ring-buffer cap — anything older drops off the bottom

type Direction = 'in' | 'out' | 'both'

export default function Traffic() {
  const [events, setEvents] = useState<TrafficEvent[]>([])
  const [paused, setPaused] = useState(false)
  const [direction, setDirection] = useState<Direction>('both')
  const [filter, setFilter] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const listRef = useRef<HTMLDivElement>(null)
  // Hold pause/filter behind a ref so the subscription closure sees the
  // latest value without re-subscribing on every keystroke.
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  useEffect(() => {
    const off = wsClient.subscribeTraffic((ev) => {
      if (pausedRef.current) return
      setEvents((prev) => {
        const next = prev.concat([ev])
        return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next
      })
    })
    return off
  }, [])

  // Keep the latest event in view when auto-scroll is enabled.
  useEffect(() => {
    if (!autoScroll || !listRef.current) return
    listRef.current.scrollTop = listRef.current.scrollHeight
  }, [events, autoScroll])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return events.filter((e) => {
      if (direction !== 'both' && e.direction !== direction) return false
      if (!q) return true
      // Cheap substring match against the serialised frame + method/topic
      // so the user can grep by topic, action, error, etc.
      const haystack = JSON.stringify(e.frame).toLowerCase()
      return haystack.includes(q)
    })
  }, [events, direction, filter])

  const onClear = useCallback(() => setEvents([]), [])

  return (
    <div className="mx-auto flex h-screen max-w-screen-2xl flex-col p-6">
      <header>
        <h1 className="text-lg font-semibold">Traffic</h1>
      </header>

      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-xs">
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          className={
            paused
              ? 'rounded bg-amber-600 px-2 py-1 font-medium text-white hover:bg-amber-500'
              : 'rounded border border-slate-700 px-2 py-1 text-slate-200 hover:border-slate-500'
          }
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="rounded border border-slate-700 px-2 py-1 text-slate-200 hover:border-slate-500"
        >
          Clear
        </button>
        <label className="flex items-center gap-1 text-slate-400">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
          />
          Auto-scroll
        </label>
        <span className="mx-1 text-slate-700">|</span>
        <span className="text-slate-400">show</span>
        {(['both', 'in', 'out'] as Direction[]).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDirection(d)}
            className={
              direction === d
                ? 'rounded bg-sky-600 px-2 py-1 font-medium text-white'
                : 'rounded border border-slate-700 px-2 py-1 text-slate-200 hover:border-slate-500'
            }
          >
            {d === 'both' ? 'both' : d === 'in' ? 'inbound ↓' : 'outbound ↑'}
          </button>
        ))}
        <span className="mx-1 text-slate-700">|</span>
        <input
          type="text"
          placeholder="filter… (substring match on JSON)"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-200 placeholder-slate-600 focus:border-slate-500 focus:outline-none"
        />
        <span className="text-slate-500">
          {filtered.length}
          {filter || direction !== 'both' ? ` / ${events.length}` : ''}
        </span>
      </div>

      {paused && (
        <Banner tone="info">Capture paused — new traffic is being dropped while paused.</Banner>
      )}

      <div
        ref={listRef}
        className="flex-1 overflow-auto rounded-lg border border-slate-700 bg-slate-950 font-mono text-xs"
      >
        {filtered.length === 0 ? (
          <div className="p-4 text-slate-500">
            No traffic yet. Open another tab and click a button — frames will appear here as
            they cross the wire.
          </div>
        ) : (
          <ul className="divide-y divide-slate-900">
            {filtered.map((ev, i) => (
              <TrafficRow key={i} ev={ev} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function TrafficRow({ ev }: { ev: TrafficEvent }) {
  const [expanded, setExpanded] = useState(false)
  const arrow = ev.direction === 'in' ? '↓' : '↑'
  const arrowTone = ev.direction === 'in' ? 'text-emerald-400' : 'text-sky-400'
  const time = new Date(ev.ts)
  const hms = `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}.${pad(time.getMilliseconds(), 3)}`
  const method = ev.frame.method as string | undefined
  const topic = ev.frame.topic as string | undefined
  const id = ev.frame.id as string | undefined
  // Quick one-line summary so the user can scan without expanding every row.
  const summary = describeFrame(ev.frame)
  return (
    <li className="hover:bg-slate-900/50">
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        className="flex w-full items-baseline gap-2 px-3 py-1 text-left"
      >
        <span className="text-slate-600">{hms}</span>
        <span className={`shrink-0 font-bold ${arrowTone}`}>{arrow}</span>
        <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
          {method ?? '(no method)'}
        </span>
        {topic && (
          <span className="shrink-0 truncate text-slate-200">{topic}</span>
        )}
        <span className="flex-1 truncate text-slate-500">{summary}</span>
        {id && <span className="shrink-0 text-slate-700">#{id}</span>}
      </button>
      {expanded && (
        <pre className="overflow-auto bg-slate-900/40 px-6 py-2 text-[10px] text-slate-300">
          {JSON.stringify(ev.frame, null, 2)}
        </pre>
      )}
    </li>
  )
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0')
}

function describeFrame(frame: Record<string, unknown>): string {
  // Prefer the most informative content depending on frame method.
  const method = frame.method as string | undefined
  if (method === 'message') {
    const payload = frame.payload
    return payload === undefined ? '' : safeStringify(payload, 80)
  }
  if (method === 'publish') {
    const data = frame.data as { payload?: unknown } | undefined
    return data?.payload === undefined ? '' : safeStringify(data.payload, 80)
  }
  if (method === 'error') {
    return String(frame.error ?? '')
  }
  if (method === 'ack') {
    const bits: string[] = []
    if (frame.subscribed !== undefined) bits.push(`subscribed=${frame.subscribed}`)
    if (frame.delivered !== undefined) bits.push(`delivered=${frame.delivered}`)
    return bits.join(' ')
  }
  if (method === 'topics') {
    const topics = (frame.topics as Array<{ name: string }> | undefined) ?? []
    return `${topics.length} topics`
  }
  return ''
}

function safeStringify(value: unknown, max: number): string {
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value)
    return s.length > max ? s.slice(0, max - 1) + '…' : s
  } catch {
    return '(unserializable)'
  }
}
