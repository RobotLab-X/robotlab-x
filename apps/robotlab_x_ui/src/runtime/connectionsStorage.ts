/**
 * localStorage shape + read/write for the multi-runtime connection
 * list.
 *
 * Two keys:
 *   - ``rlx.connections`` — JSON array of persisted connection entries
 *   - ``rlx.active``      — id of the currently-active connection
 *
 * Access tokens never persist (kept in-memory by RuntimeConnection).
 * Only the refresh token + the URL + the user-facing id survive
 * reload. Plenty for Phase 6's auth-restore-on-boot logic.
 *
 * The format is intentionally small + forward-compatible: extra
 * fields are preserved verbatim on round-trip, so adding columns
 * later (e.g. ``color``, ``label``, ``trust_level``) doesn't break
 * users coming from earlier UI versions.
 */

export interface PersistedConnection {
  /** Stable handle the React Map keys by. Usually the learned
   * runtime_id once known, otherwise the URL the user added. */
  id: string
  url: string
  /** Long-lived refresh token. Null when the user hasn't logged in
   * yet (e.g. the seed entry after first load). */
  refreshToken: string | null
  /** Forward-compat slot for fields future phases add. */
  [extra: string]: unknown
}


const CONNECTIONS_KEY = 'rlx.connections'
const ACTIVE_KEY = 'rlx.active'


/** Read the persisted connection list. Returns [] on missing/corrupt
 * data — we never throw from boot-path readers. */
export function loadConnections(): PersistedConnection[] {
  if (typeof localStorage === 'undefined') return []
  const raw = localStorage.getItem(CONNECTIONS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Drop anything that doesn't smell like a connection — defensive
    // against a hand-edited localStorage.
    return parsed.filter(isPersistedConnection)
  } catch {
    return []
  }
}


export function saveConnections(list: PersistedConnection[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(list))
  } catch {
    // localStorage can throw (quota, private-mode). Soft-fail; the
    // user's connections still work this session, just don't survive
    // reload.
  }
}


export function loadActiveId(): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(ACTIVE_KEY)
}


export function saveActiveId(id: string | null): void {
  if (typeof localStorage === 'undefined') return
  try {
    if (id === null) localStorage.removeItem(ACTIVE_KEY)
    else localStorage.setItem(ACTIVE_KEY, id)
  } catch {
    // Same soft-fail as above.
  }
}


function isPersistedConnection(v: unknown): v is PersistedConnection {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return typeof r.id === 'string'
    && typeof r.url === 'string'
    && (r.refreshToken === null || typeof r.refreshToken === 'string')
}


/** Origin of the SPA — used to seed the first-ever-load connection
 * so the user lands with one runtime already populated (whichever
 * served the SPA, or wherever Vite proxies to). Treated as just
 * another entry; nothing special-cases it after creation. */
export function originSeed(): PersistedConnection | null {
  if (typeof window === 'undefined' || typeof location === 'undefined') return null
  return {
    id: location.origin,
    url: location.origin,
    refreshToken: null,
  }
}
