// Top-bar "Save" button — snapshots every managed service's current
// config + run-state into the ACTIVE config set, so the next restart
// restores the exact current state (which services run vs are created,
// each service's own runtime state, and each proxy's desired_state).
//
// Placed immediately left of the ConfigSetSwitcher chip in the runtime
// top bar (App.tsx): the chip shows WHICH set is active, so reading
// left-to-right it says "Save → into set <name>". Same action as the
// (less discoverable) "Save all services" item in the account menu;
// both POST /v1/system/save-config.
import { useEffect, useRef, useState } from 'react'
import { Save, Loader2, Check } from 'lucide-react'

import { useApiFetch } from '../contexts/ActiveRuntimeContext'

type SaveState = 'idle' | 'saving' | 'done' | 'error'

export default function SaveAllButton() {
  const apiFetch = useApiFetch()
  const [state, setState] = useState<SaveState>('idle')
  // Hold the auto-reset timer so an unmount (or a rapid re-save) doesn't
  // fire setState on a dead component.
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current) }, [])

  const scheduleReset = () => {
    if (resetTimer.current) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => setState('idle'), 2500)
  }

  const onSave = () => {
    if (state === 'saving') return
    setState('saving')
    void apiFetch('/v1/system/save-config', { method: 'POST' })
      .then((r) => {
        setState(r && (r as { ok?: boolean }).ok !== false ? 'done' : 'error')
        scheduleReset()
      })
      .catch(() => { setState('error'); scheduleReset() })
  }

  const label =
    state === 'saving' ? 'Saving…'
      : state === 'done' ? 'Saved'
        : state === 'error' ? 'Retry'
          : 'Save'

  // Error/done get a colored border so the result reads at a glance;
  // otherwise match the ConfigSetSwitcher chip surface exactly.
  const tone =
    state === 'error' ? 'border-rose-600 text-rose-300 hover:border-rose-400'
      : state === 'done' ? 'border-emerald-600 text-emerald-300'
        : 'border-slate-700 text-slate-200 hover:border-slate-500'

  return (
    <button
      type="button"
      onClick={onSave}
      disabled={state === 'saving'}
      className={`flex items-center gap-1.5 rounded border bg-slate-900/60 px-2 py-1 text-[11px] disabled:opacity-60 ${tone}`}
      title="Save all services' current state into the active config set as the restore point for the next restart"
    >
      {state === 'saving'
        ? <Loader2 size={14} className="animate-spin text-slate-400" />
        : state === 'done'
          ? <Check size={14} className="text-emerald-400" />
          : <Save size={14} className="text-slate-400" />}
      <span>{label}</span>
    </button>
  )
}
