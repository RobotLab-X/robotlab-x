import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { createApiFetch } from '../lib/api'
import { useRuntimeConnections } from '../contexts/RuntimeConnectionsContext'
import { useActiveRuntimeOptional } from '../contexts/ActiveRuntimeContext'
import { runtimePrimary } from '../runtime/runtimeColors'


/**
 * Modal that adds a new runtime to the connections list.
 *
 * Primary path: peers the active runtime has already discovered + federated
 * to via mDNS. One click adds them — we reuse the active runtime's access
 * token (shared JWT_SECRET_KEY across federated peers means the token
 * verifies on the new runtime as-is) so no creds are needed.
 *
 * Fallback path: manual URL + credentials, used when a runtime isn't
 * mDNS-visible (different subnet, behind a proxy, etc.).
 */

interface DiscoveredPeer {
  /** Composite key from /v1/peers — either remote_id or the ws URL */
  key: string
  /** WebSocket URL of the peer, e.g. ``ws://10.0.0.5:8998/v1/ws`` */
  url: string
  remote_id: string | null
  state: string
}

interface ConnectDialogProps {
  /** Initial URL to show in the manual-entry input. Used by the
   * empty-state CTA to seed the input with the SPA's own origin. */
  initialUrl?: string
  /** Source list of peer suggestions. Provided by the caller (the
   * switcher) so the dialog itself doesn't need to know which
   * runtime's peers to fetch. */
  discoveredPeers?: DiscoveredPeer[]
  onClose: () => void
  onConnected: (newConnectionId: string) => void
}

interface LoginResponse {
  access_token?: string | null
  token_type?: string | null
  mfa_required?: boolean | null
  message?: string | null
  refresh_token?: string | null
}

interface RuntimeInfoResponse {
  runtime_id?: string | null
}


/** Translate a peer ws URL into the HTTP origin the browser uses for
 * apiFetch + WsClient. ``ws://h:p/v1/ws`` → ``http://h:p``. The handshake
 * normalises peer URLs to this form, so the rewrite is deterministic. */
function peerHttpOrigin(wsUrl: string): string {
  try {
    const u = new URL(wsUrl)
    const scheme = u.protocol === 'wss:' ? 'https:' : 'http:'
    return `${scheme}//${u.host}`
  } catch {
    return wsUrl
  }
}


