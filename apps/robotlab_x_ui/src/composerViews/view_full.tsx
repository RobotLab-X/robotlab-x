// view_full — the resizable panel container. Delegates the body
// content to the service-type-specific component registered in
// ``serviceViews/index.ts``; everything else (title strip, lifecycle
// buttons, maximize-to-canvas portal, edge + corner resize handles)
// lives here.
//
// Extracted from Composer.tsx — formerly the inline
// ``ProxyNodeFullView`` function. ``preservesSize: true`` on the
// definition tells the page-level dispatcher to keep any stored
// width/height on this view (the other shapes content-size).
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { NodeResizeControl, ResizeControlVariant } from '@xyflow/react'
import { FolderInput, Hexagon, Loader2, Maximize2, Minimize2, Minus, Play, Save, Square, X } from 'lucide-react'

import { ServiceIcon, STATUS_DOT, metaNameFromId, metaVersionFromId } from './_shared'
import { NodeViewMenu } from './_NodeViewMenu'
import { getOriginView } from './index'
import { getFullView } from '../serviceViews'
import { DynamicServiceView } from '../serviceViews/DynamicServiceView'
import { useApiFetch } from '../contexts/ActiveRuntimeContext'
import type { ComposerViewDefinition, ComposerViewProps } from './types'


