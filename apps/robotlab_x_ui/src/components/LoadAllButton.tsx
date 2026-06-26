// Top-bar "Load all" button — re-reads EVERY managed service's yml from
// the active config set and applies it to the live services. The inverse
// of SaveAllButton, placed right beside it.
//
// Unlike Save (harmless — just persists), Load all REPLACES every running
// service's live config with what's on disk, so any unsaved live tweaks
// are lost. That blast radius earns a ConfirmDialog (the codebase rule is
// no native confirm/alert) before it fires.
import { useEffect, useRef, useState } from 'react'
import { FolderInput, Loader2, Check } from 'lucide-react'

import { useApiFetch } from '../contexts/ActiveRuntimeContext'
import { ConfirmDialog } from './ConfirmDialog'

type LoadState = 'idle' | 'loading' | 'done' | 'error'

interface ReloadReport {
  ok?: boolean
  reloaded?: string[]
  skipped?: Record<string, string>
  errors?: Record<string, string>
}

export default function LoadAllButton() {
  const apiFetch = useApiFetch()
  const [state, setState] = useState<LoadState>('idle')
  const [confirming, setConfirming] = useState(false)
  const [detail, setDetail] = useState<string | null>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current) }, [])

  const scheduleReset = () => {
    if (resetTimer.current) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => { setState('idle'); setDetail(null) }, 3000)
  }

  const doLoad = () => {
    setConfirming(false)
    setState('loading')
    setDetail(null)
    void apiFetch<ReloadReport>('/v1/system/reload-config', { method: 'POST' })
      .then((r) => {
        const errs = Object.keys(r?.errors ?? {})
        if (r?.ok && errs.length === 0) {
          setState('done')
          setDetail(`${r.reloaded?.length ?? 0} loaded`)
        } else {
          setState('error')
          setDetail(errs.length ? `${errs.length} failed` : 'load failed')
        }
        scheduleReset()
      })
      .catch(() => { setState('error'); setDetail('load failed'); scheduleReset() })
  }

  const label =
    state === 'loading' ? 'Loading…'
      : state === 'done' ? (detail ?? 'Loaded')
        : state === 'error' ? (detail ?? 'Retry')
          : 'Load all'

  const tone =
    state === 'error' ? 'border-rose-600 text-rose-300 hover:border-rose-400'
      : state === 'done' ? 'border-emerald-600 text-emerald-300'
        : 'border-slate-700 text-slate-200 hover:border-slate-500'

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={state === 'loading'}
        className={`flex items-center gap-1.5 rounded border bg-slate-900/60 px-2 py-1 text-[11px] disabled:opacity-60 ${tone}`}
        title="Re-read every service's yml from the active config set and apply it to the live services"
      >
        {state === 'loading'
          ? <Loader2 size={14} className="animate-spin text-slate-400" />
          : state === 'done'
            ? <Check size={14} className="text-emerald-400" />
            : <FolderInput size={14} className="text-slate-400" />}
        <span>{label}</span>
      </button>

      {confirming && (
        <ConfirmDialog
          title="Load all services from disk?"
          message="Re-reads every service's yml from the active config set and applies it to the running services. Any live changes you haven't saved will be overwritten by what's on disk."
          confirmLabel="Load all"
          variant="danger"
          onConfirm={doLoad}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  )
}
