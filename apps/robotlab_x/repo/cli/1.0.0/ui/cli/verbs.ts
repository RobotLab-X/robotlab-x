// CLI verbs — one async function per command. Verbs read context (cwd,
// io, wsClient) via the InterpreterContext passed in; they return a
// promise that resolves when the verb is done. Long-running verbs
// (tail, watch) register a cancel via ctx.io.registerCancel + the
// returned promise resolves on cancel.
//
// Verb implementations stay small + composable; shared formatting
// helpers live at the bottom of the file. The verb table is the public
// surface — Interpreter.run() reads the first token and looks it up
// here.
import type { InterpreterContext } from './interpreter'
import { resolvePath } from './interpreter'
import {
  getFilterCatalog, getInstanceMeta, getServices, getTypeDescriptor,
  getTypes, listChildren, type DirEntry,
} from './discovery'


type Verb = (args: string[], ctx: InterpreterContext) => Promise<void>


// ─── ANSI helpers (kept local; Cli.tsx writes raw lines) ──────────


const ESC = '\x1b['
const RESET = `${ESC}0m`
// One styles map covers colors AND text-weight styles — they all
// resolve to "ANSI escape + payload + reset". Keeping them separate
// (a COLORS map plus stray BOLD/DIM constants) meant ``c('bold', ...)``
// didn't type-check; merging keeps the call shape consistent.
const STYLES = {
  red: `${ESC}31m`, green: `${ESC}32m`, yellow: `${ESC}33m`, blue: `${ESC}34m`,
  magenta: `${ESC}35m`, cyan: `${ESC}36m`, gray: `${ESC}90m`,
  bold: `${ESC}1m`, dim: `${ESC}2m`,
}
const c = (style: keyof typeof STYLES, s: string) => `${STYLES[style]}${s}${RESET}`


// ─── attach the discovery cache once ──────────────────────────────


// Discovery cache attach/detach now lives in Cli.tsx — see the
// useEffect that calls ``attach(wsClient)`` on mount and the returned
// detach() on unmount. Previously this module owned a singleton
// ``_attached`` flag, which broke when the user switched between
// runtimes: the flag stayed set so subscriptions never moved to the
// new bus, leaving the cache stuck on the FIRST runtime's data (or
// empty if the first runtime's index hadn't published yet).


// ─── pwd ──────────────────────────────────────────────────────────


const pwd: Verb = async (_args, ctx) => {
  ctx.io.writeLine(ctx.getCwd())
}


// ─── cd ───────────────────────────────────────────────────────────


const cd: Verb = async (args, ctx) => {
  if (args.length === 0) {
    ctx.setCwd('/')
    return
  }
  const target = args[0]
  const next = resolvePath(ctx.getCwd(), target)
  ctx.setCwd(next)
}


// ─── ls ───────────────────────────────────────────────────────────


