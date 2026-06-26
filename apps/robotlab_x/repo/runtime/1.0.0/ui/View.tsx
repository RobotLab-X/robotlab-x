import { useCallback, useEffect, useState } from 'react'
import type { ServiceProxy } from '@rlx/ui'
import { type InboundFrame } from '@rlx/ui'
import { useActiveRuntime, useWsClient } from '@rlx/ui'

// RuntimeFullView — process + OS + system metrics for the in-process
// runtime service. Source: /runtime/<proxyId>/state, published by
// runtime/system_state.py every ~3s.

interface ProcessInfo {
  pid?: number
  uptime_s?: number
  cmdline?: string
  cwd?: string
  threads?: number
  rss_bytes?: number
  cpu_percent?: number
}

interface OsInfo {
  name?: string
  version?: string
  kernel?: string
  arch?: string
  hostname?: string
}

interface CpuInfo {
  logical?: number
  physical?: number | null
  percent?: number
  load_avg_1?: number | null
  load_avg_5?: number | null
  load_avg_15?: number | null
}

interface MemInfo {
  total_bytes?: number
  available_bytes?: number
  used_bytes?: number
  percent?: number
}

interface DiskInfo {
  mount?: string
  total_bytes?: number
  used_bytes?: number
  free_bytes?: number
  percent?: number
  error?: string
}

interface RuntimeState {
  language?: string
  language_version?: string
  language_implementation?: string
  process?: ProcessInfo
  os?: OsInfo
  cpu?: CpuInfo
  memory?: MemInfo
  disk?: DiskInfo
}


