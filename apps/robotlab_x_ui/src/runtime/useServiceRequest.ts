// Generic "fire an action + wait for its reply" hook for service
// views. Wraps the bus's reply_to convention so a view doesn't have
// to hand-roll spinner state, unique reply topics, the
// awaitSubscribed race fix, and attempt-id bookkeeping every time
// it needs to know "did connect succeed?".
//
// The bus framework already publishes the @service_method return
// value to ``payload.reply_to`` automatically; this hook is the
// client-side counterpart that drives the UI states (spinner,
// debounce, error) and resolves a Promise when the reply lands.
//
// Usage:
//
//   const connect = useServiceRequest(controlTopic, {
//     timeoutMs: 10_000,
//     errorField: 'last_error',
//     replyPrefix: 'arduino',  // optional, just for nicer topic names
//   })
//
//   // In a button handler:
//   const onConnect = async () => {
//     await connect.request('connect', { port, baudrate })
//   }
//
//   // In JSX:
//   <button disabled={connect.inFlight} onClick={onConnect}>
//     {connect.inFlight ? <Loader2 className="animate-spin h-3 w-3" /> : 'Connect'}
//   </button>
//   {connect.error && <span className="text-rose-300">{connect.error}</span>}
//
// One ``useServiceRequest`` per logically-distinct action is the
// recommended pattern (one for connect, one for disconnect, …).
// They share the same spinner/error state inside but each has its
// own attempt-id so a slow connect reply can't clobber a fresh
// disconnect's UI state.
import { useCallback, useEffect, useRef, useState } from 'react'

import { useWsClient } from '../contexts/ActiveRuntimeContext'
import type { InboundFrame } from './wsClient'


export interface UseServiceRequestOptions<T> {
  /** How long to wait for a reply before declaring the request
   *  failed. The UI unlocks regardless; the error message names the
   *  timeout. Default 10s — matches what arduino's connect uses for
   *  pymata4's handshake plus serial settle. */
  timeoutMs?: number
  /** Where the error lives on the reply payload. Most actions
   *  return ``{error: "..."}`` or a state-shaped snapshot with a
   *  field like ``last_error`` / ``connect_error``. Pass the field
   *  name and we'll surface its value as ``error`` when non-null.
   *  Default: 'error'. */
  errorField?: keyof T | 'error' | string
  /** A short label that goes into the reply topic so bus diagnostics
   *  (Topics tab, /v1/bus/topics) can identify the source. Doesn't
   *  affect correctness — just human-readable. Default: 'svc'. */
  replyPrefix?: string
}


export interface UseServiceRequestResult<T> {
  /** True while a request is in flight. Bind to the button's
   *  ``disabled`` (debounce) and ``aria-busy`` (a11y). */
  inFlight: boolean
  /** Latest error string, cleared on each new request. Carries the
   *  reply's ``errorField`` or a timeout message. */
  error: string | null
  /** Latest non-error reply payload, cleared on each new request.
   *  Useful when the caller wants to act on the result without
   *  awaiting the Promise. */
  reply: T | null
  /** Issue the request. Returns the resolved reply (or null on
   *  error/timeout — check ``error`` for the reason). The button's
   *  onClick can either await this or ignore the return value and
   *  watch ``inFlight`` / ``error`` from state. Safe to call again
   *  while a previous request is in flight — the prior attempt is
   *  abandoned (its reply is discarded if it ever arrives). */
  request: (action: string, args?: Record<string, unknown>) => Promise<T | null>
}


