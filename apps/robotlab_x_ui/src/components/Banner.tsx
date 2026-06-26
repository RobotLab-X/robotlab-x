type Tone = 'info' | 'success' | 'error'

const TONE_STYLES: Record<Tone, string> = {
  info: 'border-sky-500/40 bg-sky-500/10 text-sky-100',
  success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100',
  error: 'border-rose-500/40 bg-rose-500/10 text-rose-100',
}

export default function Banner({
  tone = 'info',
  children,
}: {
  tone?: Tone
  children: React.ReactNode
}) {
  return (
    <div
      role="status"
      className={`rounded border px-3 py-2 text-sm ${TONE_STYLES[tone]}`}
    >
      {children}
    </div>
  )
}
