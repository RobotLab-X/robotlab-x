// Discovery cache — single subscriber per topic, shared across CLI
// instances on the same page. Verbs read snapshots from here instead
// of subscribing themselves so `ls` is instant after the first second.
//
// Topics tracked (all retained):
//   /runtime/runtime/services           → live instance list
//   /runtime/runtime/types              → registered types
//   /runtime/runtime/types/<type>       → per-type descriptors
//   /+/+/meta                           → per-instance meta
//   /video/+/filter_catalog             → filter catalogs per video instance
//   /filter/index/+                     → cross-runtime filter index
//
// All snapshots are plain JS objects; consumers should treat them as
// read-only (we don't deep-clone on every getter call for perf).
import type { CliWsClient } from './interpreter'


export interface ServicesEntry {
  proxy_id: string
  type: string
  version?: string
  transport?: string
  status?: string
  topics_root?: string
  meta_topic?: string
  runtime_id?: string
  pid?: number | null
}
export interface ServicesIndex {
  ts?: number
  runtime_id?: string | null
  services: ServicesEntry[]
}

export interface TypeSummaryEntry {
  type: string
  version?: string
  transport?: string
  description?: string | null
  tags?: string[]
  installed?: boolean
  schemas_complete?: boolean
}
export interface TypesSummary {
  ts?: number
  runtime_id?: string | null
  types: TypeSummaryEntry[]
}

export interface TypeMethod {
  name: string
  doc?: string | null
  args_schema?: Record<string, unknown>
  publishes?: string[]
  publish_return?: string | null
}
export interface TypeDescriptor {
  type: string
  version?: string
  transport?: string
  description?: string | null
  tags?: string[]
  schemas_complete?: boolean
  config_schema?: Record<string, unknown> | null
  state_schema?: Record<string, unknown> | null
  topic_schemas?: Record<string, Record<string, unknown>>
  methods?: TypeMethod[]
  sub_resources?: Array<{ name: string; list_topic_suffix?: string; item_topic_template?: string; catalog_topic_suffix?: string; key_field?: string }>
  notes?: string
}

export interface InstanceMeta {
  proxy_id: string
  type: string
  version?: string
  transport?: string
  runtime_id?: string | null
  pid?: number
  topics_root: string
  topics: Record<string, string>
  methods?: Array<{ name: string; doc?: string | null; publishes?: string[]; publish_return?: string | null }>
}

export interface FilterCatalogEntry {
  type: string
  title?: string
  description?: string
  publishes_telemetry?: boolean
  param_schema?: Array<Record<string, unknown>>
  telemetry_schema?: Record<string, unknown> | null
}


// ─── singleton store ──────────────────────────────────────────────


interface FilterIndexEntry {
  filter_id?: string
  type?: string
  title?: string
  video_proxy_id?: string
  runtime_id?: string | null
  telemetry_topic?: string
  enabled?: boolean
}


interface Snapshot {
  servicesIndex: ServicesIndex | null
  typesSummary: TypesSummary | null
  typeDescriptors: Map<string, TypeDescriptor>
  // Keyed by concrete topic path, e.g. /clock/clock-1/meta.
  metaByTopic: Map<string, InstanceMeta>
  // Keyed by /video/<vid>/filter_catalog → list of catalog entries.
  filterCatalogByTopic: Map<string, FilterCatalogEntry[]>
  // Keyed by filter_id — entries from /filter/index/<id>. Populated
  // by a wildcard subscription so cli ``ls /filter/index`` enumerates
  // every active filter across the federation in one place.
  filterIndexById: Map<string, FilterIndexEntry>
}


const _snap: Snapshot = {
  servicesIndex: null,
  typesSummary: null,
  typeDescriptors: new Map(),
  metaByTopic: new Map(),
  filterCatalogByTopic: new Map(),
  filterIndexById: new Map(),
}
let _offFns: Array<() => void> = []
let _refcount = 0


