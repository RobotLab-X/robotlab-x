// Modal text-input dialog — the in-app substitute for native
// ``window.prompt``.
//
// Same visual language as ConfirmDialog / ConnectDialog. Submits on
// Enter, cancels on Escape or backdrop click. The submit handler
// receives the trimmed input; empty inputs trigger the validation
// banner instead of submitting.
import { useEffect, useRef, useState, type FormEvent } from 'react'


interface PromptDialogProps {
  title: string
  /** Sub-heading / explainer above the input. */
  message?: string
  label: string
  placeholder?: string
  initialValue?: string
  submitLabel?: string
  /** Validation function. Return null for valid; return an error
   * string to show inline + block submit. */
  validate?: (value: string) => string | null
  busy?: boolean
  /** Fired with the trimmed input value. */
  onSubmit: (value: string) => void
  onCancel: () => void
}


export function PromptDialog({
  title,
  message,
  label,
  placeholder,
  initialValue = '',
  submitLabel = 'OK',
  validate,
  busy = false,
  onSubmit,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Live validation (VS Code-style): re-check on every keystroke so the
  // operator sees a collision/format error AND a disabled OK button
  // immediately, not only after pressing Enter. Empty input just blocks
  // submit without nagging until they've typed something.
  const trimmed = value.trim()
  const liveError = trimmed && validate ? validate(trimmed) : null
  const canSubmit = !!trimmed && !liveError && !busy

  // Autofocus the input on mount + select the seed value so the
  // operator can immediately replace it.
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // Escape cancels.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [busy, onCancel])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit(trimmed)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
      onClick={busy ? undefined : onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-4 text-sm text-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-2 text-base font-semibold">{title}</h2>
        {message && <p className="mb-3 text-[13px] text-slate-400">{message}</p>}
        <form onSubmit={submit} className="space-y-2">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-slate-400">{label}</span>
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              disabled={busy}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100 focus:border-slate-500 focus:outline-none disabled:opacity-40"
            />
          </label>
          {liveError && (
            <div className="rounded border border-rose-700 bg-rose-950/40 px-2 py-1 font-mono text-[11px] text-rose-200">
              {liveError}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded border border-slate-700 px-3 py-1 text-xs hover:border-slate-500 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? '…' : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
