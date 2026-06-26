// The "switch view" kebab. Iterates the registry — adding a new
// view file in this directory automatically extends the menu.
//
// Lives in this directory (not in Composer.tsx) because every shape
// renders it on its own title bar and we want a single source of
// truth for the menu UX.
//
// Also hosts the "Open in window" action (the undock affordance). It
// pops the current view out into a chrome-less browser window
// (DockView at /r/:runtimeId/dock/:proxyId), preserving the view shape
// via a ``?view=`` query param so a min stays min, a basic stays
// basic, etc. Available on every view's kebab; suppressed inside the
// dock window itself (showPopOut={false}).
import { useEffect, useRef, useState } from 'react'
import { ExternalLink, MoreVertical } from 'lucide-react'

import type { ServiceProxy } from '../models/ServiceProxy'
import { offeredViewsFor } from './index'
import { useActiveRuntimeOptional } from '../contexts/ActiveRuntimeContext'
import { useInDock } from '../contexts/DockContext'


export function NodeViewMenu({
  proxy,
  current,
  onChange,
  showPopOut = true,
}: {
  proxy: ServiceProxy
  current: string
  onChange?: (proxyId: string, next: string) => void
  /** Render the "Open in window" item. Default true; the dock window
   *  passes false (popping a dock view out of a dock window is a
   *  no-op worth avoiding). */
  showPopOut?: boolean
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const activeRuntime = useActiveRuntimeOptional()
  const inDock = useInDock()
  // Close only when the mousedown lands OUTSIDE the menu wrapper. The
  // previous version closed on every document mousedown — which fired
  // before the menu item's click event resolved, unmounting the item
  // and swallowing the click.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as globalThis.Node | null
      if (target && wrapRef.current && wrapRef.current.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  const proxyId = proxy.id ?? proxy.name ?? ''
  const options = offeredViewsFor(proxy)
  const runtimeId = activeRuntime?.runtimeId
  // Pop out preserving the CURRENT view shape. Window NAME keyed by
  // proxy id so re-clicking focuses the existing window rather than
  // spawning a duplicate.
  const onPopOut = () => {
    if (!runtimeId || !proxyId) return
    const url =
      `/r/${encodeURIComponent(runtimeId)}/dock/${encodeURIComponent(proxyId)}` +
      `?view=${encodeURIComponent(current)}`
    window.open(
      url,
      `rlx-dock-${proxyId}`,
      'popup=yes,width=480,height=680,menubar=no,toolbar=no,location=no,status=no',
    )
    setOpen(false)
  }
  const canPopOut = showPopOut && !inDock && !!runtimeId && !!proxyId
  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-label="Switch node view"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        className="nodrag nopan rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 min-w-[160px] overflow-hidden rounded border border-slate-700 bg-slate-900 text-xs shadow-xl">
          {options.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onChange?.(proxyId, id); setOpen(false) }}
              className={
                id === current
                  ? 'nodrag nopan block w-full px-3 py-1.5 text-left font-medium text-sky-300 bg-slate-800'
                  : 'nodrag nopan block w-full px-3 py-1.5 text-left text-slate-200 hover:bg-slate-800'
              }
            >
              {label}
            </button>
          ))}
          {canPopOut && (
            <>
              <div className="my-0.5 border-t border-slate-700" />
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onPopOut() }}
                className="nodrag nopan flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-slate-200 hover:bg-slate-800"
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                Open in window
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
