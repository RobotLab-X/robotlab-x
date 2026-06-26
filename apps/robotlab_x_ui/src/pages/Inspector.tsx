import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Banner from '../components/Banner'
import { wsClient, type InboundFrame, type TopicInfo } from '../runtime/wsClient'

interface TailEntry {
  ts: number
  bytes: number
  frame: InboundFrame
}

// Per-topic message-rate samples for a sliding 5s window. We push a
// timestamp on each frame and prune anything older than the window when
// computing the rate.
const RATE_WINDOW_MS = 5000
const TAIL_LIMIT = 200
const LIST_POLL_MS = 2000

export default function Inspector() {
  const [topics, setTopics] = useState<TopicInfo[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [tail, setTail] = useState<TailEntry[]>([])
  const [paused, setPaused] = useState(false)

  // Rolling per-topic timestamps so we can compute msgs/sec for *every*
  // known topic, not just the selected one. Updated by the dedicated
  // observer subscription.
  const ratesRef = useRef<Map<string, number[]>>(new Map())
  const [tick, setTick] = useState(0)
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  // ─── topic list polling ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const list = await wsClient.listTopics()
        if (!cancelled) {
          setTopics(list)
          setListError(null)
        }
      } catch (err) {
        if (!cancelled && err instanceof Error) setListError(err.message)
      }
    }
    // Kick the WS open so listTopics has a socket to use.
    wsClient.connect()
    poll()
    const handle = setInterval(poll, LIST_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(handle)
    }
  }, [])

  // ─── observer subscriptions for rate computation ─────────────────────
  // Subscribe to every known topic with a no-op handler that records a
  // timestamp. This gives every topic in the left rail a live msgs/sec
  // without forcing the user to click each one. Re-keys whenever the
  // topic list changes.
  useEffect(() => {
    const unsubs: Array<() => void> = []
    for (const t of topics) {
      const off = wsClient.subscribe(t.name, () => {
        const samples = ratesRef.current.get(t.name) ?? []
        const now = Date.now()
        samples.push(now)
        ratesRef.current.set(t.name, samples)
      })
      unsubs.push(off)
    }
    return () => {
      for (const off of unsubs) off()
    }
  }, [topics.map((t) => t.name).join('|')])

  // Trigger a re-render every 500ms so msgs/sec numbers stay live without
  // tying re-renders to message volume.
  useEffect(() => {
    const handle = setInterval(() => setTick((n) => n + 1), 500)
    return () => clearInterval(handle)
  }, [])

  // ─── selected-topic tail ─────────────────────────────────────────────
  useEffect(() => {
    if (!selected) return
    const off = wsClient.subscribe(selected, (frame: InboundFrame) => {
      if (frame.method !== 'message') return
      if (pausedRef.current) return
      const bytes = JSON.stringify(frame.payload ?? null).length
      setTail((prev) => {
        const next = prev.concat([{ ts: Date.now(), bytes, frame }])
        return next.length > TAIL_LIMIT ? next.slice(next.length - TAIL_LIMIT) : next
      })
    })
    setTail([])
    return () => off()
  }, [selected])

  // ─── rate computation ────────────────────────────────────────────────
  const ratesByTopic = useMemo(() => {
    const out = new Map<string, number>()
    const now = Date.now()
    for (const [name, samples] of ratesRef.current.entries()) {
      // Prune in-place — keeps memory bounded for chatty topics.
      const cutoff = now - RATE_WINDOW_MS
      while (samples.length && samples[0] < cutoff) samples.shift()
      const rate = (samples.length * 1000) / RATE_WINDOW_MS
      out.set(name, rate)
    }
    return out
  }, [tick, topics])

  // Bytes/sec for the selected topic, computed from the tail.
  const selectedBytesRate = useMemo(() => {
    if (!selected) return 0
    const now = Date.now()
    const cutoff = now - RATE_WINDOW_MS
    let bytes = 0
    for (const entry of tail) {
      if (entry.ts < cutoff) continue
      bytes += entry.bytes
    }
    return (bytes * 1000) / RATE_WINDOW_MS
  }, [tick, tail, selected])

  const clearTail = useCallback(() => setTail([]), [])

  return (
    <div className="flex h-full flex-col">
      <header>
        <h1 className="text-lg font-semibold">Message Inspector</h1>
      </header>

      {listError && (
        <div className="border-b border-rose-900 px-4 py-2">
          <Banner tone="error">list_topics: {listError}</Banner>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Topic list */}
        <aside className="w-80 shrink-0 overflow-y-auto border-r border-slate-800 bg-slate-900/60">
          <h2 className="border-b border-slate-800 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Topics
          </h2>
          <ul className="divide-y divide-slate-800">
            {topics.length === 0 && !listError && (
              <li className="px-3 py-3 text-xs text-slate-500">
                Bus is idle. Topics appear here when something publishes.
              </li>
            )}
            {topics.map((t) => {
              const rate = ratesByTopic.get(t.name) ?? 0
              const isSelected = t.name === selected
              return (
                <li key={t.name}>
                  <button
                    type="button"
                    onClick={() => setSelected(t.name)}
                    className={`block w-full px-3 py-2 text-left text-xs hover:bg-slate-800 ${
                      isSelected ? 'bg-slate-800' : ''
                    }`}
                  >
                    <div className="truncate font-mono text-slate-200">{t.name}</div>
                    <div className="mt-0.5 flex gap-3 font-mono text-[10px] text-slate-500">
                      <span>{t.subscriber_count} subs</span>
                      <span>{rate.toFixed(1)} msg/s</span>
                      {t.retained && <span className="text-amber-400">retained</span>}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>

        {/* Tail */}
        <main className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-2 text-xs">
            <div className="flex items-baseline gap-3">
              {selected ? (
                <>
                  <span className="font-mono text-slate-200">{selected}</span>
                  <span className="text-slate-500">
                    {(ratesByTopic.get(selected) ?? 0).toFixed(1)} msg/s
                  </span>
                  <span className="text-slate-500">{formatBytes(selectedBytesRate)}/s</span>
                  <span className="text-slate-500">{tail.length} captured</span>
                </>
              ) : (
                <span className="text-slate-500">Select a topic to tail.</span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPaused((p) => !p)}
                disabled={!selected}
                className={`rounded border px-2 py-0.5 text-xs ${
                  paused
                    ? 'border-amber-700 bg-amber-900/40 text-amber-200'
                    : 'border-slate-700 text-slate-300 hover:border-slate-500'
                } disabled:opacity-40`}
              >
                {paused ? 'Resume' : 'Pause'}
              </button>
              <button
                type="button"
                onClick={clearTail}
                disabled={!selected || tail.length === 0}
                className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-40"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto bg-slate-950 px-3 py-2 font-mono text-xs">
            {!selected && (
              <div className="text-slate-500">Select a topic from the left rail.</div>
            )}
            {selected && tail.length === 0 && (
              <div className="text-slate-500">waiting for messages…</div>
            )}
            {tail
              .slice()
              .reverse()
              .map((entry, i) => (
                <pre
                  key={`${entry.ts}-${i}`}
                  className="border-b border-slate-900 py-1 last:border-0"
                >
                  <span className="text-slate-500">
                    {new Date(entry.ts).toISOString().slice(11, 23)}{' '}
                    {entry.frame.sender_id ? `from=${entry.frame.sender_id}` : ''}{' '}
                    {entry.bytes}B
                  </span>
                  {'\n'}
                  {JSON.stringify(entry.frame.payload, null, 2)}
                </pre>
              ))}
          </div>
        </main>
      </div>
    </div>
  )
}

function formatBytes(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B`
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB`
  return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB`
}
