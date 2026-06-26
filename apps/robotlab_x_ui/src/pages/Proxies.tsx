import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import Banner from '../components/Banner'
import type { ServiceProxy } from '../models/ServiceProxy'
import type { ServiceRequest } from '../models/ServiceRequest'
import { wsClient, type InboundFrame } from '../runtime/wsClient'

type Action = 'start' | 'stop' | 'restart' | 'uninstall'

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

export default function Proxies() {
  const [rows, setRows] = useState<ServiceProxy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setError(null)
    try {
      const list = await apiFetch<ServiceProxy[]>('/v1/service-proxy-list')
      setRows(list ?? [])
    } catch (err) {
      if (err instanceof Error) setError(err.message)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiFetch<ServiceProxy[]>('/v1/service-proxy-list')
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

  // Subscribe to a per-proxy lifecycle topic for each row so the status
  // pill updates in real time. When a proxy disappears (uninstall), we
  // reload to drop it from the list.
  useEffect(() => {
    const unsubs: Array<() => void> = []
    for (const row of rows) {
      if (!row.id) continue
      const topic = `/service_proxy/${row.id}/lifecycle`
      const off = wsClient.subscribe(topic, (frame: InboundFrame) => {
        if (frame.method !== 'message') return
        const updated = frame.payload as ServiceProxy
        if (!updated || !updated.id) return
        setRows((prev) => {
          const idx = prev.findIndex((p) => p.id === updated.id)
          if (updated.status === 'uninstalled') {
            return idx === -1 ? prev : prev.filter((_, i) => i !== idx)
          }
          if (idx === -1) return prev.concat([updated])
          const next = prev.slice()
          next[idx] = { ...next[idx], ...updated }
          return next
        })
      })
      unsubs.push(off)
    }
    return () => {
      for (const off of unsubs) off()
    }
  }, [rows.map((r) => r.id).join('|')])

  async function dispatch(proxy: ServiceProxy, action: Action) {
    if (!proxy.id) return
    setBusyId(proxy.id)
    setError(null)
    try {
      const result = await apiFetch<ServiceRequest>('/v1/service-request', {
        method: 'POST',
        body: JSON.stringify({
          action,
          service_proxy_id: proxy.id,
        }),
      })
      if (result.status === 'failed') {
        setError(result.result ?? `${action} failed`)
      }
      if (action === 'uninstall') {
        // The WS event will remove the row, but reload guards against
        // missed events (the connection might have been mid-reconnect).
        await reload()
      }
    } catch (err) {
      if (err instanceof Error) setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <header>
        <h1 className="text-lg font-semibold">Service Proxies</h1>
      </header>

      {error && <Banner tone="error">{error}</Banner>}
      {loading && <Banner tone="info">Loading proxies…</Banner>}

      <div className="overflow-hidden rounded-lg border border-slate-700 bg-slate-900/60">
        <table className="w-full table-auto text-sm">
          <thead className="bg-slate-900 text-xs uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Catalog</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">pid</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.map((row) => {
              const tone = STATUS_TONE[row.status ?? 'stopped'] ?? STATUS_TONE.stopped
              const running = row.status === 'running' || row.status === 'starting'
              return (
                <tr key={row.id} className="hover:bg-slate-900">
                  <td className="px-3 py-2 font-mono">{row.name ?? row.id}</td>
                  <td className="px-3 py-2 font-mono text-slate-400">{row.service_meta_id}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${tone}`}>
                      {row.status ?? 'unknown'}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-400">{row.pid ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1.5">
                      <ProxyAction
                        label="Start"
                        disabled={busyId === row.id || running}
                        onClick={() => dispatch(row, 'start')}
                      />
                      <ProxyAction
                        label="Stop"
                        disabled={busyId === row.id || !running}
                        onClick={() => dispatch(row, 'stop')}
                      />
                      <ProxyAction
                        label="Restart"
                        disabled={busyId === row.id}
                        onClick={() => dispatch(row, 'restart')}
                      />
                      <ProxyAction
                        label="Uninstall"
                        disabled={busyId === row.id || running}
                        tone="danger"
                        onClick={() => dispatch(row, 'uninstall')}
                      />
                    </div>
                  </td>
                </tr>
              )
            })}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  No proxies installed. Visit the catalog to install one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ProxyAction({
  label,
  onClick,
  disabled,
  tone = 'normal',
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  tone?: 'normal' | 'danger'
}) {
  const base =
    tone === 'danger'
      ? 'border-rose-800 text-rose-300 hover:border-rose-600'
      : 'border-slate-700 text-slate-200 hover:border-slate-500'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded border px-2 py-1 text-xs ${base} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {label}
    </button>
  )
}
