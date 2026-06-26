// Interpreter — turns a single line of user input into one verb +
// arglist + invocation. The verb table itself lives in ./verbs.ts; this
// module owns tokenization, cwd state, and IO routing.
//
// Design notes
// ────────────
// • Verbs are async — they may subscribe + await retained messages, do
//   REST calls, or hold an open subscription (tail/watch) until Ctrl-C.
//   The terminal in Cli.tsx awaits the returned promise before drawing
//   the next prompt.
// • Cancel signalling is via a registerCancel(fn) callback on the IO
//   surface. Long-running verbs register a cancel; Cli.tsx invokes it
//   on Ctrl-C.
// • Tokenization handles three forms a CLI user expects:
//     plain        →  ls /clock
//     quoted       →  call echo "hello world"
//     JSON braces  →  call set_filters '[{"type":"motion"}]'
//   Single + double quotes both work; JSON literals starting at the
//   token boundary stay together until a balanced closing brace/bracket.
import type { WsClient as DefaultWsClient } from '@rlx/ui'
import { VERBS } from './verbs'


// Subset of the wsClient surface verbs need. Typed loosely so tests can
// pass a stub without copying the real class. Shapes mirror the real
// ``WsClient`` (InboundFrame + TopicInfo) so the real client is
// assignable to this — previously divergent field names (``topic`` vs
// ``name``, ``subscribers`` vs ``subscriber_count``) made it impossible.
export interface CliWsClient {
  subscribe: (
    topic: string,
    handler: (frame: { method?: string; payload?: unknown; topic?: string }) => void
  ) => () => void
  publish: (topic: string, payload: unknown, opts?: { retained?: boolean }) => void
  listTopics?: (timeoutMs?: number) => Promise<Array<{
    name: string
    subscriber_count: number
    retained: boolean
    dropped?: number
  }>>
}


export interface TermIO {
  // Print one line + newline. Caller-provided ANSI is preserved.
  writeLine: (line: string) => void
  // Print raw chunk (no newline). Used by verbs that stream multi-line
  // JSON in pieces.
  write: (chunk: string) => void
  // Same as writeLine but prefixed with red ANSI. For verb errors.
  writeError: (line: string) => void
  // Gray-tinted hint line. For framing info that isn't an error.
  writeInfo: (line: string) => void
  // Update the view's displayed cwd (drives the prompt path label).
  setCwd: (next: string) => void
  // Wipe the screen.
  clear: () => void
  // Verbs that hold an open subscription register a cancel callback.
  // The terminal calls it on Ctrl-C.
  registerCancel: (cancel: () => void) => void
}


// Loose type for the per-runtime REST fetcher (createApiFetch in
// lib/api.ts). Typed as a generic <T> async fn so we don't drag the
// real signature through every verb file.
export type CliApiFetch = <T = unknown>(path: string, init?: RequestInit) => Promise<T>


export interface InterpreterContext {
  wsClient: CliWsClient
  apiFetch?: CliApiFetch
  io: TermIO
  // Mutable per-interpreter state. Verbs read + update cwd through
  // ctx.getCwd / ctx.setCwd so changes survive across verb calls.
  getCwd: () => string
  setCwd: (next: string) => void
}


export interface Interpreter {
  run: (line: string) => Promise<void>
  getCwd: () => string
}


export function createInterpreter(opts: {
  wsClient: typeof DefaultWsClient | CliWsClient
  apiFetch?: CliApiFetch
  io: TermIO
  initialCwd?: string
}): Interpreter {
  let cwd = normalizeCwd(opts.initialCwd ?? '/')
  const ctx: InterpreterContext = {
    wsClient: opts.wsClient as CliWsClient,
    apiFetch: opts.apiFetch,
    io: opts.io,
    getCwd: () => cwd,
    setCwd: (next: string) => {
      cwd = normalizeCwd(next)
      opts.io.setCwd(cwd)
    },
  }
  return {
    getCwd: () => cwd,
    async run(line: string) {
      const tokens = tokenize(line)
      if (tokens.length === 0) return
      let verb = tokens[0]
      let args = tokens.slice(1)
      // Method-call shortcut: ``stop_clock()`` or ``stop_clock(arg)``
      // at the verb position is sugar for ``call stop_clock [arg…]``.
      // Mirrors what ``ls`` prints — methods render with trailing ()
      // so users naturally type that form.
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\(\s*(.*?)\s*\)$/.exec(verb)
      if (m) {
        const method = m[1]
        const inside = m[2]
        verb = 'call'
        // Inside-parens args are comma-separated when present; we
        // re-tokenize each piece honouring quotes + JSON braces.
        const inner = inside ? tokenize(inside.replace(/,/g, ' ')) : []
        args = [method, ...inner, ...args]
      }
      const fn = VERBS[verb]
      if (!fn) {
        opts.io.writeError(`unknown verb: ${verb} — try "help"`)
        return
      }
      try {
        await fn(args, ctx)
      } catch (e) {
        opts.io.writeError(`${verb}: ${(e as Error).message ?? String(e)}`)
      }
    },
  }
}


