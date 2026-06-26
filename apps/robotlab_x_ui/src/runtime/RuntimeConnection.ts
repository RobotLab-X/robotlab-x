import { WsClient } from './wsClient'
import { createApiFetch, getAuthToken } from '../lib/api'

/**
 * One connection to a robotlab_x runtime.
 *
 * Holds the per-runtime ws client, apiFetch, auth state, and learned
 * runtime metadata. The multi-runtime UI keeps a Map<id, RuntimeConnection>;
 * each page renders against whichever instance is currently "active".
 *
 * Design constraints from the multi-runtime plan:
 *  - All connections are equal. There is no "default" connection that
 *    code special-cases. Whatever is at index 0 in localStorage today
 *    was the SAME-origin seed inserted on first load.
 *  - Access tokens are IN-MEMORY only. Refresh tokens persist to
 *    localStorage (rlx.connections) so a page reload restores the
 *    session without requiring re-login.
 *  - Per-connection ``auth:expired`` handling — an expiry on one
 *    runtime does NOT bounce the user out of other connections.
 *
 * Phase 3 (this file) provides the data shape + WsClient/apiFetch
 * wiring. Auth flows (login, refresh, expiry recovery) get filled in
 * during Phase 5 + 6. The class is fully constructable today but
 * intentionally inert until the active-runtime layer mounts it.
 */

/** Lifecycle state of a single runtime connection. */
export type RuntimeConnectionState =
  | 'disconnected'      // no socket, no auth attempt in flight
  | 'connecting'        // ws handshake in progress (mirrors WsClient 'connecting')
  | 'authenticating'    // login or refresh in progress (Phase 5/6)
  | 'connected'         // ws open + auth ok
  | 'error'             // unrecoverable; user must act (re-login, fix URL)


/** Per-connection auth bundle. ``accessToken`` lives in memory only;
 * ``refreshToken`` is persisted to localStorage so reload survives. */
export interface RuntimeAuthState {
  accessToken: string | null
  refreshToken: string | null
  expiresAt: number | null         // epoch ms when accessToken expires
  lastError: string | null         // last auth failure message
}


/** Metadata learned about the remote runtime — populated once the
 * connection identifies itself via /runtime/info. ``runtime_id`` is
 * the federation handle (e.g. ``"witty-gizmo"``); the UI uses it as
 * the canonical display label once known. */
export interface RuntimeMeta {
  runtime_id: string | null
  version: string | null
  started_at: string | null
}


/** Constructor input. ``id`` is the UI-facing label used until we
 * learn the actual ``runtime_id`` (e.g. the URL itself, or a
 * persisted previous-known id). */
export interface RuntimeConnectionOptions {
  id?: string
  url: string
  refreshToken?: string | null
}


export class RuntimeConnection {
  /** Stable handle used as the Map key + URL slug. Initially the URL
   * (or a caller-provided label); replaced with the learned
   * ``runtime_id`` once /runtime/info arrives. The MAP key in the
   * parent context is also updated on rename to keep things consistent. */
  id: string

  /** Origin of the target runtime. Canonical form is
   * ``http(s)://host[:port]`` — no trailing slash, no path. The
   * WsClient + apiFetch instances inside append their own paths. */
  readonly url: string

  state: RuntimeConnectionState = 'disconnected'

  auth: RuntimeAuthState = {
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
    lastError: null,
  }

  meta: RuntimeMeta = {
    runtime_id: null,
    version: null,
    started_at: null,
  }

  /** Per-connection WS client. Bound to ``this.url`` + reads the
   * in-memory access token via getToken callback. */
  readonly ws: WsClient

  /** Per-connection apiFetch. Same wiring as WsClient — base url +
   * live-read access token + per-connection expiry handler. */
  readonly apiFetch: ReturnType<typeof createApiFetch>

  /** Observers for state changes. Used by the React context to
   * re-render chip pills + auth banners on any transition. */
  private listeners = new Set<() => void>()

