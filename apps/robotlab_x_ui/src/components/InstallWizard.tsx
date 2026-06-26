// Install wizard — shown on first Start of a placeholder whose service
// TYPE needs a one-time install AND has install-time requirements (a
// license to accept and/or install-time inputs). M3 of the install wizard.
//
// Steps: Overview → License (if any) → Inputs (if any) → confirm. On
// confirm the caller runs the actual install+start, forwarding the
// collected field values as the instance's initial config. Field forms
// use the existing wizard_steps shape ({id,title,description,fields:[{id,
// type,title,default,description,options?}]}) — the same shape the
// per-instance wizard_config already uses — rather than JSON-Schema/RJSF
// (deferred; see docs/TODO_INSTALL_WIZARD.md).
import { useMemo, useState } from 'react'
import type { ServiceMeta } from '../models/ServiceMeta'

export interface WizardField {
  id: string
  type?: 'string' | 'password' | 'integer' | 'number' | 'boolean' | 'select'
  title?: string
  description?: string
  default?: unknown
  options?: Array<string | { value: string; label?: string }>
}
export interface WizardStep {
  id: string
  title?: string
  description?: string
  fields?: WizardField[]
}

export function defaultsFor(steps: WizardStep[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const s of steps) for (const f of s.fields ?? []) {
    out[f.id] = f.default ?? (f.type === 'boolean' ? false : '')
  }
  return out
}

interface Props {
  meta: ServiceMeta
  onCancel: () => void
  onConfirm: (config: Record<string, unknown>) => void
}

export default function InstallWizard({ meta, onCancel, onConfirm }: Props) {
  const steps: WizardStep[] = useMemo(
    () => (Array.isArray(meta.wizard_steps) ? (meta.wizard_steps as WizardStep[]) : []),
    [meta.wizard_steps],
  )
  const hasLicense = !!meta.license
  const hasInputs = steps.some((s) => (s.fields ?? []).length > 0)

  // Page order: overview, [license], [inputs]. Built once from what exists.
  const pages = useMemo(() => {
    const p: Array<'overview' | 'license' | 'inputs'> = ['overview']
    if (hasLicense) p.push('license')
    if (hasInputs) p.push('inputs')
    return p
  }, [hasLicense, hasInputs])

  const [pageIdx, setPageIdx] = useState(0)
  const [accepted, setAccepted] = useState(false)
  const [values, setValues] = useState<Record<string, unknown>>(() => defaultsFor(steps))

  const page = pages[pageIdx]
  const isLast = pageIdx === pages.length - 1
  const canAdvance = page !== 'license' || accepted

  const setField = (id: string, v: unknown) => setValues((prev) => ({ ...prev, [id]: v }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
        <header className="border-b border-slate-800 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-100">
            Install {meta.name}
            <span className="ml-2 text-xs font-normal text-slate-500">one-time setup</span>
          </h2>
          <div className="mt-1 text-[11px] text-slate-500">
            Step {pageIdx + 1} of {pages.length}
          </div>
        </header>

        <div className="flex-1 overflow-auto px-5 py-4 text-sm text-slate-300">
          {page === 'overview' && (
            <div className="space-y-3">
              <p>
                <span className="font-medium text-slate-200">{meta.name}</span> needs a one-time
                install of its dependencies before an instance can run. This happens once for this
                service type and is shared by every instance you create.
              </p>
              {meta.description && (
                <p className="rounded bg-slate-800/50 p-2 text-xs text-slate-400">{meta.description}</p>
              )}
              <p className="text-xs text-slate-500">
                You can watch detailed progress (and retry on failure) after you start the install.
              </p>
            </div>
          )}

          {page === 'license' && (
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-wider text-slate-500">License / notice</p>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-3 font-mono text-[11px] leading-snug text-slate-300">
                {meta.license}
              </pre>
              <label className="flex items-start gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                  className="mt-0.5"
                />
                <span>I have read and accept the above for my deployment.</span>
              </label>
            </div>
          )}

          {page === 'inputs' && (
            <div className="space-y-4">
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
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-slate-800 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200"
          >
            Cancel
          </button>
          <div className="flex gap-2">
            {pageIdx > 0 && (
              <button
                type="button"
                onClick={() => setPageIdx((i) => i - 1)}
                className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:border-slate-500"
              >
                Back
              </button>
            )}
            {!isLast ? (
              <button
                type="button"
                disabled={!canAdvance}
                onClick={() => setPageIdx((i) => i + 1)}
                className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                disabled={!canAdvance}
                onClick={() => onConfirm(values)}
                className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
              >
                Install &amp; start
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}

export function FieldInput({
  field,
  value,
  onChange,
}: {
  field: WizardField
  value: unknown
  onChange: (v: unknown) => void
}) {
  const label = field.title ?? field.id
  if (field.type === 'boolean') {
    return (
      <label className="flex items-start gap-2 text-xs text-slate-300">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
        <span>{label}</span>
      </label>
    )
  }
  if (field.type === 'select' && field.options) {
    return (
      <label className="block text-xs text-slate-300">
        <span className="mb-1 block">{label}</span>
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100"
        >
          {field.options.map((o) => {
            const val = typeof o === 'string' ? o : o.value
            const lab = typeof o === 'string' ? o : o.label ?? o.value
            return <option key={val} value={val}>{lab}</option>
          })}
        </select>
      </label>
    )
  }
  const numeric = field.type === 'integer' || field.type === 'number'
  const inputType = field.type === 'password' ? 'password' : numeric ? 'number' : 'text'
  return (
    <label className="block text-xs text-slate-300">
      <span className="mb-1 block">{label}</span>
      {field.description && <span className="mb-1 block text-[10px] text-slate-500">{field.description}</span>}
      <input
        type={inputType}
        autoComplete={field.type === 'password' ? 'new-password' : undefined}
        value={String(value ?? '')}
        onChange={(e) => onChange(numeric ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
        className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100"
      />
    </label>
  )
}
