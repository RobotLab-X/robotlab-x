import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'
import Banner from '../components/Banner'

type Record = Record_<string, unknown> // alias to satisfy TS; see below
type Record_<K extends string, V> = { [k in K]: V }

export default function AdminTables() {
  const [tables, setTables] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [rows, setRows] = useState<Record[]>([])
  const [tablesLoading, setTablesLoading] = useState(true)
  const [rowsLoading, setRowsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let cancelled = false
    setTablesLoading(true)
    setError(null)
    apiFetch<string[]>('/v1/admin/table-list')
      .then((list) => {
        if (cancelled) return
        const sorted = (list ?? []).slice().sort()
        setTables(sorted)
        if (sorted.length > 0 && selected === null) setSelected(sorted[0])
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setTablesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const loadTable = useCallback(async (table: string) => {
    setRowsLoading(true)
    setError(null)
    try {
      const data = await apiFetch<Record[]>(`/v1/admin/table/${encodeURIComponent(table)}`)
      setRows(data ?? [])
    } catch (err) {
      if (err instanceof Error) setError(err.message)
      setRows([])
    } finally {
      setRowsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!selected) {
      setRows([])
      return
    }
    loadTable(selected)
  }, [selected, loadTable])

  // Derive the column set as the union of keys across all rows so that
  // optional fields are still visible. 'id' (if present) anchors as the
  // first column to make scanning easier.
  const columns = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) for (const k of Object.keys(r)) set.add(k)
    const all = Array.from(set)
    const hasId = all.includes('id')
    const rest = all.filter((k) => k !== 'id').sort()
    return hasId ? ['id', ...rest] : rest
  }, [rows])

  const filteredRows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q))
  }, [rows, filter])

  return (
    <div className="mx-auto max-w-screen-2xl space-y-4 p-6">
      <header>
        <h1 className="text-lg font-semibold">Tables</h1>
      </header>

      {error && <Banner tone="error">{error}</Banner>}

      <div className="flex h-[calc(100vh-140px)] gap-4">
        {/* Sidebar: table list */}
        <aside className="w-56 shrink-0 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900/60">
          <div className="border-b border-slate-800 px-3 py-2 text-xs uppercase tracking-wider text-slate-400">
            Tables {tables.length > 0 && <span className="text-slate-500">({tables.length})</span>}
          </div>
          {tablesLoading && <div className="px-3 py-2 text-xs text-slate-500">Loading…</div>}
          {!tablesLoading && tables.length === 0 && (
            <div className="px-3 py-2 text-xs text-slate-500">No tables found.</div>
          )}
          <ul>
            {tables.map((t) => (
              <li key={t}>
                <button
                  type="button"
                  onClick={() => setSelected(t)}
                  className={
                    selected === t
                      ? 'block w-full px-3 py-1.5 text-left font-mono text-xs text-slate-100 bg-slate-800'
                      : 'block w-full px-3 py-1.5 text-left font-mono text-xs text-slate-300 hover:bg-slate-800'
                  }
                >
                  {t}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Right pane: rows */}
        <main className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden rounded-lg border border-slate-700 bg-slate-900/60">
          <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
            <div className="flex items-baseline gap-3">
              <h2 className="font-mono text-sm text-slate-100">{selected ?? '—'}</h2>
              <span className="text-xs text-slate-500">
                {selected ? `${filteredRows.length}${filter ? ` of ${rows.length}` : ''} rows` : ''}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="filter…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 placeholder-slate-600 focus:border-slate-500 focus:outline-none"
              />
              <button
                type="button"
                disabled={!selected || rowsLoading}
                onClick={() => selected && loadTable(selected)}
                className="rounded border border-slate-700 px-2 py-1 text-xs hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Reload
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            {rowsLoading && <div className="px-3 py-2 text-xs text-slate-500">Loading rows…</div>}
            {!rowsLoading && selected && rows.length === 0 && (
              <div className="px-3 py-2 text-xs text-slate-500">Table is empty.</div>
            )}
            {!rowsLoading && rows.length > 0 && (
              <table className="w-full table-auto text-xs">
                <thead className="sticky top-0 bg-slate-900 text-[10px] uppercase tracking-wider text-slate-400">
                  <tr>
                    {columns.map((c) => (
                      <th key={c} className="border-b border-slate-800 px-2 py-1.5 text-left font-medium">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredRows.map((row, i) => (
                    <tr key={(row.id as string | undefined) ?? i} className="hover:bg-slate-900">
                      {columns.map((c) => (
                        <td key={c} className="px-2 py-1.5 align-top font-mono text-slate-300">
                          <Cell value={row[c]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

function Cell({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-slate-600">—</span>
  }
  if (typeof value === 'string') {
    return <span className="break-words">{value}</span>
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span>{String(value)}</span>
  }
  // Objects / arrays render as collapsed JSON; long values get capped so
  // one fat row doesn't blow out the layout.
  const s = JSON.stringify(value)
  if (s.length <= 80) return <span className="text-slate-400">{s}</span>
  return (
    <details>
      <summary className="cursor-pointer text-slate-400">{s.slice(0, 60)}…</summary>
      <pre className="mt-1 whitespace-pre-wrap break-words text-slate-300">{JSON.stringify(value, null, 2)}</pre>
    </details>
  )
}
