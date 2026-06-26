// Cross-view helpers shared by every Composer node shape AND by the
// non-canvas pages (Inspector, palette previews) that need the same
// service-icon + status tone vocabulary.
//
// Centralising these here keeps the per-shape files thin and means
// adding a new view (composerViews/view_*.tsx) doesn't have to
// re-export a status-colour helper.
import { useState } from 'react'
import { Package } from 'lucide-react'


/** Human-readable display label for a service type: its ``title`` when
 *  set (free-form — spaces/casing allowed), else the ``name`` dir-key
 *  (the current behaviour). Accepts any record carrying those two fields
 *  (ServiceMeta, catalog rows) so both the Catalog page and the palette
 *  share one rule. */
export function serviceTitle(meta: { title?: string | null; name?: string | null } | null | undefined): string {
  const t = meta?.title?.trim()
  return t || meta?.name || ''
}

/** Pull the service-type name out of a ``name@version`` id. */
export function metaNameFromId(serviceMetaId: string | undefined | null): string | undefined {
  if (!serviceMetaId) return undefined
  const at = serviceMetaId.indexOf('@')
  return at >= 0 ? serviceMetaId.slice(0, at) : serviceMetaId
}

/** Pull the version off a ``name@version`` id. Returns undefined if
 *  the input has no ``@`` (e.g. unversioned legacy ids). */
export function metaVersionFromId(serviceMetaId: string | undefined | null): string | undefined {
  if (!serviceMetaId) return undefined
  const at = serviceMetaId.indexOf('@')
  return at >= 0 ? serviceMetaId.slice(at + 1) : undefined
}


/** Pill-shaped status colour vocabulary. Background + text in one
 *  Tailwind class so callers spread it on a single span. */
export const STATUS_TONE: Record<string, string> = {
  placeholder: 'bg-slate-700 text-slate-200',
  installed: 'bg-slate-700 text-slate-200',
  installing: 'bg-amber-700 text-amber-100',
  starting: 'bg-amber-700 text-amber-100',
  running: 'bg-emerald-700 text-emerald-100',
  stopping: 'bg-amber-700 text-amber-100',
  stopped: 'bg-slate-700 text-slate-200',
  error: 'bg-rose-700 text-rose-100',
}

/** Single-colour dot variant — same colour grammar as STATUS_TONE
 *  but just the dot. Used by compact views (Min, FullView title). */
export const STATUS_DOT: Record<string, string> = {
  placeholder: 'bg-slate-500',
  installed: 'bg-slate-500',
  installing: 'bg-amber-400',
  starting: 'bg-amber-400',
  running: 'bg-emerald-500',
  stopping: 'bg-amber-400',
  stopped: 'bg-slate-500',
  error: 'bg-rose-500',
}


interface ServiceIconProps {
  /** Service-type name (no version). */
  name?: string
  /** Service-type version. Required because the icon endpoint includes it. */
  version?: string
  /** Optional override of the default sizing class. */
  className?: string
}

/** Renders the service-type's icon from
 *  ``/repo/<name>/<version>/icon`` with a fall-back to a generic
 *  Package glyph when the icon endpoint 404s or either field is
 *  missing. The hue-rotate filter tints the SVG to match the rest
 *  of the chrome (sky-400-ish).
 */
export function ServiceIcon({ name, version, className }: ServiceIconProps) {
  const [failed, setFailed] = useState(false)
  if (!name || !version || failed) {
    return <Package className={className ?? 'h-4 w-4 text-sky-400'} />
  }
  return (
    <img
      src={`/repo/${encodeURIComponent(name)}/${encodeURIComponent(version)}/icon`}
      alt={name}
      onError={() => setFailed(true)}
      className={className ?? 'h-4 w-4 text-sky-400'}
      style={{ filter: 'invert(72%) sepia(54%) saturate(458%) hue-rotate(166deg)' }}
    />
  )
}
