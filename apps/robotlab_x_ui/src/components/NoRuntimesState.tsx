import { useState } from 'react'
import { ConnectDialog } from './ConnectDialog'
import { useNavigate } from 'react-router-dom'


/**
 * Empty-state page shown when the connections list is empty.
 *
 * Reached via the catch-all redirect in App.tsx when RedirectToActive
 * has no entries to redirect to. Single primary action: open the
 * connect dialog. No discovered-peers list — we don't have an active
 * runtime yet to learn peers from.
 */
export function NoRuntimesState() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-slate-950 p-6 text-slate-200">
      <div className="text-lg font-semibold">No runtimes connected</div>
      <div className="max-w-md text-center text-sm text-slate-400">
        Add a robotlab_x runtime to get started. You'll need its URL
        and credentials. Multiple runtimes can be connected at once —
        switch between them in the chip bar.
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
      >
        + Add a runtime
      </button>
      {open && (
        <ConnectDialog
          // Pre-fill with the SPA's origin as a convenience hint — the
          // user can change it. This is *visual* hint only; nothing is
          // created until they click Connect.
          initialUrl={typeof window !== 'undefined' ? window.location.origin : ''}
          onClose={() => setOpen(false)}
          onConnected={(id) => {
            navigate(`/r/${encodeURIComponent(id)}/workspaces/runtime`)
          }}
        />
      )}
    </div>
  )
}