export function ConnectDialog({
  initialUrl = '',
  discoveredPeers = [],
  onClose,
  onConnected,
}: ConnectDialogProps) {
  const [url, setUrl] = useState(initialUrl)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Tracks which discovered peer is mid-connect so we can disable its
  // button + surface the spinner. Keyed by peer.key.
  const [busyPeer, setBusyPeer] = useState<string | null>(null)
  const { connections, add } = useRuntimeConnections()
  // ``useActiveRuntimeOptional`` so this dialog also works when
  // rendered from <NoRuntimesState> — there's no /r/:runtimeId/* route
  // active yet, hence no provider. ``activeConn`` will be null in that
  // path; the one-click "use existing token" affordance shows its
  // standard "sign in first" hint instead of crashing.
  const active = useActiveRuntimeOptional()
  const activeConn = active?.connection ?? null

  useEffect(() => { if (initialUrl) setUrl(initialUrl) }, [initialUrl])

  // Filter discovered peers: drop any whose HTTP origin already maps
  // to a connection we hold, and drop peers that haven't completed the
  // handshake (state !== connected) since we can't trust their identity
  // claims yet.
  const knownOrigins = useMemo(
    () => new Set(connections.map((c) => c.url)),
    [connections],
  )
  const peerOptions = useMemo(
    () => discoveredPeers
      .filter((p) => p.state === 'connected')
      .filter((p) => !knownOrigins.has(peerHttpOrigin(p.url))),
    [discoveredPeers, knownOrigins],
  )

  /** One-click add: reuse the active connection's access token (shared
   * JWT_SECRET_KEY makes this work cross-runtime). On success the new
   * connection is fully usable without password entry. */
  const connectDiscovered = useCallback(async (peer: DiscoveredPeer) => {
    if (!activeConn) {
      setError('Sign in to the current runtime first — needed to bridge auth to the peer.')
      return
    }
    const accessToken = activeConn.getAccessToken()
    if (!accessToken) {
      setError('Sign in to the current runtime first — needed to bridge auth to the peer.')
      return
    }
    setBusyPeer(peer.key)
    setError(null)
    try {
      const httpOrigin = peerHttpOrigin(peer.url)
      // Probe the peer with the existing token to confirm it accepts
      // it before we commit to adding the connection. Also gives us
      // the peer's authoritative runtime_id from its own DB rather
      // than trusting the discovery handshake blindly.
      const probe = createApiFetch({
        baseUrl: httpOrigin,
        getToken: () => accessToken,
      })
      // /v1/peers is admin-gated and always exists — cheap auth probe.
      const info = await probe<RuntimeInfoResponse>('/v1/runtime_info').catch(() => null)
      // If /v1/runtime_info doesn't exist, fall back to /v1/peers — if
      // either returns 2xx the token is good.
      if (!info) await probe('/v1/peers')

      const id = peer.remote_id ?? info?.runtime_id ?? httpOrigin
      const conn = add({ id, url: httpOrigin, refreshToken: null })
      conn.setTokens({
        accessToken,
        // We're piggybacking on the active runtime's session — no
        // refresh token of our own. When this access token expires
        // Phase 6 will re-bridge from a still-valid active connection.
        refreshToken: null,
        expiresAt: activeConn.auth.expiresAt,
      })
      if (peer.remote_id && conn.meta.runtime_id === null) {
        conn.meta.runtime_id = peer.remote_id
      }
      onConnected(conn.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`Couldn't bridge to ${peer.remote_id ?? peer.url}: ${msg}`)
    } finally {
      setBusyPeer(null)
    }
  }, [activeConn, add, onConnected])

  /** Manual URL + creds path — for runtimes mDNS can't see. */
  const submitManual = useCallback(async (e?: FormEvent) => {
    e?.preventDefault()
    const cleanUrl = url.trim().replace(/\/+$/, '')
    if (!cleanUrl) { setError('Runtime URL is required'); return }
    if (!username.trim() || !password) { setError('Username + password required'); return }

    setSubmitting(true)
    setError(null)
    try {
      const probe = createApiFetch({
        baseUrl: cleanUrl,
        getToken: () => null,
      })
      const res = await probe<LoginResponse>('/v1/login', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password }),
      })
      if (res.mfa_required) {
        setError('MFA required — log in via the main login page for this runtime, then add it here. (Multi-runtime MFA support is Phase 6.)')
        return
      }
      if (!res.access_token) {
        setError(res.message ?? 'Login succeeded but returned no token')
        return
      }
      const conn = add({
        id: cleanUrl,
        url: cleanUrl,
        refreshToken: res.refresh_token ?? null,
      })
      conn.setTokens({
        accessToken: res.access_token,
        refreshToken: res.refresh_token ?? null,
      })
      onConnected(conn.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }, [url, username, password, add, onConnected])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-4 text-sm text-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Add a runtime</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:text-slate-200"
          >
            ×
          </button>
        </div>

        {/* ── Discovered peers (primary path) ───────────────────────── */}
        <section>
          <h3 className="mb-1 text-[10px] uppercase tracking-wider text-slate-400">
            Discovered{activeConn ? ` via ${activeConn.meta.runtime_id ?? activeConn.id}` : ''}
            {peerOptions.length > 0 && ` (${peerOptions.length})`}
          </h3>
          {peerOptions.length === 0 ? (
            <div className="rounded border border-slate-800 bg-slate-950/60 px-2 py-1.5 text-[11px] text-slate-500">
              No new peers discovered on this network.
            </div>
          ) : (
            <ul className="space-y-1">
              {peerOptions.map((p) => {
                const label = p.remote_id ?? p.key
                const color = runtimePrimary(label)
                const isBusy = busyPeer === p.key
                return (
                  <li key={p.key} className="flex items-center gap-2 rounded border border-slate-800 bg-slate-950/40 px-2 py-1">
                    <span
                      className="rounded-full px-2 py-0.5 font-mono text-[11px] text-white"
                      style={{ background: color }}
                    >
                      {label}
                    </span>
                    <span className="flex-1 truncate font-mono text-[10px] text-slate-500" title={p.url}>
                      {peerHttpOrigin(p.url)}
                    </span>
                    <button
                      type="button"
                      onClick={() => connectDiscovered(p)}
                      disabled={isBusy || !activeConn?.getAccessToken()}
                      className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
                    >
                      {isBusy ? '…' : 'Connect'}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* ── Manual URL fallback ──────────────────────────────────── */}
        <section className="mt-4 border-t border-slate-800 pt-3">
          <h3 className="mb-1 text-[10px] uppercase tracking-wider text-slate-400">
            Or connect by URL
          </h3>
          <form onSubmit={submitManual} className="space-y-2">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://10.0.0.5:8998"
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs focus:border-slate-500 focus:outline-none"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username"
                autoComplete="username"
                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="password"
                autoComplete="current-password"
                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="rounded border border-slate-700 px-3 py-1 text-xs hover:border-slate-500 disabled:opacity-40"
              >
                {submitting ? 'Connecting…' : 'Connect by URL'}
              </button>
            </div>
          </form>
        </section>

        {error && (
          <div className="mt-3 rounded border border-rose-700 bg-rose-950/40 px-2 py-1 font-mono text-[11px] text-rose-200">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
