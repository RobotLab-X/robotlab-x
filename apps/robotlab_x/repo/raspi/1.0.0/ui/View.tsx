import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ServiceProxy } from '@rlx/ui'
import { type InboundFrame } from '@rlx/ui'
import { useWsClient } from '@rlx/ui'

// RaspiService view: board info header, then a per-pin grid + an I2C
// panel. State arrives on /raspi/{id}/state retained. Actions go out
// on /raspi/{id}/control as {action, ...args}. Per-pin live values
// arrive on /raspi/{id}/pin/{N} when polling is active or after a
// read/write.

interface BoardInfo {
  kind?: string
  model?: string
  soc?: string
  revision_code?: string
  memory_mb?: number | null
  serial?: string
  hardware?: string
  reason?: string
  gpio_pins?: number[]
  pin_functions?: Record<string, string>
}

interface PinSnapshot {
  mode?: string
  value?: number
}

interface RaspiState {
  board?: BoardInfo
  backend_mode?: string
  pins?: Record<string, PinSnapshot>
  polling?: Record<string, number>
}

interface I2cScanPayload {
  bus: number
  addresses: string[]
}

const PIN_MODES = ['input', 'input_pullup', 'input_pulldown', 'output', 'pwm']

export default function RaspiFullView({ proxy }: { proxy: ServiceProxy }) {
  const wsClient = useWsClient()
  const proxyId = proxy.id ?? proxy.name ?? ''
  const stateTopic = `/raspi/${proxyId}/state`
  const i2cScanTopic = `/raspi/${proxyId}/i2c/scan`
  const controlTopic = `/raspi/${proxyId}/control`

  const [state, setState] = useState<RaspiState>({})
  const [i2cScan, setI2cScan] = useState<I2cScanPayload | null>(null)

  useEffect(() => {
    if (!proxyId) return
    const off1 = wsClient.subscribe(stateTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      setState(f.payload as RaspiState)
    })
    const off2 = wsClient.subscribe(i2cScanTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      setI2cScan(f.payload as I2cScanPayload)
    })
    return () => { off1(); off2() }
  }, [proxyId, stateTopic, i2cScanTopic, wsClient])

  // Live per-pin values arrive on /raspi/{id}/pin/{N}. Subscribe to
  // every configured pin so the UI updates as polls fire / writes echo.
  const configuredPins = useMemo(
    () => Object.keys(state.pins ?? {}).map(Number).sort((a, b) => a - b),
    [state.pins],
  )
  useEffect(() => {
    if (!proxyId || configuredPins.length === 0) return
    const unsubs: Array<() => void> = []
    for (const p of configuredPins) {
      const topic = `/raspi/${proxyId}/pin/${p}`
      const off = wsClient.subscribe(topic, (f: InboundFrame) => {
        if (f.method !== 'message') return
        const payload = f.payload as { value?: number }
        if (typeof payload?.value !== 'number') return
        setState((prev) => {
          const pins = { ...(prev.pins ?? {}) }
          pins[String(p)] = { ...(pins[String(p)] ?? {}), value: payload.value }
          return { ...prev, pins }
        })
      })
      unsubs.push(off)
    }
    return () => { for (const off of unsubs) off() }
  }, [proxyId, configuredPins.join(','), wsClient])

  const send = useCallback(
    (action: string, args: Record<string, unknown> = {}) => {
      wsClient.publish(controlTopic, { action, ...args })
    },
    [controlTopic, wsClient],
  )

  const board = state.board ?? {}
  const pins = state.pins ?? {}
  const polling = state.polling ?? {}
  const allPins = board.gpio_pins ?? []
  const pinFunctions = board.pin_functions ?? {}

  return (
    <div className="flex min-w-[480px] flex-col gap-3 p-3 text-xs">
      <BoardPanel board={board} backendMode={state.backend_mode} />
      <PinGrid
        allPins={allPins}
        pinFunctions={pinFunctions}
        pins={pins}
        polling={polling}
        onSetMode={(pin, mode) => send('set_pin_mode', { pin, mode })}
        onRelease={(pin) => send('release_pin', { pin })}
        onDigitalWrite={(pin, value) => send('digital_write', { pin, value })}
        onDigitalRead={(pin) => send('digital_read', { pin })}
        onPwmWrite={(pin, duty) => send('pwm_write', { pin, duty })}
        onPoll={(pin, interval_ms) => send('poll_pin', { pin, interval_ms })}
        onStopPoll={(pin) => send('stop_poll', { pin })}
      />
      <I2CPanel
        scan={i2cScan}
        onScan={(bus) => send('i2c_scan', { bus })}
        onRead={(addr, reg, count, bus) => send('i2c_read', { addr, reg, count, bus })}
        onWrite={(addr, data, bus) => send('i2c_write', { addr, data, bus })}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// BoardPanel — top-of-view header showing detected board info
// ─────────────────────────────────────────────────────────────────────

function BoardPanel({ board, backendMode }: { board: BoardInfo; backendMode?: string }) {
  const isMock = board.kind === 'mock' || backendMode === 'mock'
  return (
    <Section title="board">
      <div className={`rounded border p-2 leading-snug ${isMock ? 'border-amber-700 bg-amber-950/30 text-amber-200' : 'border-slate-800 bg-slate-950/70 text-slate-300'}`}>
        {isMock && (
          <div className="mb-2 text-[10px] uppercase tracking-wider text-amber-400">
            mock — no Raspberry Pi detected
          </div>
        )}
        <div className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 font-mono">
          <span className="text-slate-500">model</span>
          <span>{board.model ?? '—'}</span>
          {board.soc && (
            <>
              <span className="text-slate-500">soc</span>
              <span>{board.soc}</span>
            </>
          )}
          {typeof board.memory_mb === 'number' && (
            <>
              <span className="text-slate-500">memory</span>
              <span>{board.memory_mb} MB</span>
            </>
          )}
          {board.revision_code && (
            <>
              <span className="text-slate-500">revision</span>
              <span>{board.revision_code}</span>
            </>
          )}
          {board.serial && (
            <>
              <span className="text-slate-500">serial</span>
              <span className="truncate">{board.serial}</span>
            </>
          )}
        </div>
        {isMock && board.reason && (
          <div className="mt-2 text-[10px]">{board.reason}</div>
        )}
      </div>
    </Section>
  )
}

// ─────────────────────────────────────────────────────────────────────
// PinGrid — main table of GPIO pins
// ─────────────────────────────────────────────────────────────────────

function PinGrid({
  allPins, pinFunctions, pins, polling,
  onSetMode, onRelease, onDigitalWrite, onDigitalRead, onPwmWrite, onPoll, onStopPoll,
}: {
  allPins: number[]
  pinFunctions: Record<string, string>
  pins: Record<string, PinSnapshot>
  polling: Record<string, number>
  onSetMode: (pin: number, mode: string) => void
  onRelease: (pin: number) => void
  onDigitalWrite: (pin: number, value: number) => void
  onDigitalRead: (pin: number) => void
  onPwmWrite: (pin: number, duty: number) => void
  onPoll: (pin: number, interval_ms: number) => void
  onStopPoll: (pin: number) => void
}) {
  const [filter, setFilter] = useState<'all' | 'configured'>('all')
  const rows = useMemo(() => {
    const list = filter === 'configured'
      ? allPins.filter((p) => pins[String(p)])
      : allPins
    return list
  }, [allPins, pins, filter])

  return (
    <Section title="gpio pins">
      <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500">
        <span>{rows.length} pin{rows.length === 1 ? '' : 's'}</span>
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`rounded border px-1.5 py-0.5 ${filter === 'all' ? 'border-slate-500 text-slate-200' : 'border-slate-700 text-slate-500 hover:text-slate-300'}`}
        >
          all
        </button>
        <button
          type="button"
          onClick={() => setFilter('configured')}
          className={`rounded border px-1.5 py-0.5 ${filter === 'configured' ? 'border-slate-500 text-slate-200' : 'border-slate-700 text-slate-500 hover:text-slate-300'}`}
        >
          configured
        </button>
      </div>
      <table className="w-full table-auto font-mono">
        <thead className="text-[10px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="py-1 text-left">pin</th>
            <th className="py-1 text-left">fn</th>
            <th className="py-1 text-left">mode</th>
            <th className="py-1 text-left">value</th>
            <th className="py-1 text-left">poll</th>
            <th className="py-1 text-right">action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((pin) => (
            <PinRow
              key={pin}
              pin={pin}
              fn={pinFunctions[String(pin)]}
              snap={pins[String(pin)] ?? {}}
              pollInterval={polling[String(pin)] ?? 0}
              onSetMode={(m) => onSetMode(pin, m)}
              onRelease={() => onRelease(pin)}
              onDigitalWrite={(v) => onDigitalWrite(pin, v)}
              onDigitalRead={() => onDigitalRead(pin)}
              onPwmWrite={(d) => onPwmWrite(pin, d)}
              onPoll={(ms) => onPoll(pin, ms)}
              onStopPoll={() => onStopPoll(pin)}
            />
          ))}
        </tbody>
      </table>
    </Section>
  )
}

