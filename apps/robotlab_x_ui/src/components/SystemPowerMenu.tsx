// Top-bar power chooser — Restart vs Shut down the backend.
//
// Anchored at the far right of the runtime top bar (App.tsx): destructive
// / terminal system actions live at the trailing edge, away from the
// frequently-used Save + config-set controls, so they're hard to hit by
// accident. Both actions go through a ConfirmDialog (the codebase rule is
// no native confirm/alert).
//
//   * Restart  → POST /v1/system/restart  — graceful drain + re-exec.
//                The ws auto-reconnects; we poll system/info for the fresh
//                process and report when it's back.
//   * Shutdown → POST /v1/system/shutdown — graceful drain + exit, NO
//                re-exec. The backend stays down and will NOT reconnect on
//                its own, so we surface a clear one-button notice.
import { useState } from 'react'
import { Power, RotateCw, PowerOff } from 'lucide-react'

import { useApiFetch } from '../contexts/ActiveRuntimeContext'
import { ConfirmDialog } from './ConfirmDialog'

type Pending = null | 'restart' | 'shutdown'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function SystemPowerMenu() {
  const apiFetch = useApiFetch()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<Pending>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const doRestart = async () => {
    setBusy(true)
    setError(null)
    let beforeStartedAt: number | null = null
    try {
      const info = await apiFetch<{ started_at?: number }>('/v1/system/info')
      beforeStartedAt = info.started_at ?? null
    } catch { /* poll anyway */ }
    try {
      await apiFetch('/v1/system/restart', { method: 'POST' })
    } catch { /* response may not arrive as the process goes down — fine */ }

    await sleep(1500)
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      try {
        const info = await apiFetch<{ started_at?: number }>('/v1/system/info')
        if (beforeStartedAt == null || info.started_at !== beforeStartedAt) {
          setBusy(false); setPending(null)
          return
        }
      } catch { /* still draining / down — keep polling */ }
      await sleep(1000)
    }
    setBusy(false)
    setError('Backend did not come back within 120s — check the server, then refresh.')
  }

  const doShutdown = async () => {
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/v1/system/shutdown', { method: 'POST' })
    } catch { /* the process is exiting; a missing response is expected */ }
    setBusy(false)
    setPending(null)
    setNotice('The backend is shutting down. It will NOT reconnect on its own — start it again from the host to bring it back.')
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-200 hover:border-rose-500 hover:text-rose-200"
        title="Power — restart or shut down the backend"
      >
        <Power size={14} className="text-slate-400" />
      </button>

      {open && (
        <>
          {/* click-away backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-44 rounded border border-slate-700 bg-slate-900 py-1 shadow-xl">
            <button
              type="button"
              onClick={() => { setOpen(false); setPending('restart') }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-300 hover:bg-slate-800"
            >
              <RotateCw size={14} className="text-slate-400" /> Restart backend
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setPending('shutdown') }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-rose-300 hover:bg-rose-900/40"
            >
              <PowerOff size={14} /> Shut down backend
            </button>
          </div>
        </>
      )}

      {pending === 'restart' && (
        <ConfirmDialog
          title="Restart backend?"
          message="Services drain and the process re-execs. The connection drops briefly and reconnects on its own."
          confirmLabel="Restart"
          variant="danger"
          busy={busy}
          onConfirm={doRestart}
          onCancel={() => { if (!busy) setPending(null) }}
        />
      )}

      {pending === 'shutdown' && (
        <ConfirmDialog
          title="Shut down backend?"
          message="Services drain and the process exits. The backend will NOT come back on its own — you'll need to start it again from the host."
          confirmLabel="Shut down"
          variant="danger"
          busy={busy}
          onConfirm={doShutdown}
          onCancel={() => { if (!busy) setPending(null) }}
        />
      )}

      {notice && (
        <ConfirmDialog
          title="Backend shutting down"
          message={notice}
          confirmLabel="OK"
          cancelLabel={null}
          onConfirm={() => setNotice(null)}
          onCancel={() => setNotice(null)}
        />
      )}

      {error && (
        <ConfirmDialog
          title="Restart problem"
          message={error}
          confirmLabel="OK"
          cancelLabel={null}
          variant="danger"
          onConfirm={() => setError(null)}
          onCancel={() => setError(null)}
        />
      )}
    </div>
  )
}
