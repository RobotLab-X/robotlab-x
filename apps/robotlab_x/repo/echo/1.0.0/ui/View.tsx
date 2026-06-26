// Modular service UI for echo — the real, COMPILED source (Option B,
// docs/TODO_SERVICE_UI_BUNDLES.md). Built to ui/dist/ui.js by the
// framework-owned vite lib config (externalizing react + @rlx/ui, JSX via
// the automatic runtime → exercises the /rlx/jsx-runtime.js shim). A
// service author writes only this file.
import { useEffect, useState } from 'react'
import { useWsClient, Panel, type ServiceProxy } from '@rlx/ui'

export default function EchoView({ proxy }: { proxy: ServiceProxy }) {
  const proxyId = proxy?.id ?? proxy?.name ?? 'echo'
  // Self-contained bus proof: publish to our own topic and watch it come
  // back through our own subscription (the bus fans out to all subscribers,
  // sender included). No dependency on a running service.
  const topic = `/rlx/spike/${proxyId}`
  const ws = useWsClient()
  const [clicks, setClicks] = useState(0)
  const [roundtrips, setRoundtrips] = useState(0)

  useEffect(() => {
    const off = ws.subscribe(topic, (f) => {
      if (f.method === 'message') setRoundtrips((n) => n + 1)
    })
    return off
  }, [ws, topic])

  const ping = () => {
    setClicks((c) => c + 1)
    ws.publish(topic, { ping: clicks + 1 })
  }

  return (
    <Panel title="modular ui bundle (built via vite lib)">
      <div className="font-mono text-emerald-300">
        ✓ compiled View.tsx → ui.js (jsx-runtime + externals)
      </div>
      <div className="text-slate-400">proxy: {proxyId}</div>
      <div className="text-slate-400">host React hooks: clicks = {clicks}</div>
      <div className="text-slate-400">bus round-trips seen: {roundtrips}</div>
      <button
        className="nodrag nopan w-fit rounded bg-sky-600 px-2 py-1 text-white hover:bg-sky-500"
        onClick={ping}
        onPointerDown={(e) => e.stopPropagation()}
      >
        ping bus (publish → subscribe round-trip)
      </button>
    </Panel>
  )
}
