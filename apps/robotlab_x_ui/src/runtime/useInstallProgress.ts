// Shared install-progress hook — the single source of truth for turning
// the backend's structured install milestones into InstallProgressState,
// used by BOTH the Composer canvas (placeholder Start) and the Catalog
// page (type Install). Both backends publish the SAME frame schema:
//
//   {phase:'install', step_id, label, index, total, status,
//    detail?, stream?, error_code?}
//
// on different topics (`/service_request/{id}/progress` vs
// `/registry/install/{metaId}/progress`). This hook is topic-agnostic —
// the caller passes the full topic to watch(). The dumb renderer is
// components/InstallProgress.tsx.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useWsClient } from '../contexts/ActiveRuntimeContext'
import type { InboundFrame } from './wsClient'
import type { InstallProgressState, InstallStepState } from '../components/InstallProgress'

export type InstallProgressMap = Record<string, InstallProgressState>

export interface UseInstallProgress {
  /** Per-key live progress. Key is whatever the caller chose (proxyId on
   *  the canvas, `name@version` metaId on the Catalog). */
  progress: InstallProgressMap
  /** Subscribe to `topic` and fold its milestones into progress[key].
   *  Call this BEFORE triggering the install (subscribe-before-publish)
   *  so no early frames are missed. `requestId` is cosmetic (stored on
   *  the state); defaults to `key`. Self-cancels on a terminal state. */
  watch: (key: string, topic: string, requestId?: string) => void
  /** Drop progress[key] and unsubscribe — e.g. the user dismissed it. */
  dismiss: (key: string) => void
}

export function useInstallProgress(): UseInstallProgress {
  const wsClient = useWsClient()
  const unsubs = useRef<Record<string, () => void>>({})
  const [progress, setProgress] = useState<InstallProgressMap>({})

  const dismiss = useCallback((key: string) => {
    unsubs.current[key]?.()
    delete unsubs.current[key]
    setProgress((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  const watch = useCallback((key: string, topic: string, requestId?: string) => {
    unsubs.current[key]?.()
    const rid = requestId ?? key
    setProgress((prev) => ({
      ...prev,
      [key]: { requestId: rid, steps: [], log: [], overall: 'running' },
    }))
    const off = wsClient.subscribe(topic, (frame: InboundFrame) => {
      if (frame.method !== 'message') return
      const p = frame.payload as {
        phase?: string; step_id?: string; label?: string; index?: number; total?: number
        status?: string; detail?: string; stream?: string; error_code?: string
      } | undefined
      if (!p || p.phase !== 'install' || !p.step_id) return
      setProgress((prev) => {
        const cur = prev[key] ?? { requestId: rid, steps: [], log: [], overall: 'running' as const }
        if (p.stream) {
          // Raw subprocess output line.
          if (!p.detail) return prev
          return { ...prev, [key]: { ...cur, log: [...cur.log, p.detail].slice(-400) } }
        }
        // Milestone.
        const step: InstallStepState = {
          stepId: p.step_id!,
          label: p.label ?? p.step_id!,
          index: p.index ?? cur.steps.length + 1,
          total: p.total ?? cur.steps.length + 1,
          status: (p.status as InstallStepState['status']) ?? 'running',
          errorCode: p.error_code,
        }
        const steps = cur.steps.filter((s) => s.stepId !== step.stepId).concat([step]).sort((a, b) => a.index - b.index)
        let overall = cur.overall
        let error = cur.error
        if (step.status === 'failed') {
          overall = 'failed'
          error = { stepId: step.stepId, message: p.detail || `${step.label} failed`, code: p.error_code }
        } else if (step.status === 'completed' && step.index >= step.total) {
          overall = 'completed'
        }
        if (overall !== 'running') {
          // Terminal — stop listening (defer so we don't unsub mid-dispatch).
          setTimeout(() => {
            unsubs.current[key]?.()
            delete unsubs.current[key]
          }, 0)
        }
        return { ...prev, [key]: { ...cur, steps, overall, error } }
      })
    })
    unsubs.current[key] = off
  }, [wsClient])

  // Clean up any open progress subscriptions on unmount.
  useEffect(() => () => {
    for (const off of Object.values(unsubs.current)) off()
    unsubs.current = {}
  }, [])

  return { progress, watch, dismiss }
}