export function useServiceRequest<T = unknown>(
  controlTopic: string,
  options: UseServiceRequestOptions<T> = {},
): UseServiceRequestResult<T> {
  const wsClient = useWsClient()
  const {
    timeoutMs = 10_000,
    errorField = 'error',
    replyPrefix = 'svc',
  } = options

  const [inFlight, setInFlight] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reply, setReply] = useState<T | null>(null)

  // ``attemptId`` ratchets every time ``request`` is invoked. Any
  // reply or timeout that fires for a now-stale attempt is silently
  // ignored so a slow connect reply can't paint over a fresh
  // disconnect's UI.
  const attemptIdRef = useRef(0)

  // GC any pending subscriptions/timers on unmount so we don't leak
  // listeners after the view is dismounted.
  const cleanupsRef = useRef<Array<() => void>>([])
  useEffect(() => {
    return () => {
      for (const c of cleanupsRef.current) {
        try { c() } catch { /* noop */ }
      }
      cleanupsRef.current = []
    }
  }, [])

  const request = useCallback(
    async (action: string, args: Record<string, unknown> = {}): Promise<T | null> => {
      const myId = ++attemptIdRef.current
      // Unique reply topic per attempt. The ``cli/reply/`` prefix
      // matches the convention other views already use and keeps
      // these topics filterable in the Topics tab. Including the
      // attempt id + timestamp guarantees uniqueness even under
      // rapid re-clicks.
      const replyTopic = `/cli/reply/${replyPrefix}-${myId}-${Date.now()}`
      setInFlight(true)
      setError(null)
      setReply(null)

      return new Promise<T | null>((resolve) => {
        let resolved = false
        let timer: ReturnType<typeof setTimeout> | null = null
        let offSub: (() => void) | null = null
        const finish = (result: T | null) => {
          if (resolved) return
          resolved = true
          if (timer !== null) { clearTimeout(timer); timer = null }
          if (offSub !== null) { offSub(); offSub = null }
          // Drop this attempt's cleanup from the unmount list
          // (already torn down) — the array search is O(n) but n is
          // tiny (one entry per pending request).
          const idx = cleanupsRef.current.indexOf(teardown)
          if (idx >= 0) cleanupsRef.current.splice(idx, 1)
          // Only update React state if this attempt is still the
          // most recent one. Stale replies are reported via the
          // resolved Promise but don't touch the UI.
          if (myId === attemptIdRef.current) {
            setInFlight(false)
          }
          resolve(result)
        }
        const teardown = () => finish(null)
        cleanupsRef.current.push(teardown)

        // Subscribe FIRST so we don't race the reply.
        offSub = wsClient.subscribe(replyTopic, (f: InboundFrame) => {
          if (resolved || f.method !== 'message') return
          if (myId !== attemptIdRef.current) {
            // Stale reply for an abandoned attempt — drop it but
            // still tear down our subscription.
            finish(null)
            return
          }
          const payload = (f.payload ?? {}) as Record<string, unknown> & T
          // Pull the error field if the reply carries one. The
          // service framework's auto-reply publishes the @service_method's
          // return value verbatim, so the convention is "reply has an
          // explicit ``error`` field when something went wrong".
          // Snapshot-style returns (Serial's _snapshot) carry
          // ``last_error`` instead — caller picks via options.
          const errMsg = payload[errorField as string]
          if (typeof errMsg === 'string' && errMsg) {
            setError(errMsg)
            setReply(null)
            finish(null)
            return
          }
          // No error → success. Stash the reply so the caller can
          // read it without awaiting the Promise.
          setReply(payload as T)
          finish(payload as T)
        })

        // awaitSubscribed defends against the bus race where the
        // reply gets published before our subscribe ack is
        // processed. Drop the reply attempt if subscribing fails
        // outright — that's a much bigger problem.
        wsClient.awaitSubscribed(replyTopic).then(() => {
          if (resolved) return
          wsClient.publish(controlTopic, { action, ...args, reply_to: replyTopic })
        }).catch((subErr: unknown) => {
          if (myId !== attemptIdRef.current) { finish(null); return }
          setError(`subscribe failed: ${subErr instanceof Error ? subErr.message : String(subErr)}`)
          finish(null)
        })

        timer = setTimeout(() => {
          if (resolved) return
          if (myId !== attemptIdRef.current) { finish(null); return }
          setError(`no reply within ${(timeoutMs / 1000).toFixed(1)}s`)
          finish(null)
        }, timeoutMs)
      })
    },
    [controlTopic, wsClient, errorField, replyPrefix, timeoutMs],
  )

  return { inFlight, error, reply, request }
}