export function attach(client: CliWsClient): () => void {
  _refcount++
  if (_refcount === 1) {
    _offFns = [
      client.subscribe('/runtime/runtime/services', (f) => {
        if (f.method !== 'message') return
        _snap.servicesIndex = (f.payload ?? null) as ServicesIndex | null
      }),
      client.subscribe('/runtime/runtime/types', (f) => {
        if (f.method !== 'message') return
        _snap.typesSummary = (f.payload ?? null) as TypesSummary | null
      }),
      client.subscribe('/runtime/runtime/types/+', (f) => {
        if (f.method !== 'message') return
        const t = (f.topic || '').split('/').pop() || ''
        if (!t) return
        if (f.payload === null) { _snap.typeDescriptors.delete(t); return }
        _snap.typeDescriptors.set(t, f.payload as TypeDescriptor)
      }),
      client.subscribe('/+/+/meta', (f) => {
        if (f.method !== 'message') return
        const topic = f.topic ?? ''
        if (!topic) return
        if (f.payload === null) { _snap.metaByTopic.delete(topic); return }
        _snap.metaByTopic.set(topic, f.payload as InstanceMeta)
      }),
      client.subscribe('/+/+/filter_catalog', (f) => {
        if (f.method !== 'message') return
        const topic = f.topic ?? ''
        if (!topic) return
        if (f.payload === null) { _snap.filterCatalogByTopic.delete(topic); return }
        const p = f.payload as { filters?: FilterCatalogEntry[] }
        _snap.filterCatalogByTopic.set(topic, p?.filters ?? [])
      }),
      client.subscribe('/filter/index/+', (f) => {
        if (f.method !== 'message') return
        const topic = f.topic ?? ''
        if (!topic.startsWith('/filter/index/')) return
        const fid = topic.slice('/filter/index/'.length)
        if (!fid) return
        if (f.payload === null) { _snap.filterIndexById.delete(fid); return }
        if (typeof f.payload === 'object') {
          _snap.filterIndexById.set(fid, f.payload as FilterIndexEntry)
        }
      }),
    ]
  }
  return () => {
    _refcount--
    if (_refcount === 0) {
      for (const off of _offFns) off()
      _offFns = []
      _snap.servicesIndex = null
      _snap.typesSummary = null
      _snap.typeDescriptors.clear()
      _snap.metaByTopic.clear()
      _snap.filterCatalogByTopic.clear()
      _snap.filterIndexById.clear()
    }
  }
}


// ─── snapshot accessors ───────────────────────────────────────────


export function getServices(): ServicesEntry[] {
  return _snap.servicesIndex?.services ?? []
}
export function getTypes(): TypeSummaryEntry[] {
  return _snap.typesSummary?.types ?? []
}
export function getTypeDescriptor(type: string): TypeDescriptor | null {
  return _snap.typeDescriptors.get(type) ?? null
}
export function getInstanceMeta(typeName: string, proxyId: string): InstanceMeta | null {
  return _snap.metaByTopic.get(`/${typeName}/${proxyId}/meta`) ?? null
}
export function getFilterCatalog(videoProxyId: string): FilterCatalogEntry[] | null {
  return _snap.filterCatalogByTopic.get(`/video/${videoProxyId}/filter_catalog`) ?? null
}


// ─── path → children resolution ───────────────────────────────────


export interface DirEntry {
  name: string
  // 'namespace' / 'instance' / 'topic' / 'method' / 'meta' = entries
  //   the curated view knows about (from meta + indexes).
  // 'raw' = entries discovered straight from the bus topic registry —
  //   surfaced only when the user passes ``ls -a`` so the default
  //   listing stays curated. Equivalent to dotfiles in a real shell.
  kind: 'namespace' | 'instance' | 'topic' | 'method' | 'meta' | 'raw'
  hint?: string
}


// Strip any @peer-id suffix; for now we resolve children against the
// local snapshot only. Federation-aware completion comes later (would
// require subscribing to /runtime/runtime/services@<peer-id> too).
function stripPeer(path: string): { base: string; peer: string } {
  const i = path.indexOf('@')
  if (i < 0) return { base: path, peer: '' }
  return { base: path.slice(0, i), peer: path.slice(i) }
}


