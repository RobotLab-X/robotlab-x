import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import Banner from '../components/Banner'
import type { Workspace } from '../models/Workspace'

const STATUS_TONE: Record<string, string> = {
  draft: 'bg-slate-700 text-slate-200',
  inactive: 'bg-slate-700 text-slate-200',
  activating: 'bg-amber-700 text-amber-100',
  active: 'bg-emerald-700 text-emerald-100',
  deactivating: 'bg-amber-700 text-amber-100',
  degraded: 'bg-rose-700 text-rose-100',
}

export default function Workspaces() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const reload = useCallback(async () => {
    setError(null)
    try {
      const list = await apiFetch<Workspace[]>('/v1/workspace-list')
      setRows(list ?? [])
    } catch (err) {
      if (err instanceof Error) setError(err.message)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiFetch<Workspace[]>('/v1/workspace-list')
      .then((list) => {
        if (!cancelled) setRows(list ?? [])
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) {
      setError('Workspace name is required')
      return
    }
    setCreating(true)
    setError(null)
    try {
      const created = await apiFetch<Workspace>('/v1/workspace', {
        method: 'POST',
        body: JSON.stringify({
          id: name,
          name,
          status: 'draft',
          service_proxy_ids: [],
          node_positions: {},
        }),
      })
      setNewName('')
      await reload()
      if (created.id) navigate(`/workspaces/${encodeURIComponent(created.id)}`)
    } catch (err) {
      if (err instanceof Error) setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <header>
        <h1 className="text-lg font-semibold">Workspaces</h1>
      </header>

      {error && <Banner tone="error">{error}</Banner>}
      {loading && <Banner tone="info">Loading workspaces…</Banner>}

      {/* Runtime workspace is the always-present live view. Pinned here
          so it's the first thing the user sees in the workspace list. */}
      {(() => {
        const runtime = rows.find((r) => r.kind === 'runtime')
        if (!runtime) return null
        const liveCount = (runtime.service_proxy_ids as string[] | undefined)?.length ?? 0
        return (
          <button
            type="button"
            onClick={() => navigate(`/workspaces/${encodeURIComponent(runtime.id ?? 'runtime')}`)}
            className="block w-full rounded-lg border border-emerald-700 bg-emerald-950/30 p-4 text-left hover:border-emerald-500"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-emerald-200">Runtime</h2>
                  <span className="rounded bg-emerald-900 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-200">
                    live
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {runtime.description ?? 'Live view of every running service.'}
                </p>
              </div>
              <div className="font-mono text-xs text-slate-400">
                {liveCount} running
              </div>
            </div>
          </button>
        )
      })()}

      <form onSubmit={handleCreate} className="flex gap-2 rounded-lg border border-slate-700 bg-slate-900/60 p-4">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="new-workspace-name"
          className="flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
        />
        <button
          type="submit"
          disabled={creating}
          className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
        >
          {creating ? 'Creating…' : 'New workspace'}
        </button>
      </form>

      <div className="overflow-hidden rounded-lg border border-slate-700 bg-slate-900/60">
        <table className="w-full table-auto text-sm">
          <thead className="bg-slate-900 text-xs uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Proxies</th>
              <th className="px-3 py-2 text-left">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.filter((r) => r.kind !== 'runtime').map((row) => {
              const tone = STATUS_TONE[row.status ?? 'draft'] ?? STATUS_TONE.draft
              const count = row.service_proxy_ids?.length ?? 0
              return (
                <tr
                  key={row.id}
                  onClick={() => navigate(`/workspaces/${encodeURIComponent(row.id ?? '')}`)}
                  className="cursor-pointer hover:bg-slate-900"
                >
                  <td className="px-3 py-2 font-mono">{row.name ?? row.id}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${tone}`}>
                      {row.status ?? 'draft'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-400">{count}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">
                    {row.updated_at ?? '—'}
                  </td>
                </tr>
              )
            })}
            {!loading && rows.filter((r) => r.kind !== 'runtime').length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                  No saved workspaces yet. Build something on the runtime canvas, then save it as a grouping.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
