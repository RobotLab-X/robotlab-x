import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Editor from '@monaco-editor/react'

import { apiFetch } from '../lib/api'
import Banner from '../components/Banner'
import type { Script } from '../models/Script'
import { wsClient, type InboundFrame } from '../runtime/wsClient'

interface OutputLine {
  stream: 'stdout' | 'stderr' | 'meta'
  text: string
  ts: number
}

interface RunState {
  runId: string | null
  startedAt: number | null
  exitCode: number | null
  timedOut: boolean
}

const INITIAL_RUN: RunState = { runId: null, startedAt: null, exitCode: null, timedOut: false }

export default function ScriptEditor() {
  const navigate = useNavigate()
  const { id: rawId } = useParams<{ id: string }>()
  const scriptId = decodeURIComponent(rawId ?? '')

  const [script, setScript] = useState<Script | null>(null)
  const [body, setBody] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [lines, setLines] = useState<OutputLine[]>([])
  const [run, setRun] = useState<RunState>(INITIAL_RUN)

  // Debounced auto-save so the editor doesn't write on every keystroke.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingBody = useRef<string>('')

  // ─── load ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiFetch<Script>(`/v1/script/${encodeURIComponent(scriptId)}`)
      .then((s) => {
        if (cancelled) return
        setScript(s)
        setBody(s.body ?? '')
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [scriptId])

  // ─── subscribe to per-script output ──────────────────────────────────
  useEffect(() => {
    if (!script?.id) return
    const topic = `/script/${script.id}/output`
    const off = wsClient.subscribe(topic, (frame: InboundFrame) => {
      if (frame.method !== 'message') return
      const p = frame.payload as Record<string, unknown> | null
      if (!p) return
      const stream = p.stream as OutputLine['stream'] | undefined
      if (stream === 'meta') {
        const event = p.event as string | undefined
        if (event === 'start') {
          setLines((prev) => prev.concat([{ stream: 'meta', text: '▶ run started', ts: Date.now() }]))
          setRun((r) => ({ ...r, runId: (p.run_id as string) ?? null, startedAt: Date.now(), exitCode: null, timedOut: false }))
          setRunning(true)
        } else if (event === 'end') {
          const code = (p.exit_code as number | null) ?? null
          const elapsed = (p.elapsed_ms as number | null) ?? null
          setLines((prev) =>
            prev.concat([
              {
                stream: 'meta',
                text: `■ exit ${code} (${elapsed}ms)`,
                ts: Date.now(),
              },
            ]),
          )
          setRun((r) => ({ ...r, exitCode: code }))
          setRunning(false)
        } else if (event === 'timeout') {
          setLines((prev) =>
            prev.concat([
              { stream: 'meta', text: '⏱ timed out — process killed', ts: Date.now() },
            ]),
          )
          setRun((r) => ({ ...r, timedOut: true }))
        } else if (event === 'error') {
          setLines((prev) =>
            prev.concat([
              { stream: 'meta', text: `! runner error: ${p.error ?? 'unknown'}`, ts: Date.now() },
            ]),
          )
          setRunning(false)
        }
      } else if (stream === 'stdout' || stream === 'stderr') {
        const text = (p.line as string) ?? ''
        setLines((prev) => prev.concat([{ stream, text, ts: Date.now() }]))
      }
    })
    return () => off()
  }, [script?.id])

  // ─── persistence ─────────────────────────────────────────────────────
  const persist = useCallback(
    (nextBody: string) => {
      pendingBody.current = nextBody
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(async () => {
        if (!script?.id) return
        setSaving(true)
        try {
          await apiFetch<Script>(`/v1/script/${encodeURIComponent(script.id)}`, {
            method: 'PUT',
            body: JSON.stringify({ ...script, body: pendingBody.current }),
          })
        } catch (err) {
          if (err instanceof Error) setError(err.message)
        } finally {
          setSaving(false)
        }
      }, 500)
    },
    [script],
  )

  function handleEditorChange(value: string | undefined) {
    const next = value ?? ''
    setBody(next)
    persist(next)
  }

  async function handleRun() {
    if (!script?.id) return
    setLines([])
    setRun(INITIAL_RUN)
    setError(null)
    try {
      await apiFetch('/v1/script-request', {
        method: 'POST',
        body: JSON.stringify({ action: 'run', id: script.id }),
      })
    } catch (err) {
      if (err instanceof Error) setError(err.message)
    }
  }

  function clearOutput() {
    setLines([])
    setRun(INITIAL_RUN)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/scripts')}
            className="text-sm text-slate-400 hover:text-slate-200"
          >
            ← Scripts
          </button>
          <h1 className="text-base font-semibold">{script?.name ?? scriptId}</h1>
          {saving && <span className="text-xs text-slate-500">saving…</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRun}
            disabled={running || loading}
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            {running ? 'Running…' : 'Run'}
          </button>
          <button
            type="button"
            onClick={clearOutput}
            className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500"
          >
            Clear
          </button>
        </div>
      </header>

      {error && (
        <div className="border-b border-rose-900 px-4 py-2">
          <Banner tone="error">{error}</Banner>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="p-6 text-sm text-slate-400">Loading…</div>
          ) : (
            <Editor
              height="100%"
              language={script?.language ?? 'python'}
              value={body}
              onChange={handleEditorChange}
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                tabSize: 4,
                automaticLayout: true,
              }}
            />
          )}
        </div>

        <aside className="w-[42%] shrink-0 overflow-hidden border-l border-slate-800 bg-slate-950">
          <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-1.5 text-xs">
            <span className="font-semibold text-slate-300">output</span>
            <div className="flex gap-2 text-slate-500">
              {run.runId && <span className="font-mono">run {run.runId}</span>}
              {run.exitCode !== null && (
                <span className={run.exitCode === 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  exit {run.exitCode}
                </span>
              )}
              {run.timedOut && <span className="text-amber-400">timed out</span>}
            </div>
          </div>
          <div className="h-full overflow-y-auto p-2 font-mono text-xs">
            {lines.length === 0 && (
              <div className="text-slate-500">
                Click Run to execute the script. Output streams here over WebSocket.
              </div>
            )}
            {lines.map((l, i) => (
              <div
                key={i}
                className={
                  l.stream === 'stderr'
                    ? 'text-rose-300'
                    : l.stream === 'meta'
                      ? 'text-slate-400'
                      : 'text-slate-100'
                }
              >
                {l.text}
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  )
}