export function listChildren(path: string): DirEntry[] {
  const { base } = stripPeer(path)
  const segs = base.split('/').filter(Boolean)

  // /  →  unique top-level segments from active instances + the runtime
  // pseudo-namespaces (filter, stream).
  if (segs.length === 0) {
    const seen = new Set<string>()
    for (const s of getServices()) {
      const t = s.topics_root?.split('/').filter(Boolean)[0]
      if (t) seen.add(t)
    }
    // Always include cross-cutting + runtime singleton namespaces so the
    // top of the tree shows them even before any instance publishes
    // their topic. These match retained-topic prefixes we know exist.
    for (const n of ['runtime', 'filter', 'stream', 'service_proxy']) seen.add(n)
    return Array.from(seen).sort().map((name) => ({ name, kind: 'namespace' }))
  }

  // /<type>  →  instances of that type
  if (segs.length === 1) {
    const ns = segs[0]
    const inst = new Set<string>()
    for (const s of getServices()) {
      if (s.type === ns && s.proxy_id) inst.add(s.proxy_id)
    }
    // Special namespaces: runtime, filter, stream, service_proxy. Their
    // children are well-known indexes rather than instances.
    if (ns === 'runtime') {
      return [
        { name: 'runtime', kind: 'instance', hint: 'singleton — services + types index' },
      ]
    }
    if (ns === 'filter') {
      return [{ name: 'index', kind: 'instance', hint: 'global filter index — children are filter ids' }]
    }
    if (ns === 'stream') {
      return [{ name: 'index', kind: 'instance', hint: 'global stream index' }]
    }
    return Array.from(inst).sort().map((name) => ({
      name, kind: 'instance', hint: ns === 'cli' ? 'cli (this terminal type)' : ns,
    }))
  }

  // /<type>/<id>  →  topics + methods
  if (segs.length === 2) {
    const [ns, id] = segs
    const out: DirEntry[] = []
    const meta = getInstanceMeta(ns, id)
    if (meta) {
      const seen = new Set<string>()
      for (const [k] of Object.entries(meta.topics ?? {})) {
        if (seen.has(k)) continue
        seen.add(k)
        out.push({ name: k, kind: 'topic', hint: meta.topics[k] })
      }
      for (const m of meta.methods ?? []) {
        if (seen.has(m.name)) continue
        out.push({ name: m.name, kind: 'method', hint: (m.doc || '').split('\n')[0] })
      }
    }
    // Runtime singleton has services + types as children that aren't in
    // its meta (no in-process Service backs the runtime). Synthesize.
    if (ns === 'runtime' && id === 'runtime') {
      out.push({ name: 'services', kind: 'topic', hint: '/runtime/runtime/services' })
      out.push({ name: 'types', kind: 'topic', hint: '/runtime/runtime/types' })
      out.push({ name: 'state', kind: 'topic', hint: '/runtime/runtime/state' })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  // Index topics behave as directories whose children are the entries
  // in their payload — keeps the FS metaphor honest for the user who
  // does ``ls /runtime/runtime/services`` expecting the list inside.
  // Each child carries a ``hint`` pointing at the entity's real
  // topics_root so the user can ``cd`` there (or ``describe`` it).
  if (segs.length === 3 && segs[0] === 'runtime' && segs[1] === 'runtime') {
    if (segs[2] === 'services') {
      return getServices()
        .filter((s) => s.proxy_id)
        .sort((a, b) => (a.proxy_id ?? '').localeCompare(b.proxy_id ?? ''))
        .map((s) => ({
          name: s.proxy_id ?? '',
          kind: 'instance' as const,
          hint: `${s.type}@${s.version ?? '?'}  → cd ${s.topics_root ?? `/${s.type}/${s.proxy_id}`}`,
        }))
    }
    if (segs[2] === 'types') {
      return getTypes()
        .sort((a, b) => a.type.localeCompare(b.type))
        .map((t) => ({
          name: t.type,
          kind: 'namespace' as const,
          hint: `${t.version ? `v${t.version}  ` : ''}${t.transport ?? '?'}  ${t.description?.split('\n')[0] ?? ''}`,
        }))
    }
  }
  // The cross-cutting filter index: /filter/index/<filter_id> entries.
  // Each child name is a filter_id; the hint points the user at the
  // telemetry topic + identifies which video service owns it.
  if (segs.length === 2 && segs[0] === 'filter' && segs[1] === 'index') {
    return Array.from(_snap.filterIndexById.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([fid, entry]) => ({
        name: fid,
        kind: 'instance' as const,
        hint: `${entry.type ?? '?'} on ${entry.video_proxy_id ?? '?'}  → ${entry.telemetry_topic ?? '/filter/index/' + fid}`,
      }))
  }
  // Deeper paths — leaf topics; treat as a file.
  return []
}