const ls: Verb = async (args, ctx) => {
  // Flags accepted (combinable, e.g. -la):
  //   -l   long format (kind + name + hint columns)
  //   -a   include "raw" entries discovered straight from the bus
  //        topic registry — useful when the curated view is hiding
  //        something the user expects to see (the FS metaphor's
  //        equivalent of dotfiles).
  const flags = new Set<string>()
  for (const a of args) {
    if (!a.startsWith('-') || a === '-') continue
    for (const ch of a.slice(1)) flags.add(ch)
  }
  const longFmt = flags.has('l')
  const showAll = flags.has('a')
  const target = args.find((a) => !a.startsWith('-')) ?? '.'
  const path = resolvePath(ctx.getCwd(), target)
  const curated = listChildren(path)
  let entries = curated
  if (showAll) {
    // Augment with bus-topic-registry children. ``listTopics`` is the
    // canonical "what topics exist" view; we filter to one segment
    // below ``path`` so the result is the immediate children, matching
    // the curated view's shape. Curated entries take precedence —
    // ``raw`` only fills the gaps.
    try {
      const raw = await busTopicChildren(ctx, path)
      const seen = new Set(curated.map((e) => e.name))
      for (const r of raw) {
        if (seen.has(r.name)) continue
        entries = entries.concat(r)
      }
    } catch (e) {
      ctx.io.writeInfo(`(ls -a: listTopics unavailable — ${(e as Error).message})`)
    }
  }
  if (entries.length === 0) {
    if (!showAll) {
      ctx.io.writeInfo(`(no entries at ${path}; try ls -a)`)
    } else {
      ctx.io.writeInfo(`(no entries at ${path})`)
    }
    return
  }
  if (!longFmt) {
    // Compact: just names, methods marked with (). Raw entries get
    // a leading dot so they're visually distinct in the dense listing.
    const names = entries.map((e) =>
      e.kind === 'method' ? `${e.name}()`
        : e.kind === 'raw' ? `.${e.name}`
          : e.name)
    ctx.io.writeLine(names.join('  '))
    return
  }
  // Long: kind + name + hint.
  const widthName = Math.max(...entries.map((e) => e.name.length)) + 2
  const widthKind = 10
  for (const e of entries) {
    const kindCol =
      e.kind === 'method' ? c('green', e.kind.padEnd(widthKind)) :
      e.kind === 'topic' ? c('cyan', e.kind.padEnd(widthKind)) :
      e.kind === 'instance' ? c('magenta', e.kind.padEnd(widthKind)) :
      e.kind === 'raw' ? c('gray', e.kind.padEnd(widthKind)) :
      c('blue', e.kind.padEnd(widthKind))
    const nameCol = e.kind === 'method'
      ? c('green', (e.name + '()').padEnd(widthName + 2))
      : e.kind === 'raw'
        ? c('gray', e.name.padEnd(widthName))
        : e.name.padEnd(widthName)
    ctx.io.writeLine(`${kindCol}${nameCol}${c('gray', e.hint ?? '')}`)
  }
}


// Query /v1/bus/topics (via wsClient.listTopics) and return the
// immediate children of ``path``. Returns DirEntry[] with kind='raw'.
//
// Tree derivation: a topic ``/a/b/c/d`` is a CHILD of ``/a/b`` (or its
// sub-tree). The immediate child segment is whatever comes right
// after the path prefix — ``c`` in the example. Duplicate child
// segments collapse (multiple topics under same prefix → one entry).
async function busTopicChildren(
  ctx: InterpreterContext,
  path: string,
): Promise<DirEntry[]> {
  if (!ctx.wsClient.listTopics) {
    throw new Error('bus listTopics not available (session may lack admin auth)')
  }
  // Normalise prefix — root is '/', everything else is '/foo/bar' (no
  // trailing slash). We compute a "scan prefix" that's path + '/' so
  // /foo doesn't accidentally match /foobar.
  const base = path.split('@')[0]
  const scanPrefix = base === '/' ? '/' : base + '/'
  const topics = await ctx.wsClient.listTopics(2000)
  const seen = new Map<string, { hasRetained: boolean; subscribers: number; isLeaf: boolean }>()
  for (const t of topics) {
    const topic = t.name
    if (!topic.startsWith(scanPrefix)) continue
    const tail = topic.slice(scanPrefix.length)
    if (!tail) continue
    const slashIdx = tail.indexOf('/')
    const name = slashIdx < 0 ? tail : tail.slice(0, slashIdx)
    if (!name) continue
    const isLeaf = slashIdx < 0  // this topic exactly = path/<name>
    const existing = seen.get(name)
    const retained = Boolean(t.retained)
    const subscribers = Number(t.subscriber_count ?? 0)
    if (existing) {
      existing.hasRetained = existing.hasRetained || (isLeaf && retained)
      existing.subscribers += isLeaf ? subscribers : 0
      existing.isLeaf = existing.isLeaf || isLeaf
    } else {
      seen.set(name, {
        hasRetained: isLeaf && retained,
        subscribers: isLeaf ? subscribers : 0,
        isLeaf,
      })
    }
  }
  return Array.from(seen.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, info]) => ({
      name,
      kind: 'raw' as const,
      hint: info.isLeaf
        ? `${info.hasRetained ? 'retained' : 'transient'}  subs=${info.subscribers}`
        : 'prefix (has children)',
    }))
}


// ─── cat ──────────────────────────────────────────────────────────


