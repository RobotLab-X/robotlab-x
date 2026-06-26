import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type MouseEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Background,
  BaseEdge,
  ControlButton,
  Controls,
  EdgeLabelRenderer,
  Handle,
  Position as RFPosition,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  getBezierPath,
  MarkerType,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodePositionChange,
  type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { CircleDot, Package, Plus, Share2 } from 'lucide-react'
import { useState as useReactState } from 'react'

import { useWsClient, useApiFetch } from '../contexts/ActiveRuntimeContext'
import Banner from '../components/Banner'
import InstallProgress, { type InstallProgressState } from '../components/InstallProgress'
import { useInstallProgress } from '../runtime/useInstallProgress'
import InstallWizard from '../components/InstallWizard'
import ConfigWizard from '../components/ConfigWizard'
import type { Workspace } from '../models/Workspace'
import type { ServiceMeta } from '../models/ServiceMeta'
import type { ServiceProxy } from '../models/ServiceProxy'
import type { ServiceRequest } from '../models/ServiceRequest'
import type { Link } from '../models/Link'
import { type InboundFrame } from '../runtime/wsClient'
import {
  ServiceIcon,
  STATUS_TONE,
  metaNameFromId,
  metaVersionFromId,
  serviceTitle,
} from '../composerViews/_shared'
import {
  DEFAULT_VIEW_ID,
  getComposerView,
  normalizeComposerViewId,
  setOriginView,
} from '../composerViews'
import type { ComposerViewProps, ProxyAction } from '../composerViews/types'

// UUID with a non-secure-context fallback. crypto.randomUUID (like
// crypto.subtle) is undefined when the UI is served over plain HTTP on a
// LAN IP, so we degrade to a Math.random v4 rather than throw. Used to
// mint a service_request id client-side so we can subscribe to its
// progress topic BEFORE posting (the POST runs the install synchronously).
function genId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    const v = ch === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// Drag-and-drop payload keys shared between palette and canvas. The
// drop handler reads dataTransfer.types to decide which list the drag
// came from, then reads the matching payload:
//   * REPO drags carry a service_meta_id (catalog entry) → open the
//     install dialog so the user names the new instance.
//   * REGISTRY drags carry a service_proxy_id (existing instance) →
//     attach it to the current workspace without an install step.
const DRAG_MIME_META = 'application/x-rlx-service-meta'
const DRAG_MIME_PROXY = 'application/x-rlx-service-proxy'

// Palette tab keys. The toggle in the palette aside swaps which list
// drives the rendered rows.
type PaletteTab = 'repo' | 'registry'

// Position record persisted into workspace.node_positions[pid]. Extended
// with optional width/height so a user's resize survives across reloads
// AND across the proxy-state updates that re-derive nodes from scratch.
// Old records (just {x, y}) are still valid since the size fields are
// optional — width/height only render when set.
type Position = { x: number; y: number; width?: number; height?: number }

// Per-node view shapes live in ``../composerViews/`` — one file per
// shape, registered in ``composerViews/index.ts``. The id strings
// are what get persisted to ``Workspace.node_view_types``;
// normaliseComposerViewId handles unknown / legacy values.

interface ProxyNodeData extends Record<string, unknown> {
  proxy: ServiceProxy
  /** View-shape id. Validated/normalised by normalizeComposerViewId
   *  before dispatch — unknown values fall back to DEFAULT_VIEW_ID
   *  rather than rendering broken. */
  viewType?: string
  onViewChange?: (proxyId: string, next: string) => void
  // Wired to dispatchProxyAction so full-view title bars can offer
  // Stop / Release affordances without duplicating the REST plumbing
  // already implemented at the page level.
  onAction?: (proxyId: string, action: ProxyAction) => void
  isSingleton?: boolean
  configurable?: boolean
}

// Single dispatch point — every shape registered in
// ``composerViews/`` is reachable from here without an if/else
// ladder. Unknown ids (typo'd workspace, stale persistence)
// normalise to DEFAULT_VIEW_ID rather than rendering empty.
function ProxyNode(props: { data: ProxyNodeData; selected: boolean }) {
  const id = normalizeComposerViewId(props.data.viewType)
  const def = getComposerView(id) ?? getComposerView(DEFAULT_VIEW_ID)
  if (!def) return null   // unreachable if DEFAULT_VIEW_ID is registered
  const ViewComponent = def.Component
  const composerProps: ComposerViewProps = {
    proxy: props.data.proxy,
    selected: props.selected,
    onViewChange: props.data.onViewChange,
    onAction: props.data.onAction,
    isSingleton: props.data.isSingleton,
    configurable: props.data.configurable,
  }
  // Anchor points for derived route edges. Data flows left→right
  // (target handle on the left edge, source on the right). Kept subtle —
  // they're attachment points, not affordances; manual connection is
  // disabled (nodesConnectable=false) until the interactive-create phase.
  //
  // When this view is SELECTED, mark it ``nowheel`` so React Flow leaves
  // wheel events alone — they reach the view's own scrollable components
  // (output panels, file browsers, …) instead of being swallowed by the
  // canvas. (Canvas zoom-on-scroll is separately gated off while anything
  // is selected.) ``display:contents`` keeps the wrapper layout-neutral
  // while still sitting in the DOM ancestor chain RF inspects.
  return (
    <div className={props.selected ? 'nowheel' : undefined} style={{ display: 'contents' }}>
      <Handle type="target" position={RFPosition.Left} id="in" className="!h-1.5 !w-1.5 !border-0 !bg-slate-600/50" />
      <ViewComponent {...composerProps} />
      <Handle type="source" position={RFPosition.Right} id="out" className="!h-1.5 !w-1.5 !border-0 !bg-slate-600/50" />
    </div>
  )
}

// ─── route edges (derived data-flow links) ───────────────────────────
// A distinct, read-only edge layer separate from the cosmetic
// workspace.edges. Style encodes provenance: solid = observed live
// flow (or both), dashed = declared-only (configured but not currently
// flowing). Capability bindings render amber, data inputs cyan. A pair
// with >1 underlying topic/binding collapses to one edge with a count.

interface RouteEdgeData extends Record<string, unknown> {
  origin: 'declared' | 'observed' | 'both'
  kind: 'input' | 'capability' | 'mixed'
  count: number
  flowing?: boolean
  rateHz?: number
}

function RouteEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props
  const data = (props.data ?? {}) as RouteEdgeData
  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  })
  const declared = data.origin === 'declared'
  const flowing = !!data.flowing
  const color = data.kind === 'capability' ? '#f59e0b' : '#22d3ee'   // amber : cyan
  // Thickness scales with rate (capped) so a busy route reads as "hot".
  const width = flowing ? Math.min(4, 1.8 + Math.log10(1 + (data.rateHz ?? 0))) : 1.5
  // When flowing, leave dasharray unset so React Flow's `.animated`
  // stylesheet rule supplies the marching-ants. Declared-only links are
  // dashed + faint (configured but not currently carrying data).
  const label = data.count > 1 ? String(data.count) : flowing ? `${data.rateHz}Hz` : ''
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        style={{
          stroke: color,
          strokeWidth: width,
          strokeDasharray: flowing ? undefined : declared ? '5 4' : undefined,
          opacity: declared && !flowing ? 0.5 : 0.9,
        }}
        markerEnd={props.markerEnd}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{ transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`, borderColor: color, color }}
            className="pointer-events-none absolute rounded-full border bg-slate-950/90 px-1.5 text-[9px] font-mono leading-tight"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

const EDGE_TYPES = { route: RouteEdge }

// Inspector panel for a selected route edge — lists the underlying links
// (a pair can be wired by several topics/channels) and removes them.
function RouteInspector(props: {
  source: string
  target: string
  links: Link[]
  rates: Record<string, number>
  onRemove: (link: Link) => void | Promise<void>
  onClose: () => void
}) {
  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-mono text-slate-300">
          {props.source} <span className="text-slate-500">→</span> {props.target}
        </span>
        <button type="button" onClick={props.onClose} className="text-slate-500 hover:text-slate-300">
          ✕
        </button>
      </div>
      {props.links.length === 0 && (
        <div className="text-slate-500">This link is no longer present.</div>
      )}
      {props.links.map((l) => (
        <div key={l.id} className="rounded border border-slate-800 bg-slate-950/60 p-2">
          <div className="flex items-center gap-2">
            <span
              className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${
                l.kind === 'capability' ? 'bg-amber-500/15 text-amber-300' : 'bg-cyan-500/15 text-cyan-300'
              }`}
            >
              {l.kind}
            </span>
            <span className="text-[9px] uppercase tracking-wide text-slate-500">{l.origin}</span>
          </div>
          {l.source_topic && (
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="truncate font-mono text-[10px] text-slate-400" title={l.source_topic}>
                {l.source_topic}
              </span>
              {(props.rates[l.source_topic] ?? 0) > 0 && (
                <span className="shrink-0 font-mono text-[9px] text-emerald-400">
                  {props.rates[l.source_topic]}Hz
                </span>
              )}
            </div>
          )}
          {l.target_sink && (
            <div className="mt-0.5 text-[10px] text-slate-500">→ {l.target_sink}</div>
          )}
          <button
            type="button"
            onClick={() => void props.onRemove(l)}
            className="mt-2 rounded border border-rose-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-rose-300 hover:border-rose-500"
          >
            Remove link
          </button>
        </div>
      ))}
      <p className="text-[10px] leading-snug text-slate-500">
        Rich input/channel bindings (field, index, motor) are created from the
        consumer service’s own panel. Capability bindings can be drawn by
        connecting one node’s output to another’s input.
      </p>
    </div>
  )
}

interface GhostNodeData {
  proxyId: string
  onRemove?: (proxyId: string) => void
}

function GhostNode({ data, selected }: { data: GhostNodeData; selected: boolean }) {
  // Placeholder for a workspace member that no longer exists in the
  // registry. Keeps the layout intent visible; offers a remove affordance.
  return (
    <div
      className={`flex min-w-[180px] items-start gap-2 rounded border border-dashed bg-slate-950/60 p-3 shadow-lg ${
        selected ? 'border-rose-400' : 'border-rose-700'
      }`}
    >
      <Package className="mt-0.5 h-5 w-5 shrink-0 text-rose-400 opacity-60" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-mono text-rose-300">{data.proxyId}</div>
        <div className="mt-0.5 truncate text-xs italic text-slate-400">missing — released</div>
        <button
          type="button"
          onClick={() => data.onRemove?.(data.proxyId)}
          className="mt-2 rounded border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300 hover:border-slate-500"
        >
          Remove
        </button>
      </div>
    </div>
  )
}

const NODE_TYPES = { proxy: ProxyNode, ghost: GhostNode }


// Layout helper for the Cluster button. Spreads N node positions
// across concentric hex-style rings around (0, 0):
//
//   * Ring 0 holds 1 node (the centre)
//   * Ring k≥1 holds up to 6·k nodes, evenly spaced, on a circle of
//     radius ``k · _CLUSTER_RING_STEP``
//
// Returned positions are TOP-LEFT corners of the node bounding box
// (React Flow's coordinate convention) — pre-offset by half the
// typical view_min pill size so the visual centres land on the
// circle, not the corners. Pill size is content-dependent so we
// approximate; on the rare wide-pill case (long proxy id) the
// node still ends up near origin.
const _CLUSTER_RING_STEP = 130          // pixels between adjacent rings
const _CLUSTER_PILL_OFFSET_X = 70       // ≈ half of typical view_min pill width
const _CLUSTER_PILL_OFFSET_Y = 15       // ≈ half of typical view_min pill height

function _computeClusterPositions(n: number): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = []
  if (n <= 0) return positions
  positions.push({
    x: 0 - _CLUSTER_PILL_OFFSET_X,
    y: 0 - _CLUSTER_PILL_OFFSET_Y,
  })
  let placed = 1
  let ring = 1
  while (placed < n) {
    const capacity = 6 * ring
    const radius = ring * _CLUSTER_RING_STEP
    const onThisRing = Math.min(capacity, n - placed)
    for (let i = 0; i < onThisRing; i++) {
      // Start angle at -π/2 so ring 1 puts its first node at "12
      // o'clock" — visually more pleasing than the right-hand
      // 3-o'clock start that comes out of plain trig.
      const angle = (2 * Math.PI * i) / onThisRing - Math.PI / 2
      positions.push({
        x: Math.round(Math.cos(angle) * radius) - _CLUSTER_PILL_OFFSET_X,
        y: Math.round(Math.sin(angle) * radius) - _CLUSTER_PILL_OFFSET_Y,
      })
    }
    placed += onThisRing
    ring++
  }
  return positions
}

export default function Composer() {
  return (
    <ReactFlowProvider>
      <ComposerInner />
    </ReactFlowProvider>
  )
}

