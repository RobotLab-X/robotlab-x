// DockView — a single service's view rendered chrome-less, full-window,
// in its own browser popup. The "undockable" service view.
//
// Reached via ``/r/:runtimeId/dock/:proxyId?view=<viewId>`` (see
// App.tsx). The route is wrapped in ProtectedRoute +
// ActiveRuntimeProvider but NOT RuntimeLayout — so this page has auth +
// the per-runtime bus/apiFetch context, but none of the nav/switcher
// chrome. The operator pops a view out from the canvas (the kebab's
// "Open in window"), places the small window wherever they like, and
// arranges several across their monitors as a live dashboard.
//
// View-shape preservation: the canvas passes the node's CURRENT view id
// (view_min / view_basic / view_full / …) as ``?view=``. DockView
// renders that exact shape via the same registry the canvas dispatches
// through (getComposerView), so a min stays min and a basic stays
// basic. The shape can be changed in-window from the view's own kebab;
// the choice is mirrored back into the URL so a refresh keeps it.
//
// Each popup is an independent SPA instance with its own WS to the
// runtime. The bus is the source of truth, so a value changed in the
// canvas window shows up here (and vice-versa) without any cross-window
// messaging — both ends just subscribe to the same topics.
import { useCallback, useEffect, useReducer, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'

import { useActiveRuntime } from '../contexts/ActiveRuntimeContext'
import { DockProvider } from '../contexts/DockContext'
import {
  DEFAULT_VIEW_ID,
  getComposerView,
  normalizeComposerViewId,
} from '../composerViews'
import type { ComposerViewProps, ProxyAction } from '../composerViews/types'
import { STATUS_DOT } from '../composerViews/_shared'
import type { ServiceProxy } from '../models/ServiceProxy'
import type { ServiceRequest } from '../models/ServiceRequest'


export default function DockView() {
  const { proxyId = '' } = useParams<{ proxyId: string }>()
  const { runtimeId, connection } = useActiveRuntime()
  const decodedId = decodeProxyId(proxyId)

  const [searchParams, setSearchParams] = useSearchParams()
  // Current view shape — seeded from ``?view=`` (the shape the node was
  // in when popped out), normalised so a stale/typo'd value can't crash
  // the dispatcher. Switching updates both state AND the URL so a
  // refresh restores the same shape.
  const [viewId, setViewId] = useState<string>(() =>
    normalizeComposerViewId(searchParams.get('view') ?? DEFAULT_VIEW_ID),
  )
  const onViewChange = useCallback(
    (_proxyId: string, next: string) => {
      const normalized = normalizeComposerViewId(next)
      setViewId(normalized)
      setSearchParams(
        (prev) => {
          const sp = new URLSearchParams(prev)
          sp.set('view', normalized)
          return sp
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const [proxy, setProxy] = useState<ServiceProxy | null>(null)
  const [error, setError] = useState<string | null>(null)

  // RuntimeConnection mutates ``state`` in place + notifies listeners;
  // it does NOT swap the object reference. ActiveRuntimeProvider's
  // memoized value therefore stays identical across a
  // connecting→connected transition, so this component would never
  // re-render to notice. Subscribe directly to the connection and force
  // a re-render on every notify (state flip, auth change). Also kick
  // the socket open explicitly — idempotent; covers the case where
  // nothing else has subscribed yet to trigger the lazy connect.
  const [, forceRender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (!connection) return
    const off = connection.subscribe(forceRender)
    connection.ws.connect()
    return off
  }, [connection])

  // Title the OS window after the service so a row of popups is
  // distinguishable on the taskbar / alt-tab.
  useEffect(() => {
    const label = proxy?.name ?? decodedId
    document.title = label ? `${label} — robotlab_x` : 'robotlab_x'
  }, [proxy?.name, decodedId])

  // Fetch the proxy record once the connection is live. The view itself
  // pulls its live data off the bus; this is just the static descriptor
  // (id + service_meta_id + name) the view components need. Re-runs if
  // the connection flips to connected after an initial disconnected
  // render.
  useEffect(() => {
    if (!connection || connection.state !== 'connected') return
    let cancelled = false
    setError(null)
    connection
      .apiFetch<ServiceProxy[]>('/v1/service-proxy-list')
      .then((list) => {
        if (cancelled) return
        const found = (list ?? []).find((p) => (p.id ?? p.name) === decodedId)
        if (found) setProxy(found)
        else setError(`No service "${decodedId}" on ${runtimeId}.`)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [connection, connection?.state, decodedId, runtimeId])

  // Minimal lifecycle dispatcher for the full view's title-bar buttons
  // (Start / Stop / Release). The canvas dispatcher additionally drives
  // install + config wizards; those need canvas state we don't have
  // here, so a popped-out view handles the already-installed case (the
  // realistic one for a dashboard) and routes ``configure_service`` /
  // first-run installs back to the canvas by simply no-op'ing.
  const onAction = useCallback(
    async (pid: string, action: ProxyAction) => {
      if (!connection || action === 'configure_service') return
      try {
        const result = await connection.apiFetch<ServiceRequest>('/v1/service-request', {
          method: 'POST',
          body: JSON.stringify({ action, service_proxy_id: pid }),
        })
        if (result?.status === 'failed') {
          setError(result.result ?? `${action} failed`)
        } else {
          // Refresh the descriptor so the status dot reflects the new
          // lifecycle state.
          const list = await connection.apiFetch<ServiceProxy[]>('/v1/service-proxy-list')
          const found = (list ?? []).find((p) => (p.id ?? p.name) === pid)
          if (found) setProxy(found)
        }
      } catch (err) {
        if (err instanceof Error) setError(err.message)
      }
    },
    [connection],
  )

  // ── connection-state gates ───────────────────────────────────────
  if (!connection) {
    return (
      <DockShell runtimeId={runtimeId} connected={false}>
        <Placeholder>
          Not connected to runtime{' '}
          <span className="font-mono text-slate-300">{runtimeId}</span>. Open
          this view from the main window so the connection is established.
        </Placeholder>
      </DockShell>
    )
  }
  if (connection.state !== 'connected' && !proxy) {
    return (
      <DockShell runtimeId={runtimeId} connected={false}>
        <Placeholder>
          Connecting to{' '}
          <span className="font-mono text-slate-300">{runtimeId}</span>…
        </Placeholder>
      </DockShell>
    )
  }
  if (error && !proxy) {
    return (
      <DockShell runtimeId={runtimeId} connected={connection.state === 'connected'}>
        <Placeholder tone="error">{error}</Placeholder>
      </DockShell>
    )
  }
  if (!proxy) {
    return (
      <DockShell runtimeId={runtimeId} connected={connection.state === 'connected'}>
        <Placeholder>Loading…</Placeholder>
      </DockShell>
    )
  }

  // Render the SAME view-shape component the canvas would dispatch for
  // this view id — so the popped-out window is a faithful copy of the
  // node's shape. ``selected={false}`` keeps the canvas-only resize
  // handles off; the view's own kebab (pop-out suppressed via
  // DockProvider) lets the operator switch shapes in-window.
  const def = getComposerView(viewId) ?? getComposerView(DEFAULT_VIEW_ID)
  const ViewComponent = def?.Component
  const composerProps: ComposerViewProps = {
    proxy,
    selected: false,
    onViewChange,
    onAction,
    // We don't know singleton/configurable status here without the
    // catalog; default to the safe values (show Stop, no Configure
    // affordance beyond the no-op above).
    isSingleton: false,
    configurable: false,
  }

  return (
    <DockProvider>
      <DockShell runtimeId={runtimeId} connected={connection.state === 'connected'}>
        <div className="min-h-0 flex-1 overflow-auto select-text">
          {ViewComponent ? (
            <ViewComponent {...composerProps} />
          ) : (
            <Placeholder tone="error">Unknown view "{viewId}".</Placeholder>
          )}
          {error && (
            <p className="px-3 py-1.5 text-[11px] text-rose-400">{error}</p>
          )}
        </div>
      </DockShell>
    </DockProvider>
  )
}


/** Full-window frame: a thin status strip (the "window frame") + the
 * view body underneath. Deliberately minimal — it does NOT repeat the
 * service name/lifecycle/kebab, because the rendered view shape carries
 * its own title bar + kebab. This strip just identifies the runtime,
 * shows live connection state, and offers an in-app close. */
function DockShell({
  runtimeId,
  connected,
  children,
}: {
  runtimeId: string
  connected: boolean
  children: React.ReactNode
}) {
  const dot = connected ? STATUS_DOT.running : STATUS_DOT.stopped
  return (
    <div className="flex h-screen w-screen flex-col bg-slate-900 text-slate-200">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800 bg-slate-950 px-2 py-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${dot}`}
            title={connected ? 'connected' : 'not connected'}
            aria-label={connected ? 'connected' : 'not connected'}
          />
          <span className="truncate font-mono text-[11px] text-slate-500">{runtimeId}</span>
        </div>
        <button
          type="button"
          onClick={() => window.close()}
          title="Close window"
          className="rounded p-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {children}
    </div>
  )
}


function Placeholder({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode
  tone?: 'muted' | 'error'
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-center">
      <p className={`text-xs ${tone === 'error' ? 'text-rose-400' : 'text-slate-500'}`}>
        {children}
      </p>
    </div>
  )
}


/** The proxy id rides through the URL path; decode any percent-encoded
 * special chars (ids can contain ``@``, ``.``, ``-``). */
function decodeProxyId(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}
