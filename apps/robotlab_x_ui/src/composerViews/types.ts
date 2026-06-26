// Public contract for a Composer view shape.
//
// One file per shape lives in this directory; ``index.ts`` collects
// them into a registry. Adding a new shape is exactly two steps:
//
//   1. Create ``composerViews/<id>.tsx`` default-exporting a
//      ``ComposerViewDefinition``.
//   2. Add the import to ``composerViews/index.ts``'s array.
//
// The kebab menu (``NodeViewMenu`` in Composer.tsx), the proxy-node
// dispatcher, and the resize/persistence path all read this contract
// — no other file should hardcode a list of view ids.
import type { ComponentType } from 'react'
import type { ServiceProxy } from '../models/ServiceProxy'


/** Action keys understood by the page-level ``onAction`` dispatcher.
 *  Re-declared here (instead of imported from Composer) so view files
 *  don't depend on the page they render under. */
// 'configure_service' is a UI-only pseudo-action (not a backend service
// request): the page handles it by opening the per-instance config wizard.
export type ProxyAction = 'start_service' | 'stop_service' | 'release_service' | 'configure_service'


/** Props every view shape's component receives. The page wires these
 *  through ``data.onViewChange`` / ``data.onAction`` on the React
 *  Flow node. */
export interface ComposerViewProps {
  /** The service-proxy record this node represents. */
  proxy: ServiceProxy
  /** React Flow's selection state. Most shapes highlight the border. */
  selected: boolean
  /** Switch this proxy to a different view id. The id MUST match one
   *  registered in this directory; the dispatcher normalises unknown
   *  values to the default. */
  onViewChange?: (proxyId: string, next: string) => void
  /** Page-level lifecycle dispatcher — only some shapes wire start /
   *  stop / release buttons (today: view_full). Optional so a shape
   *  can ignore it. */
  onAction?: (proxyId: string, action: ProxyAction) => void
  /** True when this proxy's type is a singleton (e.g. the runtime
   *  itself) — views hide Stop so the operator can't take the runtime
   *  down from the canvas. */
  isSingleton?: boolean
  /** True when this proxy's type declares per-instance config fields,
   *  so views can offer a Configure affordance. */
  configurable?: boolean
}


/** One entry in the registry. */
export interface ComposerViewDefinition {
  /** Stable string id. Persisted to ``Workspace.node_view_types`` and
   *  the value the kebab emits. e.g. ``"view_min"``, ``"view_full"``.
   *  Renaming an id is a breaking change for existing workspaces —
   *  add a new id and let normaliseComposerViewId() alias the old
   *  one if you need to migrate. */
  id: string

  /** Label shown in the kebab + window-style header buttons. */
  label: string

  /** Optional ordering hint for the kebab menu (ascending; default
   *  is array order in ``index.ts``). */
  order?: number

  /** The React component that renders the node body. Receives
   *  ``ComposerViewProps``. */
  Component: ComponentType<ComposerViewProps>

  /** When ``false`` (the default), switching to this view strips any
   *  stored width/height from the node + style so the next render
   *  measures to content. When ``true``, the dispatcher leaves them
   *  intact — used by resizable shapes like ``view_full`` that own
   *  their own NodeResizeControl handles. */
  preservesSize?: boolean

  /** Optional per-proxy filter — return false to omit this shape
   *  from the kebab for that specific proxy. Useful for shapes that
   *  only make sense on certain service types. The dispatcher still
   *  honours the shape if it's already stored on the node (so the
   *  rule changes are non-breaking); it only affects what the
   *  kebab OFFERS. */
  shouldOffer?: (proxy: ServiceProxy) => boolean
}
