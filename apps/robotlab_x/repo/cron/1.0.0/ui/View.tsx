import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { ServiceProxy } from '@rlx/ui'
import { type InboundFrame } from '@rlx/ui'
import { useWsClient } from '@rlx/ui'

// CronService's full view: a table of scheduled jobs + an "add job"
// form. State comes from /cron/{id}/state retained. Edits are sent as
// {action: 'add_job' | 'update_job' | ...} on /cron/{id}/control.
//
// Schedule is the standard 5-field cron expression. Payload is freeform
// JSON; the textarea is parsed before publishing so the user catches
// JSON typos here rather than after the cron tries to fire.

interface CronJob {
  id: string
  name: string
  schedule: string
  topic: string
  payload: unknown
  enabled: boolean
  retained: boolean
  last_run: number | null
  last_error: string | null
  next_run: number | null
}

interface CronState {
  jobs?: CronJob[]
}

interface FiredEvent {
  job_id: string
  name?: string
  topic: string
  ts: number
}

export default function CronFullView({ proxy }: { proxy: ServiceProxy }) {
  const wsClient = useWsClient()
  const proxyId = proxy.id ?? proxy.name ?? ''
  const stateTopic = `/cron/${proxyId}/state`
  const firedTopic = `/cron/${proxyId}/fired`
  const controlTopic = `/cron/${proxyId}/control`

  const [state, setState] = useState<CronState>({})
  const [recentFires, setRecentFires] = useState<FiredEvent[]>([])

  useEffect(() => {
    if (!proxyId) return
    const off1 = wsClient.subscribe(stateTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      setState((f.payload as CronState) ?? {})
    })
    const off2 = wsClient.subscribe(firedTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const p = f.payload as FiredEvent | undefined
      if (!p?.job_id) return
      setRecentFires((prev) => prev.concat([p]).slice(-10))
    })
    return () => { off1(); off2() }
  }, [proxyId, stateTopic, firedTopic, wsClient])

  const send = useCallback(
    (action: string, args: Record<string, unknown> = {}) => {
      wsClient.publish(controlTopic, { action, ...args })
    },
    [controlTopic, wsClient],
  )

  const jobs = state.jobs ?? []

  return (
    <div className="flex min-w-[560px] flex-col gap-3 p-3 text-xs">
      <AddJobForm onAdd={(args) => send('add_job', args)} />
      <JobTable
        jobs={jobs}
        onToggle={(j) => send(j.enabled ? 'disable_job' : 'enable_job', { id: j.id })}
        onRunNow={(j) => send('run_job_now', { id: j.id })}
        onRemove={(j) => send('remove_job', { id: j.id })}
        onUpdate={(id, patch) => send('update_job', { id, ...patch })}
      />
      <RecentFires fires={recentFires} jobs={jobs} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// AddJobForm — collapsible at the top
// ─────────────────────────────────────────────────────────────────────

function AddJobForm({
  onAdd,
}: {
  onAdd: (args: Record<string, unknown>) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [schedule, setSchedule] = useState('*/5 * * * *')
  const [topic, setTopic] = useState('')
  const [payload, setPayload] = useState('{}')
  const [retained, setRetained] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback((e?: FormEvent) => {
    e?.preventDefault()
    if (!topic.trim().startsWith('/')) {
      setError('Topic must be an absolute path starting with /')
      return
    }
    let parsed: unknown = null
    if (payload.trim() !== '') {
      try {
        parsed = JSON.parse(payload)
      } catch {
        setError('Payload is not valid JSON')
        return
      }
    }
    setError(null)
    onAdd({
      schedule: schedule.trim(),
      topic: topic.trim(),
      payload: parsed,
      name: name.trim(),
      retained,
    })
    // Reset to defaults so a sequence of adds is fast
    setName('')
    setTopic('')
    setPayload('{}')
    setOpen(false)
  }, [name, schedule, topic, payload, retained, onAdd])

  return (
    <Section title={open ? 'add job' : 'add job ▸'}>
      <div className="-mt-1 mb-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 hover:border-slate-500"
        >
          {open ? 'Cancel' : '+ New job'}
        </button>
      </div>
      {open && (
        <form
          onSubmit={submit}
          onPointerDown={(e) => e.stopPropagation()}
          className="space-y-2"
        >
          <div className="flex gap-2">
            <LabeledInput
              label="name"
              value={name}
              onChange={setName}
              placeholder="e.g. heartbeat"
              className="flex-1"
            />
            <LabeledInput
              label="schedule"
              value={schedule}
              onChange={setSchedule}
              placeholder="*/5 * * * *"
              className="flex-1"
              mono
            />
          </div>
          <LabeledInput
            label="topic"
            value={topic}
            onChange={setTopic}
            placeholder="/servo/servo-1/control"
            mono
          />
          <div>
            <div className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">payload (JSON)</div>
            <textarea
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              rows={3}
              className="nodrag nopan w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-200 focus:border-slate-500 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500">
              <input
                type="checkbox"
                checked={retained}
                onChange={(e) => setRetained(e.target.checked)}
              />
              retained
            </label>
            <button
              type="submit"
              className="ml-auto rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-emerald-500"
            >
              Add
            </button>
          </div>
          {error && (
            <div className="rounded border border-rose-700 bg-rose-950/40 px-2 py-1 font-mono text-[10px] text-rose-200">
              {error}
            </div>
          )}
          <ScheduleHint />
        </form>
      )}
    </Section>
  )
}

function ScheduleHint() {
  return (
    <div className="rounded border border-slate-800 bg-slate-950/70 p-2 text-[10px] leading-tight text-slate-400">
      <div className="text-slate-300">Cron 5-field syntax:</div>
      <div className="font-mono">
        <span className="text-emerald-300">m</span> <span className="text-emerald-300">h</span> <span className="text-emerald-300">dom</span> <span className="text-emerald-300">mon</span> <span className="text-emerald-300">dow</span>
      </div>
      <div className="mt-1 grid grid-cols-[max-content_1fr] gap-x-2">
        <span className="font-mono text-slate-500">*/5 * * * *</span><span>every 5 min</span>
        <span className="font-mono text-slate-500">0 * * * *</span><span>top of every hour</span>
        <span className="font-mono text-slate-500">0 9 * * 1-5</span><span>9 AM on weekdays</span>
        <span className="font-mono text-slate-500">30 2 * * 0</span><span>02:30 Sunday</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// JobTable — main display
// ─────────────────────────────────────────────────────────────────────

function JobTable({
  jobs, onToggle, onRunNow, onRemove, onUpdate,
}: {
  jobs: CronJob[]
  onToggle: (j: CronJob) => void
  onRunNow: (j: CronJob) => void
  onRemove: (j: CronJob) => void
  onUpdate: (id: string, patch: Record<string, unknown>) => void
}) {
  return (
    <Section title={`jobs (${jobs.length})`}>
      {jobs.length === 0 && (
        <div className="text-slate-500">
          No jobs scheduled. Add one above — pair a cron expression with a topic + payload.
        </div>
      )}
      {jobs.length > 0 && (
        <table className="w-full table-auto">
          <thead className="text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="py-1 text-left">name</th>
              <th className="py-1 text-left">schedule</th>
              <th className="py-1 text-left">topic</th>
              <th className="py-1 text-left">last</th>
              <th className="py-1 text-left">next</th>
              <th className="py-1 text-right">actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <JobRow
                key={j.id}
                job={j}
                onToggle={() => onToggle(j)}
                onRunNow={() => onRunNow(j)}
                onRemove={() => onRemove(j)}
                onUpdate={(patch) => onUpdate(j.id, patch)}
              />
            ))}
          </tbody>
        </table>
      )}
    </Section>
  )
}

function JobRow({
  job, onToggle, onRunNow, onRemove, onUpdate,
}: {
  job: CronJob
  onToggle: () => void
  onRunNow: () => void
  onRemove: () => void
  onUpdate: (patch: Record<string, unknown>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draftSchedule, setDraftSchedule] = useState(job.schedule)
  const [draftTopic, setDraftTopic] = useState(job.topic)
  const [draftPayload, setDraftPayload] = useState(
    typeof job.payload === 'string' ? job.payload : JSON.stringify(job.payload ?? null),
  )
  const [editErr, setEditErr] = useState<string | null>(null)

  // Reset drafts to authoritative state whenever the job updates and we're not editing.
  useEffect(() => {
    if (editing) return
    setDraftSchedule(job.schedule)
    setDraftTopic(job.topic)
    setDraftPayload(
      typeof job.payload === 'string' ? job.payload : JSON.stringify(job.payload ?? null),
    )
  }, [editing, job.schedule, job.topic, job.payload])

  const saveEdit = () => {
    let parsed: unknown = null
    if (draftPayload.trim() !== '') {
      try {
        parsed = JSON.parse(draftPayload)
      } catch {
        setEditErr('Payload is not valid JSON')
        return
      }
    }
    if (!draftTopic.startsWith('/')) {
      setEditErr('Topic must start with /')
      return
    }
    setEditErr(null)
    onUpdate({ schedule: draftSchedule, topic: draftTopic, payload: parsed })
    setEditing(false)
  }

  if (editing) {
    return (
      <tr className="border-t border-slate-800 align-top">
        <td colSpan={6} className="px-1 py-2">
          <div className="space-y-1 rounded border border-slate-700 bg-slate-900/60 p-2">
            <div className="flex gap-2">
              <LabeledInput label="schedule" value={draftSchedule} onChange={setDraftSchedule} mono className="flex-1" />
              <LabeledInput label="topic" value={draftTopic} onChange={setDraftTopic} mono className="flex-1" />
            </div>
            <div>
              <div className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">payload (JSON)</div>
              <textarea
                value={draftPayload}
                onChange={(e) => setDraftPayload(e.target.value)}
                onPointerDown={(e) => e.stopPropagation()}
                rows={3}
                className="nodrag nopan w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-200 focus:border-slate-500 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:border-slate-500"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                className="ml-auto rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-emerald-500"
              >
                Save
              </button>
            </div>
            {editErr && (
              <div className="rounded border border-rose-700 bg-rose-950/40 px-2 py-1 font-mono text-[10px] text-rose-200">
                {editErr}
              </div>
            )}
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr className={`border-t border-slate-800 align-top ${job.enabled ? '' : 'opacity-50'}`}>
      <td className="py-1 pr-2 font-mono text-slate-200">{job.name || <span className="text-slate-600">—</span>}</td>
      <td className="py-1 pr-2 font-mono text-slate-300">{job.schedule}</td>
      <td className="py-1 pr-2 font-mono text-slate-300">{job.topic}</td>
      <td className="py-1 pr-2 text-slate-400">
        {formatRelative(job.last_run) || <span className="text-slate-600">never</span>}
        {job.last_error && (
          <div className="font-mono text-[10px] text-rose-400">{job.last_error}</div>
        )}
      </td>
      <td className="py-1 pr-2 text-slate-400">
        {job.enabled ? (formatRelative(job.next_run) || '—') : <span className="text-slate-600">disabled</span>}
      </td>
      <td className="py-1 text-right">
        <div className="flex justify-end gap-1" onPointerDown={(e) => e.stopPropagation()}>
          <SmallButton onClick={onToggle}>{job.enabled ? 'Disable' : 'Enable'}</SmallButton>
          <SmallButton onClick={onRunNow} disabled={!job.enabled}>Run now</SmallButton>
          <SmallButton onClick={() => setEditing(true)}>Edit</SmallButton>
          <SmallButton onClick={onRemove} tone="danger">×</SmallButton>
        </div>
      </td>
    </tr>
  )
}

// ─────────────────────────────────────────────────────────────────────
// RecentFires — collapsed-by-default log of recent firings
// ─────────────────────────────────────────────────────────────────────

function RecentFires({ fires, jobs }: { fires: FiredEvent[]; jobs: CronJob[] }) {
  const jobNames = useMemo(() => Object.fromEntries(jobs.map((j) => [j.id, j.name || j.id])), [jobs])
  return (
    <Section title={`recent firings (${fires.length})`}>
      {fires.length === 0 && <div className="text-slate-500">Nothing fired yet.</div>}
      {fires.length > 0 && (
        <ul className="space-y-0.5 font-mono text-[11px] text-slate-300">
          {fires.slice().reverse().map((f, i) => (
            <li key={i}>
              <span className="text-slate-500">{new Date(f.ts * 1000).toLocaleTimeString()}</span>
              {' '}<span className="text-emerald-300">{jobNames[f.job_id] ?? f.job_id}</span>
              {' → '}<span>{f.topic}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

// ─────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────

function formatRelative(epochSec: number | null): string {
  if (epochSec === null) return ''
  const diffSec = epochSec - Date.now() / 1000
  if (Math.abs(diffSec) < 5) return 'now'
  const sign = diffSec >= 0 ? 'in ' : ''
  const suffix = diffSec >= 0 ? '' : ' ago'
  const abs = Math.abs(diffSec)
  if (abs < 60) return `${sign}${Math.round(abs)}s${suffix}`
  if (abs < 3600) return `${sign}${Math.round(abs / 60)}m${suffix}`
  if (abs < 86400) return `${sign}${Math.round(abs / 3600)}h${suffix}`
  return `${sign}${Math.round(abs / 86400)}d${suffix}`
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-slate-800 bg-slate-900/40 p-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
      {children}
    </section>
  )
}

function LabeledInput({
  label, value, onChange, placeholder, mono, className = '',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
  className?: string
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        placeholder={placeholder}
        className={`nodrag nopan w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-slate-500 focus:outline-none ${mono ? 'font-mono' : ''}`}
      />
    </label>
  )
}

function SmallButton({
  children, onClick, disabled, tone = 'normal',
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  tone?: 'normal' | 'danger'
}) {
  const cls = tone === 'danger'
    ? 'border border-rose-700 text-rose-300 hover:border-rose-500'
    : 'border border-slate-700 text-slate-200 hover:border-slate-500'
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick?.() }}
      onPointerDown={(e) => e.stopPropagation()}
      disabled={disabled}
      className={`nodrag nopan rounded px-1.5 py-0.5 text-[11px] ${cls} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  )
}