// Read a retained topic's current value. Resolves the path against the
// cwd, normalizes (in particular: a 2-segment path like /clock/clock-1
// resolves to the state topic for convenience, matching `cat` of a
// directory-as-default-file in shells like fish).
const cat: Verb = async (args, ctx) => {
  if (args.length === 0) {
    ctx.io.writeError('usage: cat <path>')
    return
  }
  const raw = resolvePath(ctx.getCwd(), args[0])
  const topic = toTopic(raw)
  await new Promise<void>((resolve) => {
    let resolved = false
    const off = ctx.wsClient.subscribe(topic, (f) => {
      if (f.method !== 'message') return
      if (resolved) return
      resolved = true
      const payload = f.payload
      if (payload === null || payload === undefined) {
        ctx.io.writeInfo(`(${topic} is cleared / no retained value)`)
      } else if (typeof payload === 'string') {
        ctx.io.writeLine(payload)
      } else {
        ctx.io.writeLine(JSON.stringify(payload, null, 2))
      }
      off()
      resolve()
    })
    // No retained value? Resolve after a short window so we don't hang.
    setTimeout(() => {
      if (resolved) return
      resolved = true
      off()
      ctx.io.writeInfo(`(no retained value at ${topic} within 500ms)`)
      resolve()
    }, 500)
  })
}


// ─── tail ─────────────────────────────────────────────────────────


// Subscribe + stream. Stays open until Ctrl-C (the terminal calls the
// registered cancel fn).
const tail: Verb = async (args, ctx) => {
  if (args.length === 0) {
    ctx.io.writeError('usage: tail <path>')
    return
  }
  const raw = resolvePath(ctx.getCwd(), args[0])
  const topic = toTopic(raw)
  ctx.io.writeInfo(`tail ${topic} — Ctrl-C to stop`)
  await new Promise<void>((resolve) => {
    let first = true
    const off = ctx.wsClient.subscribe(topic, (f) => {
      if (f.method !== 'message') return
      // First payload is the retained one; mark it for clarity but
      // print it like the rest so the user sees current truth.
      const prefix = first ? c('gray', 'retained ') : c('gray', new Date().toISOString().slice(11, 23) + ' ')
      first = false
      const payload = f.payload
      const body = payload === null ? '(null)' :
                   typeof payload === 'string' ? payload :
                   JSON.stringify(payload)
      ctx.io.writeLine(`${prefix}${body}`)
    })
    ctx.io.registerCancel(() => {
      off()
      resolve()
    })
  })
}


// ─── watch ────────────────────────────────────────────────────────


// Re-run the rest of the command every N seconds, clearing between
// runs. Useful for `watch ls /runtime/runtime/services`.
const watchVerb: Verb = async (args, ctx) => {
  let intervalS = 1
  let i = 0
  if (args[i] === '-n' && args[i + 1]) {
    intervalS = Math.max(0.25, parseFloat(args[i + 1]))
    i += 2
  }
  const sub = args.slice(i)
  if (sub.length === 0) {
    ctx.io.writeError('usage: watch [-n SECONDS] <command...>')
    return
  }
  const subVerb = sub[0]
  const subArgs = sub.slice(1)
  const fn = VERBS[subVerb]
  if (!fn) {
    ctx.io.writeError(`watch: unknown verb ${subVerb}`)
    return
  }
  let cancelled = false
  ctx.io.registerCancel(() => { cancelled = true })
  while (!cancelled) {
    ctx.io.clear()
    ctx.io.writeInfo(`watch — every ${intervalS}s — ${[subVerb, ...subArgs].join(' ')}`)
    try {
      await fn(subArgs, ctx)
    } catch (e) {
      ctx.io.writeError(`watch: ${(e as Error).message}`)
    }
    await new Promise((r) => setTimeout(r, intervalS * 1000))
  }
}


// ─── describe ─────────────────────────────────────────────────────


