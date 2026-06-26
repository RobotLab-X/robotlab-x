// Modal confirmation dialog — the in-app substitute for native
// ``window.confirm`` / ``window.alert``.
//
// Visual language matches ConnectDialog.tsx: slate-900 surface,
// slate-700 border, click-backdrop-to-cancel. Two variants:
//
//   * variant="danger"  — destructive action (Delete). Confirm button
//                          is rose.
//   * variant="default" — non-destructive (Switch, Apply, OK). Confirm
//                          button is emerald.
//
// Single-button "alert" mode: pass ``cancelLabel={null}`` to hide the
// cancel button and use the dialog as a one-button informational
// notice. ``onConfirm`` becomes the dismiss handler.
import { useEffect, type ReactNode } from 'react'


interface ConfirmDialogProps {
  /** Heading shown at the top of the dialog. */
  title: string
  /** Body text or React node. Plain strings render as a paragraph. */
  message: ReactNode
  /** Label for the confirm/primary button. Defaults to "OK". */
  confirmLabel?: string
  /** Label for the cancel button. Pass ``null`` to hide it
   * (turns the dialog into a single-button notice). */
  cancelLabel?: string | null
  /** ``danger`` = rose confirm button, used for destructive ops. */
  variant?: 'default' | 'danger'
  /** Disable the buttons while an inflight action is running. */
  busy?: boolean
  /** Fired when confirm is clicked. Caller decides whether to close. */
  onConfirm: () => void
  /** Fired on cancel / backdrop click / Escape. */
  onCancel: () => void
}


export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  variant = 'default',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // Escape closes the dialog. Bound once per mount; the listener
  // teardown runs on unmount.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [busy, onCancel])

  const confirmClass =
    variant === 'danger'
      ? 'bg-rose-700 hover:bg-rose-600'
      : 'bg-emerald-600 hover:bg-emerald-500'

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
        <div className="mb-4 text-[13px] text-slate-300">
          {typeof message === 'string' ? <p>{message}</p> : message}
        </div>
        <div className="flex justify-end gap-2">
          {cancelLabel !== null && (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded px-3 py-1 text-xs font-medium text-white ${confirmClass} disabled:opacity-40`}
          >
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
