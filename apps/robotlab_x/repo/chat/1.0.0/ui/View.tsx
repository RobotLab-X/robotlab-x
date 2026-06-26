// Chat — view_full panel for the chat service.
//
// Three jobs:
//   1. Render a running transcript of the conversation. Each line is
//      either an operator turn (from /chat/<id>/inbox) or a brain
//      reply (from /chat/<id>/spoken).
//   2. Input box that publishes the operator's text to
//      /chat/<id>/inbox so the brain's listen() pulls it.
//   3. Status strip showing the service's listening state +
//      inbox-queue depth (from the retained /chat/<id>/state).
//
// The brain's conversation_session workflow is the typical consumer:
// the operator types here, the workflow calls listen → respond →
// speak, and the brain's speak result flows back to /spoken which
// this view picks up.
import {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
  type FormEvent, type KeyboardEvent,
} from 'react'

import type { ServiceProxy } from '@rlx/ui'
import { type InboundFrame } from '@rlx/ui'
import { useWsClient } from '@rlx/ui'


interface InboxPayload { text: string; ts?: number }
interface SpokenPayload { text: string; ts: number }
interface StatePayload {
  listening: boolean
  queued: number
  last_inbox?: string
  last_spoken?: string
}

interface Turn {
  from: 'operator' | 'brain'
  text: string
  ts: number
  // Stable id so React reconciles correctly when two messages share a
  // ts (rare but possible on a fast loopback bus).
  key: string
}


// Keep at most this many turns in the rendered transcript. Older
// entries scroll off; the bus itself is non-retained for /inbox + /spoken
// so there's no "load history on mount" path either way.
const MAX_TURNS = 200