const describe: Verb = async (args, ctx) => {
  const target = args[0] ?? '.'
  const path = resolvePath(ctx.getCwd(), target)
  const segs = path.split('@')[0].split('/').filter(Boolean)
  if (segs.length === 0) {
    // Root — show runtime + types summary.
    const types = getTypes()
    const services = getServices()
    ctx.io.writeLine(c('cyan', `${types.length} types registered, ${services.length} services running`))
    for (const t of types) {
      const flag = t.schemas_complete ? c('green', '✓') : c('gray', '-')
      ctx.io.writeLine(`  ${flag} ${t.type}@${t.version ?? '?'}  ${c('gray', t.description?.split('\n')[0] ?? '')}`)
    }
    return
  }
  if (segs.length === 1) {
    // Type-level: look up the descriptor.
    const t = getTypeDescriptor(segs[0])
    if (!t) {
      ctx.io.writeError(`unknown type: ${segs[0]}`)
      return
    }
    ctx.io.writeLine(`${c('cyan', t.type)}@${t.version}  ${c('gray', '(' + t.transport + ')')}`)
    if (t.description) ctx.io.writeLine(c('gray', t.description.split('\n')[0]))
    if (t.tags?.length) ctx.io.writeLine(`tags: ${t.tags.join(', ')}`)
    if (t.schemas_complete === false) {
      ctx.io.writeLine(c('yellow', `note: ${t.notes ?? 'manifest-only descriptor'}`))
    }
    if (t.methods?.length) {
      ctx.io.writeLine(c('bold', 'methods:'))
      for (const m of t.methods) {
        const argstr = formatArgs(m.args_schema)
        ctx.io.writeLine(`  ${c('green', m.name)}(${argstr})  ${c('gray', (m.doc || '').split('\n')[0])}`)
      }
    }
    if (t.config_schema) ctx.io.writeLine(c('bold', 'config_schema:') + ' (see /runtime/runtime/types/' + t.type + ')')
    if (t.state_schema) ctx.io.writeLine(c('bold', 'state_schema:') + ' (see /runtime/runtime/types/' + t.type + ')')
    return
  }
  // Instance: pull meta + walk type descriptor for the schema half.
  const [type, id] = segs
  const meta = getInstanceMeta(type, id)
  if (!meta) {
    ctx.io.writeError(`no /meta retained for ${type}/${id} — service may not be running`)
    return
  }
  ctx.io.writeLine(`${c('cyan', `${meta.type}/${meta.proxy_id}`)}  ${c('gray', `(${meta.transport ?? '?'}; pid=${meta.pid ?? '-'}; runtime=${meta.runtime_id ?? '-'})`)}`)
  ctx.io.writeLine(c('bold', 'topics:'))
  for (const [k, v] of Object.entries(meta.topics ?? {})) {
    ctx.io.writeLine(`  ${k.padEnd(20)} ${c('cyan', v)}`)
  }
  if (meta.methods?.length) {
    const td = getTypeDescriptor(meta.type)
    const byName = new Map((td?.methods ?? []).map((m) => [m.name, m]))
    ctx.io.writeLine(c('bold', 'methods:'))
    for (const m of meta.methods) {
      const args = formatArgs(byName.get(m.name)?.args_schema)
      ctx.io.writeLine(`  ${c('green', m.name)}(${args})  ${c('gray', (m.doc || '').split('\n')[0])}`)
    }
  }
  // For video, also surface filter catalog summary.
  if (meta.type === 'video') {
    const cat = getFilterCatalog(meta.proxy_id)
    if (cat) {
      ctx.io.writeLine(c('bold', 'filter_catalog:'))
      for (const f of cat) {
        const tel = f.publishes_telemetry ? c('green', '✓ telem') : c('gray', '  effect')
        ctx.io.writeLine(`  ${tel}  ${f.type}  ${c('gray', f.description?.split('\n')[0] ?? '')}`)
      }
    }
  }
}


// ─── call ─────────────────────────────────────────────────────────


