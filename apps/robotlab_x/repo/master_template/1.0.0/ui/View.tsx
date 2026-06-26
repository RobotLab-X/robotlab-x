// ─────────────────────────────────────────────────────────────────────
// master_template — reference modular service UI (Option B).
// See apps/robotlab_x/docs/TODO_SERVICE_UI_BUNDLES.md.
//
// A service ships its own frontend here: repo/<name>/<version>/ui/View.tsx,
// compiled to ui/dist/ui.js and dynamically loaded by the host. You write
// ONLY this file (+ ui/package.json for any third-party deps). The host
// loads it via DynamicServiceView when the type has no built-in
// serviceViews entry.
//
// RULES
//   • Default-export a React component taking { proxy }.
//   • Import react + everything host-provided from '@rlx/ui' — those are
//     EXTERNALS resolved at runtime to the host's single instances (one
//     React, one bus client, one auth). Never bundle your own React.
//   • Your OWN third-party libs (charts, editors, …) DO bundle in
//     (tree-shaken) — declare them in ui/package.json.
//   • Tailwind classes are inherited from the host's compiled CSS, so stick
//     to the vocabulary the host already uses. CSS a dep imports (e.g.
//     xterm.css) is inlined into ui.js automatically at build.
//
// BUILD (from apps/robotlab_x_ui/):
//   node scripts/build-service-ui.mjs ../robotlab_x/repo/<name>/<version>/ui
//   # or rebuild + vet everything:
//   npm run build:service-ui && npm run check:service-ui
// Commit the produced ui/dist/ui.js (the shipped artifact); ui/node_modules
// is gitignored.
// ─────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { useWsClient, Panel, type ServiceProxy, type InboundFrame } from '@rlx/ui'

// Shape of whatever your service publishes on its retained /state topic.
// Mirror your service's _snapshot()/state payload here.
interface TemplateState {
  message?: string
  ticks?: number
}

export default function MasterTemplateView({ proxy }: { proxy: ServiceProxy }) {
  // proxy.id is this instance's id; the service's topics live under
  // /<type>/<proxy_id>/... — derive the type from service_meta_id.
  const proxyId = proxy.id ?? proxy.name ?? ''
  const type = (proxy.service_meta_id ?? 'master_template@1.0.0').split('@')[0]
  const ws = useWsClient()
  const [state, setState] = useState<TemplateState>({})

  // Subscribe to the service's retained /state. The handler fires once
  // immediately with the retained value, then on every change. The
  // returned function unsubscribes on unmount.
  useEffect(() => {
    if (!proxyId) return
    const off = ws.subscribe(`/${type}/${proxyId}/state`, (f: InboundFrame) => {
      if (f.method === 'message' && f.payload && typeof f.payload === 'object') {
        setState(f.payload as TemplateState)
      }
    })
    return off
  }, [ws, type, proxyId])

  // Invoke a service @service_method by publishing {action, ...args} to
  // the control topic. (Use useServiceRequest from @rlx/ui when you want a
  // spinner + the reply.)
  const sendAction = (action: string, args: Record<string, unknown> = {}) => {
    ws.publish(`/${type}/${proxyId}/control`, { action, ...args })
  }

  return (
    <Panel title={`${type} — replace me`}>
      <div className="text-slate-400">proxy: {proxyId}</div>
      <div className="text-slate-400">message: {state.message ?? '—'}</div>
      <div className="text-slate-400">ticks: {state.ticks ?? '—'}</div>
      <button
        type="button"
        className="nodrag nopan w-fit rounded bg-sky-600 px-2 py-1 text-white hover:bg-sky-500"
        onClick={() => sendAction('ping')}
        onPointerDown={(e) => e.stopPropagation()}
      >
        send an action
      </button>
    </Panel>
  )
}