  constructor(opts: RuntimeConnectionOptions) {
    this.url = canonicalizeUrl(opts.url)
    this.id = opts.id ?? this.url
    this.auth.refreshToken = opts.refreshToken ?? null

    // Token resolution during the Phase 4 → 6 migration window:
    //
    //   1. Per-connection ``this.auth.accessToken`` (Phase 5/6 — once
    //      the connect dialog + login flow are wired up).
    //   2. Legacy global ``robotlab_x.access_token`` in localStorage
    //      (today's auth path, used by the LoginPage). Falling back
    //      here keeps every connection working during migration: the
    //      seed connection presents the legacy token to the
    //      same-origin runtime (its rightful owner), and non-seed
    //      connections present it to remotes that will either accept
    //      it (shared JWT_SECRET_KEY across the LAN) or reject with
    //      401 — at which point Phase 5's connect dialog asks for
    //      proper credentials.
    //
    // Once Phase 6 lands, the legacy fallback is removed and every
    // connection holds its own credentials.
    const resolveToken = (): string | null =>
      this.auth.accessToken ?? getAuthToken()

    this.ws = new WsClient({
      baseUrl: this.url,
      getToken: resolveToken,
    })

    this.apiFetch = createApiFetch({
      baseUrl: this.url,
      getToken: resolveToken,
      onAuthExpired: () => this.handleAuthExpired(),
    })

    // Auto-populate meta.runtime_id from the bus. The runtime publishes
    // /runtime/runtime/services (retained) carrying its federation
    // handle in payload.runtime_id; subscribing here means EVERY
    // connection — seed + dialog-added — learns the id as soon as the
    // first retained delivery arrives. Without this, only connections
    // created through ConnectDialog ever populated the field (because
    // ConnectDialog set it from the peer probe), leaving the seed
    // connection's chip showing the URL-derived id and the runtime
    // banner reading "no federation id yet".
    //
    // Idempotent — re-deliveries with the same id are a no-op + skip
    // notify(). We never unsubscribe (subscription lifetime = connection
    // lifetime); WsClient automatically resubscribes on reconnect.
    this.ws.subscribe('/runtime/runtime/services', (frame) => {
      if (frame.method !== 'message') return
      const p = frame.payload as { runtime_id?: string | null } | null | undefined
      const id = p && typeof p === 'object' ? p.runtime_id : null
      if (!id || typeof id !== 'string') return
      if (this.meta.runtime_id === id) return
      this.meta.runtime_id = id
      this.notify()
    })

    // Mirror the WsClient's live state into this.state so listeners
    // (chip status dot, banners) see real transitions. The WsClient
    // emits 'connecting'/'connected'/'disconnected'; we map them onto
    // RuntimeConnectionState — the 'authenticating' + 'error' values
    // remain reserved for higher-level conditions that aren't WS-state.
    // ``signOut()`` + ``handleAuthExpired()`` still set state directly;
    // a subsequent WsClient transition will reconcile.
    this.ws.subscribeState((wsState) => {
      const next: RuntimeConnectionState =
        wsState === 'connected' ? 'connected'
          : wsState === 'connecting' ? 'connecting'
            : 'disconnected'
      if (this.state === next) return
      this.state = next
      this.notify()
    })
  }

  /** Effective access token for outgoing calls — same resolution
   * order the internal WsClient + apiFetch use. Exposed so callers
   * (e.g. ConnectDialog's discovered-peer bridge) can decide whether
   * we have *any* token to present to a peer, regardless of whether
   * it came from the new per-connection auth path or the legacy
   * localStorage one. Returns null when neither has a token. */
  getAccessToken(): string | null {
    return this.auth.accessToken ?? getAuthToken()
  }


  /** Subscribe to state-change notifications. Returns an unsubscribe.
   * Cheap when no observers — used by the context provider so React
   * trees re-render when any field on this connection updates. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Notify observers of any mutation. Called internally on auth
   * changes, ws state shifts, and meta updates. */
  private notify(): void {
    for (const l of this.listeners) {
      try { l() } catch (err) { console.error('RuntimeConnection listener threw', err) }
    }
  }

  /** Update the in-memory access token + (optionally) the persisted
   * refresh token. Filed during Phase 5's login flow. */
  setTokens(opts: { accessToken: string; refreshToken?: string | null; expiresAt?: number | null }): void {
    this.auth.accessToken = opts.accessToken
    if (opts.refreshToken !== undefined) this.auth.refreshToken = opts.refreshToken
    if (opts.expiresAt !== undefined) this.auth.expiresAt = opts.expiresAt
    this.auth.lastError = null
    this.notify()
  }

  /** Clear all tokens + drop the WS. Used on user sign-out + on
   * irrecoverable auth failure. */
  signOut(): void {
    this.auth.accessToken = null
    this.auth.refreshToken = null
    this.auth.expiresAt = null
    this.state = 'disconnected'
    this.ws.disconnect()
    this.notify()
  }

  /** Per-connection 401 handler. Today it just zeroes the access
   * token + nudges state — Phase 6 will add a refresh attempt before
   * giving up. We DON'T fire window-level ``auth:expired`` because
   * that would sign the user out of every other connection too. */
  private handleAuthExpired(): void {
    this.auth.accessToken = null
    this.auth.expiresAt = null
    this.state = 'disconnected'
    this.auth.lastError = 'token expired'
    this.notify()
  }
}


/** Strip trailing slashes + lowercase the scheme. Idempotent — calling
 * it twice produces the same result. We keep it strict so two entries
 * for the same runtime can't slip in as ``http://x:8998`` and
 * ``http://x:8998/`` simultaneously. */
function canonicalizeUrl(url: string): string {
  let u = (url || '').trim().replace(/\/+$/, '')
  // Normalise scheme casing (URLs may arrive from copy-paste with
  // mixed case). Don't touch host casing — case-insensitive at the
  // DNS layer but operators sometimes use casing as a visual hint.
  if (u.startsWith('HTTP://')) u = 'http://' + u.slice(7)
  else if (u.startsWith('HTTPS://')) u = 'https://' + u.slice(8)
  return u
}
