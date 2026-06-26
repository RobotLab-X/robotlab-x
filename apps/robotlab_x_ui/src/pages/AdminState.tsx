import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import Banner from '../components/Banner'

/**
 * /admin/state — mirror of `python -m robotlab_x.tools.state`.
 *
 * Reads from GET /v1/admin/state, refreshes on demand + auto every 5s.
 * Anyone seeing UI weirdness should open this first — it's the truth
 * about service_proxy rows, workspace integrity, and live processes.
 */

interface ProxyRow {
  id: string
  status: string
  pid: number | null
  host: string | null
  port: number | null
  service_meta_id: string | null
  error: string | null
  pid_alive: boolean
  warnings: string[]
}
interface WorkspaceRow {
  id: string
  kind: string
  members_stored: number
  members_computed: boolean
  positions: number
  view_types: number
  edges: number
  orphans: {
    members: string[]
    positions: string[]
    view_types: string[]
    edges: string[]
  }
}
interface ProcessRow {
  pid: number
  argv: string[]
  is_backend: boolean
  orphan: boolean
}
interface StateSnapshot {
  proxies: ProxyRow[]
  workspaces: WorkspaceRow[]
  processes: ProcessRow[]
  summary: {
    proxies: number
    workspaces: number
    processes: number
    drift_warnings: number
  }
}

const STATUS_TONE: Record<string, string> = {
  installed: 'bg-slate-700 text-slate-200',
  installing: 'bg-amber-700 text-amber-100',
  starting: 'bg-amber-700 text-amber-100',
  running: 'bg-emerald-700 text-emerald-100',
  stopping: 'bg-amber-700 text-amber-100',
  stopped: 'bg-slate-700 text-slate-200',
  uninstalled: 'bg-slate-800 text-slate-400',
  error: 'bg-rose-700 text-rose-100',
}

export default function AdminState() {
  const [snap, setSnap] = useState<StateSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastFetched, setLastFetched] = useState<number | null>(null)

  const reload = useCallback(async () => {
    setError(null)
    try {
      const data = await apiFetch<StateSnapshot>('/v1/admin/state')
      setSnap(data)
      setLastFetched(Date.now())
    } catch (err) {
      if (err instanceof Error) setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
    // Auto-refresh every 5s — diagnostic page, cheap call.
    const t = setInterval(reload, 5000)
    return () => clearInterval(t)
  }, [reload])

  const drift = snap?.summary?.drift_warnings ?? 0
  const ageMs = lastFetched ? Date.now() - lastFetched : null

  return (
    <div className="mx-auto max-w-screen-2xl space-y-3 p-6 text-xs">
      <header>
        <h1 className="text-lg font-semibold">State</h1>
      </header>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={reload}
          className="rounded border border-slate-700 px-2 py-1 text-xs hover:border-slate-500"
        >
          Refresh now
        </button>
        <span className="text-slate-500">
          {ageMs === null ? 'never fetched' : `last fetched ${Math.round(ageMs / 1000)}s ago`}
          {' · auto every 5s'}
        </span>
        <span className="ml-auto">
          {drift > 0 ? (
            <span className="rounded bg-rose-700 px-2 py-0.5 font-mono text-rose-100">
              {drift} drift warning{drift === 1 ? '' : 's'}
            </span>
          ) : (
            <span className="rounded bg-emerald-700 px-2 py-0.5 font-mono text-emerald-100">
              clean
            </span>
          )}
        </span>
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      {loading && !snap && <Banner tone="info">Loading state…</Banner>}

      {snap && (
        <>
          <Section title={`service_proxy · ${snap.summary.proxies} rows`}>
            <table className="w-full table-auto font-mono">
              <thead className="bg-slate-900 text-[10px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-2 py-1 text-left">id</th>
                  <th className="px-2 py-1 text-left">status</th>
                  <th className="px-2 py-1 text-left">pid</th>
                  <th className="px-2 py-1 text-left">live?</th>
                  <th className="px-2 py-1 text-left">host:port</th>
                  <th className="px-2 py-1 text-left">meta</th>
                  <th className="px-2 py-1 text-left">warnings / error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {snap.proxies.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-900">
                    <td className="px-2 py-1 text-slate-200">{p.id}</td>
                    <td className="px-2 py-1">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${STATUS_TONE[p.status] ?? STATUS_TONE.stopped}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-slate-400">{p.pid ?? '—'}</td>
                    <td className="px-2 py-1">
                      {p.pid_alive ? (
                        <span className="text-emerald-400">●</span>
                      ) : p.pid ? (
                        <span className="text-rose-400">✗</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-slate-400">
                      {p.host ?? '—'}{p.port ? `:${p.port}` : ''}
                    </td>
                    <td className="px-2 py-1 text-slate-500">{p.service_meta_id ?? '—'}</td>
                    <td className="px-2 py-1 text-rose-300">
                      {p.warnings.length > 0 && (
                        <div>⚠ {p.warnings.join(' · ')}</div>
                      )}
                      {p.error && <div className="text-rose-400">{p.error}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title={`workspaces · ${snap.summary.workspaces} rows · referential integrity`}>
            <ul className="divide-y divide-slate-800">
              {snap.workspaces.map((w) => {
                const orphanFlags: Array<[string, string[]]> = [
                  ['members', w.orphans.members],
                  ['positions', w.orphans.positions],
                  ['view_types', w.orphans.view_types],
                  ['edges', w.orphans.edges],
                ]
                const hasOrphans = orphanFlags.some(([, v]) => v.length > 0)
                return (
                  <li key={w.id} className="px-2 py-1">
                    <div className="font-mono text-slate-200">
                      {w.id}
                      <span className="ml-2 text-slate-500">
                        kind={w.kind} · members=
                        {w.members_computed ? 'computed' : w.members_stored}
                        {' '}· positions={w.positions} · view_types={w.view_types} · edges={w.edges}
                      </span>
                    </div>
                    {hasOrphans && (
                      <div className="mt-1 ml-3 space-y-0.5 font-mono text-rose-300">
                        {orphanFlags.map(([k, ids]) => ids.length === 0 ? null : (
                          <div key={k}>⚠ orphan {k}: {ids.join(', ')}</div>
                        ))}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </Section>

          <Section title={`processes · ${snap.summary.processes}`}>
            <ul className="divide-y divide-slate-800 font-mono">
              {snap.processes.map((p) => (
                <li key={p.pid} className="flex items-baseline gap-2 px-2 py-1">
                  <span className="w-16 text-slate-400">pid={p.pid}</span>
                  {p.is_backend && (
                    <span className="rounded bg-sky-800 px-1.5 py-0.5 text-[10px] text-sky-100">backend</span>
                  )}
                  {p.orphan && (
                    <span className="rounded bg-rose-700 px-1.5 py-0.5 text-[10px] text-rose-100">
                      orphan
                    </span>
                  )}
                  <span className="flex-1 truncate text-slate-500">{p.argv.join(' ')}</span>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-700 bg-slate-900/60">
      <h2 className="border-b border-slate-800 bg-slate-900 px-3 py-1.5 font-semibold text-slate-200">
        {title}
      </h2>
      <div className="overflow-auto">{children}</div>
    </section>
  )
}
