import { useEffect, useMemo, useState } from 'react'
import { useApiFetch } from '../contexts/ActiveRuntimeContext'
import type { ServiceProxy } from '../models/ServiceProxy'

// Global cross-reference for every topic on the bus right now.
//
// Two data sources, joined by topic name:
//   * /v1/bus/topics — runtime: each active topic with its
//     subscribers (identity parsed by bus.parse_subscriber_id).
//   * /v1/service-proxy/{id}/topology — declared publishes per
//     running service. Aggregated across every running proxy so the
//     "publishers" column lists everyone who could emit on the topic.
//
// The result is a single table that answers two questions for any
// topic: who publishes here, and who's currently listening.

interface BusTopic {
  name: string
  subscriber_count: number
  retained: boolean
  dropped: number
  subscribers: BusSubscriber[]
}

interface BusSubscriber {
  id: string
  kind: string
  type?: string
  proxy_id?: string
  suffix?: string
  user?: string
  session?: string
  matched_via?: string
}

interface ProxyTopology {
  transport: string | null
  type_name: string
  publishes: { topic: string; source: string; method: string | null; retained?: boolean }[]
}

interface Row {
  topic: string
  retained: boolean
  dropped: number
  publishers: { proxyId: string; method: string | null; source: string }[]
  subscribers: BusSubscriber[]
}