function ProxyNodeFullView({ proxy, selected, onViewChange, onAction, isSingleton }: ComposerViewProps) {
  const status = proxy.status ?? 'stopped'
  // Compact status dot — same colour grammar as view_min. The verbose
  // pill we used before crowded the title bar once we added action
  // icons; a single dot conveys the same information at a glance.
  const dot = STATUS_DOT[status] ?? STATUS_DOT.stopped
  const isRunning = status === 'running'
  // Look up the service-type-specific UI by service_meta_id. Service
  // types without a registered full view fall back to a placeholder.
  const View = getFullView(proxy.service_meta_id)
  // Only the title strip is the drag handle / double-click target. The
  // body below it contains the service's own UI (sliders, dropdowns,
  // forms) which mustn't toggle or initiate drag on double-click.
  const proxyId = proxy.id ?? proxy.name ?? ''
  // Double-click goes BACK to whichever shape the node was in just
  // before being promoted to Full — recorded by setNodeViewType in
  // Composer.tsx at promotion time, persisted in localStorage. Falls
  // back to view_min when nothing's been stamped (matches the
  // pre-origin-tracking default). The Minus button in the title's
  // window-style trio remains a deliberate "to Min" shortcut
  // independent of this back-target.
  const onTitleDoubleClick = () => {
    onViewChange?.(proxyId, getOriginView(proxyId))
  }
  const onStart = (e: ReactMouseEvent) => { e.stopPropagation(); onAction?.(proxyId, 'start_service') }
  const onStop = (e: ReactMouseEvent) => { e.stopPropagation(); onAction?.(proxyId, 'stop_service') }
  const onRelease = (e: ReactMouseEvent) => { e.stopPropagation(); onAction?.(proxyId, 'release_service') }

  // Save this service's config to its yml in the active config set.
  // Backed by ``POST /v1/system/save-config/{proxy_id}`` (per-proxy
  // counterpart to the system-wide save). saveState drives the icon
  // feedback: 'idle' renders the Save icon, 'saving' shows a spinner,
  // 'ok' flashes a green tick for 1.2s, 'err' flashes a red tick.
  const apiFetch = useApiFetch()
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'ok' | 'err'>('idle')
  const [saveDetail, setSaveDetail] = useState<string | null>(null)
  const onSave = async (e: ReactMouseEvent) => {
    e.stopPropagation()
    if (saveState === 'saving' || !proxyId) return
    setSaveState('saving')
    setSaveDetail(null)
    try {
      const r = await apiFetch<{
        ok?: boolean
        yml_path?: string
        set_name?: string
        skipped?: string
        error?: string
      }>(`/v1/system/save-config/${encodeURIComponent(proxyId)}`, { method: 'POST' })
      if (r?.ok) {
        setSaveState('ok')
        setSaveDetail(r.yml_path ?? r.set_name ?? null)
      } else {
        setSaveState('err')
        setSaveDetail(r?.error ?? r?.skipped ?? 'save failed')
      }
    } catch (err) {
      setSaveState('err')
      setSaveDetail(err instanceof Error ? err.message : String(err))
    } finally {
      // Auto-reset the indicator. Errors linger slightly longer so
      // they're noticeable.
      const hold = saveStateRef.current === 'err' ? 2500 : 1200
      setTimeout(() => setSaveState('idle'), hold)
    }
  }
  // Pinning saveState in a ref for the setTimeout above — closures
  // would otherwise capture the value at call time and prematurely
  // shorten the error display window.
  const saveStateRef = useRef<'idle' | 'saving' | 'ok' | 'err'>('idle')
  useEffect(() => { saveStateRef.current = saveState }, [saveState])

  // Load (apply) this service's yml from disk into the LIVE service —
  // the inverse of Save. Backed by ``POST /v1/system/reload-config/
  // {proxy_id}``: the operator hand-edits <set>/<proxy_id>.yml while the
  // system runs, then clicks this to push the change in without a
  // restart. loadState drives the icon feedback the same way saveState
  // does for the Save button.
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle')
  const [loadDetail, setLoadDetail] = useState<string | null>(null)
  const loadStateRef = useRef<'idle' | 'loading' | 'ok' | 'err'>('idle')
  useEffect(() => { loadStateRef.current = loadState }, [loadState])
  const onLoad = async (e: ReactMouseEvent) => {
    e.stopPropagation()
    if (loadState === 'loading' || !proxyId) return
    setLoadState('loading')
    setLoadDetail(null)
    try {
      const r = await apiFetch<{
        ok?: boolean
        applied_via?: string
        set_name?: string
        skipped?: string
        error?: string
      }>(`/v1/system/reload-config/${encodeURIComponent(proxyId)}`, { method: 'POST' })
      if (r?.ok) {
        setLoadState('ok')
        setLoadDetail(r.applied_via ?? r.set_name ?? null)
      } else {
        setLoadState('err')
        setLoadDetail(r?.error ?? r?.skipped ?? 'load failed')
      }
    } catch (err) {
      setLoadState('err')
      setLoadDetail(err instanceof Error ? err.message : String(err))
    } finally {
      const hold = loadStateRef.current === 'err' ? 2500 : 1200
      setTimeout(() => setLoadState('idle'), hold)
    }
  }

  // Maximize-to-canvas. When maximized, the panel renders via a
  // portal into the ``.react-flow`` root container so it escapes the
  // viewport's pan/zoom transform and fills the visible canvas area.
  // The node's slot in the flow stays present (invisible) so
  // ReactFlow keeps the node in its nodes array and we can snap
  // back to the same position on restore.
  //
  // Persisted via localStorage keyed by proxy_id so the maximize
  // state survives page refresh.
  const MAX_KEY = `rlx-node-maximized-${proxyId}`
  const [isMaximized, setIsMaximized] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MAX_KEY) === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      if (isMaximized) localStorage.setItem(MAX_KEY, '1')
      else localStorage.removeItem(MAX_KEY)
    } catch {
      // Quota / private-mode / disabled storage — non-fatal, just
      // means the state won't survive refresh for this user.
    }
  }, [MAX_KEY, isMaximized])
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!isMaximized) {
      setPortalTarget(null)
      return
    }
    // Wait a microtask so the anchor div is mounted (matters when the
    // page rehydrates with isMaximized=true on first render —
    // anchorRef isn't attached until React paints the placeholder).
    let cancelled = false
    const find = () => {
      if (cancelled) return
      const flow = anchorRef.current?.closest('.react-flow') as HTMLElement | null
      if (flow) {
        setPortalTarget(flow)
      } else {
        // anchorRef not in the DOM yet — try again next tick.
        setTimeout(find, 16)
      }
    }
    find()
    return () => { cancelled = true }
  }, [isMaximized])
  // Escape restores from maximized — matches usual full-screen UX.
  useEffect(() => {
    if (!isMaximized) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMaximized(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isMaximized])
  const onToggleMaximize = (e: ReactMouseEvent) => {
    e.stopPropagation()
    setIsMaximized((prev) => !prev)
  }

  const titleBar = (
    <div
      onDoubleClick={isMaximized ? undefined : onTitleDoubleClick}
      className={`flex shrink-0 items-center justify-between gap-2 border-b border-slate-800 px-3 py-2 ${
        isMaximized ? 'cursor-default' : 'rlx-drag-handle cursor-grab'
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <ServiceIcon
          name={metaNameFromId(proxy.service_meta_id)}
          version={metaVersionFromId(proxy.service_meta_id)}
          className="h-4 w-4 shrink-0"
        />
        <span className="truncate font-mono text-xs text-slate-200">
          {proxy.name ?? proxy.id}
        </span>
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${dot}`}
          title={status}
          aria-label={`status: ${status}`}
        />
        {/* Actions — context-sensitive:
            • running  → Stop (hexagon)
            • not running → Release (X) + Start (play), in that order
              (X sits to the LEFT of the play triangle). Start is
              a no-op for stopped services that have never been
              installed; the backend handles re-install gracefully.
            We render exactly one or the other set so the bar isn't
            cluttered with always-disabled affordances. */}
        {isRunning ? (
          // Singletons (the runtime itself) can't be stopped from the
          // canvas — render nothing so there's no Stop affordance.
          isSingleton ? null : (
          <button
            type="button"
            onClick={onStop}
            onPointerDown={(e) => e.stopPropagation()}
            title="Stop service"
            className="nodrag nopan rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-rose-500"
          >
            {/* Rotated 30°: a hexagon is 60°-symmetric, so 60° was a no-op
                (vertex still pointing down). 30° reorients it to flat
                top/bottom edges. */}
            <Hexagon className="h-3.5 w-3.5 rotate-[30deg]" />
          </button>
          )
        ) : (
          <>
            <button
              type="button"
              onClick={onRelease}
              onPointerDown={(e) => e.stopPropagation()}
              title="Release (delete) — removes the service proxy + node"
              className="nodrag nopan rounded p-1 text-slate-400 hover:bg-rose-900/40 hover:text-rose-300"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onStart}
              onPointerDown={(e) => e.stopPropagation()}
              title="Start service"
              className="nodrag nopan rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-emerald-300"
            >
              <Play className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
      {/* View controls — top-right window-style trio: minimize to pill,
          panel (current), maximize to canvas. The "panel" icon shows
          as active when the node is in view_full and NOT canvas-
          maximized; the canvas-max icon shows as active when
          isMaximized. Clicking the same icon as the current state is
          a no-op. */}
      <div className="flex shrink-0 items-center gap-0.5">
        {/* Load — re-reads this proxy's yml from the active config set
            and applies it to the live service (inverse of Save). For
            hand-editing a running service's yml without a restart. */}
        <button
          type="button"
          onClick={onLoad}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={loadState === 'loading'}
          title={
            loadState === 'loading' ? 'Loading config from yml…'
            : loadState === 'ok' ? `Applied${loadDetail ? ` (${loadDetail})` : ''}`
            : loadState === 'err' ? `Load failed${loadDetail ? `: ${loadDetail}` : ''}`
            : 'Load config from yml in the active config set + apply to the live service'
          }
          className={`nodrag nopan rounded p-1 hover:bg-slate-800 ${
            loadState === 'ok' ? 'text-emerald-300'
              : loadState === 'err' ? 'text-rose-300'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {loadState === 'loading'
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <FolderInput className="h-3.5 w-3.5" />}
        </button>
        {/* Save — writes this proxy's config to <set>/<proxy_id>.yml
            in the active config set. Lives directly to the left of
            the window-style trio so the operator's eye finds it next
            to the other lifecycle/view affordances. */}
        <button
          type="button"
          onClick={onSave}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={saveState === 'saving'}
          title={
            saveState === 'saving' ? 'Saving config…'
            : saveState === 'ok' ? `Saved${saveDetail ? ` → ${saveDetail}` : ''}`
            : saveState === 'err' ? `Save failed${saveDetail ? `: ${saveDetail}` : ''}`
            : 'Save config to yml in the active config set'
          }
          className={`nodrag nopan rounded p-1 hover:bg-slate-800 ${
            saveState === 'ok' ? 'text-emerald-300'
              : saveState === 'err' ? 'text-rose-300'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {saveState === 'saving'
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Save className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onViewChange?.(proxyId, 'view_min') }}
          onPointerDown={(e) => e.stopPropagation()}
          title="Minimize to pill"
          className="nodrag nopan rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            if (isMaximized) setIsMaximized(false)
            onViewChange?.(proxyId, 'view_full')
          }}
          onPointerDown={(e) => e.stopPropagation()}
          title="Panel view"
          className={`nodrag nopan rounded p-1 hover:bg-slate-800 ${
            !isMaximized ? 'bg-slate-800 text-sky-300' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Square className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onToggleMaximize}
          onPointerDown={(e) => e.stopPropagation()}
          title={isMaximized ? 'Restore (Esc)' : 'Maximize to canvas'}
          className={`nodrag nopan rounded p-1 hover:bg-slate-800 ${
            isMaximized ? 'bg-slate-800 text-sky-300' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
        {/* Kebab — every view shape carries one so the operator can
            cross to ANY other shape without having to bounce through
            Min first. The window-style trio above is shortcuts for
            the three most common transitions; the kebab covers
            everything else the registry offers (Basic for servo,
            future per-service shapes). */}
        <NodeViewMenu proxy={proxy} current="view_full" onChange={onViewChange} />
      </div>
    </div>
  )

  // View body fills whatever's left after the title — flex-1 +
  // overflow-auto so any content (CLI's xterm, video preview's
  // MJPEG, dense forms) gets the resized space and scrolls when it
  // can't shrink further.
  const body = (
    <div className="min-h-0 flex-1 overflow-auto select-text">
      {View ? (
        // Static-first: a compiled serviceViews component wins.
        <View proxy={proxy} />
      ) : (
        // Else try a modular UI bundle shipped with the service
        // (Option B); 404 / load error degrades to the placeholder.
        <DynamicServiceView
          proxy={proxy}
          fallback={
            <div className="p-3 text-xs text-slate-500">
              No full view registered for{' '}
              <span className="font-mono text-slate-400">{proxy.service_meta_id}</span>.
            </div>
          }
        />
      )}
    </div>
  )

  if (isMaximized && portalTarget) {
    return (
      <>
        {/* Anchor stays in the flow at the node's bounding box so
            ReactFlow keeps measuring + tracking this node while the
            real UI is portal'd elsewhere. */}
        <div
          ref={anchorRef}
          className="h-full min-h-[120px] w-full min-w-[280px]"
          style={{ visibility: 'hidden' }}
        />
        {createPortal(
          <div className="pointer-events-auto absolute inset-0 z-50 flex flex-col rounded border-2 border-sky-400 bg-slate-900 shadow-2xl">
            {titleBar}
            {body}
          </div>,
          portalTarget,
        )}
      </>
    )
  }

  return (
    <div
      ref={anchorRef}
      // ``cursor-default`` overrides React Flow's ``.react-flow__node``
      // which sets ``cursor: grab`` on the entire node. Without this
      // the body of the panel shows a grab cursor everywhere — only
      // the title bar should be grabbable (it has its own
      // ``cursor-grab`` to opt back in). The portal-maximised path
      // dodges this because it renders outside the .react-flow__node
      // wrapper.
      className={`flex h-full min-h-[120px] w-full min-w-[280px] cursor-default flex-col rounded border bg-slate-900/95 shadow-lg ${
        selected ? 'border-sky-400' : 'border-slate-700'
      }`}
    >
      {/* Resize controls — matches Ubuntu/GNOME window manager
          behaviour: drag any edge to resize that one dimension, OR
          drag the bottom-right corner to resize diagonally. The
          other three corners are deliberately absent — they're
          awkward (especially top-left, which has to move x/y AND
          change w/h, prone to desync) and Ubuntu's WM doesn't show
          them either.

          Five handles:
            bottom-right corner — diagonal (width + height + position
              stays put). Visible chevron because diagonal-resize is
              the less obvious gesture.
            4 edges — perpendicular drag, transparent hit strips with
              the right cursor (col-resize / row-resize). Operator
              sees the cursor change on hover; no visual clutter.

          Only rendered when the node is selected so the canvas stays
          clean at rest (Figma/Miro convention). */}
      {selected && (
        <>
          <NodeResizeControl
            position="bottom-right"
            minWidth={280}
            minHeight={160}
            style={{ background: 'transparent', border: 'none', width: 16, height: 16 }}
          >
            <svg viewBox="0 0 16 16" className="pointer-events-none">
              <path d="M 16 6 L 6 16 M 16 11 L 11 16 M 16 15 L 15 16" stroke="#22d3ee" strokeWidth="1.5" fill="none" />
            </svg>
          </NodeResizeControl>

          {/* Edges use ``variant="line"`` so the handle spans the
              entire edge (default variant is a 5×5 dot at the edge
              midpoint — too small to hit, no cursor on the rest of
              the border). The library's CSS already wires the right
              cursor per edge: ``ns-resize`` on top/bottom and
              ``ew-resize`` on left/right (the two-arrow indicators
              the operator expects). Override style only thickens the
              hit area (~8px) and zeros out the visible border line. */}
          <NodeResizeControl
            position="top"
            variant={ResizeControlVariant.Line}
            minWidth={280}
            minHeight={160}
            style={{ background: 'transparent', border: 'none', height: 8 }}
          />
          <NodeResizeControl
            position="bottom"
            variant={ResizeControlVariant.Line}
            minWidth={280}
            minHeight={160}
            style={{ background: 'transparent', border: 'none', height: 8 }}
          />
          <NodeResizeControl
            position="left"
            variant={ResizeControlVariant.Line}
            minWidth={280}
            minHeight={160}
            style={{ background: 'transparent', border: 'none', width: 8 }}
          />
          <NodeResizeControl
            position="right"
            variant={ResizeControlVariant.Line}
            minWidth={280}
            minHeight={160}
            style={{ background: 'transparent', border: 'none', width: 8 }}
          />
        </>
      )}
      {titleBar}
      {body}
    </div>
  )
}


const definition: ComposerViewDefinition = {
  id: 'view_full',
  label: 'Full',
  order: 2,
  Component: ProxyNodeFullView,
  // The ONLY shape today that wants its persisted width/height kept
  // when the user re-enters it — every other shape content-sizes.
  preservesSize: true,
}
export default definition
