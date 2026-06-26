import { Navigate, useLocation } from 'react-router-dom'
import { useRuntimeConnections } from '../contexts/RuntimeConnectionsContext'
import { loadActiveId } from '../runtime/connectionsStorage'


/**
 * Redirect a bare path to its ``/r/:runtimeId/...`` equivalent.
 *
 * Used by the legacy routes in App.tsx (``/workspaces/runtime``,
 * ``/topology``, etc.) so old bookmarks + in-code ``navigate(...)``
 * calls keep landing on the right page after the URL-routing refactor.
 *
 * The runtime to redirect to is, in order of preference:
 *   1. The persisted ``rlx.active`` id, if it matches a current connection
 *   2. The first connection in the list (insertion order)
 *   3. None — falls back to ``/no-runtime`` (a future empty-state page;
 *      for now we just keep the URL where it is)
 */
export function RedirectToActive() {
  const { connections } = useRuntimeConnections()
  const location = useLocation()

  // Pick the active runtime — persisted choice first, else first
  // connection. The persisted choice may be stale (referencing a
  // since-removed connection); fall through gracefully.
  const persistedId = loadActiveId()
  const persisted = persistedId
    ? connections.find((c) => c.id === persistedId)
    : null
  const target = persisted ?? connections[0]

  if (!target) {
    // Empty state — no connections. Bounce to /no-runtimes which
    // renders the "Add your first runtime" CTA.
    return <Navigate to="/no-runtimes" replace />
  }

  // Encode the id in case it ever contains URL-significant chars
  // (today they're a-z0-9- only, but defensive against future
  // changes to the id grammar).
  const encoded = encodeURIComponent(target.id)
  // Carry forward the entire path + search + hash; we're only
  // prepending the /r/<id> segment.
  const next = `/r/${encoded}${location.pathname}${location.search}${location.hash}`
  return <Navigate to={next} replace />
}
