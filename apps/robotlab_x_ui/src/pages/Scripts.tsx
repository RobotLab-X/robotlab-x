import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import Banner from '../components/Banner'
import type { Script } from '../models/Script'

export default function Scripts() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<Script[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const reload = useCallback(async () => {
    setError(null)
    try {
      setRows((await apiFetch<Script[]>('/v1/script-list')) ?? [])
    } catch (err) {
      if (err instanceof Error) setError(err.message)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiFetch<Script[]>('/v1/script-list')
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
      setError('Script name is required')
      return
    }
    const id = name.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase() || 'script'
    setCreating(true)
    setError(null)
    try {
      const created = await apiFetch<Script>('/v1/script', {
        method: 'POST',
        body: JSON.stringify({
          id,
          name,
          language: 'python',
          body: '# Write your script here\nprint("hello from " + ' + JSON.stringify(name) + ')\n',
        }),
      })
      setNewName('')
      await reload()
      if (created.id) navigate(`/scripts/${encodeURIComponent(created.id)}`)
    } catch (err) {
      if (err instanceof Error) setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <header>
        <h1 className="text-lg font-semibold">Scripts</h1>
      </header>

      {error && <Banner tone="error">{error}</Banner>}
      {loading && <Banner tone="info">Loading scripts…</Banner>}

      <form onSubmit={handleCreate} className="flex gap-2 rounded-lg border border-slate-700 bg-slate-900/60 p-4">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="new-script-name"
          className="flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
        />
        <button
          type="submit"
          disabled={creating}
          className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
        >
          {creating ? 'Creating…' : 'New script'}
        </button>
      </form>

      <div className="overflow-hidden rounded-lg border border-slate-700 bg-slate-900/60">
        <table className="w-full table-auto text-sm">
          <thead className="bg-slate-900 text-xs uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Language</th>
              <th className="px-3 py-2 text-left">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => navigate(`/scripts/${encodeURIComponent(row.id ?? '')}`)}
                className="cursor-pointer hover:bg-slate-900"
              >
                <td className="px-3 py-2 font-mono">{row.name ?? row.id}</td>
                <td className="px-3 py-2 text-slate-400">{row.language}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">
                  {row.updated_at ?? '—'}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-slate-500">
                  No scripts yet. Create one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
