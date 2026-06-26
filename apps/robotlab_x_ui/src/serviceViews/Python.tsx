import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ServiceProxy } from '../models/ServiceProxy'
import { type InboundFrame } from '../runtime/wsClient'
import { useWsClient } from '../contexts/ActiveRuntimeContext'

// Compact view_full for the python service. The real editing happens
// in the dedicated full-page IDE at /python/{id}/ide — this card
// shows a summary (script count + recent runs) and a big launcher button.

interface Script {
  id: string
  name: string
  updated_at?: string
}

interface RunEntry {
  run_id: string
  script_name: string
  started_at: number
  status: string
  exit_code?: number
  duration_ms?: number
}

interface PythonState {
  scripts?: Script[]
  recent_runs?: RunEntry[]
}

export default function PythonFullView({ proxy }: { proxy: ServiceProxy }) {
  const wsClient = useWsClient()
  const proxyId = proxy.id ?? proxy.name ?? ''
  const navigate = useNavigate()
  const stateTopic = `/python/${proxyId}/state`
  const [state, setState] = useState<PythonState>({})

  useEffect(() => {
    if (!proxyId) return
    const off = wsClient.subscribe(stateTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      setState(f.payload as PythonState)
    })
    return off
  }, [proxyId, stateTopic, wsClient])

  const scripts = state.scripts ?? []
  const recentRuns = (state.recent_runs ?? []).slice(0, 5)

  const openIDE = () => navigate(`/python/${encodeURIComponent(proxyId)}/ide`)

  return (
    <div className="flex min-w-[360px] flex-col gap-3 p-3 text-xs">
      <section className="rounded border border-slate-800 bg-slate-900/40 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400">
              python · {proxyId}
            </div>
            <div className="mt-1 font-mono text-[11px] text-slate-500">
              {scripts.length} script{scripts.length === 1 ? '' : 's'} · {recentRuns.length} recent run{recentRuns.length === 1 ? '' : 's'}
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); openIDE() }}
            onPointerDown={(e) => e.stopPropagation()}
            className="nodrag nopan rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
          >
            Open IDE →
          </button>
        </div>
      </section>

      <section className="rounded border border-slate-800 bg-slate-900/40 p-3">
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          scripts
        </h3>
        {scripts.length === 0 ? (
          <div className="text-slate-500">No scripts yet — open the IDE to create one.</div>
        ) : (
          <ul className="space-y-0.5 font-mono">
            {scripts.slice(0, 8).map((s) => (
              <li
                key={s.id}
                onClick={(e) => { e.stopPropagation(); openIDE() }}
                onPointerDown={(e) => e.stopPropagation()}
                className="nodrag nopan cursor-pointer truncate rounded px-1.5 py-1 text-slate-300 hover:bg-slate-800/60"
              >
                {s.name}
              </li>
            ))}
            {scripts.length > 8 && (
              <li className="px-1.5 py-1 text-[10px] text-slate-500">
                + {scripts.length - 8} more — open IDE to browse
              </li>
            )}
          </ul>
        )}
      </section>

      <section className="rounded border border-slate-800 bg-slate-900/40 p-3">
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          recent runs
        </h3>
        {recentRuns.length === 0 ? (
          <div className="text-slate-500">No runs yet.</div>
        ) : (
          <ul className="space-y-0.5 font-mono">
            {recentRuns.map((r) => (
              <li key={r.run_id} className="flex items-center gap-2 px-1 py-0.5 text-[11px]">
                <StatusBadge status={r.status} />
                <span className="truncate text-slate-300">{r.script_name}</span>
                <span className="ml-auto text-slate-500">
                  {r.duration_ms != null ? `${r.duration_ms}ms` : '…'}
                </span>
                {typeof r.exit_code === 'number' && r.exit_code !== 0 && (
                  <span className="text-rose-400">exit {r.exit_code}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    running: 'bg-sky-700 text-sky-200',
    completed: 'bg-emerald-800 text-emerald-200',
    error: 'bg-rose-800 text-rose-200',
    timeout: 'bg-amber-800 text-amber-200',
  }
  return (
    <span className={`rounded px-1 py-0 text-[9px] uppercase tracking-wider ${map[status] ?? 'bg-slate-700 text-slate-200'}`}>
      {status}
    </span>
  )
}
