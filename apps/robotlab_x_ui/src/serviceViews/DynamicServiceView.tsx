// DynamicServiceView — loads a service's UI from its repo bundle
// (Option B; see docs/TODO_SERVICE_UI_BUNDLES.md).
//
// Resolution is static-first: view_full uses the compiled serviceViews
// registry when a type has one, and only falls back here. This component
// dynamically imports `/repo/<name>/<version>/ui.js` (served by the
// backend, with the host import map mapping the bundle's bare react /
// @rlx/ui imports to the host singletons). A 404 (no bundle) or any load
// error degrades to `fallback` — the existing placeholder — so an absent
// or broken bundle never takes down the canvas.
import { Component, lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import type { ServiceProxy } from '../models/ServiceProxy'

type LazyView = ComponentType<{ proxy: ServiceProxy }>

// Memoize per service_meta_id so a remount doesn't re-import. A bumped
// version → different metaId → different entry (natural cache-bust).
const loaders = new Map<string, ReturnType<typeof lazy<LazyView>>>()

// Per-page-load cache-bust. A rebuilt bundle keeps the SAME URL
// (/repo/<name>/<version>/ui.js — the version is the service version,
// not a content hash), so the browser's module map / HTTP cache can keep
// serving the OLD module even across a refresh, despite the backend's
// no-cache header. Stamping the import URL with a per-load token means
// every full page load fetches the latest bundle, while remounts within
// a session reuse the memoized loader. (Set once at module-eval so all
// bundles this session share the token.)
const LOAD_TOKEN = Date.now().toString(36)

function loaderFor(metaId: string) {
  let view = loaders.get(metaId)
  if (!view) {
    const [name, version] = metaId.split('@')
    const url = `/repo/${encodeURIComponent(name)}/${encodeURIComponent(version)}/ui.js?t=${LOAD_TOKEN}`
    // @vite-ignore: a runtime URL served by the backend, not a module Vite
    // should analyze/bundle at build time. A bundle inlines its own CSS
    // (built by build-service-ui.mjs), so there's nothing else to load.
    view = lazy(() =>
      import(/* @vite-ignore */ url).then((m) => ({ default: m.default as LazyView })),
    )
    loaders.set(metaId, view)
  }
  return view
}

class LoadBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? <>{this.props.fallback}</> : <>{this.props.children}</>
  }
}

export function DynamicServiceView({
  proxy,
  fallback,
}: {
  proxy: ServiceProxy
  fallback: ReactNode
}) {
  const metaId = proxy.service_meta_id
  if (!metaId) return <>{fallback}</>
  const View = loaderFor(metaId)
  return (
    <LoadBoundary fallback={fallback}>
      <Suspense fallback={<div className="p-3 text-xs text-slate-500">loading view…</div>}>
        <View proxy={proxy} />
      </Suspense>
    </LoadBoundary>
  )
}