export default function ChatFullView({ proxy }: { proxy: ServiceProxy }) {
  const wsClient = useWsClient()
  const proxyId = proxy.id ?? proxy.name ?? ''
  const inboxTopic = `/chat/${proxyId}/inbox`
  const spokenTopic = `/chat/${proxyId}/spoken`
  const stateTopic = `/chat/${proxyId}/state`

  const [transcript, setTranscript] = useState<Turn[]>([])
  const [state, setState] = useState<StatePayload | null>(null)
  const [draft, setDraft] = useState<string>('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // Counter for unique keys when ts collisions happen on rapid turns.
  const keyCounterRef = useRef(0)

  const pushTurn = useCallback((from: 'operator' | 'brain', text: string, ts: number) => {
    const trimmed = text.trim()
    if (!trimmed) return
    keyCounterRef.current += 1
    const key = `${ts}-${keyCounterRef.current}`
    setTranscript((prev) => {
      const next = [...prev, { from, text: trimmed, ts, key }]
      return next.length > MAX_TURNS ? next.slice(next.length - MAX_TURNS) : next
    })
  }, [])

  useEffect(() => {
    if (!proxyId) return
    const offInbox = wsClient.subscribe(inboxTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const p = (f.payload ?? {}) as InboxPayload
      if (typeof p.text !== 'string') return
      pushTurn('operator', p.text, p.ts ?? Date.now() / 1000)
    })
    const offSpoken = wsClient.subscribe(spokenTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const p = (f.payload ?? {}) as SpokenPayload
      if (typeof p.text !== 'string') return
      pushTurn('brain', p.text, p.ts ?? Date.now() / 1000)
    })
    const offState = wsClient.subscribe(stateTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      setState(f.payload as StatePayload)
    })
    return () => { offInbox(); offSpoken(); offState() }
  }, [proxyId, inboxTopic, spokenTopic, stateTopic, wsClient, pushTurn])

  // Auto-scroll to the bottom when a new turn arrives. ``useLayoutEffect``
  // runs synchronously after DOM commit but BEFORE paint — the scroll
  // assignment lands atomically with the new turn's render, so the
  // operator never sees a flash of the old position. Then a second
  // ``requestAnimationFrame`` pass catches cases where layout settles
  // late (async fonts, wrapped long messages whose final height is
  // computed in a microtask). Triggered on transcript.length change so
  // we don't fight the user while they sit idle between turns.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
    return () => cancelAnimationFrame(id)
  }, [transcript.length])

  const serviceRunning = proxy.status === 'running' || proxy.status === 'starting'

  const send = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault()
      const text = draft.trim()
      if (!text || !serviceRunning) return
      // Publish to /inbox directly — the chat service's inbox loop
      // queues it, and listen() drains the queue. The /inbox topic
      // also flows back to this view's subscription, which is where
      // the operator turn shows up in the transcript (single source
      // of truth — don't push locally or you'd render it twice).
      wsClient.publish(inboxTopic, { text, ts: Date.now() / 1000 })
      setDraft('')
    },
    [draft, inboxTopic, serviceRunning, wsClient],
  )

  // Enter submits, Shift-Enter inserts a newline (standard chat UX).
  const onKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }, [send])

  const fmtTime = (ts: number): string => {
    const d = new Date(ts * 1000)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  return (
    <div
      className="flex h-full min-h-[260px] min-w-[300px] flex-col gap-2 p-3 text-xs"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Status strip — operator's primary signal that brain is
          actually listening for them. ``listening`` flips true while
          the chat service's listen() is parked on the inbox queue;
          ``queued`` shows any unread inbox messages waiting for the
          next listen() call. */}
      <div className="flex items-baseline justify-between text-[10px] text-slate-500">
        <span>
          chat-{proxyId}
        </span>
        <span className="flex items-baseline gap-2">
          {state ? (
            <>
              <span className={state.listening ? 'text-emerald-400' : 'text-slate-500'}>
                {state.listening ? '● listening' : '○ idle'}
              </span>
              {state.queued > 0 && (
                <span className="text-amber-400" title="Messages queued for the next listen() call">
                  queued {state.queued}
                </span>
              )}
            </>
          ) : (
            <span>{serviceRunning ? 'loading…' : 'service not running'}</span>
          )}
        </span>
      </div>

      {/* Transcript — newest at the bottom; auto-scrolls when a turn
          arrives. Operator vs brain styling mirrors common chat UIs:
          operator is right-aligned + sky, brain is left + emerald.
          Empty state nudges the user toward the input.

          The ``relative`` outer + ``absolute inset-0`` inner pattern
          gives a bulletproof bounded scroll box. A pure flex chain
          (``flex-1 min-h-0 overflow-y-auto``) collapses to content
          height when an ancestor isn't height-anchored — which
          happens for view_full nodes BEFORE the operator drags a
          resize handle, since React Flow content-sizes unsized
          nodes. The absolutely-positioned inner div is always
          exactly the size of its relative parent's box (which
          ``flex-1 min-h-0`` does correctly establish, even when the
          flex chain doesn't bound the inner's natural height), so
          ``overflow-y-auto`` reliably triggers and auto-scroll
          actually has a scrollable target. */}
      <div className="relative min-h-0 flex-1 rounded border border-slate-800 bg-slate-950/60">
        <div
          ref={scrollRef}
          className="nodrag nopan absolute inset-0 flex flex-col gap-1 overflow-y-auto p-2"
          onWheel={(e) => e.stopPropagation()}
        >
          {transcript.length === 0 ? (
            <div className="text-[11px] text-slate-600">
              {serviceRunning
                ? 'no conversation yet — type below to talk to the brain'
                : 'start the chat service to begin a conversation'}
            </div>
          ) : (
            transcript.map((t) => {
              const isOperator = t.from === 'operator'
              return (
                <div
                  key={t.key}
                  className={`flex flex-col ${isOperator ? 'items-end' : 'items-start'}`}
                >
                  <span className="text-[9px] text-slate-600">
                    {t.from} · {fmtTime(t.ts)}
                  </span>
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap break-words rounded px-2 py-1 text-[11px] ${
                      isOperator
                        ? 'bg-sky-950/60 text-sky-100'
                        : 'bg-emerald-950/60 text-emerald-100'
                    }`}
                  >
                    {t.text}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Composer — textarea + Send. Enter submits, Shift-Enter newlines.
          nodrag + nopan on the textarea so React Flow doesn't grab the
          drag/pan gesture while the operator is typing. */}
      <form onSubmit={send} className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onClick={(e) => e.stopPropagation()}
          disabled={!serviceRunning}
          rows={2}
          placeholder={serviceRunning ? 'type here, Enter to send' : 'service not running'}
          className="nodrag nopan min-h-[44px] flex-1 resize-none rounded border border-slate-700 bg-slate-950 px-2 py-1 font-sans text-[12px] text-slate-100 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={!serviceRunning || draft.trim().length === 0}
          className="nodrag nopan rounded bg-sky-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  )
}
