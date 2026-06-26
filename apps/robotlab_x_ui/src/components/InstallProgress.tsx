// Install progress panel — renders the structured install milestones the
// backend streams on /service_request/{id}/progress while a placeholder's
// type dependencies are being installed (M2 of the install wizard).
//
// Shows a step list (Create venv → Install bus client → Install deps),
// a collapsible raw subprocess log, and on failure a structured error
// (which step, why) with a Retry button. Subscription + parsing live in
// Composer; this is the dumb renderer.
import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2, XCircle, Circle, ChevronRight, ChevronDown } from 'lucide-react'

export type InstallStepStatus = 'running' | 'completed' | 'failed'

export interface InstallStepState {
  stepId: string
  label: string
  index: number
  total: number
  status: InstallStepStatus
  errorCode?: string
}

export interface InstallProgressState {
  requestId: string
  steps: InstallStepState[]
  log: string[]
  overall: 'running' | 'completed' | 'failed'
  error?: { stepId?: string; message: string; code?: string }
}

function StepIcon({ status }: { status: InstallStepStatus }) {
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 text-emerald-400" />
  if (status === 'failed') return <XCircle className="h-4 w-4 text-rose-400" />
  return <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
}

interface Props {
  state: InstallProgressState
  onRetry?: () => void
  onDismiss?: () => void
}

export default function InstallProgress({ state, onRetry, onDismiss }: Props) {
  const [showLog, setShowLog] = useState(false)
  const { steps, log, overall, error } = state

  // Keep the raw-log pane pinned to the newest line as output streams in.
  const logRef = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log, showLog])

  // Steps arrive as they start; pad to the announced total so the user
  // sees the full plan (greyed) up front rather than a list that grows.
  const total = steps[0]?.total ?? steps.length
  const byIndex = new Map(steps.map((s) => [s.index, s]))

  return (
    <div className="space-y-2 rounded border border-slate-700 bg-slate-900/60 p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-200">
          {overall === 'completed' ? 'Installed' : overall === 'failed' ? 'Install failed' : 'Installing…'}
        </span>
        {(overall === 'completed' || overall === 'failed') && onDismiss && (
          <button type="button" onClick={onDismiss} className="text-slate-500 hover:text-slate-300">
            Dismiss
          </button>
        )}
      </div>

      <ol className="space-y-1">
        {Array.from({ length: total }, (_, i) => {
          const step = byIndex.get(i + 1)
          if (!step) {
            return (
              <li key={i} className="flex items-center gap-2 text-slate-500">
                <Circle className="h-4 w-4" />
                <span>Step {i + 1}</span>
              </li>
            )
          }
          return (
            <li
              key={step.stepId}
              className={`flex items-center gap-2 ${
                step.status === 'failed' ? 'text-rose-300' : 'text-slate-200'
              }`}
            >
              <StepIcon status={step.status} />
              <span>{step.label}</span>
            </li>
          )
        })}
      </ol>

      {error && (
        <div className="rounded bg-rose-950/50 p-2 text-rose-200">
          <div className="font-medium">{error.message}</div>
          {error.code && <div className="text-[10px] text-rose-400">code: {error.code}</div>}
        </div>
      )}

      {log.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowLog((v) => !v)}
            className="flex items-center gap-1 text-slate-400 hover:text-slate-200"
          >
            {showLog ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {showLog ? 'Hide' : 'Show'} detail ({log.length} lines)
          </button>
          {showLog && (
            <pre ref={logRef} className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 font-mono text-[10px] leading-snug text-slate-300">
              {log.slice(-200).join('\n')}
            </pre>
          )}
        </div>
      )}

      {overall === 'failed' && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded border border-slate-600 px-2 py-1 text-slate-200 hover:border-slate-400"
        >
          Retry install
        </button>
      )}
    </div>
  )
}