// Invoke an @service_method on the current cwd's service. Three arg
// forms accepted:
//   call set_interval 500                   (positional)
//   call set_interval interval_ms=500       (kwargs)
//   call set_interval '{"interval_ms":500}' (raw JSON object)
const call: Verb = async (args, ctx) => {
  if (args.length < 1) {
    ctx.io.writeError('usage: call <method> [args...]')
    return
  }
  const cwd = ctx.getCwd()
  const { base, peer } = splitPeer(cwd)
  const segs = base.split('/').filter(Boolean)
  if (segs.length < 2) {
    ctx.io.writeError('call: must be invoked on a service path (e.g. cd /clock/clock-1)')
    return
  }
  const [type, id] = segs
  // Strip a trailing ()` so ``call stop_clock()`` works the same as
  // ``call stop_clock`` — matches what ``ls`` prints for methods.
  const method = args[0].replace(/\(\s*\)$/, '')
  const argTokens = args.slice(1)

  // Look up the args schema (best effort — without it we just pack
  // positional args in declaration order and ship).
  const td = getTypeDescriptor(type)
  const methodInfo = td?.methods?.find((m) => m.name === method)
  const schema = methodInfo?.args_schema as
    | { properties?: Record<string, { type?: string }>; required?: string[] }
    | undefined

  let payload: Record<string, unknown>
  try {
    payload = buildArgPayload(argTokens, schema)
  } catch (e) {
    ctx.io.writeError(`call: ${(e as Error).message}`)
    return
  }

  const controlTopic = `/${type}/${id}/control${peer}`
  const replyTopic = `/cli/reply/${randomId()}${peer}`

  // Subscribe to the reply BEFORE publishing so retained-delivery races
  // can't drop a fast response. Always tear down on resolve/timeout.
  await new Promise<void>((resolve) => {
    let resolved = false
    const off = ctx.wsClient.subscribe(replyTopic, (f) => {
      if (f.method !== 'message' || resolved) return
      resolved = true
      const r = f.payload
      ctx.io.writeLine(c('green', 'ok') + ' ' + (r === undefined || r === null ? '' : JSON.stringify(r, null, 2)))
      off()
      resolve()
    })
    ctx.wsClient.publish(controlTopic, { action: method, reply_to: replyTopic, ...payload })
    setTimeout(() => {
      if (resolved) return
      resolved = true
      off()
      ctx.io.writeInfo('(no reply within 3s — fire-and-forget method?)')
      resolve()
    }, 3000)
  })
}


// ─── pub ──────────────────────────────────────────────────────────


// Raw publish — power-user only. Useful for sending control payloads
// that don't fit the call helper (e.g. weird method names, retained
// state injection during testing).
const pub: Verb = async (args, ctx) => {
  if (args.length < 2) {
    ctx.io.writeError('usage: pub <topic> <json>')
    return
  }
  const topic = toTopic(resolvePath(ctx.getCwd(), args[0]))
  let payload: unknown
  try {
    payload = JSON.parse(args.slice(1).join(' '))
  } catch (e) {
    ctx.io.writeError(`pub: invalid JSON — ${(e as Error).message}`)
    return
  }
  ctx.wsClient.publish(topic, payload)
  ctx.io.writeInfo(`→ ${topic}`)
}


// ─── find ─────────────────────────────────────────────────────────


// Glob the topic registry. Returns retained-having topics matching a
// pattern (uses listTopics + a regex).
const find: Verb = async (args, ctx) => {
  if (!ctx.wsClient.listTopics) {
    ctx.io.writeError('find: bus listTopics not available')
    return
  }
  const pattern = args[0] ?? '/+'
  const re = patternToRegex(pattern)
  const topics = await ctx.wsClient.listTopics(2000)
  const matches = topics.filter((t) => re.test(t.name))
  matches.sort((a, b) => a.name.localeCompare(b.name))
  for (const t of matches) {
    const tag = t.retained ? c('green', '[retained]') : c('gray', '[transient]')
    ctx.io.writeLine(`${tag} ${t.name}  ${c('gray', `subs=${t.subscriber_count}`)}`)
  }
  ctx.io.writeInfo(`${matches.length}/${topics.length} topics match`)
}


// ─── peers ────────────────────────────────────────────────────────


