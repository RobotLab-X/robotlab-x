import { useEffect, useState } from 'react'
import { wsClient, type WsState } from './wsClient'

/**
 * Subscribe a component to wsClient connection-state transitions.
 * The hook calls back into the singleton — there's exactly one WS per
 * tab, so every consumer sees the same state.
 */
export function useWsState(): WsState {
  const [state, setState] = useState<WsState>(() => wsClient.getState())
  useEffect(() => {
    const off = wsClient.subscribeState(setState)
    return () => off()
  }, [])
  return state
}
