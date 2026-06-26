// Cli — terminal-style introspection view for a robotlab_x runtime.
//
// Hosts an xterm.js instance + line-discipline editor (input buffer,
// cursor, history). When the user presses Enter, the buffered line is
// handed to the interpreter (../cli/interpreter.ts), which dispatches
// to a verb. Verbs use the same wsClient + REST primitives every other
// view does — no special backend; the cli service-type is a presence
// marker for the canvas card.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

import type { ServiceProxy } from '@rlx/ui'
import { useActiveRuntime, useApiFetch, useWsClient } from '@rlx/ui'
import { type InboundFrame } from '@rlx/ui'
import { createInterpreter, resolvePath, type Interpreter, type TermIO } from './cli/interpreter'
import { attach, listChildren } from './cli/discovery'
import { VERBS } from './cli/verbs'


// ANSI escapes the CLI uses. xterm.js renders these natively; consumers
// (verb implementations) write through writeLine/writeError so colors
// stay consistent + can be turned off centrally.
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
}


interface CliConfigPayload {
  history_size?: number
  prompt?: string
}


export default function CliFullView({ proxy }: { proxy: ServiceProxy }) {
  const proxyId = proxy.id ?? '?'
  const wsClient = useWsClient()
  const apiFetch = useApiFetch()
  // The active runtime — exposes the federation id (witty-gizmo,
  // rlx, etc.) once it arrives via the bus. Fallback chain matches
  // the chip-bar: ``meta.runtime_id`` (authoritative) → ``c.id`` (the
  // chip's canonical label) → ``runtimeId`` from the URL (last
  // resort, often the raw URL string before the runtime identifies
  // itself).  We keep the resolved label in a ref so xterm's onData
  // closure can read it without re-binding; AND we expose a
  // ``redrawPrompt`` ref the connection-subscribe listener can call
  // to refresh the on-screen prompt the moment the label changes.
  const { connection, runtimeId } = useActiveRuntime()
  const resolveRuntimeLabel = (): string =>
    connection?.meta.runtime_id ?? connection?.id ?? runtimeId
  const runtimeLabelRef = useRef<string>(resolveRuntimeLabel())
  const redrawPromptRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!connection) return
    const update = () => {
      const next = resolveRuntimeLabel()
      if (next === runtimeLabelRef.current) return
      runtimeLabelRef.current = next
      redrawPromptRef.current?.()
    }
    update()
    return connection.subscribe(update)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, runtimeId])
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  // Mutable refs the keyboard handler reads — xterm's onData is bound
  // once; the closures need stable refs to the latest interpreter +
  // input state.
  const interpRef = useRef<Interpreter | null>(null)
  const inputRef = useRef<string>('')
  const historyRef = useRef<string[]>([])
  const historyIdxRef = useRef<number>(0)
  const inflightCancelRef = useRef<(() => void) | null>(null)
  // Suffix that follows the runtime_id in the prompt. Read from the
  // cli service's persisted config (CliConfig.prompt, default "> ").
  // Subscribers see the latest retained value on connect.
  const promptSuffixRef = useRef<string>('> ')
  const [cwd, setCwd] = useState<string>('/')

  // Pick up the cli service's config — gives us the user-chosen prompt
  // suffix + history buffer size. Falls back to defaults if the retained
  // config_state hasn't been delivered yet (fresh proxy).
  useEffect(() => {
    const topic = `/service_proxy/${proxyId}/config_state`
    const off = wsClient.subscribe(topic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const p = f.payload as CliConfigPayload | null | undefined
      if (!p) return
      if (typeof p.prompt === 'string' && p.prompt.length > 0) {
        promptSuffixRef.current = p.prompt
      }
    })
    return off
  }, [proxyId, wsClient])

  // History persistence — keyed by proxy_id so multiple CLI instances
  // don't share buffers, and survives reload of one card.
  const historyKey = useMemo(() => `rlx-cli-history-${proxyId}`, [proxyId])
  useEffect(() => {
    try {
      const raw = localStorage.getItem(historyKey)
      if (raw) historyRef.current = JSON.parse(raw)
    } catch { /* corrupt storage → just start fresh */ }
  }, [historyKey])

  // Wire the discovery cache to THIS runtime's wsClient. Re-running on
  // wsClient identity change is essential: when the user switches
  // runtimes in the chip-bar, this component re-mounts with a new
  // wsClient, and the cache needs to subscribe to the NEW runtime's
  // /runtime/runtime/services, types, meta wildcards. The cleanup fn
  // tears the old subscriptions down so the snapshot doesn't go stale.
  useEffect(() => {
    return attach(wsClient)
  }, [wsClient])
  const persistHistory = () => {
    try {
      localStorage.setItem(historyKey, JSON.stringify(historyRef.current.slice(-500)))
    } catch { /* quota or denied — silently degrade */ }
  }

  // ── terminal lifecycle ────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    const term = new Terminal({
      fontFamily: '"JetBrainsMono Nerd Font", "Fira Code", Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.2,
      theme: {
        background: '#020617',
        foreground: '#e2e8f0',
        cursor: '#fbbf24',
        black: '#0f172a', red: '#f87171', green: '#34d399', yellow: '#fbbf24',
        blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#e2e8f0',
        brightBlack: '#475569', brightRed: '#f87171', brightGreen: '#34d399',
        brightYellow: '#fbbf24', brightBlue: '#60a5fa', brightMagenta: '#c084fc',
        brightCyan: '#22d3ee', brightWhite: '#f8fafc',
      },
      convertEol: true,
      cursorBlink: true,
      scrollback: 5000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    termRef.current = term
    fitRef.current = fit
    setTimeout(() => fit.fit(), 0)

    // Build the IO surface verbs use; routes through xterm + tracks cwd
    // updates so the prompt stays in sync.
    const io: TermIO = {
      writeLine: (line: string) => {
        term.writeln(line)
      },
      write: (chunk: string) => {
        term.write(chunk)
      },
      writeError: (line: string) => {
        term.writeln(ANSI.red + line + ANSI.reset)
      },
      writeInfo: (line: string) => {
        term.writeln(ANSI.gray + line + ANSI.reset)
      },
      setCwd: (next: string) => {
        setCwd(next)
      },
      clear: () => {
        term.clear()
      },
      // Verbs that run long (tail, watch) hand back a cancel fn so
      // Ctrl-C can stop them.
      registerCancel: (fn: () => void) => {
        inflightCancelRef.current = fn
      },
    }

    const interp = createInterpreter({
      wsClient,
      apiFetch,
      io,
      initialCwd: '/',
    })
    interpRef.current = interp

    // Banner + first prompt.
    term.writeln(ANSI.bold + ANSI.cyan + 'robotlab_x cli' + ANSI.reset +
                 ANSI.gray + '  —  type "help" for commands' + ANSI.reset)
    writePrompt()

    function writePrompt() {
      // Format: `{path} {runtime_id}> ` — green for the path so the
      // current cd context is the first thing the eye lands on;
      // magenta for the runtime id (matches the colour we use for
      // peer ids in the peers verb output); cyan terminator (the
      // service's configured `prompt` suffix, defaults to "> ") sets
      // the typing cursor visually apart from the label.
      const path = interp.getCwd()
      const runtimeLabel = runtimeLabelRef.current
      term.write(
        '\r'
        + ANSI.green + path
        + ' ' + ANSI.magenta + runtimeLabel
        + ANSI.cyan + promptSuffixRef.current + ANSI.reset
      )
    }

    function rewriteInputLine() {
      // Clear current visible line, reprint prompt + buffer. xterm
      // doesn't have a "redraw line" primitive — we erase via \r +
      // \x1b[K and reprint.
      term.write('\r\x1b[K')
      writePrompt()
      term.write(inputRef.current)
    }

    // Expose to the outer connection-listener so when meta.runtime_id
    // arrives a moment after mount, the prompt updates in place
    // instead of waiting for the user's next Enter.
    redrawPromptRef.current = () => {
      // Don't disturb an inflight command — only redraw at idle.
      if (inflightCancelRef.current) return
      rewriteInputLine()
    }

    const onData = (data: string) => {
      // xterm sends every keystroke / paste as a string; we implement
      // a line-discipline ourselves so we can intercept Tab/Up/Down/
      // Ctrl-C without involving the OS.
      for (const ch of data) {
        const code = ch.charCodeAt(0)
        if (code === 13) {
          // Enter — submit the buffered line.
          const line = inputRef.current
          inputRef.current = ''
          term.write('\r\n')
          if (line.trim()) {
            historyRef.current.push(line)
            historyIdxRef.current = historyRef.current.length
            persistHistory()
            const inflight = interp.run(line)
            // While a verb is running, swallow further input until it
            // settles. Ctrl-C below cancels it.
            inflight.finally(() => {
              inflightCancelRef.current = null
              writePrompt()
            })
          } else {
            writePrompt()
          }
          continue
        }
        if (code === 127 || code === 8) {
          // Backspace.
          if (inputRef.current.length > 0) {
            inputRef.current = inputRef.current.slice(0, -1)
            term.write('\b \b')
          }
          continue
        }
        if (code === 3) {
          // Ctrl-C — cancel inflight or just abandon the input line.
          if (inflightCancelRef.current) {
            inflightCancelRef.current()
            inflightCancelRef.current = null
            term.write(ANSI.yellow + '^C' + ANSI.reset + '\r\n')
            writePrompt()
          } else {
            term.write('^C\r\n')
            inputRef.current = ''
            writePrompt()
          }
          continue
        }
        if (code === 12) {
          // Ctrl-L — clear screen, keep input.
          term.clear()
          rewriteInputLine()
          continue
        }
        if (ch === '\x1b') {
          // Start of an escape sequence — onArrowOrTab handles the
          // full ESC sequence as one onData chunk, so a lone ESC here
          // means a stray keystroke we should ignore (some terminals
          // emit lone ESC on dead keys).
          continue
        }
        // Printable.
        if (code >= 32 && code < 127) {
          inputRef.current += ch
          term.write(ch)
          continue
        }
      }
    }

    // Arrow keys + tab arrive as ESC sequences. Split here so the
    // per-char loop above doesn't have to know about them.
    const onArrowOrTab = (data: string): boolean => {
      if (data === '\x1b[A') {
        // Up — older history entry.
        if (historyRef.current.length === 0) return true
        historyIdxRef.current = Math.max(0, historyIdxRef.current - 1)
        inputRef.current = historyRef.current[historyIdxRef.current] ?? ''
        rewriteInputLine()
        return true
      }
      if (data === '\x1b[B') {
        // Down — newer history entry (or empty past the end).
        historyIdxRef.current = Math.min(historyRef.current.length, historyIdxRef.current + 1)
        inputRef.current = historyRef.current[historyIdxRef.current] ?? ''
        rewriteInputLine()
        return true
      }
      if (data === '\t') {
        // Tab — complete the last token of the current input. Two
        // contexts:
        //   * first token (verb position) → match against VERBS keys
        //   * everything else (path position) → match against the cwd
        //     children of the path prefix the user typed
        const buf = inputRef.current
        const tokens = buf.split(/\s+/)
        const lastIdx = buf.endsWith(' ') ? tokens.length : tokens.length - 1
        const last = buf.endsWith(' ') ? '' : tokens[tokens.length - 1] ?? ''
        let candidates: string[] = []
        if (lastIdx === 0) {
          candidates = Object.keys(VERBS).filter((v) => v.startsWith(last))
        } else {
          // Path completion. Split the last token into "dir prefix" +
          // "name prefix" so we ls() the directory and filter.
          const slash = last.lastIndexOf('/')
          const dirPart = slash >= 0 ? last.slice(0, slash + 1) : ''
          const namePart = slash >= 0 ? last.slice(slash + 1) : last
          const baseForLs = dirPart || '.'
          const dirPath = resolvePath(interp.getCwd(), baseForLs.endsWith('/') ? baseForLs.slice(0, -1) || '.' : baseForLs)
          const entries = listChildren(dirPath)
          candidates = entries
            .map((e) => e.name)
            .filter((n) => n.startsWith(namePart))
          // Prefix re-attachment so completion writes back the full
          // (possibly relative) prefix the user typed, not just the name.
          candidates = candidates.map((name) => dirPart + name)
        }
        if (candidates.length === 0) return true
        if (candidates.length === 1) {
          // Unique — replace the last token + drop a trailing space so
          // typing keeps flowing.
          const completion = candidates[0]
          inputRef.current = (lastIdx === 0
            ? completion
            : tokens.slice(0, lastIdx).join(' ') + ' ' + completion)
          rewriteInputLine()
          return true
        }
        // Multiple — find common prefix; if it extends the input, fill
        // it. Otherwise print the choices on a new line + reprint input.
        const lcp = commonPrefix(candidates)
        if (lcp.length > (lastIdx === 0 ? last.length : last.length)) {
          const replacement = lastIdx === 0 ? lcp : tokens.slice(0, lastIdx).join(' ') + ' ' + lcp
          inputRef.current = replacement
          rewriteInputLine()
          return true
        }
        term.write('\r\n' + candidates.join('  ') + '\r\n')
        rewriteInputLine()
        return true
      }
      return false
    }

    function commonPrefix(arr: string[]): string {
      if (arr.length === 0) return ''
      let p = arr[0]
      for (let k = 1; k < arr.length; k++) {
        while (!arr[k].startsWith(p)) p = p.slice(0, -1)
        if (!p) break
      }
      return p
    }

    const disposable = term.onData((data: string) => {
      if (onArrowOrTab(data)) return
      onData(data)
    })

    // Resize observer for FitAddon — xterm needs an explicit fit call
    // whenever the container changes size (canvas resize, node drag).
    const obs = new ResizeObserver(() => {
      try { fit.fit() } catch { /* container detached mid-resize */ }
    })
    obs.observe(containerRef.current)

    return () => {
      disposable.dispose()
      obs.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
      interpRef.current = null
      redrawPromptRef.current = null
    }
    // We intentionally bind once on mount — wsClient/proxyId are
    // closure-captured but stable for a given mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex h-full min-h-[280px] min-w-[420px] flex-col p-2 text-xs">
      <div className="mb-1 flex items-baseline justify-between gap-2 font-mono text-[10px] text-slate-500">
        <span>
          <span className="text-slate-400">cli</span>
          <span className="ml-2 text-slate-600">proxy_id={proxyId}</span>
        </span>
        <span className="text-cyan-400 truncate" title={cwd}>cwd: {cwd}</span>
      </div>
      <div
        ref={containerRef}
        className="nodrag nopan flex-1 overflow-hidden rounded border border-slate-800 bg-[#020617] p-1"
        onPointerDown={(e) => e.stopPropagation()}
      />
    </div>
  )
}