const peers: Verb = async (_args, ctx) => {
  // Authoritative source: GET /v1/peers — backed by the live
  // peer_manager state (mDNS + manual connects). Each entry carries
  // url, remote_id (null while still IDENTIFYING), state, and
  // upstream_subs (count of cross-runtime forwarded subscriptions).
  // Fall back to the services-index heuristic only if the REST call
  // isn't available (apiFetch unset in a test stub, or 401).
  if (ctx.apiFetch) {
    try {
      const r = await ctx.apiFetch<Array<{ key: string; url: string; remote_id: string | null; state: string; upstream_subs?: number }>>('/v1/peers')
      const list = Array.isArray(r) ? r : []
      if (list.length === 0) {
        ctx.io.writeInfo('(no peers connected — runtime is alone or mDNS discovery has not converged)')
        return
      }
      ctx.io.writeLine(c('bold', `peers (${list.length}):`))
      // Widths for tidy column layout.
      const idWidth = Math.max(8, ...list.map((p) => (p.remote_id ?? '(identifying)').length))
      const stateWidth = Math.max(5, ...list.map((p) => p.state.length))
      for (const p of list) {
        const idLabel = p.remote_id ?? c('gray', '(identifying)')
        const stateCol = p.state === 'connected' ? c('green', p.state.padEnd(stateWidth))
                       : p.state === 'identifying' ? c('yellow', p.state.padEnd(stateWidth))
                       : c('red', p.state.padEnd(stateWidth))
        const subs = p.upstream_subs ? c('gray', ` subs=${p.upstream_subs}`) : ''
        const idPadded = (p.remote_id ? c('magenta', p.remote_id) : idLabel)
          + ' '.repeat(Math.max(0, idWidth - (p.remote_id ?? '(identifying)').length))
        ctx.io.writeLine(`  ${idPadded}  ${stateCol}  ${c('cyan', p.url)}${subs}`)
      }
      return
    } catch (e) {
      // 401 (non-admin token) or transport error — fall through to the
      // bus-based heuristic so the verb still produces something useful.
      ctx.io.writeInfo(`peers via REST failed (${(e as Error).message}) — falling back to services-index heuristic`)
    }
  }
  // Heuristic fallback: every peer's services_index gets forwarded via
  // federation; the runtime_id field disambiguates them.
  const seen = new Set<string>()
  for (const s of getServices()) {
    if (s.runtime_id) seen.add(s.runtime_id)
  }
  if (seen.size === 0) {
    ctx.io.writeInfo('(no peers visible yet — runtime services index hasn\'t populated)')
    return
  }
  ctx.io.writeLine(c('bold', 'peers (from bus):'))
  for (const r of Array.from(seen).sort()) {
    ctx.io.writeLine(`  ${c('magenta', r)}`)
  }
}


// ─── help ─────────────────────────────────────────────────────────


const HELP_TEXT: Record<string, string> = {
  pwd: 'pwd                       Print current path.',
  cd: 'cd [path]                 Change context. ".." goes up. "~" returns to /. Supports @peer-id.',
  ls: 'ls [-l] [-a] [path]       List children at path. -l shows kind + hint. -a includes raw bus topics (the FS "dotfiles" — entries the curated view hides).',
  cat: 'cat <path>                Print the retained value at the path.',
  tail: 'tail <path>               Subscribe + stream until Ctrl-C.',
  watch: 'watch [-n S] <cmd ...>    Re-run cmd every S seconds (default 1).',
  describe: 'describe [path]           Show meta + type descriptor + filter catalog at path.',
  call: 'call <method> [args]      Invoke an @service_method on current cwd. Supports positional, kw, JSON.',
  pub: 'pub <topic> <json>        Raw publish (advanced).',
  find: 'find <pattern>            Glob the topic registry (e.g. /+/+/state).',
  peers: 'peers                     List runtime ids visible on the bus.',
  clear: 'clear                     Clear the screen.',
  history: 'history                   Print recent commands.',
  help: 'help [verb]               Show this help, or detail for one verb.',
}

const help: Verb = async (args, ctx) => {
  if (args.length > 0) {
    const v = args[0]
    if (HELP_TEXT[v]) ctx.io.writeLine(HELP_TEXT[v])
    else ctx.io.writeError(`no help for: ${v}`)
    return
  }
  ctx.io.writeLine(c('bold', 'commands:'))
  for (const line of Object.values(HELP_TEXT)) {
    ctx.io.writeLine('  ' + line)
  }
  ctx.io.writeLine('')
  ctx.io.writeLine(c('gray', 'Paths are bus topics. Try: ls /, cd /clock, ls, cat state, call start_clock'))
  ctx.io.writeLine(c('gray', 'Federation: cd /clock/clock-1@funny-droid'))
}


// ─── clear / history (history lives in the terminal; just a stub) ──


const clearV: Verb = async (_args, ctx) => { ctx.io.clear() }
const history: Verb = async (_args, ctx) => {
  ctx.io.writeInfo('history is kept by the terminal (use ↑/↓ to recall).')
}