function fmtBytes(n: number | undefined): string {
  if (n == null) return '—'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]}`
}

function fmtUptime(seconds: number | undefined): string {
  if (seconds == null) return '—'
  const s = Math.floor(seconds)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

function fmtPct(n: number | undefined): string {
  return n == null ? '—' : `${n.toFixed(1)}%`
}


export default function RuntimeFullView({ proxy }: { proxy: ServiceProxy }) {
  const wsClient = useWsClient()
  const proxyId = proxy.id ?? proxy.name ?? ''
  const stateTopic = `/runtime/${proxyId}/state`
  const [state, setState] = useState<RuntimeState>({})
  const [lastUpdate, setLastUpdate] = useState<number | null>(null)
  // Federation id — exposed by the connection's RuntimeMeta once
  // /runtime/info arrives. Other runtimes address this one via
  // ``/clock/clock-1@<runtime_id>`` topic suffixes (see Discovery
  // section of AGENTS.md). Subscribe to the connection's listener
  // so the banner updates the moment the id becomes known.
  const { connection, runtimeId } = useActiveRuntime()
  const [federationId, setFederationId] = useState<string | null>(
    connection?.meta.runtime_id ?? null,
  )
  useEffect(() => {
    if (!connection) return
    const update = () => setFederationId(connection.meta.runtime_id ?? null)
    update()
    return connection.subscribe(update)
  }, [connection])

  const copyId = useCallback((text: string) => {
    try { navigator.clipboard?.writeText(text) } catch { /* swallow */ }
  }, [])

  useEffect(() => {
    if (!proxyId) return
    const off = wsClient.subscribe(stateTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const p = f.payload
      if (!p || typeof p !== 'object') return
      setState(p as RuntimeState)
      setLastUpdate(Date.now())
    })
    return off
  }, [proxyId, stateTopic, wsClient])

  const proc = state.process ?? {}
  const os = state.os ?? {}
  const cpu = state.cpu ?? {}
  const mem = state.memory ?? {}
  const disk = state.disk ?? {}
  const langLabel = state.language_version
    ? `${state.language ?? 'python'} ${state.language_version}`
    : (state.language ?? 'python')

  return (
    <div className="flex min-w-[420px] flex-col gap-3 p-3 text-xs">
      {/* Federation identity — the handle peers use to address services
          on this runtime via the ``@<id>`` topic suffix. Surfacing it
          on the runtime card itself makes the bridge concept concrete
          for first-time users + easy to copy when wiring cross-runtime
          subscriptions. */}
      <section className="rounded border border-magenta-700 bg-slate-900/60 p-3">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-[9px] uppercase tracking-wider text-slate-500">federation id</span>
          {federationId ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); copyId(federationId) }}
              onPointerDown={(e) => e.stopPropagation()}
              title="Copy id to clipboard"
              className="nodrag nopan rounded px-1.5 py-0.5 text-[9px] text-slate-500 hover:bg-slate-800 hover:text-slate-200"
            >
              copy
            </button>
          ) : null}
        </div>
        {federationId ? (
          <>
            <div className="select-all font-mono text-base font-semibold text-fuchsia-300" title={federationId}>
              {federationId}
            </div>
            <div className="mt-1 font-mono text-[10px] text-slate-500">
              Peers address services on this runtime via the{' '}
              <span className="text-fuchsia-400">@{federationId}</span> suffix —{' '}
              e.g. <span className="text-cyan-400">/clock/clock-1@{federationId}</span>
            </div>
          </>
        ) : (
          <div className="font-mono text-[10px] text-amber-300">
            (no federation id yet — waiting for /runtime/info; chip-label is{' '}
            <span className="text-slate-400">{runtimeId}</span>)
          </div>
        )}
      </section>
      {lastUpdate === null && (
        <div className="rounded border border-amber-700 bg-amber-950/40 px-2 py-1 font-mono text-[10px] text-amber-200">
          waiting for first /runtime/{proxyId}/state frame…
        </div>
      )}
      <Section title="process">
        <Grid>
          <Field label="language" value={langLabel} mono />
          <Field label="pid" value={proc.pid?.toString() ?? '—'} mono />
          <Field label="uptime" value={fmtUptime(proc.uptime_s)} />
          <Field label="threads" value={proc.threads?.toString() ?? '—'} />
          <Field label="rss" value={fmtBytes(proc.rss_bytes)} />
          <Field label="cpu" value={fmtPct(proc.cpu_percent)} />
        </Grid>
        {proc.cmdline && (
          <div className="mt-2 truncate font-mono text-[10px] text-slate-500" title={proc.cmdline}>
            $ {proc.cmdline}
          </div>
        )}
        {proc.cwd && (
          <div className="truncate font-mono text-[10px] text-slate-500" title={proc.cwd}>
            cwd: {proc.cwd}
          </div>
        )}
      </Section>

      <Section title="operating system">
        <Grid>
          <Field label="name" value={os.name ?? '—'} />
          <Field label="version" value={os.version ?? '—'} />
          <Field label="arch" value={os.arch ?? '—'} mono />
          <Field label="hostname" value={os.hostname ?? '—'} mono />
        </Grid>
        {os.kernel && os.kernel !== os.version && (
          <div className="mt-1 truncate font-mono text-[10px] text-slate-500" title={os.kernel}>
            kernel: {os.kernel}
          </div>
        )}
      </Section>

      <Section title="cpu">
        <Grid>
          <Field
            label="cores"
            value={`${cpu.logical ?? '—'} logical${cpu.physical != null ? ` · ${cpu.physical} physical` : ''}`}
          />
          <Field label="usage" value={fmtPct(cpu.percent)} />
          <Field
            label="load avg"
            value={
              cpu.load_avg_1 == null
                ? '—'
                : `${cpu.load_avg_1.toFixed(2)} · ${cpu.load_avg_5?.toFixed(2) ?? '—'} · ${cpu.load_avg_15?.toFixed(2) ?? '—'}`
            }
            mono
          />
        </Grid>
        <Bar percent={cpu.percent} />
      </Section>

      <Section title="memory">
        <Grid>
          <Field label="total" value={fmtBytes(mem.total_bytes)} />
          <Field label="used" value={fmtBytes(mem.used_bytes)} />
          <Field label="available" value={fmtBytes(mem.available_bytes)} />
          <Field label="usage" value={fmtPct(mem.percent)} />
        </Grid>
        <Bar percent={mem.percent} />
      </Section>

      <Section title={`disk (${disk.mount ?? '/'})`}>
        {disk.error ? (
          <div className="font-mono text-[10px] text-rose-300">{disk.error}</div>
        ) : (
          <>
            <Grid>
              <Field label="total" value={fmtBytes(disk.total_bytes)} />
              <Field label="used" value={fmtBytes(disk.used_bytes)} />
              <Field label="free" value={fmtBytes(disk.free_bytes)} />
              <Field label="usage" value={fmtPct(disk.percent)} />
            </Grid>
            <Bar percent={disk.percent} />
          </>
        )}
      </Section>
    </div>
  )
}


function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-slate-800 bg-slate-900/40 p-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">{children}</div>
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
      <span className={`truncate text-slate-200 ${mono ? 'font-mono text-[11px]' : ''}`} title={value}>
        {value}
      </span>
    </div>
  )
}

/** Horizontal usage bar. Color shifts amber → rose as percent climbs. */
function Bar({ percent }: { percent: number | undefined }) {
  if (percent == null) return null
  const pct = Math.max(0, Math.min(100, percent))
  const color =
    pct >= 90 ? 'bg-rose-500' :
    pct >= 75 ? 'bg-amber-500' :
    'bg-emerald-500'
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-slate-800">
      <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}