export default function Topology() {
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | 'service-to-service' | 'ui-only' | 'orphan' | 'bridged'>('all')
  // Per-active-runtime apiFetch (Phase 4). Pages used to import a
  // singleton from '../lib/api' that always hit same-origin. Now each
  // page reads its apiFetch from the active runtime context, so when
  // the user switches runtimes via the chip bar (Phase 5) all data
  // re-fetches against the new target.
  const apiFetch = useApiFetch()

  useEffect(() => {
    let cancelled = false
    const fetchAll = async () => {
      try {
        // Fetch bus + proxy list first, then per-proxy topology in parallel.
        const [busResp, proxies] = await Promise.all([
          apiFetch<{ topics: BusTopic[]; patterns: string[] }>('/v1/bus/topics'),
          apiFetch<ServiceProxy[]>('/v1/service-proxy-list'),
        ])
        if (cancelled) return
        const runningIds = (proxies ?? [])
          .filter((p) => p.status === 'running' || p.status === 'starting')
          .map((p) => p.id ?? p.name ?? '')
          .filter(Boolean)
        const topologies = await Promise.all(
          runningIds.map(async (pid) => {
            try {
              const t = await apiFetch<ProxyTopology>(`/v1/service-proxy/${encodeURIComponent(pid)}/topology`)
              return { proxyId: pid, t }
            } catch {
              return { proxyId: pid, t: null as ProxyTopology | null }
            }
          }),
        )
        if (cancelled) return

        // Index: topic -> publishers
        const publishersByTopic = new Map<string, { proxyId: string; method: string | null; source: string }[]>()
        for (const { proxyId, t } of topologies) {
          if (!t) continue
          for (const p of t.publishes) {
            const arr = publishersByTopic.get(p.topic) ?? []
            arr.push({ proxyId, method: p.method, source: p.source })
            publishersByTopic.set(p.topic, arr)
          }
        }

        // Union: every topic mentioned by either side.
        const topicNames = new Set<string>()
        for (const t of busResp.topics ?? []) topicNames.add(t.name)
        for (const k of publishersByTopic.keys()) topicNames.add(k)

        const busByName = new Map(busResp.topics.map((t) => [t.name, t]))

        const merged: Row[] = []
        for (const name of Array.from(topicNames).sort()) {
          const bus = busByName.get(name)
          merged.push({
            topic: name,
            retained: bus?.retained ?? false,
            dropped: bus?.dropped ?? 0,
            publishers: publishersByTopic.get(name) ?? [],
            subscribers: bus?.subscribers ?? [],
          })
        }
        setRows(merged)
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }
    fetchAll()
    const t = setInterval(fetchAll, 3000)
    return () => { cancelled = true; clearInterval(t) }
  // apiFetch identity is stable for the lifetime of a connection —
  // recreated only when the active runtime changes, which is exactly
  // when we want to re-poll. Safe + correct dependency.
  }, [apiFetch])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return rows.filter((r) => {
      if (kindFilter === 'service-to-service') {
        // At least one service publisher AND at least one service subscriber
        const hasSvcPub = r.publishers.length > 0
        const hasSvcSub = r.subscribers.some((s) => s.kind === 'service')
        if (!(hasSvcPub && hasSvcSub)) return false
      } else if (kindFilter === 'ui-only') {
        // Only UI clients subscribe (no service consumer)
        if (r.subscribers.length === 0) return false
        if (r.subscribers.every((s) => s.kind === 'ui')) {
          // pass
        } else return false
      } else if (kindFilter === 'orphan') {
        // Published but nobody is listening (no exact subscribers AND
        // no wildcard match shown via matched_via)
        if (r.subscribers.length > 0) return false
        if (r.publishers.length === 0) return false
      } else if (kindFilter === 'bridged') {
        // Federation: topics carrying the ``@<peer-id>`` suffix are
        // remote topics being bridged through a peer runtime. Pick a
        // single-glance view of "what's crossing the wire right now".
        if (parsePeerSuffix(r.topic) === null) return false
      }
      if (!q) return true
      if (r.topic.toLowerCase().includes(q)) return true
      for (const p of r.publishers) {
        if (p.proxyId.toLowerCase().includes(q)) return true
        if (p.method?.toLowerCase().includes(q)) return true
      }
      for (const s of r.subscribers) {
        if ((s.proxy_id ?? '').toLowerCase().includes(q)) return true
        if ((s.user ?? '').toLowerCase().includes(q)) return true
      }
      return false
    })
  }, [rows, filter, kindFilter])

  const counts = useMemo(() => {
    let pubs = 0, subs = 0, retained = 0
    for (const r of rows) {
      pubs += r.publishers.length
      subs += r.subscribers.length
      if (r.retained) retained++
    }
    return { topics: rows.length, pubs, subs, retained }
  }, [rows])

  return (
    <div className="mx-auto flex h-screen max-w-screen-2xl flex-col p-6">
      <header>
        <h1 className="text-lg font-semibold">Topology</h1>
      </header>

      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-xs">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter topics, proxies, methods, users…"
          className="flex-1 min-w-[200px] rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-slate-200 focus:border-slate-500 focus:outline-none"
        />
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)}
          className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200"
        >
          <option value="all">all topics</option>
          <option value="service-to-service">service ↔ service</option>
          <option value="ui-only">UI subscribers only</option>
          <option value="orphan">orphan (published, nobody listening)</option>
          <option value="bridged">bridged (across peer runtimes)</option>
        </select>
        <span className="ml-auto font-mono text-slate-500">
          {counts.topics} topics · {counts.pubs} declared publishers · {counts.subs} live subscribers · {counts.retained} retained
        </span>
      </div>

      {error && (
        <div className="mb-2 rounded border border-rose-700 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      )}

      <PeersPanel />

      <div className="flex-1 overflow-auto rounded-lg border border-slate-700 bg-slate-900/60">
        <table className="w-full table-auto text-xs">
          <thead className="sticky top-0 bg-slate-900 text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">topic</th>
              <th className="px-3 py-2 text-left">publishers (declared)</th>
              <th className="px-3 py-2 text-left">subscribers (live)</th>
              <th className="px-3 py-2 text-right">flags</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              // Federation: render bridged topics distinctly. The topic
              // string carries the @<peer> suffix; we show a "via peer"
              // pill in the publishers column so a glance at the table
              // tells you "this row crosses the wire".
              const peerId = parsePeerSuffix(r.topic)
              return (
              <tr key={r.topic} className="border-t border-slate-800 align-top hover:bg-slate-800/30">
                <td className="px-3 py-2 font-mono text-slate-200">
                  {peerId ? (
                    <>
                      <span>{r.topic.slice(0, r.topic.lastIndexOf('@'))}</span>
                      <span className="text-fuchsia-400">@{peerId}</span>
                    </>
                  ) : r.topic}
                </td>
                <td className="px-3 py-2">
                  {peerId && (
                    <div className="mb-1 font-mono text-[11px] text-fuchsia-300">
                      via peer <span className="text-fuchsia-200">{peerId}</span>
                    </div>
                  )}
                  {r.publishers.length === 0 ? (
                    !peerId && <span className="text-slate-600">—</span>
                  ) : (
                    <ul className="space-y-0.5 font-mono text-slate-300">
                      {r.publishers.map((p, i) => (
                        <li key={i}>
                          <span className="text-emerald-400">{p.proxyId}</span>
                          {p.method && <span className="text-slate-500"> · {p.method}()</span>}
                          {p.source !== 'method' && (
                            <span className="ml-1 text-slate-600">[{p.source}]</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="px-3 py-2">
                  {r.subscribers.length === 0 ? (
                    <span className="text-slate-600">—</span>
                  ) : (
                    <ul className="space-y-0.5 font-mono text-slate-300">
                      {r.subscribers.map((s, i) => (
                        <li key={i}>
                          {s.kind === 'service' && (
                            <span className="text-sky-400">{s.proxy_id}</span>
                          )}
                          {s.kind === 'ui' && (
                            <span className="text-violet-300">ui · {s.user}</span>
                          )}
                          {s.kind === 'subprocess' && (
                            <span className="text-amber-300">subprocess · {s.session}</span>
                          )}
                          {s.kind === 'other' && (
                            <span className="text-slate-400">{s.id}</span>
                          )}
                          {s.matched_via && s.matched_via !== 'exact' && (
                            <span className="ml-1 text-slate-500">via {s.matched_via}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[10px]">
                  {r.retained && <span className="text-amber-500">retained </span>}
                  {r.dropped > 0 && <span className="text-rose-400">{r.dropped} dropped </span>}
                </td>
              </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                  No topics match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────
// PeersPanel — collapsible card showing federated peer runtimes.
//
// Lives at the top of the Topology page right under the filter row.
// Polls /v1/peers every 3s for state changes (a peer transitions
// CONNECTING → IDENTIFYING → CONNECTED on its own and we want the
// badge to flip without user interaction).
// ─────────────────────────────────────────────────────────────────────

interface PeerRow {
  key: string
  url: string
  remote_id: string | null
  state: string
  upstream_subs: string[]
}

function PeersPanel() {
  const [peers, setPeers] = useState<PeerRow[]>([])
  const [collapsed, setCollapsed] = useState(false)
  const [draftUrl, setDraftUrl] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Per-active-runtime apiFetch — peers shown here are this runtime's
  // peers, not a global list. Switching runtimes via the chip bar
  // (Phase 5) re-renders against the new runtime's /v1/peers.
  const apiFetch = useApiFetch()

  const refresh = async () => {
    try {
      const resp = await apiFetch<PeerRow[]>('/v1/peers')
      setPeers(Array.isArray(resp) ? resp : [])
    } catch (e) {
      // Soft-fail — leave last snapshot visible
    }
  }

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 3000)
    return () => clearInterval(t)
  // apiFetch identity changes only on active-runtime swap → correct
  // dependency to re-establish polling against the new runtime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiFetch])

  const onConnect = async (e: React.FormEvent) => {
    e.preventDefault()
    const url = draftUrl.trim()
    if (!url) {
      setErr('Enter a WS URL (e.g. ws://10.0.0.5:8998)')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      await apiFetch('/v1/peers-request', {
        method: 'POST',
        body: JSON.stringify({ action: 'connect', url }),
      })
      setDraftUrl('')
      await refresh()
    } catch (e: any) {
      setErr(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  const onDisconnect = async (key: string) => {
    try {
      await apiFetch('/v1/peers-request', {
        method: 'POST',
        body: JSON.stringify({ action: 'disconnect', key }),
      })
      await refresh()
    } catch (e: any) {
      setErr(e?.message ?? String(e))
    }
  }

  return (
    <section className="mb-2 rounded-lg border border-slate-700 bg-slate-900/60">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs uppercase tracking-wider text-slate-400 hover:text-slate-200"
      >
        <span>peer runtimes ({peers.length})</span>
        <span className="font-mono text-[10px] text-slate-500">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <div className="space-y-3 px-3 pb-3">
          {/* connect form */}
          <form onSubmit={onConnect} className="flex items-center gap-2">
            <input
              type="text"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              placeholder="ws://other-runtime:8998"
              className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-200 focus:border-slate-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || !draftUrl.trim()}
              className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              {busy ? 'Connecting…' : 'Connect peer'}
            </button>
          </form>
          {err && (
            <div className="rounded border border-rose-700 bg-rose-950/40 px-2 py-1 font-mono text-[10px] text-rose-200">
              {err}
            </div>
          )}
          {/* peers list */}
          {peers.length === 0 ? (
            <div className="text-[11px] text-slate-500">
              No peers yet. Connect to another runtime above. Once it identifies
              itself, ``@&lt;peer-id&gt;``-suffixed topics route through the bridge.
            </div>
          ) : (
            <table className="w-full table-auto text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-1 text-left">id / url</th>
                  <th className="py-1 text-left">state</th>
                  <th className="py-1 text-left">upstream subs</th>
                  <th className="py-1 text-right">action</th>
                </tr>
              </thead>
              <tbody>
                {peers.map((p) => (
                  <tr key={p.key} className="border-t border-slate-800">
                    <td className="py-1 font-mono text-slate-200">
                      {p.remote_id ? (
                        <span className="text-emerald-300">{p.remote_id}</span>
                      ) : (
                        <span className="text-slate-400">{p.url}</span>
                      )}
                      <div className="font-mono text-[10px] text-slate-500">{p.url}</div>
                    </td>
                    <td className="py-1">
                      <PeerStateBadge state={p.state} />
                    </td>
                    <td className="py-1 font-mono text-[11px] text-slate-300">
                      {p.upstream_subs.length === 0 ? (
                        <span className="text-slate-600">—</span>
                      ) : (
                        <span>{p.upstream_subs.length}</span>
                      )}
                    </td>
                    <td className="py-1 text-right">
                      <button
                        type="button"
                        onClick={() => onDisconnect(p.key)}
                        className="rounded border border-rose-700 px-1.5 py-0.5 text-[11px] text-rose-300 hover:border-rose-500"
                      >
                        Disconnect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  )
}

// Mirrors the bus's parse_id_suffix in Python — same regex so the UI
// agrees with the server on what's a peer-suffixed topic. Returns the
// peer id, or null if the topic isn't suffixed.
const _PEER_ID_RE = /^[a-z][a-z0-9-]{1,62}$/
function parsePeerSuffix(topic: string): string | null {
  const at = topic.lastIndexOf('@')
  if (at < 0) return null
  const suffix = topic.slice(at + 1)
  return _PEER_ID_RE.test(suffix) ? suffix : null
}


function PeerStateBadge({ state }: { state: string }) {
  const map: Record<string, string> = {
    connected: 'bg-emerald-800 text-emerald-200',
    identifying: 'bg-sky-700 text-sky-200',
    connecting: 'bg-sky-800 text-sky-200',
    disconnected: 'bg-amber-800 text-amber-200',
    stopped: 'bg-slate-700 text-slate-200',
    init: 'bg-slate-700 text-slate-300',
  }
  return (
    <span className={`rounded px-1.5 py-0 text-[9px] uppercase tracking-wider ${map[state] ?? 'bg-slate-700 text-slate-200'}`}>
      {state}
    </span>
  )
}
