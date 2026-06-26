// CopyButton — small clipboard icon button. Reusable across the app
// anywhere a path / id / ciphertext / api key wants a one-click copy.
//
// Visual feedback: icon flips to a checkmark for ~1.5s on success,
// or an X for ~2s on failure (e.g. clipboard permission denied in
// some sandboxes). Tooltip on hover always shows the value being
// copied so operators can read it without copying.
import { useCallback, useState } from 'react'
import { Check, Clipboard, X } from 'lucide-react'


interface CopyButtonProps {
  /** The text the button copies on click. */
  value: string
  /** Optional override label shown in the tooltip. Defaults to the
   *  value itself (truncated to ~120 chars). */
  title?: string
  /** Icon size in pixels. Defaults to 12 — sized to sit inline next
   *  to mono-font paths without dominating. */
  size?: number
  /** Extra classes applied to the button wrapper. */
  className?: string
}


export function CopyButton({ value, title, size = 12, className = '' }: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'ok' | 'err'>('idle')

  const onClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    // ``navigator.clipboard`` requires a secure context (https or
    // localhost). On http://10.x.x.x the modern API throws — fall back
    // to the legacy textarea+execCommand trick so copy still works.
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value)
      } else {
        const ta = document.createElement('textarea')
        ta.value = value
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setState('ok')
      setTimeout(() => setState('idle'), 1500)
    } catch {
      setState('err')
      setTimeout(() => setState('idle'), 2000)
    }
  }, [value])

  const Icon = state === 'ok' ? Check : state === 'err' ? X : Clipboard
  const color = state === 'ok' ? 'text-emerald-400'
    : state === 'err' ? 'text-rose-400'
    : 'text-slate-500 hover:text-slate-300'

  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded p-0.5 transition-colors ${color} ${className}`}
      title={title ?? (value.length > 120 ? value.slice(0, 117) + '…' : value)}
      aria-label="Copy"
    >
      <Icon size={size} />
    </button>
  )
}
