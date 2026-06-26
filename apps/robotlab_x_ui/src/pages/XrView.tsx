// XrView — full-page host shell for a service's immersive WebXR client
// (xr.js). Opened ON THE HEADSET at /r/:runtimeId/xr/:proxyId.
//
// Same auth + per-runtime bus wiring as DockView (ProtectedRoute +
// ActiveRuntimeProvider, no RuntimeLayout chrome), but instead of a
// composer view it dynamically imports the service's `xr.js` bundle —
// built from ui/xr/View.tsx, served at /repo/<name>/<version>/xr.js —
// and mounts it full-page. The immersive bundle owns the whole viewport
// (its own "Enter VR" button + Canvas); this shell just resolves the
// proxy + connection and hands them to it.
import {
  Component, Suspense, lazy, useEffect, useReducer, useState,
  type ComponentType, type ReactNode,
} from 'react'
import { useParams } from 'react-router-dom'

import { useActiveRuntime } from '../contexts/ActiveRuntimeContext'
import type { ServiceProxy } from '../models/ServiceProxy'

type XrComponent = ComponentType<{ proxy: ServiceProxy }>

// Memoize the lazy import per metaId so a remount doesn't re-fetch the
// (large) immersive bundle.
const loaders = new Map<string, ReturnType<typeof lazy<XrComponent>>>()
// Per-page-load cache-bust — see DynamicServiceView for the rationale
// (constant bundle URL would otherwise serve a stale module after a
// rebuild despite the backend's no-cache header).
const LOAD_TOKEN = Date.now().toString(36)
function loaderFor(metaId: string) {
  let view = loaders.get(metaId)
  if (!view) {
    const [name, version] = metaId.split('@')
    const url = `/repo/${encodeURIComponent(name)}/${encodeURIComponent(version)}/xr.js?t=${LOAD_TOKEN}`
    view = lazy(() =>
      import(/* @vite-ignore */ url).then((m) => ({ default: m.default as XrComponent })),
    )
    loaders.set(metaId, view)
  }
  return view
}

class LoadBoundary extends Component<
  { fallback: ReactNode; children: ReactNode }, { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <>{this.props.fallback}</> : <>{this.props.children}</> }
}


export default function XrView() {
  const { proxyId = '' } = useParams<{ proxyId: string }>()
  const { runtimeId, connection } = useActiveRuntime()
  const decodedId = (() => { try { return decodeURIComponent(proxyId) } catch { return proxyId } })()

  const [proxy, setProxy] = useState<ServiceProxy | null>(null)
  const [error, setError] = useState<string | null>(null)

  // RuntimeConnection mutates state in place; subscribe to re-render on
  // connect (same pattern as DockView) and kick the socket open.
  const [, forceRender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (!connection) return
    const off = connection.subscribe(forceRender)
    connection.ws.connect()
    return off
  }, [connection])

  useEffect(() => {
    document.title = `${decodedId} — WebXR`
  }, [decodedId])

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
      .catch((err: Error) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [connection, connection?.state, decodedId, runtimeId])

  if (!connection) return <Msg>Not connected to runtime {runtimeId}. Open from the main window first.</Msg>
  if (connection.state !== 'connected' && !proxy) return <Msg>Connecting to {runtimeId}…</Msg>
  if (error && !proxy) return <Msg tone="error">{error}</Msg>
  if (!proxy) return <Msg>Loading…</Msg>

  const metaId = proxy.service_meta_id
  if (!metaId) return <Msg tone="error">Service has no bundle id.</Msg>
  const View = loaderFor(metaId)

  return (
    <LoadBoundary fallback={<Msg tone="error">Failed to load the immersive bundle (xr.js). Is the service built + running?</Msg>}>
      <Suspense fallback={<Msg>Loading immersive client…</Msg>}>
        <View proxy={proxy} />
      </Suspense>
    </LoadBoundary>
  )
}


function Msg({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'error' }) {
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#0b1220', padding: 24, textAlign: 'center',
      fontFamily: 'system-ui, sans-serif', fontSize: 14,
      color: tone === 'error' ? '#fda4af' : '#94a3b8' }}>
      {children}
    </div>
  )
}
