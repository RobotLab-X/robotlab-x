import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { RuntimeConnection, type RuntimeConnectionOptions } from '../runtime/RuntimeConnection'
import {
  loadActiveId,
  loadConnections,
  originSeed,
  saveActiveId,
  saveConnections,
  type PersistedConnection,
} from '../runtime/connectionsStorage'


/**
 * Top-level React context for the multi-runtime UI.
 *
 * Holds a Map of RuntimeConnection objects keyed by id. Persists the
 * list (just URL + refresh token) to localStorage so reload restores
 * everything. The seed-from-origin behaviour fires once on the very
 * first load — afterwards the user explicitly manages the list.
 *
 * Phase 3 (this file): data + add/remove API + persistence. No UI
 * change. Nothing in the existing codebase reads from this context
 * yet; the singleton ``wsClient`` + default ``apiFetch`` continue
 * serving every page. Phase 4 will introduce the active-runtime
 * context that pages re-render against, and Phase 5 + 6 fill in the
 * auth lifecycle.
 */

interface ConnectionsContextValue {
  /** Stable list of every known connection, ordered by insertion
   * (newest last). Components iterate this to render the chip bar. */
  connections: RuntimeConnection[]

  /** Look up by id. Returns undefined if no such connection. */
  get(id: string): RuntimeConnection | undefined

  /** Add a new connection. Returns the created RuntimeConnection.
   * If a connection with the same URL already exists, returns the
   * existing one (idempotent — same wire protocol as
   * peer_manager.connect on the backend). */
  add(opts: RuntimeConnectionOptions): RuntimeConnection

  /** Remove a connection. Disconnects + drops from persistence. If
   * the removed entry was the active one, clears the active id. */
  remove(id: string): void
}


const Context = createContext<ConnectionsContextValue | null>(null)


/** Hook for consumers. Throws if not inside a provider — saves the
 * silent-bug case where a page renders before App.tsx wires up. */
export function useRuntimeConnections(): ConnectionsContextValue {
  const v = useContext(Context)
  if (!v) throw new Error('useRuntimeConnections must be used inside <RuntimeConnectionsProvider>')
  return v
}


/** Mount at the top of App.tsx so every route + protected layout has
 * access. Reads persisted state once at mount; subsequent edits flush
 * back to localStorage automatically. */
export function RuntimeConnectionsProvider({ children }: { children: ReactNode }) {
  // Live RuntimeConnection objects, keyed by id. The Map is held in a
  // ref so reorder/mutate operations don't allocate every render;
  // counter state below triggers a re-render when the shape changes.
  const mapRef = useRef<Map<string, RuntimeConnection>>(new Map())
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  // ─── boot: hydrate from localStorage, seed on first load ────────────
  useEffect(() => {
    if (mapRef.current.size > 0) return  // already hydrated (HMR)

    let persisted = loadConnections()

    // First-ever load → seed with whatever origin served the SPA.
    // After that the user explicitly controls the list; we never
    // re-seed (an empty list means "the user removed everything",
    // which we honour).
    if (persisted.length === 0 && !localStorage.getItem('rlx.connections')) {
      const seed = originSeed()
      if (seed) {
        persisted = [seed]
        saveConnections(persisted)
      }
    }

    for (const entry of persisted) {
      const conn = new RuntimeConnection({
        id: entry.id,
        url: entry.url,
        refreshToken: entry.refreshToken ?? null,
      })
      conn.subscribe(bump)
      mapRef.current.set(conn.id, conn)
    }
    if (persisted.length > 0) bump()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── mutation API ──────────────────────────────────────────────────
  const add = useCallback((opts: RuntimeConnectionOptions): RuntimeConnection => {
    // Idempotent on URL — adding the same runtime twice returns the
    // existing connection. Important for "+ add" wired to the
    // discovered-peers UI: clicking the same peer twice is a no-op
    // rather than a duplicate row.
    for (const existing of mapRef.current.values()) {
      if (existing.url === (opts.url || '').replace(/\/+$/, '')) {
        return existing
      }
    }
    const conn = new RuntimeConnection(opts)
    conn.subscribe(bump)
    mapRef.current.set(conn.id, conn)
    flushPersistence(mapRef.current)
    bump()
    return conn
  }, [bump])

  const remove = useCallback((id: string): void => {
    const conn = mapRef.current.get(id)
    if (!conn) return
    conn.signOut()  // also closes the WS
    mapRef.current.delete(id)
    // Clear the active-id pointer if it was pointing at this entry.
    if (loadActiveId() === id) saveActiveId(null)
    flushPersistence(mapRef.current)
    bump()
  }, [bump])

  const get = useCallback((id: string): RuntimeConnection | undefined => {
    return mapRef.current.get(id)
  }, [])

  // ─── exposed value ─────────────────────────────────────────────────
  const value = useMemo<ConnectionsContextValue>(() => ({
    connections: Array.from(mapRef.current.values()),
    get,
    add,
    remove,
  // ``version`` participates in deps so consumers re-render when the
  // map mutates (the ref itself doesn't trigger React).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [version, get, add, remove])

  return <Context.Provider value={value}>{children}</Context.Provider>
}


/** Project every RuntimeConnection back into the PersistedConnection
 * shape and write to localStorage. Called after every mutation; the
 * cost is trivial at 1–10 entries. */
function flushPersistence(map: Map<string, RuntimeConnection>): void {
  const list: PersistedConnection[] = []
  for (const c of map.values()) {
    list.push({
      id: c.id,
      url: c.url,
      refreshToken: c.auth.refreshToken,
    })
  }
  saveConnections(list)
}
