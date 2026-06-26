// Registry of Composer node-view shapes. The kebab menu, the node
// dispatcher in Composer.tsx, and the resize-clear path in
// setNodeViewType all read this — nothing else hardcodes a list of
// view ids.
//
// ADD A NEW SHAPE in two steps:
//
//   1. Create ``composerViews/<id>.tsx`` default-exporting a
//      ``ComposerViewDefinition``. ``<id>`` should match the chosen
//      ``id`` field exactly.
//   2. Add the import + entry to ``ALL_VIEWS`` below.
//
// The Workspace.node_view_types schema is open-string at the backend
// — no migration needed when adding ids. Old workspaces using legacy
// strings (e.g. pre-rename ``"min"``) are normalised by
// ``normalizeComposerViewId``.
import type { ServiceProxy } from '../models/ServiceProxy'
import type { ComposerViewDefinition } from './types'

import viewMin from './view_min'
import viewNameAndType from './view_name_and_type'
import viewBasic from './view_basic'
import viewFull from './view_full'


/** All registered view shapes, in their preferred kebab order. New
 *  shapes are appended (or interleaved) here — no other code needs
 *  to change. */
const ALL_VIEWS: ComposerViewDefinition[] = [
  viewMin,
  viewNameAndType,
  viewBasic,
  viewFull,
]


/** The id used when a node has no stored view type. Must match an
 *  entry in ALL_VIEWS. ``view_min`` is the canonical default because
 *  it keeps a freshly-installed proxy from dominating the canvas. */
export const DEFAULT_VIEW_ID = 'view_min'


/** Stable map for O(1) id → definition lookups. */
const VIEW_BY_ID: Map<string, ComposerViewDefinition> = new Map(
  ALL_VIEWS.map((v) => [v.id, v]),
)


/** Legacy id aliases. Workspaces persisted before the
 *  view_* rename used ``"min"`` / ``"name_and_type"``. We accept
 *  them silently so old DB rows keep working. Add new entries here
 *  rather than the definition file when renaming an id. */
const LEGACY_ID_ALIAS: Record<string, string> = {
  min: 'view_min',
  name_and_type: 'view_name_and_type',
  full: 'view_full',
}


/** Coerce a stored value into a known view id. Unknown values fall
 *  back to DEFAULT_VIEW_ID so a typo in node_view_types can't crash
 *  the dispatcher. */
export function normalizeComposerViewId(v: unknown): string {
  if (typeof v !== 'string') return DEFAULT_VIEW_ID
  if (VIEW_BY_ID.has(v)) return v
  const aliased = LEGACY_ID_ALIAS[v]
  if (aliased && VIEW_BY_ID.has(aliased)) return aliased
  return DEFAULT_VIEW_ID
}


/** Return the definition for an id, or undefined when none matches. */
export function getComposerView(id: string): ComposerViewDefinition | undefined {
  return VIEW_BY_ID.get(id)
}


/** The shapes a given proxy should see in its kebab. Applies the
 *  optional ``shouldOffer`` filter per definition (default = always
 *  offered) and sorts by ``order`` ascending with array order as a
 *  tiebreak. */
export function offeredViewsFor(proxy: ServiceProxy): ComposerViewDefinition[] {
  const visible = ALL_VIEWS.filter((v) => v.shouldOffer ? v.shouldOffer(proxy) : true)
  // Stable sort: keep array order as tiebreak when ``order`` is equal
  // or undefined. Array.prototype.sort is stable in V8 since 2018.
  return [...visible].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}


// ─── Origin tracking ────────────────────────────────────────────────
//
// Min and Full are the two guaranteed "anchor" shapes — every node
// has them. Other shapes (Name & type, Basic, future per-service
// shapes) may or may not be in the kebab.
//
// Double-click contract:
//   * On Min title  → promote to Full
//   * On any non-Full shape's title → promote to Full
//   * On Full title → go BACK to whichever shape we were in just
//                     before being promoted (the "origin")
//
// The origin is recorded by ``setNodeViewType`` in Composer.tsx the
// moment a node enters Full, and replayed by view_full.tsx's
// double-click handler. Persisted via localStorage keyed by proxy id
// so the back-target survives a page refresh — same pattern as the
// existing ``rlx-node-maximized-*`` flag.
const ORIGIN_STORAGE_KEY_PREFIX = 'rlx-node-origin-'

/** Stamp a back-target so a later promotion → Full can find its way
 *  home. ``viewId`` should be the view the node was in just BEFORE
 *  entering Full. No-op if ``viewId`` is Full itself (would create a
 *  self-loop) or unknown to the registry. */
export function setOriginView(proxyId: string, viewId: string): void {
  if (!proxyId || viewId === 'view_full') return
  if (!VIEW_BY_ID.has(viewId)) return
  try {
    localStorage.setItem(ORIGIN_STORAGE_KEY_PREFIX + proxyId, viewId)
  } catch {
    // Quota / private-mode / disabled storage — non-fatal. The
    // double-click on Full will fall back to DEFAULT_VIEW_ID.
  }
}

/** Read the back-target for ``proxyId``. Returns DEFAULT_VIEW_ID
 *  when nothing's been stored OR when the stored value is no longer
 *  a registered view id (e.g. a shape was removed from the
 *  registry). */
export function getOriginView(proxyId: string): string {
  if (!proxyId) return DEFAULT_VIEW_ID
  try {
    const v = localStorage.getItem(ORIGIN_STORAGE_KEY_PREFIX + proxyId)
    if (v && VIEW_BY_ID.has(v)) return v
  } catch {
    // localStorage unavailable — fall through to default.
  }
  return DEFAULT_VIEW_ID
}