// ─── tokenizer ────────────────────────────────────────────────────


// Parse one input line into argv. Rules:
//   • whitespace separates tokens
//   • single + double quotes group whitespace inside one token (kept
//     verbatim; the quoting characters themselves are stripped)
//   • backslash escapes the next char inside quotes
//   • { … } and [ … ] keep balanced JSON literals as one token (with
//     leading/trailing whitespace stripped) so `call x [1,2,3]` ships
//     a single arg even when the user typed a space after the bracket
//   • # starts a comment to end-of-line
export function tokenize(line: string): string[] {
  const out: string[] = []
  let i = 0
  const n = line.length
  while (i < n) {
    const c = line[i]
    if (c === '#') break  // comment
    if (c === ' ' || c === '\t') { i++; continue }
    // JSON literal — keep balanced.
    if (c === '{' || c === '[') {
      const open = c
      const close = c === '{' ? '}' : ']'
      let depth = 0
      let j = i
      let inStr = false
      let strCh = ''
      while (j < n) {
        const ch = line[j]
        if (inStr) {
          if (ch === '\\' && j + 1 < n) { j += 2; continue }
          if (ch === strCh) { inStr = false }
          j++
          continue
        }
        if (ch === '"' || ch === "'") { inStr = true; strCh = ch; j++; continue }
        if (ch === open) { depth++ }
        else if (ch === close) {
          depth--
          if (depth === 0) { j++; break }
        }
        j++
      }
      out.push(line.slice(i, j))
      i = j
      continue
    }
    // Quoted string.
    if (c === '"' || c === "'") {
      const qc = c
      i++
      let buf = ''
      while (i < n) {
        const ch = line[i]
        if (ch === '\\' && i + 1 < n) { buf += line[i + 1]; i += 2; continue }
        if (ch === qc) { i++; break }
        buf += ch
        i++
      }
      out.push(buf)
      continue
    }
    // Bare word — read until whitespace.
    let j = i
    while (j < n && line[j] !== ' ' && line[j] !== '\t') j++
    out.push(line.slice(i, j))
    i = j
  }
  return out
}


// ─── path normalization ──────────────────────────────────────────


// Canonicalize a cwd: leading slash, no trailing slash (except root),
// no doubled slashes. `~` expands to root.
export function normalizeCwd(path: string): string {
  if (!path || path === '~') return '/'
  let p = path.startsWith('/') ? path : '/' + path
  // Collapse repeated slashes; strip trailing (except root).
  p = p.replace(/\/+/g, '/').replace(/\/+$/, '')
  return p === '' ? '/' : p
}


// Resolve a user path against the current cwd. Supports:
//   absolute            /foo/bar
//   relative            foo/bar      → cwd + /foo/bar
//   ..                  one level up
//   .                   no-op
//   ~                   home (root)
//   @<peer-id> suffix   preserved verbatim (federation)
export function resolvePath(cwd: string, input: string): string {
  if (!input || input === '.') return normalizeCwd(cwd)
  if (input === '~') return '/'
  // Federation suffix: split off the @peer-id if present, re-attach at
  // the end. The base path resolution doesn't care about the suffix.
  const atIdx = input.indexOf('@')
  let base = input
  let peer = ''
  if (atIdx >= 0) {
    base = input.slice(0, atIdx)
    peer = input.slice(atIdx) // includes the '@'
  }
  let start: string[]
  if (base.startsWith('/')) {
    start = []  // absolute
  } else {
    start = cwd === '/' ? [] : cwd.split('/').filter(Boolean)
  }
  for (const seg of base.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (start.length > 0) start.pop()
      continue
    }
    start.push(seg)
  }
  const path = '/' + start.join('/')
  return normalizeCwd(path) + peer
}