// ─── verb table ───────────────────────────────────────────────────


export const VERBS: Record<string, Verb> = {
  pwd, cd, ls, cat, tail,
  watch: watchVerb,
  describe, call, pub, find, peers,
  help, clear: clearV, history,
}


// ─── helpers ──────────────────────────────────────────────────────


// Turn a /<type>/<id>/<topic-suffix> path into the wire topic. For
// 2-segment paths, default to the /state topic — matches "cat the
// directory" shorthand. Federation suffix is preserved.
function toTopic(path: string): string {
  const { base, peer } = splitPeer(path)
  const segs = base.split('/').filter(Boolean)
  if (segs.length === 2) return `/${segs.join('/')}/state${peer}`
  return base + peer
}


function splitPeer(path: string): { base: string; peer: string } {
  const i = path.indexOf('@')
  if (i < 0) return { base: path, peer: '' }
  return { base: path.slice(0, i), peer: path.slice(i) }
}


// Coerce a value to the type declared in the args_schema property.
// Best-effort — bad input returns the input verbatim so the user sees
// a server-side error rather than a silent client truncation.
function coerce(value: string, type: string | undefined): unknown {
  if (type === 'integer') {
    const n = parseInt(value, 10)
    return Number.isFinite(n) ? n : value
  }
  if (type === 'number') {
    const n = parseFloat(value)
    return Number.isFinite(n) ? n : value
  }
  if (type === 'boolean') {
    if (value === 'true' || value === '1') return true
    if (value === 'false' || value === '0') return false
  }
  if (type === 'object' || type === 'array') {
    try { return JSON.parse(value) } catch { /* fallthrough */ }
  }
  return value
}


// Build {arg_name: value} from a flat token list. Supports:
//   positional   first N tokens map to first N props in declaration order
//   key=value    overrides positional
//   raw JSON     single token starting with { or [ replaces the whole payload
function buildArgPayload(
  tokens: string[],
  schema?: { properties?: Record<string, { type?: string }>; required?: string[] }
): Record<string, unknown> {
  if (tokens.length === 1 && (tokens[0].startsWith('{') || tokens[0].startsWith('['))) {
    try {
      const p = JSON.parse(tokens[0])
      if (Array.isArray(p)) {
        // Array → positional mapping against the schema's property order.
        const out: Record<string, unknown> = {}
        const names = Object.keys(schema?.properties ?? {})
        for (let i = 0; i < p.length && i < names.length; i++) {
          out[names[i]] = p[i]
        }
        return out
      }
      if (p && typeof p === 'object') return p as Record<string, unknown>
    } catch (e) {
      throw new Error(`malformed JSON arg: ${(e as Error).message}`)
    }
  }
  const out: Record<string, unknown> = {}
  const propNames = Object.keys(schema?.properties ?? {})
  let positional = 0
  for (const t of tokens) {
    const eq = t.indexOf('=')
    if (eq > 0) {
      const k = t.slice(0, eq)
      const v = t.slice(eq + 1)
      const type = schema?.properties?.[k]?.type
      out[k] = coerce(v, type)
    } else {
      const name = propNames[positional++]
      if (!name) {
        throw new Error(`too many positional args (schema has ${propNames.length})`)
      }
      const type = schema?.properties?.[name]?.type
      out[name] = coerce(t, type)
    }
  }
  // Don't enforce required here — the server validates + the failure
  // message comes back via reply_to. Surface a hint though.
  return out
}


function formatArgs(schema: unknown): string {
  const s = schema as { properties?: Record<string, { type?: string }>; required?: string[] } | undefined
  if (!s?.properties) return ''
  const required = new Set(s.required ?? [])
  return Object.entries(s.properties)
    .map(([k, v]) => `${k}${required.has(k) ? '' : '?'}: ${v?.type ?? 'any'}`)
    .join(', ')
}


function patternToRegex(pattern: string): RegExp {
  // MQTT-style + (one segment) and # (rest of path) → regex.
  const escaped = pattern.replace(/[.*+?^${}()|\\]/g, '\\$&')
  const re = escaped.replace(/\+/g, '[^/]+').replace(/#/g, '.*')
  return new RegExp('^' + re + '$')
}


function randomId(): string {
  return Math.random().toString(36).slice(2, 10)
}
