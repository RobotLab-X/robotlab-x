// Config wizard — per-instance settings (M4). Shown on first Start of an
// instance whose type declares config_steps and that hasn't been
// configured yet, and reopenable any time via the inspector's "Configure"
// button so a user can configure before starting.
//
// Renders the type's config_steps (same {id,title,fields:[...]} shape as
// the install wizard's wizard_steps) seeded from the proxy's current
// service_config. Secrets use a password field (type: "password"); values
// already saved show a "••• keep" placeholder rather than the ciphertext.
import { useMemo, useState } from 'react'
import type { ServiceMeta } from '../models/ServiceMeta'
import type { ServiceProxy } from '../models/ServiceProxy'
import { FieldInput, defaultsFor, type WizardStep } from './InstallWizard'

interface Props {
  meta: ServiceMeta
  proxy: ServiceProxy
  busy?: boolean
  onCancel: () => void
  onSave: (config: Record<string, unknown>) => void
  saveLabel?: string
}

export default function ConfigWizard({ meta, proxy, busy, onCancel, onSave, saveLabel = 'Save & start' }: Props) {
  const steps = useMemo<WizardStep[]>(
    () => (Array.isArray(meta.config_steps) ? (meta.config_steps as WizardStep[]) : []),
    [meta.config_steps],
  )
  const [values, setValues] = useState<Record<string, unknown>>(() => ({
    ...defaultsFor(steps),
    ...((proxy.service_config as Record<string, unknown>) ?? {}),
  }))

  const setField = (id: string, v: unknown) => setValues((prev) => ({ ...prev, [id]: v }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
        <header className="border-b border-slate-800 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-100">
            Configure {proxy.name ?? proxy.id}
            <span className="ml-2 text-xs font-normal text-slate-500">{meta.name}</span>
          </h2>
        </header>

        <div className="flex-1 space-y-4 overflow-auto px-5 py-4 text-sm text-slate-300">
          {steps.length === 0 && (
            <p className="text-xs text-slate-500">This service type has no configurable settings.</p>
          )}
          {steps.map((step) => (
            <fieldset key={step.id} className="space-y-2">
              {step.title && <legend className="text-xs font-semibold text-slate-200">{step.title}</legend>}
              {step.description && <p className="text-xs text-slate-500">{step.description}</p>}
              {(step.fields ?? []).map((f) => (
                <FieldInput key={f.id} field={f} value={values[f.id]} onChange={(v) => setField(f.id, v)} />
              ))}
            </fieldset>
          ))}
        </div>

        <footer className="flex items-center justify-between border-t border-slate-800 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onSave(values)}
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {saveLabel}
          </button>
        </footer>
      </div>
    </div>
  )
}