function PinRow({
  pin, fn, snap, pollInterval,
  onSetMode, onRelease, onDigitalWrite, onDigitalRead, onPwmWrite, onPoll, onStopPoll,
}: {
  pin: number
  fn?: string
  snap: PinSnapshot
  pollInterval: number
  onSetMode: (mode: string) => void
  onRelease: () => void
  onDigitalWrite: (value: number) => void
  onDigitalRead: () => void
  onPwmWrite: (duty: number) => void
  onPoll: (interval_ms: number) => void
  onStopPoll: () => void
}) {
  const [pwmDraft, setPwmDraft] = useState('0.5')
  const [intervalDraft, setIntervalDraft] = useState(String(pollInterval || 100))
  useEffect(() => {
    if (pollInterval) setIntervalDraft(String(pollInterval))
  }, [pollInterval])

  const mode = snap.mode ?? ''
  const polling = pollInterval > 0
  return (
    <tr className="border-t border-slate-800">
      <td className="py-1 pr-2 text-slate-200">{pin}</td>
      <td className="py-1 pr-2 text-[10px] text-slate-500">{fn ?? ''}</td>
      <td className="py-1 pr-2">
        <select
          value={mode}
          onChange={(e) => onSetMode(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          className="nodrag nopan rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-xs text-slate-100"
        >
          <option value="">—</option>
          {PIN_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </td>
      <td className="py-1 pr-2 text-slate-300">
        {snap.value === undefined ? '—'
          : typeof snap.value === 'number' ? snap.value : String(snap.value)}
      </td>
      <td className="py-1 pr-2" onPointerDown={(e) => e.stopPropagation()}>
        {polling ? (
          <div className="flex items-center gap-1">
            <span className="text-emerald-400">{pollInterval}ms</span>
            <SmallButton onClick={onStopPoll}>stop</SmallButton>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <input
              type="number" min={10} max={5000} step={10}
              value={intervalDraft}
              onChange={(e) => setIntervalDraft(e.target.value)}
              className="nodrag nopan w-14 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-xs text-slate-100"
            />
            <SmallButton
              onClick={() => onPoll(Number.parseInt(intervalDraft, 10) || 100)}
              disabled={!mode.startsWith('input')}
            >
              poll
            </SmallButton>
          </div>
        )}
      </td>
      <td className="py-1 text-right" onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex justify-end gap-1">
          {mode === 'input' || mode === 'input_pullup' || mode === 'input_pulldown' ? (
            <SmallButton onClick={onDigitalRead}>read</SmallButton>
          ) : null}
          {mode === 'output' ? (
            <>
              <SmallButton onClick={() => onDigitalWrite(1)}>HI</SmallButton>
              <SmallButton onClick={() => onDigitalWrite(0)}>LO</SmallButton>
            </>
          ) : null}
          {mode === 'pwm' ? (
            <>
              <input
                type="number" min={0} max={1} step={0.05}
                value={pwmDraft}
                onChange={(e) => setPwmDraft(e.target.value)}
                className="nodrag nopan w-14 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-xs text-slate-100"
              />
              <SmallButton onClick={() => onPwmWrite(Number.parseFloat(pwmDraft) || 0)}>
                write
              </SmallButton>
            </>
          ) : null}
          {mode && <SmallButton onClick={onRelease} tone="danger">×</SmallButton>}
        </div>
      </td>
    </tr>
  )
}

// ─────────────────────────────────────────────────────────────────────
// I2CPanel — scan + read + write
// ─────────────────────────────────────────────────────────────────────

function I2CPanel({
  scan, onScan, onRead, onWrite,
}: {
  scan: I2cScanPayload | null
  onScan: (bus: number) => void
  onRead: (addr: number, reg: number, count: number, bus: number) => void
  onWrite: (addr: number, data: number[], bus: number) => void
}) {
  const [bus, setBus] = useState('1')
  const [addr, setAddr] = useState('0x68')
  const [reg, setReg] = useState('0x00')
  const [count, setCount] = useState('1')
  const [data, setData] = useState('0x00')

  const parseHex = (s: string): number => {
    const t = s.trim()
    return Number.parseInt(t.startsWith('0x') ? t.slice(2) : t, 16)
  }

  return (
    <Section title="i²c">
      <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <label className="text-[10px] uppercase tracking-wider text-slate-500">bus</label>
          <input
            type="number"
            value={bus}
            onChange={(e) => setBus(e.target.value)}
            className="nodrag nopan w-12 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100"
          />
          <SmallButton onClick={() => onScan(Number.parseInt(bus, 10) || 1)}>Scan</SmallButton>
          {scan && (
            <span className="font-mono text-[11px] text-slate-300">
              bus {scan.bus}: {scan.addresses.length ? scan.addresses.join(' ') : '(no devices)'}
            </span>
          )}
        </div>
        <div className="grid grid-cols-[max-content_1fr_max-content_1fr_max-content_1fr] items-center gap-2">
          <label className="text-[10px] uppercase tracking-wider text-slate-500">addr</label>
          <input
            value={addr} onChange={(e) => setAddr(e.target.value)}
            className="nodrag nopan rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100"
          />
          <label className="text-[10px] uppercase tracking-wider text-slate-500">reg</label>
          <input
            value={reg} onChange={(e) => setReg(e.target.value)}
            className="nodrag nopan rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100"
          />
          <label className="text-[10px] uppercase tracking-wider text-slate-500">count</label>
          <input
            value={count} onChange={(e) => setCount(e.target.value)}
            className="nodrag nopan rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100"
          />
          <SmallButton
            onClick={() => onRead(parseHex(addr), parseHex(reg),
              Number.parseInt(count, 10) || 1, Number.parseInt(bus, 10) || 1)}
          >
            Read
          </SmallButton>
          <label className="text-[10px] uppercase tracking-wider text-slate-500">data</label>
          <input
            value={data} onChange={(e) => setData(e.target.value)}
            placeholder="0x01 0x02"
            className="nodrag nopan col-span-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100"
          />
          <SmallButton
            onClick={() => {
              const bytes = data.trim().split(/\s+/).map(parseHex).filter((n) => !Number.isNaN(n))
              onWrite(parseHex(addr), bytes, Number.parseInt(bus, 10) || 1)
            }}
          >
            Write
          </SmallButton>
        </div>
      </div>
    </Section>
  )
}

// ─────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-slate-800 bg-slate-900/40 p-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
      {children}
    </section>
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
