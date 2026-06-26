import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import type { RuntimeConnection } from '../runtime/RuntimeConnection'
import type { WsClient } from '../runtime/wsClient'
import { saveActiveId } from '../runtime/connectionsStorage'
import { useRuntimeConnections } from './RuntimeConnectionsContext'


/**
 * Active-runtime context: which runtime is the current page targeting?
 *
 * Mounted INSIDE each ``/r/:runtimeId/*`` route (see App.tsx). Reads
 * the URL param, looks up the matching RuntimeConnection from
 * RuntimeConnectionsContext, exposes its ws + apiFetch through hooks.
 *
 * Pages that today do ``import { wsClient } from '../runtime/wsClient'``
 * migrate to:
 *
 *   import { useWsClient } from '../contexts/ActiveRuntimeContext'
 *   const wsClient = useWsClient()
 *
 * Same surface area (``subscribe``, ``publish``, ``listTopics``, etc.)
 * — what changes is that the instance is now per-active-runtime
 * instead of a process-singleton.
 *
 * Pages that haven't migrated yet keep using the singleton; the
 * singleton stays bound to ``location.origin`` (today's seed
 * runtime), so they still work — just always against the seed runtime
 * regardless of which one the URL says is active. Phase 5 + 6 finish
 * the migration as those pages get touched.
 */

interface ActiveRuntimeValue {
  /** The id from the URL — may not match a real connection if the
   * user landed via a stale bookmark. */
  runtimeId: string
  /** The resolved connection. Null when ``runtimeId`` doesn't match
   * anything in the connections map — pages should render a "not
   * connected" placeholder in that case. */
  connection: RuntimeConnection | null
}


const Context = createContext<ActiveRuntimeValue | null>(null)


/** Mount inside a ``/r/:runtimeId/*`` route. Reads the param + looks
 * up the connection. Persists the active id back to localStorage so
 * page reload restores the same view. */
export function ActiveRuntimeProvider({ children }: { children: ReactNode }) {
  const { runtimeId = '' } = useParams<{ runtimeId: string }>()
  const { get } = useRuntimeConnections()

  // Decode the param — runtime ids can contain ``-`` and ``.`` etc.
  // but they pass through URL paths cleanly. Decode in case anything
  // upstream encoded special chars (e.g. ``%40`` for ``@``).
  const decodedId = useMemo(() => {
    try { return decodeURIComponent(runtimeId) } catch { return runtimeId }
  }, [runtimeId])

  const connection = get(decodedId) ?? null

  // Persist active id whenever it changes so reload restores the
  // view. Skips when the URL points at a non-existent connection
  // (don't lock the user into a broken bookmark).
  useEffect(() => {
    if (connection) saveActiveId(decodedId)
  }, [decodedId, connection])

  const value = useMemo<ActiveRuntimeValue>(() => ({
    runtimeId: decodedId,
    connection,
  }), [decodedId, connection])

  return <Context.Provider value={value}>{children}</Context.Provider>
}


/** Full active-runtime details. Useful for pages that need to render
 * conditionally on connection state (e.g. show a "log in to this
 * runtime" banner when ``connection.state !== 'connected'``). */
export function useActiveRuntime(): ActiveRuntimeValue {
  const v = useContext(Context)
  if (!v) throw new Error('useActiveRuntime must be used inside <ActiveRuntimeProvider> (a /r/:runtimeId/* route)')
  return v
}


/** Safe variant — returns null when called outside a provider instead
 * of throwing. Use this in chrome components like ConnectDialog that
 * can be rendered EITHER inside a /r/:runtimeId/* route (where they
 * may bridge auth from the active connection) OR from the no-runtimes
 * empty state (where there IS no active connection). The caller is
 * responsible for null-checking before reaching for ``connection``. */
export function useActiveRuntimeOptional(): ActiveRuntimeValue | null {
  return useContext(Context) ?? null
}


/** Shortcut for the common case: just the WsClient. Throws when
 * there's no active connection — page should guard with
 * useActiveRuntime().connection if it wants to render a placeholder
 * instead. */
export function useWsClient(): WsClient {
  const { connection, runtimeId } = useActiveRuntime()
  if (!connection) throw new Error(`useWsClient: no connection for runtime ${runtimeId}`)
  return connection.ws
}


/** Same convenience for apiFetch. */
export function useApiFetch() {
  const { connection, runtimeId } = useActiveRuntime()
  if (!connection) throw new Error(`useApiFetch: no connection for runtime ${runtimeId}`)
  return connection.apiFetch
}
