import { useState, type FormEvent } from 'react'
import { useTopic } from '../runtime/useTopic'
import { wsClient } from '../runtime/wsClient'
import { useAuth } from '../contexts/AuthContext'
import Banner from '../components/Banner'
import ConnectionIndicator from '../components/ConnectionIndicator'

const DEFAULT_TOPIC = '/demo'

export default function WsDebug() {
  const { user, signOut } = useAuth()
  const [topic, setTopic] = useState(DEFAULT_TOPIC)
  const [activeTopic, setActiveTopic] = useState(DEFAULT_TOPIC)
  const [payload, setPayload] = useState('{"hello":"world"}')
  const [error, setError] = useState<string | null>(null)
  const { history } = useTopic<unknown>(activeTopic, { history: 50 })

  function handleSubscribe(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setActiveTopic(topic.trim())
  }

  function handlePublish() {
    setError(null)
    let parsed: unknown
    try {
      parsed = payload.trim() ? JSON.parse(payload) : null
    } catch (err) {
      setError(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    wsClient.publish(activeTopic, parsed)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">RobotLab-X · WebSocket Debug</h1>
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <ConnectionIndicator />
          <span>{user?.email ?? user?.id ?? 'unknown'}</span>
          <button
            type="button"
            onClick={signOut}
            className="rounded border border-slate-700 px-2 py-1 text-xs hover:border-slate-500"
          >
            Sign out
          </button>
        </div>
      </header>

      {error && <Banner tone="error">{error}</Banner>}

      <form onSubmit={handleSubscribe} className="flex gap-2 rounded-lg border border-slate-700 bg-slate-900/60 p-4">
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          className="flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
          placeholder="/topic/path"
        />
        <button
          type="submit"
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
        >
          Subscribe
        </button>
      </form>

      <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-4">
        <div className="text-xs uppercase tracking-wider text-slate-400">
          publish to <span className="font-mono">{activeTopic}</span>
        </div>
        <textarea
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          rows={3}
          className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
        />
        <button
          type="button"
          onClick={handlePublish}
          className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Publish
        </button>
      </div>

      <section className="space-y-1">
        <h2 className="text-sm font-semibold text-slate-300">
          Incoming on <span className="font-mono">{activeTopic}</span> · {history.length} message
          {history.length === 1 ? '' : 's'}
        </h2>
        <div className="max-h-96 overflow-auto rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs">
          {history.length === 0 ? (
            <div className="text-slate-500">waiting for messages…</div>
          ) : (
            history.map((msg, i) => (
              <pre key={i} className="border-b border-slate-800 py-1 last:border-0">
                {JSON.stringify(msg, null, 2)}
              </pre>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
