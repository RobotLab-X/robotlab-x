// view_min — compact pill. The default for new nodes; the whole
// pill is the drag handle and a double-click promotes to view_full.
//
// Extracted from Composer.tsx — the inline ProxyNodeMin function
// moved here unchanged so the kebab can be a registry-driven menu.
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Play, Square, Settings } from 'lucide-react'
import { ServiceIcon, STATUS_DOT, metaNameFromId, metaVersionFromId } from './_shared'
import { NodeViewMenu } from './_NodeViewMenu'
import type { ComposerViewDefinition, ComposerViewProps } from './types'


function ProxyNodeMin({ proxy, selected, onViewChange, onAction, isSingleton, configurable }: ComposerViewProps) {
  const status = proxy.status ?? 'stopped'
  const dot = STATUS_DOT[status] ?? STATUS_DOT.stopped
  const proxyId = proxy.id ?? proxy.name ?? ''
  // A dropped placeholder (and any stopped/installed/errored instance) shows
  // a Play button next to its grey light — Start kicks off the install
  // wizard / launch — plus a Configure gear (if the type has settings) so
  // the operator can configure BEFORE starting. A running instance shows
  // Stop, except singletons (the runtime itself) which mustn't be stopped
  // from the canvas. Transient states (installing/starting/stopping) show
  // neither — the next bus event resolves them in milliseconds.
  const isRunning = status === 'running'
  const startable = status === 'placeholder' || status === 'installed' || status === 'stopped' || status === 'error'
  const onStart = (e: ReactMouseEvent) => { e.stopPropagation(); onAction?.(proxyId, 'start_service') }
  const onStop = (e: ReactMouseEvent) => { e.stopPropagation(); onAction?.(proxyId, 'stop_service') }
  const onConfigure = (e: ReactMouseEvent) => { e.stopPropagation(); onAction?.(proxyId, 'configure_service') }
  // Min mode is all title bar — the whole pill is draggable + double-click
  // toggles up to the full view. Class ``rlx-drag-handle`` matches the
  // node object's dragHandle selector, so React Flow restricts
  // drag-initiation to elements carrying it.
  const onTitleDoubleClick = () => {
    onViewChange?.(proxyId, 'view_full')
  }
  return (
    <div
      onDoubleClick={onTitleDoubleClick}
      className={`rlx-drag-handle flex min-w-[140px] cursor-grab items-center gap-2 rounded-full border bg-slate-900/95 px-3 py-1.5 shadow-lg ${
        selected ? 'border-sky-400' : 'border-slate-700'
      }`}
    >
      <ServiceIcon
        name={metaNameFromId(proxy.service_meta_id)}
        version={metaVersionFromId(proxy.service_meta_id)}
        className="h-4 w-4 shrink-0"
      />
      <span className="truncate text-xs font-medium text-slate-100" title={status}>
        {proxy.name ?? proxy.id}
      </span>
      {startable && configurable && (
        <button
          type="button"
          onClick={onConfigure}
          onPointerDown={(e) => e.stopPropagation()}
          title="Configure (before starting)"
          aria-label="Configure service"
          className="nodrag nopan shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-sky-300"
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
      )}
      {startable && (
        <button
          type="button"
          onClick={onStart}
          onPointerDown={(e) => e.stopPropagation()}
          title={status === 'placeholder' ? 'Install & start' : 'Start'}
          aria-label="Start service"
          className="nodrag nopan shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-emerald-300"
        >
          <Play className="h-3.5 w-3.5" />
        </button>
      )}
      {isRunning && !isSingleton && (
        <button
          type="button"
          onClick={onStop}
          onPointerDown={(e) => e.stopPropagation()}
          title="Stop"
          aria-label="Stop service"
          className="nodrag nopan shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-amber-300"
        >
          <Square className="h-3.5 w-3.5" />
        </button>
      )}
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${dot}`}
        title={status}
        aria-label={`status: ${status}`}
      />
      <NodeViewMenu
        proxy={proxy}
        current="view_min"
        onChange={onViewChange}
      />
    </div>
  )
}


const definition: ComposerViewDefinition = {
  id: 'view_min',
  label: 'Min',
  order: 0,
  Component: ProxyNodeMin,
  preservesSize: false,
}
export default definition