function ComposerInner() {
  const wsClient = useWsClient()
  const apiFetch = useApiFetch()
  const navigate = useNavigate()
  const { id: rawId } = useParams<{ id: string }>()
  const workspaceId = decodeURIComponent(rawId ?? '')

  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [allProxies, setAllProxies] = useState<ServiceProxy[]>([])
  const [catalog, setCatalog] = useState<ServiceMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  // Staged drop awaiting user confirmation. When non-null, the install
  // dialog is shown; the meta describes the type, the position is where
  // the new node should land in flow coordinates.
  const [pendingDrop, setPendingDrop] = useState<{ meta: ServiceMeta; position: Position } | null>(null)
  const [dropName, setDropName] = useState('')
  const [installing, setInstalling] = useState(false)
  // "+ Add Service" dialog — a searchable catalog picker + name + Create/
  // Start. The discoverable alternative to dragging a palette row.
  const [addServiceOpen, setAddServiceOpen] = useState(false)
  // Save-subset dialog: only used from the runtime canvas. Captures the
  // currently selected (or all) live services as a new user workspace,
  // copying their positions so opening it later restores the layout.
  const [saveSubsetOpen, setSaveSubsetOpen] = useState(false)
  const [saveSubsetName, setSaveSubsetName] = useState('')
  const [savingSubset, setSavingSubset] = useState(false)
  // Palette tab — REPO shows service types from the on-disk catalog;
  // REGISTRY shows existing instances the runtime is managing
  // (service_proxy rows) that aren't already on this canvas.
  const [paletteTab, setPaletteTab] = useState<PaletteTab>('registry')
  // Live install progress keyed by proxy id, fed from the
  // /service_request/{id}/progress stream while a placeholder installs
  // its type deps on first Start (M2). Cleared when the proxy reaches
  // 'running' or the user dismisses a finished/failed panel. The parser +
  // subscription lifecycle live in the shared useInstallProgress hook so
  // the Catalog page renders the identical progress UI (see that hook).
  const { progress: installProgress, watch: watchProgress, dismiss: dismissInstall } = useInstallProgress()
  // When a placeholder whose type needs a one-time install (license and/or
  // install-time inputs) is started, the install wizard opens here instead
  // of installing immediately (M3).
  const [pendingInstall, setPendingInstall] = useState<{ proxyId: string; meta: ServiceMeta } | null>(null)
  // Per-instance config wizard (M4). `thenStart` distinguishes the
  // first-Start gate (configure → start) from an inspector "Configure"
  // (save only).
  const [pendingConfig, setPendingConfig] = useState<
    { proxyId: string; meta: ServiceMeta; proxy: ServiceProxy; thenStart: boolean } | null
  >(null)
  const [savingConfig, setSavingConfig] = useState(false)
  // Type-level uninstall lives on the Catalog page (/catalog) — see
  // Catalog.tsx. Composer's palette is drag-only.

  // React Flow's nodes are derived from workspace.service_proxy_ids +
  // workspace.node_positions + per-proxy live state. We hold them in a
  // separate state because RF wants to mutate them via onNodesChange.
  const [nodes, setNodes] = useState<Node<ProxyNodeData>[]>([])
  // Mirror nodes into a ref so the derivation effect (which reacts to
  // workspace/allProxies, NOT to nodes — adding nodes as a dep would
  // infinite-loop) can read the latest in-flight width/height to carry
  // them forward across rebuilds.
  const nodesRef = useRef<Node<ProxyNodeData>[]>([])
  useEffect(() => { nodesRef.current = nodes }, [nodes])
  // Edges are persisted on the workspace row (workspace.edges). Loaded on
  // mount, mutated via React Flow's onEdgesChange / onConnect, and pushed
  // back to the server through the debounced persistWorkspace path.
  const [edges, setEdges] = useState<Edge[]>([])

  // Derived data-flow links (the "routes" layer). Fetched from /v1/links —
  // a server-side projection of declared config bindings ∪ live bus
  // topology. Held separately from cosmetic edges and merged only at
  // render. `showRoutes` toggles the layer from the canvas controls.
  const [links, setLinks] = useState<Link[]>([])
  const [showRoutes, setShowRoutes] = useState(true)
  // A selected route edge → the (source,target) pair whose underlying
  // links the Inspector shows + offers to remove.
  const [selectedRoute, setSelectedRoute] = useState<{ source: string; target: string } | null>(null)
  // Live per-topic publish rate (Hz), fed by the throttled /bus/stats
  // digest (~1Hz). Drives the flow animation + thickness on route edges.
  const [topicRates, setTopicRates] = useState<Record<string, number>>({})

  // Debounce position writes — drag generates many position events.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistPending = useRef<Workspace | null>(null)

  const persistWorkspace = useCallback(
    (next: Workspace) => {
      persistPending.current = next
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(async () => {
        const payload = persistPending.current
        if (!payload || !payload.id) return
        try {
          await apiFetch<Workspace>(`/v1/workspace/${encodeURIComponent(payload.id)}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          })
        } catch (err) {
          if (err instanceof Error) setError(err.message)
        }
      }, 350)
    },
    [],
  )

  // Re-derive the routes layer. Cheap server-side projection; called on
  // load and whenever a lifecycle event changes what's running (which
  // changes the observed half of the projection).
  const refreshLinks = useCallback(async () => {
    if (!workspaceId) return
    try {
      const rows = await apiFetch<Link[]>(`/v1/links?workspace=${encodeURIComponent(workspaceId)}`)
      setLinks(rows ?? [])
    } catch {
      // Routes are an enhancement layer — a fetch failure shouldn't
      // surface as a canvas error. Leave the last-known links in place.
    }
  }, [workspaceId, apiFetch])

  // ─── initial load ─────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [ws, proxies, meta] = await Promise.all([
          apiFetch<Workspace>(`/v1/workspace/${encodeURIComponent(workspaceId)}`),
          apiFetch<ServiceProxy[]>('/v1/service-proxy-list'),
          // The catalog backs the palette — it represents the local (and
          // eventually remote) repo of service types the user can drag
          // onto the canvas to instantiate.
          apiFetch<ServiceMeta[]>('/v1/service-meta-list'),
        ])
        if (cancelled) return
        setWorkspace(ws)
        setAllProxies(proxies ?? [])
        setCatalog(meta ?? [])
        // Hydrate persisted edges. Workspace.edges is `any` from the
        // generator; we trust it's the React Flow shape we wrote.
        const persistedEdges = (ws?.edges as Edge[] | undefined) ?? []
        setEdges(persistedEdges)
        void refreshLinks()
      } catch (err) {
        if (!cancelled && err instanceof Error) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
    // Re-load when switching the active runtime so the canvas reflects
    // *that* runtime's workspace + proxies + catalog, not the previous one's.
  }, [workspaceId, apiFetch])

  // ─── periodic re-sync: cheap insurance against drift ─────────────────
  // The wildcard /service_proxy/+/lifecycle subscription handles the
  // fast path. This catches anything that got dropped (mid-restart,
  // missed during WS reconnect, etc.) — server's /v1/service-proxy-list
  // is authoritative and the page treats the fresh list verbatim.
  useEffect(() => {
    const resync = async () => {
      try {
        const fresh = await apiFetch<ServiceProxy[]>('/v1/service-proxy-list')
        const freshIds = new Set((fresh ?? []).map((p) => p.id ?? ''))
        setAllProxies((prev) => {
          // Keep only proxies the server still knows about + merge new fields.
          const byId = new Map((fresh ?? []).map((p) => [p.id ?? '', p]))
          const next = prev.filter((p) => freshIds.has(p.id ?? ''))
                           .map((p) => ({ ...p, ...(byId.get(p.id ?? '') ?? {}) }))
          // Add any rows the server has that we didn't.
          for (const p of fresh ?? []) {
            if (p.id && !prev.some((q) => q.id === p.id)) {
              next.push(p)
            }
          }
          return next
        })
      } catch {
        // Ignore — error banner is for user-initiated actions.
      }
    }
    const interval = setInterval(resync, 30_000)
    const onFocus = () => { resync() }
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
    // Re-arm the resync poll against the new runtime's apiFetch
    // when the user switches chips.
  }, [apiFetch])

  // ─── derive nodes from workspace + proxies ────────────────────────────
  useEffect(() => {
    if (!workspace) return
    const positions = (workspace.node_positions ?? {}) as Record<string, Position>
    const viewTypes = (workspace.node_view_types ?? {}) as Record<string, unknown>
    // Dedupe service_proxy_ids defensively — even if any upstream write
    // got it doubled (drop-install racing with /workspace/+/changed),
    // we render exactly one node per unique id.
    const seenIds = new Set<string>()
    const proxyIds: string[] = (workspace.service_proxy_ids ?? []).filter((pid: string) => {
      if (seenIds.has(pid)) return false
      seenIds.add(pid)
      return true
    })
    const byId = new Map(allProxies.map((p) => [p.id ?? p.name ?? '', p]))
    // Carry forward in-state node width/height across rebuilds. A
    // user-initiated resize lives in React Flow's node state until
    // onNodesChange persists it; that persistence is asynchronous so
    // a proxy-state update mid-drag would otherwise rebuild fresh
    // size-less nodes here and the resize would snap back.
    const existingById = new Map(nodesRef.current.map((n) => [n.id, n]))
    const next: Node<ProxyNodeData>[] = []
    proxyIds.forEach((pid: string, idx: number) => {
      const savedPos = positions[pid] ?? { x: 60 + idx * 220, y: 80 }
      const existing = existingById.get(pid)
      // Width/height precedence: in-state (most recent — covers an
      // in-flight resize) > saved position record > unset (let RF
      // auto-size to content).
      const width = existing?.width ?? savedPos.width
      const height = existing?.height ?? savedPos.height
      // Selection survives node rebuilds. Without this, any bus event
      // that mutates ``allProxies`` would land here, replace every
      // node with a fresh object lacking ``selected: true``, and RF
      // would fire ``onSelectionChange`` with an empty nodes array —
      // wiping our ``selected`` state and the Inspector along with
      // it. The next.push below carries the flag forward.
      const wasSelected = !!existing?.selected
      const proxy = byId.get(pid)
      if (proxy) {
        const meta = catalog.find((m) => `${m.name}@${m.version}` === proxy.service_meta_id)
        const isSingleton = Array.isArray(meta?.tags) && meta!.tags.includes('singleton')
        const cfgSteps = Array.isArray(meta?.config_steps) ? (meta!.config_steps as Array<{ fields?: unknown[] }>) : []
        const configurable = cfgSteps.some((s) => (s.fields ?? []).length > 0)
        next.push({
          id: pid,
          type: 'proxy',
          position: { x: savedPos.x, y: savedPos.y },
          ...(wasSelected ? { selected: true } : {}),
          ...(width != null ? { width } : {}),
          ...(height != null ? { height } : {}),
          // RF uses style.width/height for resize rendering — set both
          // so the inline node DOM gets the dimensions even on first
          // render after a reload (without this the resize-handle does
          // not appear in the correct position until the user clicks).
          ...(width != null || height != null ? {
            style: {
              ...(width != null ? { width } : {}),
              ...(height != null ? { height } : {}),
            },
          } : {}),
          // React Flow restricts drag-initiation to descendants of
          // elements matching this selector — keeps full-view bodies
          // (sliders, sweep controls, etc.) interactable without
          // dragging the whole node.
          dragHandle: '.rlx-drag-handle',
          data: {
            proxy,
            viewType: normalizeComposerViewId(viewTypes[pid]),
            onViewChange: setNodeViewTypeRef.current ?? (() => {}),
            onAction: dispatchProxyActionRef.current ?? (() => {}),
            isSingleton,
            configurable,
          },
          deletable: false,
        })
      } else {
        // Saved member that no longer exists in the registry (released or
        // never reached this backend). Render a ghost node so the layout
        // intent is preserved and the user can remove or recreate.
        next.push({
          id: pid,
          type: 'ghost',
          position: { x: savedPos.x, y: savedPos.y },
          ...(wasSelected ? { selected: true } : {}),
          data: { proxyId: pid, onRemove: removeGhostRef.current ?? (() => {}) },
          deletable: false,
        } as unknown as Node<ProxyNodeData>)
      }
    })
    setNodes(next)
  }, [workspace, allProxies, catalog])

  // Sync our ``selected`` state to ReactFlow's per-node ``selected``
  // flag. ReactFlow's selection state is what drives the visual
  // highlight (border colour, resize-handle visibility), so when WE
  // programmatically change ``selected`` (e.g. after drag-drop) the
  // node DOM has to know. Without this, the inspector swaps but the
  // canvas shows no selected node.
  // The reverse direction is already handled by ``onSelectionChange``
  // → ``setSelected``; this effect only kicks when local state
  // outpaces ReactFlow (drag-drop case) and is otherwise a no-op
  // because the new+old selected match.
  useEffect(() => {
    setNodes((prev) => {
      let changed = false
      const next = prev.map((n) => {
        const want = n.id === selected
        if ((!!n.selected) === want) return n
        changed = true
        return { ...n, selected: want }
      })
      return changed ? next : prev
    })
  }, [selected])

  // removeGhost is defined below (it depends on persistWorkspace), but the
  // node-derivation effect above needs to reference it. Stash through a ref
  // so we don't re-derive nodes every render just because the handler
  // identity changes.
  const removeGhostRef = useRef<((id: string) => void) | null>(null)
  // Same pattern as removeGhostRef — the menu inside a memoised node component
  // needs a stable callback, but the underlying setNodeViewType depends on
  // the current workspace. Stash through a ref so node identity stays
  // stable across position-tick re-renders.
  const setNodeViewTypeRef = useRef<((id: string, v: string) => void) | null>(null)
  // Same ref pattern for the Stop / Release buttons rendered inside
  // each full-view node — dispatchProxyAction depends on apiFetch +
  // selected, but the node-data callback needs to stay identity-stable
  // so the node memoisation doesn't re-render on every keystroke.
  const dispatchProxyActionRef = useRef<((id: string, action: ProxyAction, config?: Record<string, unknown>) => void) | null>(null)

  // Remove a ghost member from the current workspace (drops the id from
  // service_proxy_ids and the matching node_positions entry).
  const removeGhost = useCallback(
    (proxyId: string) => {
      if (!workspace) return
      setWorkspace((prev) => {
        if (!prev) return prev
        const ids = (prev.service_proxy_ids ?? []).filter((id: string) => id !== proxyId)
        const positions = { ...(prev.node_positions ?? {}) }
        delete positions[proxyId]
        const filteredEdges = (prev.edges as Edge[] | undefined ?? [])
          .filter((e) => e.source !== proxyId && e.target !== proxyId)
        const next = {
          ...prev,
          service_proxy_ids: ids,
          node_positions: positions,
          edges: filteredEdges as Workspace['edges'],
        }
        persistWorkspace(next)
        return next
      })
      setEdges((prev) => prev.filter((e) => e.source !== proxyId && e.target !== proxyId))
    },
    [workspace, persistWorkspace],
  )
  removeGhostRef.current = removeGhost

  // Persist a single node's view type onto the workspace row. Updates
  // both the workspace's node_view_types map AND the live nodes array so
  // the switch is visible immediately (without waiting for the next
  // workspace re-derive).
  const setNodeViewType = useCallback(
    (proxyId: string, next: string) => {
      if (!workspace) return
      // Whether this shape wants its persisted width/height kept is
      // declared per-view via ``ComposerViewDefinition.preservesSize``
      // — only resizable shapes (today: view_full) opt in. Everything
      // else content-sizes, so we strip stored dimensions to avoid
      // pinning a small pill at the previous-resize width.
      // Stripping happens in BOTH the persisted node_positions record
      // AND the live node so the next render measures fresh.
      const nextDef = getComposerView(next)
      const clearDims = !(nextDef?.preservesSize ?? false)
      // Origin tracking — when a node is being promoted to Full,
      // record whichever shape it's leaving so the Full title's
      // double-click can return to it. Stamped here (the central
      // dispatch point) rather than per-view so every transition
      // path is covered: kebab pick, double-click in Min/Basic,
      // programmatic switch. Min is the safe default fallback.
      if (next === 'view_full') {
        const currentId = normalizeComposerViewId(
          (workspace.node_view_types as Record<string, string> | undefined)?.[proxyId],
        )
        if (currentId !== 'view_full') {
          setOriginView(proxyId, currentId)
        }
      }
      setWorkspace((prev) => {
        if (!prev) return prev
        const map = { ...((prev.node_view_types ?? {}) as Record<string, string>) }
        map[proxyId] = next
        let updated: Workspace = { ...prev, node_view_types: map as Workspace['node_view_types'] }
        if (clearDims) {
          const positions = { ...((prev.node_positions ?? {}) as Record<string, Position>) }
          const cur = positions[proxyId]
          if (cur && (cur.width != null || cur.height != null)) {
            positions[proxyId] = { x: cur.x, y: cur.y }
            updated = { ...updated, node_positions: positions as Workspace['node_positions'] }
          }
        }
        persistWorkspace(updated)
        return updated
      })
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== proxyId || n.type !== 'proxy') return n
          const withView: Node<ProxyNodeData> = { ...n, data: { ...n.data, viewType: next } }
          if (!clearDims) return withView
          // Strip width/height from both the node and its style so RF
          // re-measures from content. Leaving style.width set would
          // pin the smaller view to the panel's last width.
          const { width: _w, height: _h, style, ...rest } = withView
          const cleanedStyle = style
            ? Object.fromEntries(
                Object.entries(style).filter(([k]) => k !== 'width' && k !== 'height'),
              )
            : undefined
          return {
            ...rest,
            ...(cleanedStyle && Object.keys(cleanedStyle).length > 0 ? { style: cleanedStyle } : {}),
          } as Node<ProxyNodeData>
        }),
      )
    },
    [workspace, persistWorkspace],
  )
  setNodeViewTypeRef.current = setNodeViewType
  // Double-click toggling lives on each node's title bar (the
  // `rlx-drag-handle` element). That keeps full-view body interactions
  // — sliders, dropdowns, sweep controls — from accidentally
  // collapsing the node.

  // ─── live status from bus ────────────────────────────────────────────
  useEffect(() => {
    if (!workspace) return
    const unsubs: Array<() => void> = []
    // One wildcard subscription covers every service_proxy on the bus —
    // including ones that aren't on this canvas. Critical for the
    // REGISTRY palette: when a proxy that's currently 'installed' starts
    // up, REGISTRY needs to flip to 'running' immediately so the user
    // doesn't see stale UI vs. the server's real state.
    // Server-side mutations to a workspace (tidy on release, reconciler
    // cleanups, future garbage-collection sweeps) publish on this topic.
    // We refetch the affected workspace so a tab whose row was changed
    // by ANOTHER tab catches up immediately, without polling.
    const offWsChanged = wsClient.subscribe('/workspace/+/changed', async (frame: InboundFrame) => {
      if (frame.method !== 'message') return
      const payload = frame.payload as { workspace_id?: string } | undefined
      const changedId = payload?.workspace_id
      if (!changedId || !workspace?.id || changedId !== workspace.id) return
      try {
        const fresh = await apiFetch<Workspace>(`/v1/workspace/${encodeURIComponent(changedId)}`)
        setWorkspace((prev) => prev ? { ...prev, ...fresh } : fresh)
      } catch {
        // Soft fail — the periodic resync will catch up.
      }
    })
    unsubs.push(offWsChanged)

    const offLifecycle = wsClient.subscribe('/service_proxy/+/lifecycle', (frame: InboundFrame) => {
      if (frame.method !== 'message') return
      const updated = frame.payload as ServiceProxy
      if (!updated || !updated.id) return
      setAllProxies((prev) => {
        // 'uninstalled' is the terminal state the backend publishes when
        // a service_proxy row is deleted. REMOVE the entry instead of
        // updating it — otherwise the REGISTRY tab keeps showing a row
        // for a proxy that no longer exists server-side and the user
        // hits "not found" on the next release attempt.
        if (updated.status === 'uninstalled') {
          return prev.filter((p) => p.id !== updated.id)
        }
        const idx = prev.findIndex((p) => p.id === updated.id)
        if (idx === -1) return prev.concat([updated])
        const next = prev.slice()
        next[idx] = { ...next[idx], ...updated }
        return next
      })
      // A start/stop changes the observed half of the routes projection.
      void refreshLinks()
    })
    unsubs.push(offLifecycle)
    // Workspace-level activation events.
    const wsTopic = `/workspace/${workspace.id}/activation`
    const offWs = wsClient.subscribe(wsTopic, (frame: InboundFrame) => {
      if (frame.method !== 'message') return
      const evt = frame.payload as { status?: string; detail?: string | null }
      if (!evt) return
      setWorkspace((prev) => (prev ? { ...prev, status: evt.status ?? prev.status } : prev))
      if (evt.detail) setError(evt.detail)
    })
    unsubs.push(offWs)
    return () => {
      for (const off of unsubs) off()
    }
    // Re-subscribe when the active runtime swaps (wsClient identity
    // changes) or the workspace id changes. The wildcard lifecycle
    // subscription doesn't depend on member ids — only the workspace's
    // identity (for the activation topic).
  }, [workspace?.id, wsClient, apiFetch, refreshLinks])

  // Live-flow overlay: one subscription to the throttled /bus/stats
  // digest. Per-message traffic NEVER reaches the UI — only this ~1Hz
  // rate snapshot does, which keeps the render loop calm regardless of
  // how chatty the bus is.
  useEffect(() => {
    const off = wsClient.subscribe('/bus/stats', (frame: InboundFrame) => {
      if (frame.method !== 'message') return
      const p = frame.payload as { rates?: Record<string, number> } | null
      setTopicRates(p?.rates ?? {})
    })
    return () => off()
  }, [wsClient])

  // Re-derive routes when ANY service's config changes — capability/input
  // bindings live in service_config, and a config change fires no
  // lifecycle (status) event, so without this a new edge wouldn't appear
  // until a hard refresh. Debounced so the burst of retained config_state
  // messages at startup collapses into one refresh.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = wsClient.subscribe('/service_proxy/+/config_state', (frame: InboundFrame) => {
      if (frame.method !== 'message') return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void refreshLinks(), 250)
    })
    return () => { if (timer) clearTimeout(timer); off() }
  }, [wsClient, refreshLinks])

  // ─── React Flow callbacks ─────────────────────────────────────────────
  const onNodesChange = useCallback(
    (changes: NodeChange<Node<ProxyNodeData>>[]) => {
      // Apply first so we can read the post-change node state below —
      // in particular, the position after a resize-from-top/left
      // handle has moved the node.
      let updatedNodes: Node<ProxyNodeData>[] = []
      setNodes((prev) => {
        updatedNodes = applyNodeChanges(changes, prev) as Node<ProxyNodeData>[]
        return updatedNodes
      })

      const positionEnds = changes.filter(
        (c): c is NodePositionChange => c.type === 'position' && c.dragging === false,
      )
      // ReactFlow v12 emits `dimensions` changes for NodeResizeControl
      // drags; ``resizing: false`` marks the gesture end. Persist size
      // into the same node_positions record so a reload reads it back
      // and proxy-state updates can't snap the node back to content
      // size.
      const resizeEnds = changes.filter(
        (c): c is NodeChange<Node<ProxyNodeData>> & { id: string; type: 'dimensions'; dimensions?: { width: number; height: number }; resizing?: boolean } =>
          c.type === 'dimensions' && (c as { resizing?: boolean }).resizing === false,
      )
      if ((positionEnds.length === 0 && resizeEnds.length === 0) || !workspace) return

      setWorkspace((prev) => {
        if (!prev) return prev
        const positions: Record<string, Position> = { ...(prev.node_positions ?? {}) }
        for (const c of positionEnds) {
          if (c.position) {
            const existing = positions[c.id] ?? { x: c.position.x, y: c.position.y }
            positions[c.id] = { ...existing, x: c.position.x, y: c.position.y }
          }
        }
        for (const c of resizeEnds) {
          if (!c.dimensions) continue
          // Resize-from-top/left moves the node as it grows. ReactFlow
          // emits a position change for that move, but with
          // ``dragging`` undefined (it wasn't a user-driven drag) so
          // it doesn't pass the positionEnds filter above and we'd
          // lose the new x/y. Read the post-applyNodeChanges position
          // off the node itself — that's authoritative for both
          // resize and drag.
          const node = updatedNodes.find((n) => n.id === c.id)
          const x = node?.position.x ?? positions[c.id]?.x ?? 0
          const y = node?.position.y ?? positions[c.id]?.y ?? 0
          positions[c.id] = {
            x,
            y,
            width: Math.round(c.dimensions.width),
            height: Math.round(c.dimensions.height),
          }
        }
        const next = { ...prev, node_positions: positions }
        persistWorkspace(next)
        return next
      })
    },
    [workspace, persistWorkspace],
  )

  const onMoveEnd = useCallback(
    (_: unknown, viewport: Viewport) => {
      if (!workspace) return
      setWorkspace((prev) => {
        if (!prev) return prev
        const next = { ...prev, viewport }
        persistWorkspace(next)
        return next
      })
    },
    [workspace, persistWorkspace],
  )

  const onSelectionChange = useCallback(
    (params: { nodes: Node[]; edges: Edge[] }) => {
      const node = params.nodes[0]?.id ?? null
      setSelected(node)
      if (node) setSelectedRoute(null)
    },
    [],
  )


  const persistEdges = useCallback(
    (nextEdges: Edge[]) => {
      if (!workspace) return
      setWorkspace((prev) => {
        if (!prev) return prev
        const next = { ...prev, edges: nextEdges as Workspace['edges'] }
        persistWorkspace(next)
        return next
      })
    },
    [workspace, persistWorkspace],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      setEdges((prev) => {
        const next = applyEdgeChanges(changes, prev)
        // Only persist on "settled" changes — additions/removals/data
        // changes. Selection toggles fire constantly and would thrash.
        const settled = changes.some((c) => c.type === 'add' || c.type === 'remove' || c.type === 'replace')
        if (settled) persistEdges(next)
        return next
      })
    },
    [persistEdges],
  )

  // Capabilities for a proxy's type, read off the catalog (ServiceMeta).
  const capsFor = useCallback(
    (proxyId: string | null | undefined): { requires: Set<string>; implements: Set<string> } => {
      const p = allProxies.find((x) => x.id === proxyId)
      const m = catalog.find((c) => `${c.name}@${c.version}` === p?.service_meta_id)
      const arr = (v: unknown) => new Set((Array.isArray(v) ? v : []) as string[])
      return { requires: arr(m?.requires), implements: arr(m?.implements) }
    },
    [allProxies, catalog],
  )

  // Connecting two nodes = "link these services." For a capability match
  // (consumer.requires ∩ controller.implements) we create the binding
  // directly via /v1/links-request; the consumer is whichever side
  // declares the requirement, so the gesture works dragged either way.
  // Rich input/channel bindings can't be synthesized from a bare drag —
  // the backend returns a helpful 400 we surface as a banner.
  const onConnect = useCallback(
    (connection: Connection) => {
      const a = connection.source
      const b = connection.target
      if (!a || !b || a === b) return
      const ca = capsFor(a)
      const cb = capsFor(b)
      const aConsumes = [...ca.requires].some((c) => cb.implements.has(c)) // a=consumer, b=controller
      const bConsumes = [...cb.requires].some((c) => ca.implements.has(c)) // b=consumer, a=controller
      let consumer: string | null = null
      let controller: string | null = null
      if (aConsumes) { consumer = a; controller = b }
      else if (bConsumes) { consumer = b; controller = a }
      if (!consumer || !controller) {
        setError('Those services aren’t capability-compatible. Configure data inputs from the consumer’s panel.')
        return
      }
      apiFetch('/v1/links-request', {
        method: 'POST',
        body: JSON.stringify({ action: 'create', kind: 'capability', source_proxy_id: consumer, target_proxy_id: controller }),
      })
        .then(() => { setError(null); void refreshLinks() })
        .catch((err: Error) => setError(err.message))
    },
    [capsFor, apiFetch, refreshLinks],
  )

  // Remove a single underlying link (binding) on its consumer.
  const deleteLink = useCallback(
    async (link: Link) => {
      try {
        await apiFetch('/v1/links-request', {
          method: 'POST',
          body: JSON.stringify({
            action: 'delete',
            kind: link.kind ?? 'input',
            source_proxy_id: link.source_proxy_id,
            target_proxy_id: link.target_proxy_id,
            source_topic: link.source_topic,
            target_sink: link.target_sink,
          }),
        })
        setError(null)
        await refreshLinks()
      } catch (err) {
        if (err instanceof Error) setError(err.message)
      }
    },
    [apiFetch, refreshLinks],
  )

  // Clicking a route edge selects the pair (Inspector shows its links).
  const onEdgeClick = useCallback(
    (_e: MouseEvent, edge: Edge) => {
      if (edge.type !== 'route') return
      setSelected(null)
      setSelectedRoute({ source: edge.source, target: edge.target })
    },
    [],
  )

  // ─── routes layer ─────────────────────────────────────────────────────
  // Aggregate raw links into one edge per (source→target) pair so a pair
  // wired by several topics/channels renders as a single line with a
  // count, not a thicket. Scaling: this collapse is what keeps the canvas
  // legible as link density grows. Only links whose BOTH endpoints are
  // present as nodes are drawn.
  const routeEdges = useMemo<Edge[]>(() => {
    if (!showRoutes) return []
    const present = new Set(nodes.map((n) => n.id))
    const byPair = new Map<string, { link: Link; count: number; origins: Set<string>; kinds: Set<string>; topics: Set<string> }>()
    for (const l of links) {
      if (!l.source_proxy_id || !l.target_proxy_id) continue
      if (!present.has(l.source_proxy_id) || !present.has(l.target_proxy_id)) continue
      const key = `${l.source_proxy_id} ${l.target_proxy_id}`
      const agg = byPair.get(key)
      if (agg) {
        agg.count += 1
        if (l.origin) agg.origins.add(l.origin)
        if (l.kind) agg.kinds.add(l.kind)
        if (l.source_topic) agg.topics.add(l.source_topic)
      } else {
        byPair.set(key, {
          link: l,
          count: 1,
          origins: new Set(l.origin ? [l.origin] : []),
          kinds: new Set(l.kind ? [l.kind] : []),
          topics: new Set(l.source_topic ? [l.source_topic] : []),
        })
      }
    }
    const out: Edge[] = []
    for (const [key, agg] of byPair) {
      // Pair origin: "both" if any endpoint says so or declared+observed
      // both appear; else the single origin present.
      const origin: RouteEdgeData['origin'] =
        agg.origins.has('both') || (agg.origins.has('declared') && agg.origins.has('observed'))
          ? 'both'
          : agg.origins.has('observed')
            ? 'observed'
            : 'declared'
      const kind: RouteEdgeData['kind'] = agg.kinds.size > 1 ? 'mixed' : (agg.kinds.values().next().value as RouteEdgeData['kind']) ?? 'input'
      // Live rate = sum of the publish rates of the topics this pair
      // carries (from the /bus/stats digest). Drives the flow animation.
      let rateHz = 0
      for (const t of agg.topics) rateHz += topicRates[t] ?? 0
      out.push({
        id: `route:${key}`,
        source: agg.link.source_proxy_id!,
        target: agg.link.target_proxy_id!,
        sourceHandle: 'out',
        targetHandle: 'in',
        type: 'route',
        deletable: false,
        animated: rateHz > 0,
        data: { origin, kind, count: agg.count, flowing: rateHz > 0, rateHz: Math.round(rateHz) } satisfies RouteEdgeData,
      })
    }
    return out
  }, [links, nodes, showRoutes, topicRates])

  // Cosmetic edges (persisted) + derived routes (read-only), merged only
  // for rendering. onEdgesChange still operates on the cosmetic `edges`
  // state, so route-edge change events harmlessly no-op against it.
  const allEdges = useMemo<Edge[]>(() => edges.concat(routeEdges), [edges, routeEdges])

  // ─── drag-and-drop install flow ──────────────────────────────────────
  // The palette is the *repo* of service types (service_meta rows).
  // Dragging a type onto the canvas opens the install dialog; OK creates
  // a fresh proxy instance + attaches it to this workspace.
  const reactFlowInstance = useReactFlow()
  const canvasRef = useRef<HTMLDivElement | null>(null)

  // Cluster — minimize every proxy node to view_min and arrange them
  // in concentric rings around the canvas origin, then drive the
  // viewport to (0, 0). Useful when the canvas has drifted (panels
  // scattered out of view, or you've installed a dozen services and
  // they're spread across kilopixels). Persists in the same shape as
  // the existing view-change + position-change paths so a reload
  // keeps the cluster.
  const clusterAtOrigin = useCallback(() => {
    if (!workspace) return
    const proxyNodes = nodes.filter((n) => n.type === 'proxy')
    if (proxyNodes.length === 0) return
    const positions = _computeClusterPositions(proxyNodes.length)
    const nextViewport: Viewport = { x: 0, y: 0, zoom: 1.0 }
    setWorkspace((prev) => {
      if (!prev) return prev
      const viewTypes = { ...((prev.node_view_types ?? {}) as Record<string, string>) }
      const nodePositions = { ...((prev.node_positions ?? {}) as Record<string, Position>) }
      proxyNodes.forEach((n, i) => {
        viewTypes[n.id] = DEFAULT_VIEW_ID
        // Drop any stored width/height — view_min content-sizes
        // (matches the existing setNodeViewType cleanup path).
        nodePositions[n.id] = { x: positions[i].x, y: positions[i].y }
      })
      const updated: Workspace = {
        ...prev,
        node_view_types: viewTypes as Workspace['node_view_types'],
        node_positions: nodePositions as Workspace['node_positions'],
        viewport: nextViewport,
      }
      persistWorkspace(updated)
      return updated
    })
    setNodes((prev) =>
      prev.map((n) => {
        if (n.type !== 'proxy') return n
        const idx = proxyNodes.findIndex((p) => p.id === n.id)
        if (idx < 0) return n
        const pos = positions[idx]
        // Strip width/height (same logic as setNodeViewType) so RF
        // re-measures content size on the next render.
        const { width: _w, height: _h, style, ...rest } = n
        const cleanedStyle = style
          ? Object.fromEntries(
              Object.entries(style).filter(([k]) => k !== 'width' && k !== 'height'),
            )
          : undefined
        return {
          ...rest,
          position: { x: pos.x, y: pos.y },
          ...(cleanedStyle && Object.keys(cleanedStyle).length > 0 ? { style: cleanedStyle } : {}),
          data: { ...(n.data as ProxyNodeData), viewType: DEFAULT_VIEW_ID },
        } as Node<ProxyNodeData>
      }),
    )
    // Re-centre the viewport on origin with a brief tween so the
    // operator visually tracks where the cluster lives.
    try {
      reactFlowInstance.setCenter?.(0, 0, { zoom: 1.0, duration: 400 })
    } catch {
      // ReactFlowProvider isn't mounted yet (shouldn't happen here,
      // but be defensive). Ignore.
    }
  }, [workspace, nodes, persistWorkspace, reactFlowInstance])

  // Suggest a default proxy name when opening the install dialog.
  // Counts existing proxies of the same service type to pick the next
  // available `${name}-N` slot.
  // Palette shows the latest version per service type. Compares with
  // localeCompare(..., numeric:true) which gets "1.10.0" > "1.9.0" right
  // for plausible semver. Older versions can still be installed via API
  // — they just don't clutter the palette.
  const latestCatalog = useMemo(() => {
    const byName = new Map<string, ServiceMeta>()
    for (const meta of catalog) {
      const prev = byName.get(meta.name)
      if (!prev || meta.version.localeCompare(prev.version, undefined, { numeric: true, sensitivity: 'base' }) > 0) {
        byName.set(meta.name, meta)
      }
    }
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [catalog])

  // REGISTRY tab content — a mirror of the runtime registry: every
  // service_proxy row the runtime is currently managing. The canvas
  // is just one view of these; the registry doesn't care which
  // workspace (if any) an instance is pinned to.
  const registryProxies = useMemo(() => {
    return allProxies
      .filter((p) => !!p.id)
      .sort((a, b) => (a.name ?? a.id ?? '').localeCompare(b.name ?? b.id ?? ''))
  }, [allProxies])

  const suggestProxyName = useCallback(
    (meta: ServiceMeta): string => {
      const prefix = meta.name
      const used = new Set(allProxies.map((p) => p.id ?? ''))
      let n = 1
      while (used.has(`${prefix}-${n}`)) n += 1
      return `${prefix}-${n}`
    },
    [allProxies],
  )

  const onRepoDragStart = useCallback((event: DragEvent<HTMLLIElement>, meta: ServiceMeta) => {
    event.dataTransfer.setData(DRAG_MIME_META, `${meta.name}@${meta.version}`)
    event.dataTransfer.effectAllowed = 'copy'
  }, [])

  const onRegistryDragStart = useCallback(
    (event: DragEvent<HTMLLIElement>, proxy: ServiceProxy) => {
      if (!proxy.id) return
      event.dataTransfer.setData(DRAG_MIME_PROXY, proxy.id)
      event.dataTransfer.effectAllowed = 'copy'
    },
    [],
  )

  // Clicking a registry row selects the proxy (so the Inspector lands
  // on it) AND pans/zooms the canvas so the node is in view. If the
  // proxy isn't on this workspace's canvas, we still select it so the
  // user can read its metadata in the Inspector — the canvas just stays
  // put, since there's no node to center on.
  const onRegistrySelect = useCallback(
    (proxyId: string) => {
      setSelected(proxyId)
      const node = reactFlowInstance.getNode(proxyId)
      if (!node) return
      // Node anchor in ReactFlow is its top-left; center on the
      // midpoint so the node sits in the middle of the viewport.
      // Width/height may not yet be measured for off-screen nodes —
      // fall back to a reasonable default so the pan still lands in
      // the right neighbourhood.
      const width = node.measured?.width ?? node.width ?? 200
      const height = node.measured?.height ?? node.height ?? 80
      const cx = node.position.x + width / 2
      const cy = node.position.y + height / 2
      const zoom = reactFlowInstance.getZoom()
      reactFlowInstance.setCenter(cx, cy, { zoom, duration: 400 })
    },
    [reactFlowInstance],
  )

  const onCanvasDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    const types = event.dataTransfer.types
    if (types.includes(DRAG_MIME_META) || types.includes(DRAG_MIME_PROXY)) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  // Helper used by both drop paths to translate screen → flow coords.
  const dropPosition = useCallback(
    (event: DragEvent<HTMLDivElement>): Position =>
      reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    [reactFlowInstance],
  )

  // Attach an existing proxy to this workspace at the dropped position.
  // No install — the instance already exists in the registry; we're just
  // bringing it into this workspace's view.
  const attachExistingProxy = useCallback(
    (proxyId: string, position: Position) => {
      setWorkspace((prev) => {
        if (!prev) return prev
        const ids: string[] = prev.service_proxy_ids ?? []
        if (ids.includes(proxyId)) return prev  // already on this canvas
        const positions: Record<string, Position> = { ...(prev.node_positions ?? {}) }
        positions[proxyId] = position
        const next: Workspace = {
          ...prev,
          service_proxy_ids: [...ids, proxyId],
          node_positions: positions,
        }
        persistWorkspace(next)
        return next
      })
      // Focus the newly-attached node so the inspector lands on it.
      // Same affordance as create-and-drop: the thing the user just
      // placed should be where their attention goes.
      setSelected(proxyId)
    },
    [persistWorkspace],
  )

  const onCanvasDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      // REPO drag → install dialog
      const metaId = event.dataTransfer.getData(DRAG_MIME_META)
      if (metaId) {
        const meta = catalog.find((m) => `${m.name}@${m.version}` === metaId)
        if (!meta) return
        setPendingDrop({ meta, position: dropPosition(event) })
        setDropName(suggestProxyName(meta))
        setError(null)
        return
      }
      // REGISTRY drag → attach in place
      const proxyId = event.dataTransfer.getData(DRAG_MIME_PROXY)
      if (proxyId) {
        attachExistingProxy(proxyId, dropPosition(event))
      }
    },
    [catalog, dropPosition, suggestProxyName, attachExistingProxy],
  )

  // Create a placeholder proxy of ``meta`` named ``proxyName`` and attach
  // it to this workspace at ``position``. Shared by the drop flow and the
  // "+ Add Service" dialog. Returns true on success; sets a banner + false
  // on any failure. Caller owns the busy flag + dialog teardown.
  const createAndAttach = useCallback(
    async (meta: ServiceMeta, proxyName: string, position: Position): Promise<boolean> => {
      if (!workspace?.id) return false
      // Pre-flight against the server's authoritative list — our local
      // allProxies may be stale (another tab created this name, or the
      // lifecycle event hasn't arrived yet).
      const serverProxies = await apiFetch<ServiceProxy[]>('/v1/service-proxy-list')
      if (serverProxies?.some((p) => p.id === proxyName)) {
        setAllProxies(serverProxies)
        setError(`A proxy named '${proxyName}' already exists`)
        return false
      }
      const result = await apiFetch<ServiceRequest>('/v1/service-request', {
        method: 'POST',
        body: JSON.stringify({
          action: 'create_service',
          service_meta_id: `${meta.name}@${meta.version}`,
          proxy_name: proxyName,
          // Placeholder only — the block lands with a grey light + Play
          // button; the type's deps install on first Start. (Starting it
          // straight away is the caller's choice.)
          placeholder: true,
        }),
      })
      if (result.status === 'failed') {
        if (/already exists/i.test(result.result ?? '')) {
          try {
            const fresh = await apiFetch<ServiceProxy[]>('/v1/service-proxy-list')
            setAllProxies(fresh ?? [])
          } catch { /* soft fail — reconciler + periodic resync catch up */ }
        }
        setError(result.result ?? 'install failed')
        return false
      }
      const newProxy = await apiFetch<ServiceProxy>(
        `/v1/service-proxy/${encodeURIComponent(proxyName)}`,
      )
      // Idempotent merge — the wildcard /service_proxy/+/lifecycle handler
      // may have added this proxy before our fetch returned.
      setAllProxies((prev) => {
        const idx = prev.findIndex((p) => p.id === newProxy.id)
        if (idx === -1) return prev.concat([newProxy])
        const next = prev.slice()
        next[idx] = { ...prev[idx], ...newProxy }
        return next
      })
      setWorkspace((prev) => {
        if (!prev) return prev
        const positions: Record<string, Position> = { ...(prev.node_positions ?? {}) }
        positions[proxyName] = position
        const existingIds = prev.service_proxy_ids ?? []
        const proxyIds = existingIds.includes(proxyName) ? existingIds : [...existingIds, proxyName]
        const next: Workspace = { ...prev, service_proxy_ids: proxyIds, node_positions: positions }
        persistWorkspace(next)
        return next
      })
      setSelected(proxyName)
      // A new instance may arrive with declared bindings (e.g. a servo
      // whose config already names a controller) — re-derive routes so
      // its edges appear without a manual refresh.
      void refreshLinks()
      return true
    },
    [workspace, apiFetch, persistWorkspace, refreshLinks],
  )

  // OK in the install dialog: create the proxy via service-request,
  // then attach it to this workspace at the dropped position.
  const confirmInstall = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault()
      if (!pendingDrop || !workspace?.id) return
      const proxyName = dropName.trim()
      if (!proxyName) {
        setError('Name is required')
        return
      }
      setInstalling(true)
      setError(null)
      try {
        const ok = await createAndAttach(pendingDrop.meta, proxyName, pendingDrop.position)
        if (ok) {
          setPendingDrop(null)
          setDropName('')
        }
      } catch (err) {
        if (err instanceof Error) setError(err.message)
      } finally {
        setInstalling(false)
      }
    },
    [pendingDrop, workspace, dropName, createAndAttach],
  )

  // Center of the canvas in flow coordinates — where dialog-created
  // services land (vs. drops, which use the cursor position).
  const canvasCenter = useCallback((): Position => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return reactFlowInstance.screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    })
  }, [reactFlowInstance])

  // "+ Add Service" dialog confirm. Creates the placeholder; when
  // ``thenStart`` it also fires start_service (via the ref so call order
  // with dispatchProxyAction doesn't matter), which runs the install +
  // start pipeline + may open the install/config wizard.
  const addServiceInstance = useCallback(
    async (meta: ServiceMeta, proxyName: string, thenStart: boolean) => {
      const name = proxyName.trim()
      if (!name) {
        setError('Name is required')
        return
      }
      setInstalling(true)
      setError(null)
      try {
        const ok = await createAndAttach(meta, name, canvasCenter())
        if (ok) {
          setAddServiceOpen(false)
          if (thenStart) dispatchProxyActionRef.current?.(name, 'start_service')
        }
      } catch (err) {
        if (err instanceof Error) setError(err.message)
      } finally {
        setInstalling(false)
      }
    },
    [createAndAttach, canvasCenter],
  )

  const cancelInstall = useCallback(() => {
    setPendingDrop(null)
    setDropName('')
    setError(null)
  }, [])

  // Save the current selection (or all visible nodes if nothing selected)
  // as a new user workspace. Layout + edges come with — opening the new
  // workspace later restores the same view.
  const confirmSaveSubset = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault()
      const name = saveSubsetName.trim()
      if (!name) {
        setError('Workspace name is required')
        return
      }
      if (!workspace) return
      const selected = nodes.filter((n) => n.selected).map((n) => n.id)
      const memberIds = selected.length > 0 ? selected : nodes.map((n) => n.id)
      if (memberIds.length === 0) {
        setError('Nothing to save — the canvas is empty')
        return
      }
      const memberSet = new Set(memberIds)
      const positions: Record<string, Position> = {}
      for (const n of nodes) {
        if (memberSet.has(n.id)) positions[n.id] = n.position
      }
      const filteredEdges = edges.filter(
        (e) => memberSet.has(e.source) && memberSet.has(e.target),
      )
      setSavingSubset(true)
      setError(null)
      try {
        const created = await apiFetch<Workspace>('/v1/workspace', {
          method: 'POST',
          body: JSON.stringify({
            id: name,
            name,
            kind: 'user',
            status: 'draft',
            service_proxy_ids: memberIds,
            node_positions: positions,
            edges: filteredEdges,
          }),
        })
        setSaveSubsetOpen(false)
        setSaveSubsetName('')
        if (created?.id) navigate(`/workspaces/${encodeURIComponent(created.id)}`)
      } catch (err) {
        if (err instanceof Error) setError(err.message)
      } finally {
        setSavingSubset(false)
      }
    },
    [saveSubsetName, nodes, edges, workspace, navigate],
  )

  // Per-proxy lifecycle action triggered from the inspector. Live status
  // updates flow back via the existing /service_proxy/{id}/lifecycle
  // subscription, so the inspector buttons re-render automatically.
  const [busyProxyId, setBusyProxyId] = useState<string | null>(null)

  // Inspector verbs map 1:1 onto the canonical runtime action names.
  // Release deletes the registry row entirely; the existing
  // /service_proxy/{id}/lifecycle subscription pushes the final
  // status=uninstalled event so the canvas + workspace state self-heal.
  const dispatchProxyAction = useCallback(
    async (
      proxyId: string,
      action: ProxyAction,
      config?: Record<string, unknown>,
    ) => {
      // 'configure_service' is UI-only — open the per-instance config
      // wizard (save without starting) instead of posting a request. Lets
      // the operator configure a placeholder before pressing Play.
      if (action === 'configure_service') {
        const proxy = allProxies.find((p) => p.id === proxyId)
        const meta = catalog.find((m) => `${m.name}@${m.version}` === proxy?.service_meta_id)
        if (proxy && meta) setPendingConfig({ proxyId, meta, proxy, thenStart: false })
        return
      }
      // Install-wizard gate: first Start of a placeholder whose type isn't
      // installed yet AND declares a license or install-time inputs opens
      // the wizard instead of installing immediately. `config` present means
      // the wizard already ran (or none was needed), so skip the gate.
      if (action === 'start_service' && !config) {
        const proxy = allProxies.find((p) => p.id === proxyId)
        const meta = catalog.find((m) => `${m.name}@${m.version}` === proxy?.service_meta_id)
        const wizardSteps = Array.isArray(meta?.wizard_steps) ? (meta!.wizard_steps as Array<{ fields?: unknown[] }>) : []
        const needsWizard =
          proxy?.status === 'placeholder' &&
          !meta?.installed &&
          !!meta &&
          (!!meta.license || wizardSteps.some((s) => (s.fields ?? []).length > 0))
        if (needsWizard && meta) {
          setPendingInstall({ proxyId, meta })
          return
        }
        // Config gate (M4): first Start of an unconfigured instance whose
        // type declares per-instance config fields opens the config wizard.
        const configSteps = Array.isArray(meta?.config_steps) ? (meta!.config_steps as Array<{ fields?: unknown[] }>) : []
        const needsConfig = !proxy?.configured && configSteps.some((s) => (s.fields ?? []).length > 0)
        if (needsConfig && meta && proxy) {
          setPendingConfig({ proxyId, meta, proxy, thenStart: true })
          return
        }
      }
      setBusyProxyId(proxyId)
      setError(null)
      // Helper to tidy local state when a proxy is gone server-side
      // (either after a successful release OR a 404 'not found' that
      // tells us the row was already deleted by someone else).
      const _dropFromLocalState = () => {
        setAllProxies((prev) => prev.filter((p) => p.id !== proxyId))
        setWorkspace((prev) => {
          if (!prev) return prev
          const ids: string[] = prev.service_proxy_ids ?? []
          const positions = { ...(prev.node_positions ?? {}) }
          const viewTypes = { ...((prev.node_view_types ?? {}) as Record<string, unknown>) }
          let changed = false
          if (ids.includes(proxyId)) {
            changed = true
          }
          if (proxyId in positions) {
            delete positions[proxyId]
            changed = true
          }
          if (proxyId in viewTypes) {
            delete viewTypes[proxyId]
            changed = true
          }
          if (!changed) return prev
          const next: Workspace = {
            ...prev,
            service_proxy_ids: ids.filter((id) => id !== proxyId),
            node_positions: positions,
            node_view_types: viewTypes as Workspace['node_view_types'],
          }
          persistWorkspace(next)
          return next
        })
        if (selected === proxyId) setSelected(null)
      }

      // Starting a placeholder installs its type deps first (M2). Mint the
      // request id here and subscribe to its progress topic BEFORE posting,
      // because the POST runs the install synchronously — events would be
      // missed if we waited for the response.
      const isPlaceholderStart =
        action === 'start_service' &&
        allProxies.find((p) => p.id === proxyId)?.status === 'placeholder'
      const requestId = isPlaceholderStart ? genId() : undefined
      if (isPlaceholderStart && requestId) {
        watchProgress(proxyId, `/service_request/${requestId}/progress`, requestId)
      }

      try {
        const result = await apiFetch<ServiceRequest>('/v1/service-request', {
          method: 'POST',
          body: JSON.stringify({
            ...(requestId ? { id: requestId } : {}),
            action,
            service_proxy_id: proxyId,
            ...(config ? { config } : {}),
          }),
        })
        if (result.status === 'failed') {
          // 'not found' on ANY action means the server has no row for
          // this proxy. Our local cache is what's stale. Drop it
          // silently — the reconciler keeps the server side coherent,
          // we just have to catch up the UI.
          const msg = result.result ?? ''
          if (/not found/i.test(msg)) {
            _dropFromLocalState()
            return
          }
          setError(result.result ?? `${action} failed`)
          return
        }
        if (action === 'release_service') {
          _dropFromLocalState()
        }
      } catch (err) {
        if (err instanceof Error) setError(err.message)
      } finally {
        setBusyProxyId(null)
      }
    },
    [persistWorkspace, selected, allProxies, catalog, watchProgress],
  )
  dispatchProxyActionRef.current = dispatchProxyAction

  // Persist per-instance config without starting (inspector "Configure").
  // Mirrors TopicRemapSection's read-merge-write so we never clobber other
  // service_config keys; marks the instance configured.
  const saveProxyConfig = useCallback(async (proxyId: string, config: Record<string, unknown>) => {
    setSavingConfig(true)
    setError(null)
    try {
      const current = await apiFetch<ServiceProxy>(`/v1/service-proxy/${encodeURIComponent(proxyId)}`)
      const nextConfig = { ...(current.service_config ?? {}), ...config }
      const next: ServiceProxy = { ...current, service_config: nextConfig, configured: true }
      await apiFetch(`/v1/service-proxy/${encodeURIComponent(proxyId)}`, {
        method: 'PUT',
        body: JSON.stringify(next),
      })
      setAllProxies((prev) => prev.map((p) => (p.id === proxyId ? { ...p, ...next } : p)))
      // Config may have changed a controller/input binding — re-derive
      // routes. (This PUT path doesn't broadcast config_state, so the
      // wildcard subscription won't catch it.)
      void refreshLinks()
    } catch (e) {
      if (e instanceof Error) setError(e.message)
    } finally {
      setSavingConfig(false)
    }
  }, [apiFetch, refreshLinks])


  const selectedProxy = useMemo(() => {
    if (!selected) return null
    return allProxies.find((p) => p.id === selected) ?? null
  }, [selected, allProxies])

  const isRuntime = workspace?.kind === 'runtime'

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/workspaces')}
            className="text-sm text-slate-400 hover:text-slate-200"
          >
            ← Workspaces
          </button>
          <h1 className="text-base font-semibold">{workspace?.name ?? workspaceId}</h1>
          {isRuntime ? (
            <span className="rounded bg-emerald-900 px-2 py-0.5 text-xs font-medium text-emerald-200">
              live
            </span>
          ) : (
            <span
              className="rounded bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-400"
              title="A saved view (layout + which services to show) over the shared running services. Services run independently; this is a lens, not a separate instance."
            >
              saved view
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(`/workspaces/${encodeURIComponent(workspaceId)}/dashboard`)}
            className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:border-slate-500"
          >
            Dashboard
          </button>
          {/* Runtime canvas can snapshot its layout into a saved view.
              A user workspace IS a saved view — services run independently
              (start them on the canvas or via the active config set), so it
              has no batch activate/deactivate. */}
          {isRuntime && (
            <button
              type="button"
              onClick={() => setSaveSubsetOpen(true)}
              disabled={!workspace}
              className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-60"
            >
              Save subset…
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="border-b border-rose-900 bg-rose-950 px-4 py-2">
          <Banner tone="error">{error}</Banner>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Palette aside — REPO (service types) and REGISTRY (existing
            instances managed by the runtime). REPO drags trigger the
            install dialog; REGISTRY drags attach in place. */}
        <aside className="w-60 shrink-0 overflow-y-auto border-r border-slate-800 bg-slate-900/60">
          <PaletteTabs
            active={paletteTab}
            onChange={setPaletteTab}
            repoCount={latestCatalog.length}
            registryCount={registryProxies.length}
          />
          <div className="p-3">
            {paletteTab === 'repo' ? (
              <RepoTab
                loading={loading}
                catalog={catalog}
                items={latestCatalog}
                onDragStart={onRepoDragStart}
              />
            ) : (
              <RegistryTab
                loading={loading}
                items={registryProxies}
                onDragStart={onRegistryDragStart}
                onAction={dispatchProxyAction}
                onSelect={onRegistrySelect}
                selectedId={selected}
                busyProxyId={busyProxyId}
              />
            )}
          </div>
        </aside>

        {/* Canvas */}
        <main
          ref={canvasRef}
          className="relative flex-1 bg-slate-950"
          onDragOver={onCanvasDragOver}
          onDrop={onCanvasDrop}
        >
          {/* Discoverable "add service" affordance — overlays the canvas
              top-left. (Dragging a palette row still works for power
              users; this is the obvious path for everyone else.) */}
          <button
            type="button"
            onClick={() => { setError(null); setAddServiceOpen(true) }}
            className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-sm font-medium text-slate-200 shadow-lg backdrop-blur hover:border-sky-500 hover:text-white"
          >
            <Plus className="h-4 w-4" />
            Add Service
          </button>
          {/* Defer mounting ReactFlow until the workspace is loaded.
              defaultViewport + fitView are both initial-only props — if we
              render with workspace=null, the saved pan/zoom is lost and
              the user has to press "fit view" after every sign-in. */}
          {workspace ? (
            <ReactFlow
              nodes={nodes}
              edges={allEdges}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed } }}
              defaultViewport={
                (workspace.viewport as Viewport | undefined) ?? { x: 0, y: 0, zoom: 1 }
              }
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onEdgeClick={onEdgeClick}
              onMoveEnd={onMoveEnd}
              onSelectionChange={onSelectionChange}
              colorMode="dark"
              // While a node (service view) is selected, the wheel belongs to
              // that view (scroll its content) — not the canvas. Canvas
              // zoom-on-scroll is only active when nothing is selected.
              zoomOnScroll={!selected}
              fitView={!workspace.viewport}
            >
              <Background gap={20} />
              <Controls>
                {/* Cluster — minimise every panel to its view_min pill +
                    arrange them in concentric rings around the canvas
                    origin, then drive the viewport to (0, 0). Lets the
                    operator rein in a sprawl after dragging panels
                    far apart, or just to see everything at a glance. */}
                <ControlButton
                  onClick={clusterAtOrigin}
                  title="Cluster all panels at origin"
                  aria-label="Cluster all panels at origin"
                >
                  <CircleDot />
                </ControlButton>
                {/* Toggle the derived data-flow routes layer. */}
                <ControlButton
                  onClick={() => setShowRoutes((v) => !v)}
                  title={showRoutes ? 'Hide data-flow routes' : 'Show data-flow routes'}
                  aria-label="Toggle data-flow routes"
                  style={{ color: showRoutes ? '#22d3ee' : undefined }}
                >
                  <Share2 />
                </ControlButton>
              </Controls>
            </ReactFlow>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-500">
              Loading canvas…
            </div>
          )}
        </main>

        {/* Inspector */}
        <aside className="w-72 shrink-0 overflow-y-auto border-l border-slate-800 bg-slate-900/60 p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Inspector
          </h2>
          {!selectedProxy && !selectedRoute && (
            <div className="text-xs text-slate-500">
              Select a node to see its metadata + live status. Click a route
              line to inspect or remove a data link.
            </div>
          )}
          {!selectedProxy && selectedRoute && (
            <RouteInspector
              source={selectedRoute.source}
              target={selectedRoute.target}
              links={links.filter(
                (l) => l.source_proxy_id === selectedRoute.source && l.target_proxy_id === selectedRoute.target,
              )}
              rates={topicRates}
              onRemove={deleteLink}
              onClose={() => setSelectedRoute(null)}
            />
          )}
          {selectedProxy && (
            <InspectorPanel
              proxy={selectedProxy}
              busy={busyProxyId === selectedProxy.id}
              onAction={(action) => selectedProxy.id && dispatchProxyAction(selectedProxy.id, action)}
              install={selectedProxy.id ? installProgress[selectedProxy.id] : undefined}
              onRetryInstall={() => selectedProxy.id && dispatchProxyAction(selectedProxy.id, 'start_service')}
              onDismissInstall={() => selectedProxy.id && dismissInstall(selectedProxy.id)}
              configurable={(() => {
                const m = catalog.find((c) => `${c.name}@${c.version}` === selectedProxy.service_meta_id)
                const steps = Array.isArray(m?.config_steps) ? (m!.config_steps as Array<{ fields?: unknown[] }>) : []
                return steps.some((s) => (s.fields ?? []).length > 0)
              })()}
              onConfigure={() => {
                const m = catalog.find((c) => `${c.name}@${c.version}` === selectedProxy.service_meta_id)
                if (m && selectedProxy.id) {
                  setPendingConfig({ proxyId: selectedProxy.id, meta: m, proxy: selectedProxy, thenStart: false })
                }
              }}
            />
          )}
        </aside>
      </div>

      {/* Install wizard — license + install-time inputs on first Start of
          a placeholder whose type needs a one-time install (M3). */}
      {pendingInstall && (
        <InstallWizard
          meta={pendingInstall.meta}
          onCancel={() => setPendingInstall(null)}
          onConfirm={(cfg) => {
            const pid = pendingInstall.proxyId
            setPendingInstall(null)
            void dispatchProxyAction(pid, 'start_service', cfg)
          }}
        />
      )}

      {/* Config wizard — per-instance settings, on first Start or from the
          inspector's Configure button (M4). */}
      {pendingConfig && (
        <ConfigWizard
          meta={pendingConfig.meta}
          proxy={pendingConfig.proxy}
          busy={savingConfig}
          saveLabel={pendingConfig.thenStart ? 'Save & start' : 'Save'}
          onCancel={() => setPendingConfig(null)}
          onSave={(cfg) => {
            const { proxyId, thenStart } = pendingConfig
            setPendingConfig(null)
            if (thenStart) {
              void dispatchProxyAction(proxyId, 'start_service', cfg)
            } else {
              void saveProxyConfig(proxyId, cfg)
            }
          }}
        />
      )}


      {/* Install dialog — shown after a service type is dropped */}
      {pendingDrop && (
        <InstallDialog
          meta={pendingDrop.meta}
          name={dropName}
          onNameChange={setDropName}
          onCancel={cancelInstall}
          onConfirm={confirmInstall}
          installing={installing}
          error={error}
          nameTaken={allProxies.some((p) => p.id === dropName.trim())}
        />
      )}

      {/* Add Service dialog — searchable catalog picker + name + Create/Start */}
      {addServiceOpen && (
        <AddServiceDialog
          catalog={latestCatalog}
          suggestName={suggestProxyName}
          nameTaken={(n) => allProxies.some((p) => p.id === n.trim())}
          installing={installing}
          error={error}
          onCancel={() => { setAddServiceOpen(false); setError(null) }}
          onSubmit={(meta, name, thenStart) => void addServiceInstance(meta, name, thenStart)}
        />
      )}

      {/* Save subset dialog — runtime canvas only */}
      {saveSubsetOpen && (
        <SaveSubsetDialog
          name={saveSubsetName}
          onNameChange={setSaveSubsetName}
          onCancel={() => { setSaveSubsetOpen(false); setSaveSubsetName(''); setError(null) }}
          onConfirm={confirmSaveSubset}
          saving={savingSubset}
          error={error}
          selectedCount={nodes.filter((n) => n.selected).length}
          totalCount={nodes.length}
        />
      )}
    </div>
  )
}

interface InstallDialogProps {
  meta: ServiceMeta
  name: string
  onNameChange: (next: string) => void
  onCancel: () => void
  onConfirm: (event?: FormEvent) => void
  installing: boolean
  error: string | null
  nameTaken: boolean
}

// ─── Palette tabs + per-tab list components ────────────────────────────
// REPO: drag a *type* → install dialog → new instance.
// REGISTRY: drag an *instance* → attach to workspace (no install).

interface PaletteTabsProps {
  active: PaletteTab
  onChange: (next: PaletteTab) => void
  repoCount: number
  registryCount: number
}

function PaletteTabs({ active, onChange, repoCount, registryCount }: PaletteTabsProps) {
  return (
    <div className="flex border-b border-slate-800 bg-slate-900">
      <PaletteTabButton
        label="REGISTRY"
        count={registryCount}
        active={active === 'registry'}
        onClick={() => onChange('registry')}
      />
      {/* Tab label says "CATALOG" to match the top-level nav + the
          ``/catalog`` page. The state key stays ``'repo'`` because
          the palette-position is persisted in workspace.palette_tab
          and a rename would silently flip existing operators back
          to the default. */}
      <PaletteTabButton
        label="CATALOG"
        count={repoCount}
        active={active === 'repo'}
        onClick={() => onChange('repo')}
      />
    </div>
  )
}

function PaletteTabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-3 py-2 text-xs font-semibold tracking-wider ${
        active
          ? 'border-b-2 border-sky-400 text-sky-300'
          : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {label} <span className="ml-1 text-[10px] text-slate-500">{count}</span>
    </button>
  )
}

interface RepoTabProps {
  loading: boolean
  catalog: ServiceMeta[]
  items: ServiceMeta[]
  onDragStart: (event: DragEvent<HTMLLIElement>, meta: ServiceMeta) => void
}

function RepoTab({ loading, catalog, items, onDragStart }: RepoTabProps) {
  // Drag-only palette. The "Catalog" page at /catalog is the single
  // surface for type-level management (install / uninstall /
  // installed-status display). The palette used to carry an
  // ``installed`` badge + an Uninstall button per row, but that
  // double-exposed the same state as the Catalog page and made the
  // two views drift out of sync (Install shown in Catalog while the
  // palette already said Installed). Keep this tab focused on
  // dragging types onto the canvas.
  //
  // Free-text filter — matches name, description, or any tag. Local
  // state because the query is purely a view concern of this tab and
  // doesn't need to persist with the workspace.
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((meta) => {
      const haystack = [
        meta.name,
        meta.title ?? '',
        meta.description ?? '',
        ...(meta.tags ?? []),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [items, query])
  return (
    <>
      <p className="mb-2 text-[10px] text-slate-500">
        Drag a type onto the canvas to add an instance.{' '}
        <a href="/catalog" className="text-sky-400 hover:text-sky-300">
          Manage installations →
        </a>
      </p>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search service types…"
        className="mb-2 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
      />
      {loading && <div className="text-xs text-slate-500">Loading…</div>}
      {!loading && catalog.length === 0 && (
        <div className="text-xs text-slate-500">
          The catalog is empty. Seed it or install a remote source.
        </div>
      )}
      {!loading && catalog.length > 0 && filtered.length === 0 && (
        <div className="text-xs text-slate-500">
          No service types match “{query.trim()}”.
        </div>
      )}
      <ul className="space-y-1">
        {filtered.map((meta) => {
          const metaId = `${meta.name}@${meta.version}`
          return (
            <li
              key={metaId}
              draggable
              onDragStart={(e) => onDragStart(e, meta)}
              className="flex cursor-grab items-start gap-2 rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs hover:border-slate-500 active:cursor-grabbing"
              title={meta.description ?? metaId}
            >
              <ServiceIcon
                name={meta.name}
                version={meta.version}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-slate-200">{serviceTitle(meta)}</div>
                <div className="truncate font-mono text-[10px] text-slate-500">
                  {meta.name}@{meta.version}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}

interface RegistryTabProps {
  loading: boolean
  items: ServiceProxy[]
  onDragStart: (event: DragEvent<HTMLLIElement>, proxy: ServiceProxy) => void
  onAction: (proxyId: string, action: 'start_service' | 'stop_service' | 'release_service') => void
  // Click on a row body — selects the proxy in the canvas and pans/zooms
  // the viewport to centre on its node. Action buttons stopPropagation
  // so they don't double-fire this.
  onSelect: (proxyId: string) => void
  // Which proxy is currently selected on the canvas — used to render a
  // matching highlight on the row so the link between registry list
  // and canvas selection is visible at a glance.
  selectedId: string | null
  busyProxyId: string | null
}

function RegistryTab({ loading, items, onDragStart, onAction, onSelect, selectedId, busyProxyId }: RegistryTabProps) {
  // ``view`` is the row-level UX router: rows are draggable AND expose
  // inline Start/Release affordances. Without inline actions, a service
  // that's status=installed has no way to be started from the runtime
  // canvas — the canvas computes its membership from running proxies, so
  // dragging an installed one onto it shows briefly then disappears once
  // the workspace re-derives.
  const [query, setQuery] = useState('')
  // Filter by id / type / status — the registry can hold many instances.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((p) =>
      [p.id, p.name, p.service_meta_id, p.status]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [items, query])
  return (
    <>
      <p className="mb-2 text-[10px] text-slate-500">
        Every instance the runtime is managing. Drag onto the canvas to view,
        or use the inline action to start / release without dragging.
      </p>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search instances…"
        className="mb-2 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
      />
      {loading && <div className="text-xs text-slate-500">Loading…</div>}
      {!loading && items.length === 0 && (
        <div className="text-xs text-slate-500">
          The registry is empty. Install a service from the Catalog to populate it.
        </div>
      )}
      {!loading && items.length > 0 && shown.length === 0 && (
        <div className="text-xs text-slate-500">No instances match “{query.trim()}”.</div>
      )}
      <ul className="space-y-1">
        {shown.map((proxy) => {
          const id = proxy.id ?? proxy.name ?? ''
          const status = proxy.status ?? 'unknown'
          const tone = STATUS_TONE[status] ?? STATUS_TONE.stopped
          const running = status === 'running' || status === 'starting'
          const startable = status === 'placeholder' || status === 'installed' || status === 'stopped' || status === 'error'
          const busy = busyProxyId === id
          const isSelected = selectedId === id
          return (
            <li
              key={id}
              draggable
              onDragStart={(e) => onDragStart(e, proxy)}
              onClick={() => onSelect(id)}
              className={`flex cursor-grab items-start gap-2 rounded border px-2 py-2 text-xs active:cursor-grabbing ${
                isSelected
                  ? 'border-sky-500 bg-sky-950/40 hover:border-sky-400'
                  : 'border-slate-700 bg-slate-950 hover:border-slate-500'
              }`}
              title={proxy.service_meta_id ?? id}
            >
              <ServiceIcon
                name={metaNameFromId(proxy.service_meta_id)}
                version={metaVersionFromId(proxy.service_meta_id)}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-slate-200">{id}</div>
                <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-slate-500">
                  <span className={`rounded px-1 py-0.5 ${tone}`}>{status}</span>
                  <span className="truncate">{proxy.service_meta_id}</span>
                </div>
              </div>
              {/* Inline action — Start for installed/stopped, Stop for running.
                  Release is only shown when not running. Buttons capture
                  their own pointer events so the parent <li>'s drag
                  handler stays out of the way. */}
              <div className="shrink-0 flex flex-col gap-1" onPointerDown={(e) => e.stopPropagation()}>
                {startable && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={(e) => { e.stopPropagation(); onAction(id, 'start_service') }}
                    className="rounded border border-emerald-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300 hover:border-emerald-500 disabled:opacity-40"
                  >
                    start
                  </button>
                )}
                {running && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={(e) => { e.stopPropagation(); onAction(id, 'stop_service') }}
                    className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-200 hover:border-slate-500 disabled:opacity-40"
                  >
                    stop
                  </button>
                )}
                {!running && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={(e) => { e.stopPropagation(); onAction(id, 'release_service') }}
                    className="rounded border border-rose-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-rose-300 hover:border-rose-500 disabled:opacity-40"
                  >
                    release
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}

function InstallDialog({
  meta,
  name,
  onNameChange,
  onCancel,
  onConfirm,
  installing,
  error,
  nameTaken,
}: InstallDialogProps) {
  const trimmed = name.trim()
  const canSubmit = trimmed.length > 0 && !nameTaken && !installing
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
      onClick={(e) => {
        // Click on the backdrop (not the dialog itself) cancels.
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <form
        onSubmit={onConfirm}
        className="w-full max-w-md space-y-4 rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-2xl"
      >
        <header className="flex items-start gap-3">
          <ServiceIcon
            name={meta.name}
            version={meta.version}
            className="mt-0.5 h-7 w-7 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-xs text-slate-500">{meta.name}@{meta.version}</div>
            <h2 className="mt-0.5 text-base font-semibold text-slate-100">
              Create {meta.name}
            </h2>
          </div>
        </header>

        {meta.description && (
          <p className="text-sm text-slate-300">{meta.description}</p>
        )}

        <div className="grid grid-cols-2 gap-3 text-xs text-slate-400">
          {meta.language && (
            <div><span className="text-slate-500">language:</span> {meta.language}</div>
          )}
          {meta.dependency_manager && (
            <div><span className="text-slate-500">deps:</span> {meta.dependency_manager}</div>
          )}
          {meta.status && (
            <div><span className="text-slate-500">status:</span> {meta.status}</div>
          )}
          {meta.author && (
            <div><span className="text-slate-500">author:</span> {meta.author}</div>
          )}
        </div>

        <label className="block space-y-1 text-sm">
          <span className="text-slate-300">Name <span className="text-rose-400">*</span></span>
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={`${meta.name}-1`}
            disabled={installing}
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 outline-none focus:border-sky-500 disabled:opacity-60"
          />
          {nameTaken && (
            <span className="block text-xs text-amber-400">
              A proxy with this name already exists.
            </span>
          )}
        </label>

        {error && <Banner tone="error">{error}</Banner>}

        <footer className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {installing ? 'Creating…' : 'Create'}
          </button>
        </footer>
      </form>
    </div>
  )
}

// "+ Add Service" dialog — the discoverable path to instantiate a service.
// A searchable catalog picker (left) + a name field that pre-fills from the
// selected type UNLESS the user has already edited it, then Create (drop a
// placeholder) or Start (create + start now).
function AddServiceDialog(props: {
  catalog: ServiceMeta[]
  suggestName: (meta: ServiceMeta) => string
  nameTaken: (name: string) => boolean
  installing: boolean
  error: string | null
  onCancel: () => void
  onSubmit: (meta: ServiceMeta, name: string, thenStart: boolean) => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<ServiceMeta | null>(null)
  const [name, setName] = useState('')
  // Once the user edits the name field we stop auto-filling from the type
  // so we never clobber their choice.
  const [nameEdited, setNameEdited] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return props.catalog
    return props.catalog.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.description ?? '').toLowerCase().includes(q) ||
        (Array.isArray(m.tags) ? (m.tags as string[]) : []).some((t) => t.toLowerCase().includes(q)),
    )
  }, [props.catalog, query])

  const pick = (meta: ServiceMeta) => {
    setSelected(meta)
    if (!nameEdited) setName(props.suggestName(meta))
  }

  const trimmed = name.trim()
  const taken = trimmed.length > 0 && props.nameTaken(trimmed)
  const canSubmit = !!selected && trimmed.length > 0 && !taken && !props.installing

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) props.onCancel() }}
    >
      <div className="flex w-full max-w-2xl flex-col gap-4 rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">Add Service</h2>
          <button type="button" onClick={props.onCancel} className="text-slate-500 hover:text-slate-300">✕</button>
        </header>

        <div className="grid grid-cols-2 gap-4">
          {/* Searchable type picker */}
          <div className="flex min-h-0 flex-col">
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search service types…"
              className="mb-2 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
            />
            <ul className="max-h-72 min-h-0 flex-1 overflow-y-auto rounded border border-slate-800">
              {filtered.length === 0 && (
                <li className="p-3 text-xs text-slate-500">No types match the search.</li>
              )}
              {filtered.map((m) => (
                <li key={`${m.name}@${m.version}`}>
                  <button
                    type="button"
                    onClick={() => pick(m)}
                    className={`flex w-full items-start gap-2 border-b border-slate-800/60 px-2.5 py-2 text-left hover:bg-slate-800/50 ${
                      selected && selected.name === m.name && selected.version === m.version ? 'bg-sky-500/10' : ''
                    }`}
                  >
                    <ServiceIcon name={m.name} version={m.version} className="mt-0.5 h-5 w-5 shrink-0" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-slate-200">{m.name}</span>
                      <span className="block truncate text-[10px] text-slate-500">{m.version}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Selection detail + name */}
          <div className="flex flex-col gap-3">
            {selected ? (
              <>
                <div className="flex items-center gap-2">
                  <ServiceIcon name={selected.name} version={selected.version} className="h-6 w-6 shrink-0" />
                  <span className="font-mono text-xs text-slate-400">{selected.name}@{selected.version}</span>
                </div>
                {selected.description && (
                  <p className="max-h-24 overflow-y-auto text-xs text-slate-400">{selected.description}</p>
                )}
              </>
            ) : (
              <p className="text-xs text-slate-500">Pick a service type to configure its name.</p>
            )}
            <label className="block space-y-1 text-sm">
              <span className="text-slate-300">Name <span className="text-rose-400">*</span></span>
              <input
                type="text"
                value={name}
                onChange={(e) => { setName(e.target.value); setNameEdited(true) }}
                placeholder={selected ? `${selected.name}-1` : 'select a type first'}
                disabled={!selected || props.installing}
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 outline-none focus:border-sky-500 disabled:opacity-50"
              />
              {taken && <span className="block text-xs text-amber-400">A proxy with this name already exists.</span>}
            </label>
          </div>
        </div>

        {props.error && <Banner tone="error">{props.error}</Banner>}

        <footer className="flex items-center justify-between">
          <span className="text-[11px] text-slate-500">Create drops a placeholder; Start also installs + runs it.</span>
          <div className="flex gap-2">
            <button type="button" onClick={props.onCancel} className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500">
              Cancel
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => selected && props.onSubmit(selected, trimmed, false)}
              className="rounded border border-emerald-700 px-4 py-1.5 text-sm font-medium text-emerald-300 hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {props.installing ? 'Creating…' : 'Create'}
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => selected && props.onSubmit(selected, trimmed, true)}
              className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Start
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

// Status → which inspector actions are visible. The three buttons map
// 1:1 onto the runtime's canonical action verbs:
//   start   → start_service     (installed | stopped | error)
//   stop    → stop_service      (running)
//   release → release_service   (anything that isn't currently running)
//
// Transient states hide everything because the next bus event will
// resolve the row into a stable state within milliseconds — offering
// a button mid-transition just produces "from status='starting'" errors.
function visibleActions(status: string | undefined): {
  start: boolean
  stop: boolean
  release: boolean
} {
  switch (status) {
    case 'placeholder':
    case 'installed':
    case 'stopped':
    case 'error':
      return { start: true, stop: false, release: true }
    case 'running':
      return { start: false, stop: true, release: false }
    case 'starting':
    case 'stopping':
    case 'installing':
      return { start: false, stop: false, release: false }
    default:
      // Unknown / fresh row: at least let the user release it so a
      // stuck proxy can be cleared from the registry.
      return { start: false, stop: false, release: true }
  }
}

interface InspectorPanelProps {
  proxy: ServiceProxy
  busy: boolean
  onAction: (action: 'start_service' | 'stop_service' | 'release_service') => void
  install?: InstallProgressState
  onRetryInstall?: () => void
  onDismissInstall?: () => void
  configurable?: boolean
  onConfigure?: () => void
}

function InspectorPanel({ proxy, busy, onAction, install, onRetryInstall, onDismissInstall, configurable, onConfigure }: InspectorPanelProps) {
  const wsClient = useWsClient()
  const actions = visibleActions(proxy.status)
  // Show the structured install panel while the type installs, or if the
  // last install failed (so the user gets the step + a Retry button).
  const showInstall = !!install && (proxy.status === 'installing' || install.overall === 'failed')
  // Last few log lines for this proxy. Helps diagnose status=error
  // without leaving the canvas to /logs.
  const proxyId = proxy.id ?? proxy.name ?? ''
  const [logTail, setLogTail] = useReactState<string[]>([])
  useEffect(() => {
    if (!proxyId) return
    setLogTail([])
    const off = wsClient.subscribe(`/service_proxy/${proxyId}/log`, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const p = f.payload as { line?: string; stream?: string } | undefined
      if (!p?.line) return
      const prefix = p.stream === 'stderr' ? '! ' : '  '
      setLogTail((prev) => {
        const next = prev.concat([prefix + p.line])
        return next.length > 30 ? next.slice(-30) : next
      })
    })
    return off
  }, [proxyId, wsClient])

  const isErrored = proxy.status === 'error'
  return (
    <div className="space-y-3">
      <header className="flex items-start gap-2">
        <ServiceIcon
          name={metaNameFromId(proxy.service_meta_id)}
          version={metaVersionFromId(proxy.service_meta_id)}
          className="mt-0.5 h-5 w-5 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-slate-100">
            {proxy.name ?? proxy.id}
          </div>
          <div className="truncate font-mono text-[10px] text-slate-500">
            {proxy.service_meta_id}
          </div>
        </div>
      </header>

      {/* Structured install progress — steps + raw log + retry, shown
          while the type's deps install on first Start (or after a failure
          so the user can see which step broke). Supersedes the generic
          error banner below when present. */}
      {showInstall && install && (
        <InstallProgress
          state={install}
          onRetry={onRetryInstall}
          onDismiss={onDismissInstall}
        />
      )}

      {/* Error banner — front-and-center when the proxy is in error.
          Shows the row's error string + the most recent stderr lines
          from the log topic. Without this the user has to guess at
          /logs to see why a Start failed. */}
      {isErrored && !showInstall && (
        <div className="space-y-2 rounded border border-rose-700 bg-rose-950/40 p-2">
          <div className="font-mono text-xs text-rose-200">
            ✗ {proxy.error ?? 'unknown error'}
          </div>
          {proxy.stopped_at && (
            <div className="font-mono text-[10px] text-rose-400">
              at {proxy.stopped_at}
            </div>
          )}
          <div className="text-[10px] uppercase tracking-wider text-rose-400">
            recent log (last {logTail.length || 0} line{logTail.length === 1 ? '' : 's'})
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950 px-2 py-1 font-mono text-[10px] leading-tight text-slate-300">
            {logTail.length === 0
              ? 'No recent log lines captured. Open /logs and filter by this service for the full history.'
              : logTail.join('\n')}
          </pre>
        </div>
      )}

      {(actions.start || actions.stop || actions.release) && (
        <div className="flex flex-wrap gap-1.5">
          {actions.start && (
            <ActionButton
              label={busy ? 'Starting…' : 'Start'}
              tone="primary"
              disabled={busy}
              onClick={() => onAction('start_service')}
            />
          )}
          {actions.stop && (
            <ActionButton
              label={busy ? 'Stopping…' : 'Stop'}
              tone="primary"
              disabled={busy}
              onClick={() => onAction('stop_service')}
            />
          )}
          {actions.release && (
            <ActionButton
              label={busy ? 'Releasing…' : 'Release'}
              tone="danger"
              disabled={busy}
              onClick={() => onAction('release_service')}
            />
          )}
          {configurable && onConfigure && actions.start && (
            <ActionButton label="Configure" tone="secondary" disabled={busy} onClick={onConfigure} />
          )}
        </div>
      )}

      <dl className="space-y-2 text-xs">
        <Field label="id" value={proxy.id ?? '—'} />
        <Field label="status" value={proxy.status ?? '—'} />
        <Field label="pid" value={String(proxy.pid ?? '—')} />
        <Field label="host" value={proxy.host ?? '—'} />
        <Field label="port" value={String(proxy.port ?? '—')} />
        <Field label="started_at" value={proxy.started_at ?? '—'} />
        <Field label="stopped_at" value={proxy.stopped_at ?? '—'} />
      </dl>

      <TopicsSection proxyId={proxyId} />
      <TopicRemapSection proxy={proxy} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Topic remap — ROS-style aliasing for the running service.
//
// Edits write to ``service_proxy.service_config.topic_remap`` (a
// ``Dict[str, str]`` of absolute_from → absolute_to). The framework's
// ``Service.resolve_topic`` reads that table at every publish + subscribe.
//
// In-process services pick up the new mapping on next start — there
// is a banner reminding the user to restart if the service is currently
// running. Subprocess services live-update via the config_state retained
// topic (handled by SubprocessService._apply_config_state).
// ─────────────────────────────────────────────────────────────────────

function TopicRemapSection({ proxy }: { proxy: ServiceProxy }) {
  const apiFetch = useApiFetch()
  const proxyId = proxy.id ?? proxy.name ?? ''
  const isRunning = proxy.status === 'running' || proxy.status === 'starting'
  const [rows, setRows] = useReactState<{ from: string; to: string }[]>([])
  const [dirty, setDirty] = useReactState(false)
  const [saving, setSaving] = useReactState(false)
  const [error, setError] = useReactState<string | null>(null)
  const [collapsed, setCollapsed] = useReactState(true)

  // Seed from proxy.service_config.topic_remap whenever the proxy
  // object changes (initial mount + after every save). Don't overwrite
  // local edits — only sync when not dirty.
  useEffect(() => {
    if (dirty) return
    const remap = (proxy.service_config?.topic_remap ?? {}) as Record<string, string>
    setRows(Object.entries(remap).map(([from, to]) => ({ from, to })))
  }, [proxy.service_config, dirty])

  const setRow = (idx: number, patch: Partial<{ from: string; to: string }>) => {
    setDirty(true)
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  const removeRow = (idx: number) => {
    setDirty(true)
    setRows((prev) => prev.filter((_, i) => i !== idx))
  }
  const addRow = () => {
    setDirty(true)
    setRows((prev) => prev.concat([{ from: '', to: '' }]))
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      // Build the remap map, dropping empty/incomplete rows.
      const remap: Record<string, string> = {}
      for (const r of rows) {
        const from = r.from.trim()
        const to = r.to.trim()
        if (!from || !to) continue
        if (!from.startsWith('/') || !to.startsWith('/')) {
          setError('Topics must be absolute paths starting with /')
          setSaving(false)
          return
        }
        remap[from] = to
      }
      // Fetch-then-PUT — the proxy row is the source of truth; we
      // merge service_config.topic_remap and write the full row back.
      const current = await apiFetch<ServiceProxy>(
        `/v1/service-proxy/${encodeURIComponent(proxyId)}`,
      )
      const nextConfig = { ...(current.service_config ?? {}), topic_remap: remap }
      const next: ServiceProxy = { ...current, service_config: nextConfig }
      await apiFetch(`/v1/service-proxy/${encodeURIComponent(proxyId)}`, {
        method: 'PUT',
        body: JSON.stringify(next),
      })
      setDirty(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded border border-slate-800 bg-slate-950/40">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between px-2 py-1.5 text-[10px] uppercase tracking-wider text-slate-400 hover:text-slate-200"
      >
        <span>topic remap</span>
        <span className="font-mono text-slate-500">
          {rows.filter((r) => r.from && r.to).length} rule{rows.filter((r) => r.from && r.to).length === 1 ? '' : 's'}  {collapsed ? '▸' : '▾'}
        </span>
      </button>
      {!collapsed && (
        <div className="space-y-2 px-2 pb-2">
          <div className="text-[10px] text-slate-500">
            ROS-style aliasing. Rewrites every publish + subscribe whose
            absolute path matches a key. Both sides must start with <span className="font-mono">/</span>.
          </div>
          {rows.length === 0 && (
            <div className="text-[11px] text-slate-500">No remap rules. Click + to add one.</div>
          )}
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                type="text"
                value={r.from}
                onChange={(e) => setRow(i, { from: e.target.value })}
                placeholder="/from/topic"
                className="nodrag nopan flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-200 focus:border-slate-500 focus:outline-none"
              />
              <span className="text-slate-500">→</span>
              <input
                type="text"
                value={r.to}
                onChange={(e) => setRow(i, { to: e.target.value })}
                placeholder="/to/topic"
                className="nodrag nopan flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-200 focus:border-slate-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                title="Remove remap"
                className="rounded border border-slate-700 px-1.5 py-0.5 text-xs text-slate-400 hover:border-rose-500 hover:text-rose-300"
              >
                ×
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={addRow}
              className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:border-slate-500"
            >
              + add remap
            </button>
            <div className="flex items-center gap-2">
              {dirty && (
                <span className="text-[10px] uppercase tracking-wider text-amber-400">unsaved</span>
              )}
              <button
                type="button"
                onClick={save}
                disabled={!dirty || saving}
                className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
          {error && (
            <div className="rounded border border-rose-700 bg-rose-950/40 px-2 py-1 font-mono text-[10px] text-rose-200">
              {error}
            </div>
          )}
          {isRunning && !dirty && rows.length > 0 && (
            <div className="rounded border border-amber-700/40 bg-amber-950/30 px-2 py-1 text-[10px] text-amber-200">
              Restart the service for in-process remap changes to take effect on running subscriptions. Subprocess services pick up changes live.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Topics section — answers "what does THIS service publish + listen to?"
// Data sources:
//   * /v1/service-proxy/{id}/topology — declared publishes (decorator
//     + class-attr publishes), substituted into absolute topic paths
//   * /v1/bus/topics — live bus topology; filtered to subscribers whose
//     parsed identity has this proxy_id
// ─────────────────────────────────────────────────────────────────────

interface TopologyResponse {
  transport: string | null
  type_name: string
  publishes: { topic: string; source: string; method: string | null; retained?: boolean }[]
  methods: { name: string; doc: string | null; publishes: string[]; publish_return: string | null }[]
}

interface BusTopic {
  name: string
  subscriber_count: number
  retained: boolean
  dropped: number
  subscribers: { id: string; kind: string; type?: string; proxy_id?: string; suffix?: string; user?: string; matched_via?: string }[]
}

function TopicsSection({ proxyId }: { proxyId: string }) {
  const apiFetch = useApiFetch()
  const [topology, setTopology] = useReactState<TopologyResponse | null>(null)
  const [busTopics, setBusTopics] = useReactState<BusTopic[]>([])
  const [collapsed, setCollapsed] = useReactState(false)

  useEffect(() => {
    if (!proxyId) return
    let cancelled = false
    const fetchAll = async () => {
      try {
        const [topo, bus] = await Promise.all([
          apiFetch<TopologyResponse>(`/v1/service-proxy/${encodeURIComponent(proxyId)}/topology`),
          apiFetch<{ topics: BusTopic[] }>(`/v1/bus/topics`),
        ])
        if (cancelled) return
        setTopology(topo)
        setBusTopics(bus.topics ?? [])
      } catch {
        // Soft-fail — leave previous data shown.
      }
    }
    fetchAll()
    const t = setInterval(fetchAll, 4000)
    return () => { cancelled = true; clearInterval(t) }
  }, [proxyId, apiFetch])

  // Subscribed topics for this proxy: every bus topic whose subscribers
  // list contains an entry with kind=service and proxy_id matching.
  const subscribed = useMemo(() => {
    const out: { topic: string; suffix?: string; matched_via?: string }[] = []
    for (const t of busTopics) {
      for (const s of t.subscribers ?? []) {
        if (s.kind === 'service' && s.proxy_id === proxyId) {
          out.push({ topic: t.name, suffix: s.suffix, matched_via: s.matched_via })
          break
        }
      }
    }
    return out
  }, [busTopics, proxyId])

  return (
    <div className="rounded border border-slate-800 bg-slate-950/40">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between px-2 py-1.5 text-[10px] uppercase tracking-wider text-slate-400 hover:text-slate-200"
      >
        <span>topics</span>
        <span className="font-mono text-slate-500">
          {topology?.publishes.length ?? 0} pub · {subscribed.length} sub  {collapsed ? '▸' : '▾'}
        </span>
      </button>
      {!collapsed && (
        <div className="space-y-3 px-2 pb-2">
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-emerald-500">publishes</div>
            {(topology?.publishes ?? []).length === 0 && (
              <div className="text-[11px] text-slate-500">
                {topology === null
                  ? 'loading…'
                  : 'No declared publishes. Add @service_method(publishes=[…]) or a class-level publishes attr to surface here.'}
              </div>
            )}
            {(topology?.publishes ?? []).map((p, idx) => (
              <div key={`${p.topic}-${idx}`} className="font-mono text-[11px] text-slate-200">
                <span className="text-slate-400">·</span> {p.topic}
                {p.method && (
                  <span className="ml-1 text-slate-500">from {p.method}()</span>
                )}
                {p.retained && <span className="ml-1 text-amber-500">retained</span>}
              </div>
            ))}
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-sky-500">subscribes</div>
            {subscribed.length === 0 && (
              <div className="text-[11px] text-slate-500">
                Service has no live subscriptions on the bus right now.
              </div>
            )}
            {subscribed.map((s, idx) => (
              <div key={`${s.topic}-${idx}`} className="font-mono text-[11px] text-slate-200">
                <span className="text-slate-400">·</span> {s.topic}
                {s.matched_via && s.matched_via !== 'exact' && (
                  <span className="ml-1 text-slate-500">via {s.matched_via}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ActionButton({
  label,
  onClick,
  disabled,
  tone,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  tone: 'primary' | 'secondary' | 'danger'
}) {
  const base =
    tone === 'primary'
      ? 'bg-emerald-600 text-white hover:bg-emerald-500'
      : tone === 'danger'
        ? 'border border-rose-800 text-rose-300 hover:border-rose-600'
        : 'border border-slate-700 text-slate-200 hover:border-slate-500'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-2.5 py-1 text-xs font-medium ${base} disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {label}
    </button>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="font-mono text-slate-200">{value}</dd>
    </div>
  )
}

interface SaveSubsetDialogProps {
  name: string
  onNameChange: (next: string) => void
  onCancel: () => void
  onConfirm: (event?: FormEvent) => void
  saving: boolean
  error: string | null
  selectedCount: number
  totalCount: number
}

function SaveSubsetDialog({
  name, onNameChange, onCancel, onConfirm, saving, error, selectedCount, totalCount,
}: SaveSubsetDialogProps) {
  const using = selectedCount > 0 ? selectedCount : totalCount
  const sourceLabel = selectedCount > 0 ? 'selected services' : 'every service on the canvas'
  const canSubmit = name.trim().length > 0 && using > 0 && !saving
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <form
        onSubmit={onConfirm}
        className="w-full max-w-md space-y-4 rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-2xl"
      >
        <header>
          <h2 className="text-base font-semibold text-slate-100">Save subset as workspace</h2>
          <p className="mt-1 text-xs text-slate-400">
            Captures the {sourceLabel} ({using} {using === 1 ? 'node' : 'nodes'}) plus their
            positions and the edges between them. The new workspace can be opened
            later to restore this layout — services keep running in the meantime.
          </p>
        </header>

        <label className="block">
          <span className="text-xs uppercase tracking-wider text-slate-400">Workspace name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="my-grouping"
            autoFocus
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
          />
        </label>

        {error && (
          <div className="rounded border border-rose-700 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        )}

        <footer className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:border-slate-500 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </form>
    </div>
  )
}
