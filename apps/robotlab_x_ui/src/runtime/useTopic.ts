import { useEffect, useRef, useState } from 'react'
import { wsClient, type InboundFrame } from './wsClient'

interface UseTopicOptions {
  // Number of historical messages to keep in the returned array. Old
  // entries are dropped (FIFO) once the limit is reached. Default 100.
  history?: number
}

/**
 * Subscribe to a bus topic for the lifetime of the component.
 *
 * Returns the latest message + a history slice (most recent last). The
 * subscription is cleaned up automatically when the component unmounts
 * or when the topic argument changes.
 */
export function useTopic<T = unknown>(
  topic: string | null | undefined,
  opts: UseTopicOptions = {},
): { latest: T | null; history: T[] } {
  const limit = opts.history ?? 100
  const [latest, setLatest] = useState<T | null>(null)
  const [history, setHistory] = useState<T[]>([])
  const limitRef = useRef(limit)
  limitRef.current = limit

  useEffect(() => {
    if (!topic) return
    const handler = (frame: InboundFrame) => {
      if (frame.method !== 'message') return
      const payload = frame.payload as T
      setLatest(payload)
      setHistory((prev) => {
        const next = prev.concat([payload])
        return next.length > limitRef.current
          ? next.slice(next.length - limitRef.current)
          : next
      })
    }
    const unsubscribe = wsClient.subscribe(topic, handler)
    return () => {
      unsubscribe()
    }
  }, [topic])

  return { latest, history }
}
