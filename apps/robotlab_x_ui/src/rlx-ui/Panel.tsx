// Seed of the @rlx/ui component kit. Uses utility classes already present
// in the host's compiled CSS so a dynamically-loaded view inherits styling
// (see docs/TODO_SERVICE_UI_BUNDLES.md — styling-by-inheritance).
import type { ReactNode } from 'react'

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded border border-slate-800 bg-slate-900/40 p-3 text-xs text-slate-200">
      {title && (
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
      )}
      {children}
    </section>
  )
}
