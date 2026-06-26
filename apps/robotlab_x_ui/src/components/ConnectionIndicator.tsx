import { useWsState } from '../runtime/useWsState'

const TONE: Record<string, { dot: string; ring: string; label: string }> = {
  connected: {
    dot: 'bg-emerald-400',
    ring: 'ring-emerald-400/30',
    label: 'connected',
  },
  connecting: {
    dot: 'bg-amber-400 animate-pulse',
    ring: 'ring-amber-400/30',
    label: 'connecting…',
  },
  disconnected: {
    dot: 'bg-rose-500 animate-pulse',
    ring: 'ring-rose-500/40',
    label: 'disconnected — retrying',
  },
}

/**
 * Live WebSocket connection indicator. Sits in the app header on
 * every page. Green = open, amber = handshaking, red = closed and
 * the wsClient is retrying with exponential backoff.
 *
 * Multi-backend connection selection lands here eventually — for
 * now the indicator reads the single same-origin connection.
 */
export default function ConnectionIndicator() {
  const state = useWsState()
  const tone = TONE[state] ?? TONE.disconnected
  return (
    <span
      role="status"
      aria-label={`backend ${tone.label}`}
      className="inline-flex items-center gap-1.5 text-xs text-slate-400"
      title={`Backend ${tone.label}`}
    >
      <span className={`inline-block h-2.5 w-2.5 rounded-full ring-2 ${tone.dot} ${tone.ring}`} />
      <span className="hidden sm:inline">{tone.label}</span>
    </span>
  )
}
