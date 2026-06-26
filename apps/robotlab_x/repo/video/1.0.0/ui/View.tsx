import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ServiceProxy } from '@rlx/ui'
import { type InboundFrame } from '@rlx/ui'
import { useWsClient } from '@rlx/ui'
import { useActiveRuntime } from '@rlx/ui'

// VideoFullView — capture status + MJPEG preview + reconnect controls
// + single-frame snapshot trigger.
//
// State comes from /video/<id>/state (retained). The MJPEG <img> points
// at the active runtime's /v1/stream/<stream_id>/mjpeg with the user's
// access token as a query param (the <img> tag can't send Authorization
// headers). Stream id convention: ``video/<proxy_id>``.

interface VideoState {
  connected?: boolean
  source?: string | null
  resolution?: [number, number] | null
  declared_fps?: number | null
  observed_fps?: number
  dropped?: number
  error?: string | null
}

interface SnapshotPayload {
  request_id?: string | null
  ts?: number
  resolution?: [number, number]
  jpeg_b64?: string
  error?: string | null
}

interface ParamSchema {
  name: string
  // Scalar + spatial. point/rect/points are arrays in image-pixel
  // coords; the UI renders an overlay-picker for them instead of
  // sliders. ``string`` is a free-form single-line text input
  // (used for things like custom file paths, comma-lists, etc).
  type: 'int' | 'float' | 'bool' | 'enum' | 'string' | 'point' | 'rect' | 'points'
  default: number | boolean | string | number[] | number[][]
  min?: number
  max?: number
  step?: number
  choices?: string[]
  label?: string
  help?: string
  placeholder?: string
}

/** Descriptor of what the user is currently picking, used to drive the
 * MJPEG-overlay capture surface in VideoFullView. ``null`` = no
 * picking in progress; the overlay stays hidden + pointer events fall
 * through to ReactFlow's drag handler as usual. */
interface PickingRequest {
  filterId: string
  paramName: string
  type: 'point' | 'rect' | 'points'
  // Current accumulated value — for ``points`` we keep adding; for
  // ``point`` and ``rect`` we replace on each click/drag.
  value: number[] | number[][]
}

interface CatalogEntry {
  type: string
  title: string
  description: string
  publishes_telemetry: boolean
  param_schema: ParamSchema[]
  // Backend (Phase E.4) attaches a JSON Schema describing the telemetry
  // payload for every filter where ``publishes_telemetry === true``.
  // Effect filters carry ``null`` here; older backends may omit the
  // field entirely.
  telemetry_schema?: Record<string, unknown> | null
}

interface FilterSpec {
  id: string
  type: string
  enabled: boolean
  params: Record<string, unknown>
  // Discovery enrichment populated by the video service when it
  // publishes /<id>/filters — see _publish_filters in video_service.
  // Older backends won't send these; UI falls back to deriving the
  // telemetry topic from the catalog + filter id.
  title?: string
  publishes_telemetry?: boolean
  telemetry_topic?: string
}


export default function VideoFullView({ proxy }: { proxy: ServiceProxy }) {
  const wsClient = useWsClient()
  const { connection } = useActiveRuntime()
  const proxyId = proxy.id ?? proxy.name ?? ''
  const stateTopic = `/video/${proxyId}/state`
  const streamId = `video/${proxyId}`

  const [state, setState] = useState<VideoState>({})
  const [sourceDraft, setSourceDraft] = useState<string>('')
  // bumping reloadTick forces the <img> to drop+reconnect (browsers
  // sometimes wedge MJPEG streams after a network hiccup).
  const [reloadTick, setReloadTick] = useState(0)
  // ── picking system ────────────────────────────────────────────────
  // A FilterPipeline param of type point/rect/points calls into here
  // to ask the user for spatial input. We render an overlay over the
  // MJPEG <img> that captures clicks, translates them to image-pixel
  // coords (using <img>.naturalWidth/Height), and pushes the updated
  // param back to the filter via the standard update_filter action.
  const [picking, setPicking] = useState<PickingRequest | null>(null)
  // For type='rect': while the user is dragging, hold the in-progress
  // bbox in image-pixel coords. Cleared on mouseup (committed to
  // picking.value) or mouseleave (cancelled).
  const [rectDraft, setRectDraft] = useState<number[] | null>(null)
  const mjpegImgRef = useRef<HTMLImageElement | null>(null)
  // Snapshot modal state. ``snapshotOpen`` controls visibility; the
  // payload is set after the matching response arrives (or an error
  // surfaces). ``pendingRequestId`` is the request_id we're waiting on
  // — held in a ref so the WS handler's closure sees the latest value
  // without re-subscribing.
  const [snapshotOpen, setSnapshotOpen] = useState(false)
  const [snapshotPayload, setSnapshotPayload] = useState<SnapshotPayload | null>(null)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [snapshotPending, setSnapshotPending] = useState(false)
  const pendingRequestIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!proxyId) return
    const off = wsClient.subscribe(stateTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const p = f.payload
      if (!p || typeof p !== 'object') return
      setState(p as VideoState)
    })
    return off
  }, [proxyId, stateTopic, wsClient])

  // Seed the source-draft input from authoritative state once it
  // arrives, but don't fight the user mid-edit.
  useEffect(() => {
    if (sourceDraft === '' && state.source) setSourceDraft(state.source)
  }, [state.source, sourceDraft])

  // Build the MJPEG URL. Origin = the active runtime's base URL (so
  // federation works — when the user is on the funny-droid chip, the
  // image fetches from funny-droid.local:8999). Auth token comes from
  // the connection's effective access token.
  const mjpegUrl = useMemo(() => {
    if (!connection) return null
    const token = connection.getAccessToken()
    if (!token) return null
    // reloadTick is in the URL so changing it actually forces a refetch
    // — browsers dedupe identical <img src> assignments.
    return `${connection.url}/v1/stream/${encodeURIComponent(streamId)}/mjpeg?token=${encodeURIComponent(token)}&_=${reloadTick}`
  }, [connection, streamId, reloadTick])

  const sendAction = useCallback(
    (action: string, args: Record<string, unknown> = {}) => {
      wsClient.publish(`/video/${proxyId}/control`, { action, ...args })
    },
    [wsClient, proxyId],
  )

  const onConnect = useCallback((e?: FormEvent) => {
    e?.preventDefault()
    const src = sourceDraft.trim()
    sendAction('connect', src ? { source: src } : {})
    setReloadTick((t) => t + 1)
  }, [sourceDraft, sendAction])

  const onDisconnect = useCallback(() => {
    sendAction('disconnect')
  }, [sendAction])

  // ── snapshot trigger ──────────────────────────────────────────────
  // Subscribe-once pattern: open modal in pending state, subscribe to
  // /snapshot, send the control with a fresh request_id, wait for the
  // matching payload (or 5s timeout), then render. Unsubscribe + clean
  // up regardless of success/failure.
  const onSnapshot = useCallback(() => {
    if (snapshotPending) return
    const requestId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `snap-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    pendingRequestIdRef.current = requestId
    setSnapshotOpen(true)
    setSnapshotPending(true)
    setSnapshotPayload(null)
    setSnapshotError(null)

    const off = wsClient.subscribe(`/video/${proxyId}/snapshot`, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const p = f.payload as SnapshotPayload | undefined
      if (!p || typeof p !== 'object') return
      // Match by request_id so concurrent triggers from other clients
      // don't bleed into this modal.
      if (p.request_id !== pendingRequestIdRef.current) return
      off()
      window.clearTimeout(timeoutId)
      pendingRequestIdRef.current = null
      setSnapshotPending(false)
      if (p.error) {
        setSnapshotError(p.error)
      } else {
        setSnapshotPayload(p)
      }
    })

    const timeoutId = window.setTimeout(() => {
      if (pendingRequestIdRef.current !== requestId) return
      off()
      pendingRequestIdRef.current = null
      setSnapshotPending(false)
      setSnapshotError('snapshot timed out — no response from video service in 5s')
    }, 5000)

    sendAction('snapshot', { request_id: requestId })
  }, [snapshotPending, wsClient, proxyId, sendAction])

  const closeSnapshotModal = useCallback(() => {
    setSnapshotOpen(false)
    setSnapshotPayload(null)
    setSnapshotError(null)
    pendingRequestIdRef.current = null
  }, [])

  // ── pick-overlay control ──────────────────────────────────────────
  /** Called from a filter's param input. Starts a picking session over
   * the MJPEG preview. ``currentValue`` seeds the overlay so previously-
   * picked points stay visible while the user adds more. */
  const startPicking = useCallback(
    (filterId: string, paramName: string, type: 'point' | 'rect' | 'points', currentValue: number[] | number[][]) => {
      setPicking({ filterId, paramName, type, value: currentValue ?? [] })
    },
    [],
  )
  /** Translate a browser pointer event into image-pixel coords using
   * the <img>'s natural dimensions. Returns null if the cursor is
   * outside the image bounds or the image hasn't loaded yet. */
  const eventToImagePoint = useCallback((e: { clientX: number; clientY: number }): [number, number] | null => {
    const img = mjpegImgRef.current
    if (!img || !img.naturalWidth || !img.naturalHeight) return null
    const rect = img.getBoundingClientRect()
    const offsetX = e.clientX - rect.left
    const offsetY = e.clientY - rect.top
    if (offsetX < 0 || offsetY < 0 || offsetX > rect.width || offsetY > rect.height) return null
    return [
      Math.round((offsetX / rect.width) * img.naturalWidth),
      Math.round((offsetY / rect.height) * img.naturalHeight),
    ]
  }, [])

  const publishParam = useCallback((req: PickingRequest, value: number[] | number[][]) => {
    wsClient.publish(`/video/${proxyId}/control`, {
      action: 'update_filter',
      id: req.filterId,
      params: { [req.paramName]: value },
    })
  }, [wsClient, proxyId])

  /** Pointer-down on the overlay. For point/points this commits immediately
   * (matching the prior click behaviour); for rect it starts a drag. */
  const onOverlayMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!picking) return
    const p = eventToImagePoint(e)
    if (!p) return
    if (picking.type === 'point') {
      const next: number[] = p
      setPicking({ ...picking, value: next })
      publishParam(picking, next)
    } else if (picking.type === 'points') {
      const cur = (picking.value as number[][]) ?? []
      const next: number[][] = [...cur, p]
      setPicking({ ...picking, value: next })
      publishParam(picking, next)
    } else if (picking.type === 'rect') {
      // Start drag — record the anchor as a 0-size rect; mousemove
      // updates the opposite corner; mouseup normalizes + commits.
      setRectDraft([p[0], p[1], 0, 0])
    }
  }, [picking, eventToImagePoint, publishParam])

  /** Pointer-move — only matters for rect drags. Re-anchors the draft
   * so the overlay draws an updated preview box. Does NOT publish on
   * every move (would flood the bus + the filter would re-init the
   * tracker on every frame). */
  const onOverlayMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!picking || picking.type !== 'rect' || !rectDraft) return
    const p = eventToImagePoint(e)
    if (!p) return
    const [x0, y0] = [rectDraft[0], rectDraft[1]]
    setRectDraft([x0, y0, p[0] - x0, p[1] - y0])
  }, [picking, rectDraft, eventToImagePoint])

  /** Pointer-up. For rect drags this normalizes the draft (negative
   * width/height from dragging right-to-left or bottom-to-top), commits
   * to the picking value, and publishes a single update_filter. */
  const onOverlayMouseUp = useCallback(() => {
    if (!picking) return
    if (picking.type === 'rect' && rectDraft) {
      let [x, y, w, h] = rectDraft
      if (w < 0) { x = x + w; w = -w }
      if (h < 0) { y = y + h; h = -h }
      setRectDraft(null)
      // Reject sub-2px drags — almost certainly an accidental click
      // rather than a real ROI; preserve any prior value.
      if (w < 2 || h < 2) return
      const next: number[] = [x, y, w, h]
      setPicking({ ...picking, value: next })
      publishParam(picking, next)
    }
  }, [picking, rectDraft, publishParam])

  /** Pointer-leave cancels an in-progress rect drag. The committed
   * value (if any) stays. */
  const onOverlayMouseLeave = useCallback(() => {
    if (rectDraft) setRectDraft(null)
  }, [rectDraft])

  const stopPicking = useCallback(() => {
    setRectDraft(null)
    setPicking(null)
  }, [])

  const clearPickedValue = useCallback(() => {
    if (!picking) return
    const empty: number[] | number[][] = picking.type === 'points' ? [] : []
    setRectDraft(null)
    setPicking({ ...picking, value: empty })
    publishParam(picking, empty)
  }, [picking, publishParam])

  const downloadSnapshot = useCallback(() => {
    if (!snapshotPayload?.jpeg_b64) return
    const a = document.createElement('a')
    a.href = `data:image/jpeg;base64,${snapshotPayload.jpeg_b64}`
    const ts = snapshotPayload.ts ? new Date(snapshotPayload.ts * 1000).toISOString().replace(/[:.]/g, '-') : Date.now()
    a.download = `${proxyId}-${ts}.jpg`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }, [snapshotPayload, proxyId])

  const connected = state.connected === true
  const resLabel = state.resolution ? `${state.resolution[0]}×${state.resolution[1]}` : '—'

  return (
    <div className="flex min-w-[420px] flex-col gap-3 p-3 text-xs">
      {/* ── MJPEG preview ──────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded border border-slate-800 bg-black">
        {mjpegUrl && connected ? (
          <img
            ref={mjpegImgRef}
            key={reloadTick}
            src={mjpegUrl}
            alt={`stream ${streamId}`}
            className="block h-auto w-full"
            draggable={false}
            onError={() => {
              window.setTimeout(() => setReloadTick((t) => t + 1), 1500)
            }}
          />
        ) : (
          <div className="flex aspect-video items-center justify-center text-slate-500">
            {state.error ? (
              <span className="font-mono text-rose-400">{state.error}</span>
            ) : connected ? (
              'connecting to stream…'
            ) : (
              'disconnected'
            )}
          </div>
        )}
        {picking && (
          <PickOverlay
            picking={picking}
            rectDraft={rectDraft}
            mjpegImgRef={mjpegImgRef}
            onMouseDown={onOverlayMouseDown}
            onMouseMove={onOverlayMouseMove}
            onMouseUp={onOverlayMouseUp}
            onMouseLeave={onOverlayMouseLeave}
            onClear={clearPickedValue}
            onDone={stopPicking}
          />
        )}
      </section>

      {/* ── metadata row ──────────────────────────────────────────── */}
      <section className="grid grid-cols-3 gap-x-3 gap-y-1 rounded border border-slate-800 bg-slate-900/40 p-2 font-mono text-[10px] text-slate-400">
        <Cell label="source" value={state.source ?? '—'} />
        <Cell label="resolution" value={resLabel} />
        <Cell label="fps" value={state.observed_fps != null ? state.observed_fps.toFixed(1) : '—'} />
        <Cell label="declared fps" value={state.declared_fps != null ? state.declared_fps.toFixed(1) : '—'} />
        <Cell label="dropped" value={state.dropped?.toString() ?? '0'} />
        <Cell label="status" value={connected ? 'connected' : 'idle'} tone={connected ? 'emerald' : 'slate'} />
      </section>

      {/* ── topics / introspection ─────────────────────────────────── */}
      <ServiceTopics proxyId={proxyId} typeName="video" />

      {/* ── controls ──────────────────────────────────────────────── */}
      <section className="rounded border border-slate-800 bg-slate-900/40 p-2">
        <form onSubmit={onConnect} className="flex items-end gap-2">
          <label className="flex flex-1 flex-col">
            <span className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">source</span>
            <input
              type="text"
              value={sourceDraft}
              onChange={(e) => setSourceDraft(e.target.value)}
              placeholder="0 (device), file path, or rtsp://…"
              className="nodrag nopan w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] focus:border-slate-500 focus:outline-none"
              onPointerDown={(e) => e.stopPropagation()}
            />
          </label>
          <button
            type="submit"
            onPointerDown={(e) => e.stopPropagation()}
            className="nodrag nopan rounded bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-500"
          >
            Connect
          </button>
          <button
            type="button"
            onClick={onDisconnect}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={!connected}
            className="nodrag nopan rounded border border-slate-700 px-2 py-1 text-[11px] hover:border-slate-500 disabled:opacity-40"
          >
            Disconnect
          </button>
          <button
            type="button"
            onClick={onSnapshot}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={!connected || snapshotPending}
            title="Capture a single frame + publish on /video/<id>/snapshot"
            className="nodrag nopan rounded border border-sky-700 bg-sky-900/40 px-2 py-1 text-[11px] text-sky-200 hover:border-sky-500 disabled:opacity-40"
          >
            {snapshotPending ? '…' : 'Snapshot'}
          </button>
        </form>
        <div className="mt-1.5 text-[10px] text-slate-500">
          Source: <code className="font-mono">0</code> = first webcam · file path · <code className="font-mono">rtsp://…</code>
        </div>
      </section>

      <FilterPipeline
        proxyId={proxyId}
        onStartPick={startPicking}
        pickingFilterId={picking?.filterId ?? null}
      />

      {snapshotOpen && (
        <SnapshotPanel
          proxyId={proxyId}
          pending={snapshotPending}
          payload={snapshotPayload}
          error={snapshotError}
          onClose={closeSnapshotModal}
          onDownload={downloadSnapshot}
          onRetake={onSnapshot}
        />
      )}
    </div>
  )
}


/** Floating, draggable panel showing one snapshot. No backdrop — other
 * UI stays interactive while the panel is open. Drag from the header
 * bar to reposition. Position is local to the panel (not persisted)
 * — re-opening defaults to top-right of the viewport. */
function SnapshotPanel({
  proxyId, pending, payload, error, onClose, onDownload, onRetake,
}: {
  proxyId: string
  pending: boolean
  payload: SnapshotPayload | null
  error: string | null
  onClose: () => void
  onDownload: () => void
  onRetake: () => void
}) {
  const dataUrl = payload?.jpeg_b64 ? `data:image/jpeg;base64,${payload.jpeg_b64}` : null
  const tsLabel = payload?.ts ? new Date(payload.ts * 1000).toLocaleString() : null
  const resLabel = payload?.resolution ? `${payload.resolution[0]}×${payload.resolution[1]}` : null

  // Default to a corner that doesn't overlap the typical canvas view —
  // top-right with some margin from the page edge.
  const [pos, setPos] = useState(() => ({
    x: typeof window !== 'undefined' ? Math.max(window.innerWidth - 440, 20) : 80,
    y: 80,
  }))
  // Drag state — held in a ref so the move/up listeners installed
  // inside the effect see the current pointer offset without restarting
  // the effect on every position update.
  const dragRef = useRef<{ dragging: boolean; offX: number; offY: number }>({
    dragging: false, offX: 0, offY: 0,
  })

  // Install window-level pointer listeners while a drag is active so
  // the panel keeps moving even when the cursor slips off the header.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current.dragging) return
      setPos({
        x: e.clientX - dragRef.current.offX,
        y: e.clientY - dragRef.current.offY,
      })
    }
    const onUp = () => { dragRef.current.dragging = false }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  const onHeaderPointerDown = useCallback((e: React.PointerEvent) => {
    // Only left-button drag; right-click + middle-click shouldn't move
    // the panel.
    if (e.button !== 0) return
    dragRef.current = {
      dragging: true,
      offX: e.clientX - pos.x,
      offY: e.clientY - pos.y,
    }
  }, [pos.x, pos.y])

  // Render into a portal anchored at <body>. Without the portal the
  // panel mounts inside the ReactFlow node DOM, where ancestor
  // ``transform: translate(…)`` (how RF positions nodes) re-anchors
  // ``position: fixed`` to the transformed container instead of the
  // viewport. That'd put the panel off-screen / clipped — looks like
  // a flicker that immediately vanishes.
  return createPortal(
    <div
      // Fixed-position floating window. No bg overlay so the user can
      // keep using the canvas behind it.
      className="fixed z-50 flex max-h-[80vh] w-[420px] flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 text-sm text-slate-200 shadow-2xl"
      style={{ left: pos.x, top: pos.y }}
      // Stop ReactFlow / canvas drag handlers from grabbing pointer events
      // that originate inside the panel.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <header
        onPointerDown={onHeaderPointerDown}
        className="flex cursor-move select-none items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 px-3 py-1.5"
      >
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">snapshot from</span>
          <span className="truncate font-mono text-sm text-fuchsia-300" title={proxyId}>
            {proxyId}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-slate-400 hover:text-slate-200"
          title="Close"
        >
          ×
        </button>
      </header>
      <div className="flex-1 overflow-auto bg-black">
        {pending && (
          <div className="flex aspect-video items-center justify-center text-[11px] text-slate-500">
            capturing…
          </div>
        )}
        {!pending && error && (
          <div className="flex aspect-video items-center justify-center px-4 text-center font-mono text-[11px] text-rose-300">
            {error}
          </div>
        )}
        {!pending && !error && dataUrl && (
          <img
            src={dataUrl}
            alt={`snapshot from ${proxyId}`}
            className="block w-full"
            draggable={false}
          />
        )}
      </div>
      <footer className="flex items-center gap-2 border-t border-slate-800 px-3 py-1.5 text-[10px] text-slate-400">
        <span className="truncate font-mono">
          {tsLabel ?? '—'}{resLabel ? ` · ${resLabel}` : ''}
        </span>
        <div className="ml-auto flex gap-1.5">
          <button
            type="button"
            onClick={onRetake}
            disabled={pending}
            className="rounded border border-slate-700 px-2 py-0.5 text-[10px] hover:border-slate-500 disabled:opacity-40"
          >
            Retake
          </button>
          <button
            type="button"
            onClick={onDownload}
            disabled={!dataUrl}
            className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            Download
          </button>
        </div>
      </footer>
    </div>,
    document.body,
  )
}


function Cell({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'slate' }) {
  const valColor = tone === 'emerald' ? 'text-emerald-300' : 'text-slate-200'
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-slate-500">{label}</span>
      <span className={`truncate ${valColor}`} title={value}>{value}</span>
    </div>
  )
}


/** FilterPipeline — the editable list of filters running on the
 * camera. Reads the catalog (filter types + param schemas) + the
 * persisted pipeline (filters topic) from the bus, lets the user
 * add/remove/configure entries.
 *
 * Wire summary (all under ``/video/<proxyId>/...``):
 *   filter_catalog       (retained) — list of available filter types
 *   filters              (retained) — current pipeline (ordered specs)
 *   filter/<filter_id>   (retained) — per-filter telemetry (motion etc.)
 *   control              (send)     — add_filter / remove_filter /
 *                                     update_filter / set_filters
 */
function FilterPipeline({
  proxyId, onStartPick, pickingFilterId,
}: {
  proxyId: string
  onStartPick: (filterId: string, paramName: string, type: 'point' | 'rect' | 'points', currentValue: number[] | number[][]) => void
  pickingFilterId: string | null
}) {
  const wsClient = useWsClient()
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [filters, setFilters] = useState<FilterSpec[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  // Subscribe catalog + filters (both retained — initial value lands
  // immediately on the subscribe ack).
  useEffect(() => {
    const offCat = wsClient.subscribe(`/video/${proxyId}/filter_catalog`, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const p = f.payload as { filters?: CatalogEntry[] } | undefined
      if (p && Array.isArray(p.filters)) setCatalog(p.filters)
    })
    const offFil = wsClient.subscribe(`/video/${proxyId}/filters`, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const p = f.payload as { filters?: FilterSpec[] } | undefined
      if (p && Array.isArray(p.filters)) setFilters(p.filters)
    })
    return () => { offCat(); offFil() }
  }, [proxyId, wsClient])

  const sendControl = useCallback(
    (action: string, args: Record<string, unknown> = {}) => {
      wsClient.publish(`/video/${proxyId}/control`, { action, ...args })
    },
    [wsClient, proxyId],
  )

  const onAdd = useCallback((type: string) => {
    const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    sendControl('add_filter', { type, id })
    setExpandedId(id)
    setAddOpen(false)
  }, [sendControl])

  const onRemove = useCallback((id: string) => {
    if (expandedId === id) setExpandedId(null)
    sendControl('remove_filter', { id })
  }, [sendControl, expandedId])

  const onUpdate = useCallback((id: string, patch: { params?: Record<string, unknown>; enabled?: boolean }) => {
    sendControl('update_filter', { id, ...patch })
  }, [sendControl])

  const onReorder = useCallback((id: string, dir: -1 | 1) => {
    const idx = filters.findIndex((f) => f.id === id)
    const next = idx + dir
    if (idx < 0 || next < 0 || next >= filters.length) return
    const ids = filters.map((f) => f.id)
    ;[ids[idx], ids[next]] = [ids[next], ids[idx]]
    sendControl('reorder_filters', { ids })
  }, [filters, sendControl])

  const catalogByType = useMemo(
    () => new Map(catalog.map((c) => [c.type, c])),
    [catalog],
  )

  return (
    <section className="rounded border border-slate-800 bg-slate-900/40">
      <header className="flex items-center justify-between border-b border-slate-800 px-3 py-1.5">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-400">Filters</h3>
          <span className="font-mono text-[10px] text-slate-500">{filters.length}</span>
        </div>
        <AddFilterMenu
          catalog={catalog}
          open={addOpen}
          onToggle={() => setAddOpen((v) => !v)}
          onClose={() => setAddOpen(false)}
          onPick={onAdd}
        />
      </header>
      {filters.length === 0 ? (
        <div className="px-3 py-3 text-center text-[10px] text-slate-500">
          No filters. The camera frame passes through unchanged.
        </div>
      ) : (
        <ul className="divide-y divide-slate-800">
          {filters.map((spec, idx) => {
            const cat = catalogByType.get(spec.type)
            return (
              <FilterCard
                key={spec.id}
                index={idx + 1}
                spec={spec}
                catalog={cat ?? null}
                expanded={expandedId === spec.id}
                isFirst={idx === 0}
                isLast={idx === filters.length - 1}
                isPicking={pickingFilterId === spec.id}
                onToggleExpand={() => setExpandedId(expandedId === spec.id ? null : spec.id)}
                onRemove={() => onRemove(spec.id)}
                onUpdate={(patch) => onUpdate(spec.id, patch)}
                onMove={(dir) => onReorder(spec.id, dir)}
                onStartPick={onStartPick}
                proxyId={proxyId}
              />
            )
          })}
        </ul>
      )}
    </section>
  )
}


/** AddFilterMenu — modal dialog with search + scrollable filter list.
 *
 * Was a portal'd dropdown anchored to the + Add button; that grew
 * unwieldy as the catalog crossed ~12 entries (YOLO + future
 * additions). A centred dialog with a search box scales better:
 *
 *  * Auto-focused search input narrows by title / description /
 *    type-name (case-insensitive). Empty query shows everything.
 *  * The list is itself scrollable so the dialog stays a fixed
 *    size regardless of catalog growth.
 *  * Enter on a single result picks it; Escape / backdrop click
 *    closes; arrow-key navigation between results.
 *  * Button is NEVER disabled. With an empty catalog the dialog
 *    still opens and tells the operator the service isn't
 *    publishing one — clicks always produce feedback.
 */
function AddFilterMenu({
  catalog, open, onToggle, onClose, onPick,
}: {
  catalog: CatalogEntry[]
  open: boolean
  onToggle: () => void
  onClose: () => void
  onPick: (type: string) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  // Reset search + cursor whenever the dialog opens — last session's
  // query shouldn't leak in when the operator clicks + Add again.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    // Focus the input after the dialog has mounted — a microtask
    // delay avoids the focus landing before the input is attached.
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  // Escape closes — matches every other dialog in the app.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return catalog
    return catalog.filter((c) =>
      c.type.toLowerCase().includes(q)
      || (c.title || '').toLowerCase().includes(q)
      || (c.description || '').toLowerCase().includes(q),
    )
  }, [catalog, query])

  // Clamp the active cursor whenever the result set changes — so
  // typing past the current row doesn't leave us pointing at a
  // filtered-out entry.
  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(Math.max(0, filtered.length - 1))
  }, [filtered.length, activeIndex])

  const onInputKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(filtered.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const c = filtered[activeIndex]
      if (c) onPick(c.type)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggle() }}
        onPointerDown={(e) => e.stopPropagation()}
        className="nodrag nopan rounded border border-emerald-700 bg-emerald-900/40 px-2 py-0.5 text-[10px] text-emerald-200 hover:border-emerald-500"
      >
        + Add ▾
      </button>
      {open && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/80 p-4 pt-20"
          onClick={onClose}
          onPointerDown={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="flex w-full max-w-md flex-col rounded-lg border border-slate-700 bg-slate-900 text-sm text-slate-200 shadow-2xl"
            style={{ maxHeight: 'min(70vh, 560px)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
              <h3 className="text-[13px] font-semibold text-slate-100">Add filter</h3>
              <button
                type="button"
                onClick={onClose}
                className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
                title="Close (Esc)"
              >
                ✕
              </button>
            </header>
            <div className="border-b border-slate-800 px-4 py-2">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActiveIndex(0) }}
                onKeyDown={onInputKey}
                onPointerDown={(e) => e.stopPropagation()}
                placeholder="Search filters…"
                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[12px] placeholder:text-slate-600 focus:border-slate-500 focus:outline-none"
              />
              <div className="mt-1 text-[10px] text-slate-500">
                {catalog.length === 0
                  ? 'No catalog yet — is the video service running and connected?'
                  : `${filtered.length} of ${catalog.length} filter${catalog.length === 1 ? '' : 's'}`}
                {catalog.length > 0 && (
                  <span className="ml-2 text-slate-600">↑↓ navigate · Enter add · Esc close</span>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="px-4 py-6 text-center text-[11px] text-slate-500">
                  {catalog.length === 0 ? 'waiting for filter catalog…' : 'no matches'}
                </div>
              ) : (
                filtered.map((c, i) => {
                  const active = i === activeIndex
                  return (
                    <button
                      key={c.type}
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onPick(c.type) }}
                      onMouseEnter={() => setActiveIndex(i)}
                      className={`block w-full border-b border-slate-800 px-4 py-2 text-left last:border-b-0 ${
                        active ? 'bg-slate-800' : 'hover:bg-slate-800/60'
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[12px] font-medium text-slate-200">{c.title}</span>
                        <span className="shrink-0 font-mono text-[10px] text-slate-500">{c.type}</span>
                      </div>
                      {c.description && (
                        <div className="mt-0.5 text-[10px] leading-snug text-slate-500">
                          {c.description}
                        </div>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}


function FilterCard({
  index, spec, catalog, expanded, isFirst, isLast, isPicking,
  onToggleExpand, onRemove, onUpdate, onMove, onStartPick, proxyId,
}: {
  index: number
  spec: FilterSpec
  catalog: CatalogEntry | null
  expanded: boolean
  isFirst: boolean
  isLast: boolean
  isPicking: boolean
  onToggleExpand: () => void
  onRemove: () => void
  onUpdate: (patch: { params?: Record<string, unknown>; enabled?: boolean }) => void
  onMove: (dir: -1 | 1) => void
  onStartPick: (filterId: string, paramName: string, type: 'point' | 'rect' | 'points', currentValue: number[] | number[][]) => void
  proxyId: string
}) {
  const title = catalog?.title ?? spec.type
  // Subscribe to the filter's telemetry topic just to extract the
  // (optional) ``status`` field — used by long-loading filters like
  // ``yolo`` to surface "loading new model" feedback right in the
  // card header without expanding the panel. Filters that don't
  // publish a ``status`` simply don't render the chip. The full
  // payload renders independently inside <FilterTelemetry/>.
  const wsClient = useWsClient()
  const [status, setStatus] = useState<{ status: string; message: string } | null>(null)
  const telemetryTopic = spec.telemetry_topic
    ?? (catalog?.publishes_telemetry ? `/video/${proxyId}/filter/${spec.id}` : null)
  useEffect(() => {
    if (!telemetryTopic) return
    const off = wsClient.subscribe(telemetryTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const p = (f.payload ?? null) as { status?: unknown; status_message?: unknown } | null
      if (!p || typeof p !== 'object') { setStatus(null); return }
      const s = typeof p.status === 'string' ? p.status : ''
      if (!s) { setStatus(null); return }
      setStatus({
        status: s,
        message: typeof p.status_message === 'string' ? p.status_message : '',
      })
    })
    return off
  }, [telemetryTopic, wsClient])
  // Only render the chip while the filter is signalling something
  // non-steady — "ready" produces no clutter on the card.
  const statusChip = status && status.status !== 'ready' ? (
    <span
      className={`nodrag nopan rounded px-1.5 py-0.5 text-[9px] font-medium ${
        status.status === 'loading'
          ? 'bg-amber-900/60 text-amber-200'
          : status.status === 'error'
            ? 'bg-rose-900/60 text-rose-200'
            : 'bg-slate-800 text-slate-300'
      }`}
      title={status.message || status.status}
    >
      {status.status === 'loading' ? 'loading…' : status.status}
    </span>
  ) : null
  return (
    <li className="text-[11px]">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <span className="w-4 text-center font-mono text-[10px] text-slate-500">{index}</span>
        <div className="flex flex-col">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMove(-1) }}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={isFirst}
            className="nodrag nopan text-[8px] leading-none text-slate-500 hover:text-slate-300 disabled:opacity-30"
            title="Move up"
          >▲</button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMove(1) }}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={isLast}
            className="nodrag nopan text-[8px] leading-none text-slate-500 hover:text-slate-300 disabled:opacity-30"
            title="Move down"
          >▼</button>
        </div>
        <button
          type="button"
          onClick={onToggleExpand}
          onPointerDown={(e) => e.stopPropagation()}
          className="nodrag nopan flex flex-1 items-baseline gap-2 text-left"
        >
          <span className="font-medium text-slate-200">{title}</span>
          <span className="font-mono text-[10px] text-slate-500">{spec.type}</span>
          <span className="ml-auto text-slate-500">{expanded ? '▾' : '▸'}</span>
        </button>
        {statusChip}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onUpdate({ enabled: !spec.enabled }) }}
          onPointerDown={(e) => e.stopPropagation()}
          title={spec.enabled ? 'Disable' : 'Enable'}
          className={`nodrag nopan rounded px-1.5 py-0.5 text-[9px] ${
            spec.enabled
              ? 'bg-emerald-900/60 text-emerald-200 hover:bg-emerald-800'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
          }`}
        >
          {spec.enabled ? 'ON' : 'OFF'}
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          onPointerDown={(e) => e.stopPropagation()}
          title="Remove"
          className="nodrag nopan rounded px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-rose-900/40 hover:text-rose-300"
        >
          ✕
        </button>
      </div>
      {expanded && (
        <div className="space-y-2 border-t border-slate-800 bg-slate-950/40 px-3 py-2">
          {catalog ? (
            <ParamPanel
              schema={catalog.param_schema}
              values={spec.params}
              filterId={spec.id}
              isPicking={isPicking}
              onChange={(params) => onUpdate({ params })}
              onStartPick={onStartPick}
            />
          ) : (
            <div className="font-mono text-[10px] text-rose-300">
              unknown filter type — not in catalog
            </div>
          )}
          {catalog?.publishes_telemetry && (
            <FilterTelemetry
              proxyId={proxyId}
              filterId={spec.id}
              topicOverride={spec.telemetry_topic}
              telemetrySchema={catalog?.telemetry_schema ?? null}
            />
          )}
        </div>
      )}
    </li>
  )
}


function ParamPanel({
  schema, values, filterId, isPicking, onChange, onStartPick,
}: {
  schema: ParamSchema[]
  values: Record<string, unknown>
  filterId: string
  isPicking: boolean
  onChange: (params: Record<string, unknown>) => void
  onStartPick: (filterId: string, paramName: string, type: 'point' | 'rect' | 'points', currentValue: number[] | number[][]) => void
}) {
  if (schema.length === 0) {
    return <div className="text-[10px] text-slate-500">no parameters</div>
  }
  const patch = (name: string, v: unknown) => {
    onChange({ ...values, [name]: v })
  }
  return (
    <div className="space-y-1.5">
      {schema.map((p) => (
        <ParamInput
          key={p.name}
          schema={p}
          value={values[p.name]}
          filterId={filterId}
          isPicking={isPicking}
          onChange={(v) => patch(p.name, v)}
          onStartPick={onStartPick}
        />
      ))}
    </div>
  )
}


function ParamInput({
  schema, value, filterId, isPicking, onChange, onStartPick,
}: {
  schema: ParamSchema
  value: unknown
  filterId: string
  isPicking: boolean
  onChange: (v: unknown) => void
  onStartPick: (filterId: string, paramName: string, type: 'point' | 'rect' | 'points', currentValue: number[] | number[][]) => void
}) {
  const label = schema.label ?? schema.name
  const current = value === undefined ? schema.default : value

  // ─── spatial types ──────────────────────────────────────────────
  // Rendered as a "Pick" button + a compact summary of the current
  // value. The actual picking UI lives on the MJPEG preview overlay
  // up in VideoFullView; this component just hands off the request.
  if (schema.type === 'point' || schema.type === 'rect' || schema.type === 'points') {
    // Capture the narrowed type literal so closures (onClick below)
    // see the spatial union rather than the wider param-type union —
    // TS loses the schema.type narrowing across the function boundary.
    const spatialType: 'point' | 'rect' | 'points' = schema.type
    let summary: string
    if (schema.type === 'points') {
      const arr = (Array.isArray(current) ? current : []) as number[][]
      summary = arr.length === 0 ? 'no points' : `${arr.length} point${arr.length === 1 ? '' : 's'}`
    } else if (schema.type === 'point') {
      const a = Array.isArray(current) && current.length >= 2 ? (current as number[]) : null
      summary = a ? `[${a[0]}, ${a[1]}]` : 'not set'
    } else {
      const a = Array.isArray(current) && current.length >= 4 ? (current as number[]) : null
      summary = a ? `[${a[0]}, ${a[1]}, ${a[2]}×${a[3]}]` : 'not set'
    }
    return (
      <div className="flex items-center gap-2">
        <span className="w-32 text-[10px] uppercase tracking-wider text-slate-500" title={schema.help}>
          {label}
        </span>
        <span className="flex-1 truncate font-mono text-[10px] text-slate-400">{summary}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onStartPick(filterId, schema.name, spatialType, (current as number[] | number[][]) ?? [])
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={`nodrag nopan rounded border px-2 py-0.5 text-[10px] ${
            isPicking
              ? 'border-amber-500 bg-amber-900/40 text-amber-200'
              : 'border-sky-700 bg-sky-900/40 text-sky-200 hover:border-sky-500'
          }`}
        >
          {isPicking ? 'Picking…' : 'Pick'}
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onChange(schema.type === 'points' ? [] : []) }}
          onPointerDown={(e) => e.stopPropagation()}
          title="Clear"
          className="nodrag nopan rounded px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-800 hover:text-slate-200"
        >
          ✕
        </button>
      </div>
    )
  }

  if (schema.type === 'bool') {
    return (
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={!!current}
          onChange={(e) => onChange(e.target.checked)}
          onPointerDown={(e) => e.stopPropagation()}
          className="nodrag nopan"
        />
        <span className="text-[11px] text-slate-300">{label}</span>
        {schema.help && <span className="text-[9px] text-slate-500">— {schema.help}</span>}
      </label>
    )
  }
  if (schema.type === 'enum') {
    return (
      <label className="flex items-center gap-2">
        <span className="w-32 text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
        <select
          value={String(current)}
          onChange={(e) => onChange(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          className="nodrag nopan rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px]"
        >
          {(schema.choices ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
    )
  }
  if (schema.type === 'string') {
    // Free-form text input. ``placeholder`` carries the hint shape;
    // ``help`` is shown as a tooltip on the label and as a small
    // subtitle below on multi-line layouts (left to the consumer
    // since vertical space is tight here — tooltip is enough).
    const text = typeof current === 'string' ? current : (current == null ? '' : String(current))
    return (
      <label className="flex items-center gap-2">
        <span
          className="w-32 shrink-0 text-[10px] uppercase tracking-wider text-slate-500"
          title={schema.help}
        >
          {label}
        </span>
        <input
          type="text"
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          placeholder={schema.placeholder}
          className="nodrag nopan flex-1 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[11px] placeholder:text-slate-600 focus:border-slate-500 focus:outline-none"
        />
      </label>
    )
  }
  // int / float: slider + number input, mirrored.
  const num = typeof current === 'number' ? current : Number(current) || 0
  return (
    <div className="flex items-center gap-2">
      <span className="w-32 text-[10px] uppercase tracking-wider text-slate-500" title={schema.help}>
        {label}
      </span>
      {schema.min != null && schema.max != null ? (
        <input
          type="range"
          min={schema.min}
          max={schema.max}
          step={schema.step ?? (schema.type === 'int' ? 1 : 0.01)}
          value={num}
          onChange={(e) => onChange(schema.type === 'int' ? parseInt(e.target.value, 10) : parseFloat(e.target.value))}
          onPointerDown={(e) => e.stopPropagation()}
          className="nodrag nopan flex-1"
        />
      ) : null}
      <input
        type="number"
        min={schema.min}
        max={schema.max}
        step={schema.step ?? (schema.type === 'int' ? 1 : 0.01)}
        value={num}
        onChange={(e) => {
          const v = e.target.value
          if (v === '') return
          onChange(schema.type === 'int' ? parseInt(v, 10) : parseFloat(v))
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-right font-mono text-[11px]"
      />
    </div>
  )
}


function FilterTelemetry({
  proxyId, filterId, topicOverride, telemetrySchema,
}: {
  proxyId: string
  filterId: string
  // Backend-provided telemetry_topic from /video/<id>/filters. Newer
  // backends ship this directly so the UI doesn't have to know the
  // path convention. Fall back to deriving it for older backends.
  topicOverride?: string
  // Backend-provided JSON Schema describing the telemetry payload —
  // null for filters that don't declare one (older backends) or for
  // effect filters that don't publish telemetry. When present the UI
  // shows a "▸ schema" toggle next to the live data.
  telemetrySchema?: Record<string, unknown> | null
}) {
  const wsClient = useWsClient()
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [showSchema, setShowSchema] = useState(false)
  const topic = topicOverride ?? `/video/${proxyId}/filter/${filterId}`
  useEffect(() => {
    const off = wsClient.subscribe(topic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const p = f.payload
      if (p === null) { setData(null); return }
      if (typeof p === 'object') setData(p as Record<string, unknown>)
    })
    return off
  }, [topic, wsClient])

  return (
    <div className="rounded border border-slate-800 bg-slate-900/60 p-2">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[9px] uppercase tracking-wider text-slate-500">telemetry</span>
          {telemetrySchema && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowSchema((v) => !v) }}
              onPointerDown={(e) => e.stopPropagation()}
              className="nodrag nopan text-[9px] uppercase tracking-wider text-slate-500 hover:text-slate-300"
              title="Toggle JSON Schema for this filter's telemetry payload"
            >
              {showSchema ? '▾ schema' : '▸ schema'}
            </button>
          )}
        </div>
        <span
          className="select-all truncate font-mono text-[9px] text-sky-400"
          title={`Published to ${topic} (retained). Click to select for copy.`}
        >
          {topic}
        </span>
      </div>
      {showSchema && telemetrySchema && (
        <SchemaBlock label={`payload — ${(telemetrySchema as { title?: string }).title ?? ''}`} schema={telemetrySchema} />
      )}
      {data === null ? (
        <div className="text-[10px] text-slate-500">no data yet</div>
      ) : (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px]">
          {Object.entries(data).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-slate-500">{k}</dt>
              <dd className="truncate text-slate-200" title={String(v)}>
                {formatTelemetryValue(v)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}


function formatTelemetryValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? '✓ yes' : '✗ no'
  if (Array.isArray(v)) return `[${v.join(', ')}]`
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}


/** ServiceMeta — payload shape published by every service to its
 * /<type>/<id>/meta retained topic. Standardised across service types
 * (subprocess + in-process) so the UI can reuse this component for any
 * service view, not just video. */
interface ServiceMeta {
  proxy_id: string
  type: string
  version?: string
  transport?: string
  runtime_id?: string
  pid?: number
  topics_root: string
  topics: Record<string, string>
  methods?: Array<{ name: string; doc?: string | null; publishes?: string[]; publish_return?: string | null }>
}


/** TypeDescriptor — payload shape published to /runtime/runtime/types/<type>
 * by the runtime's types_index publisher. Keys are stable JSON Schema
 * objects (Pydantic v2 emits 2020-12-compatible schemas). */
interface TypeMethod {
  name: string
  doc?: string | null
  args_schema?: Record<string, unknown>
  publishes?: string[]
  publish_return?: string | null
}
interface TypeDescriptor {
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
  sub_resources?: Array<{ name: string; catalog_topic_suffix?: string; item_topic_template?: string; list_topic_suffix?: string; key_field?: string }>
  notes?: string
}


/** ServiceTopics — introspection panel showing the bus topics a service
 * exposes. Subscribes to /<type>/<id>/meta (instance), and to
 * /runtime/runtime/types/<type> (type descriptor — where the JSON
 * Schemas live). Methods from the instance meta are matched against
 * the type descriptor to surface arg schemas inline. */
function ServiceTopics({ proxyId, typeName }: { proxyId: string; typeName: string }) {
  const wsClient = useWsClient()
  const [meta, setMeta] = useState<ServiceMeta | null>(null)
  const [type, setType] = useState<TypeDescriptor | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [showSchemas, setShowSchemas] = useState(false)
  const metaTopic = `/${typeName}/${proxyId}/meta`
  const typeTopic = `/runtime/runtime/types/${typeName}`

  useEffect(() => {
    const off = wsClient.subscribe(metaTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const p = f.payload
      if (p === null || p === undefined) { setMeta(null); return }
      if (typeof p === 'object') setMeta(p as unknown as ServiceMeta)
    })
    return off
  }, [metaTopic, wsClient])

  useEffect(() => {
    const off = wsClient.subscribe(typeTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const p = f.payload
      if (p === null || p === undefined) { setType(null); return }
      if (typeof p === 'object') setType(p as unknown as TypeDescriptor)
    })
    return off
  }, [typeTopic, wsClient])

  const copyToClipboard = useCallback((text: string) => {
    try { navigator.clipboard?.writeText(text) } catch { /* swallow — non-https or denied */ }
  }, [])

  const methodArgs = (name: string): TypeMethod | undefined =>
    (type?.methods ?? []).find((m) => m.name === name)

  return (
    <section className="rounded border border-slate-800 bg-slate-900/40">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        onPointerDown={(e) => e.stopPropagation()}
        className="nodrag nopan flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left"
      >
        <span className="flex items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">topics</span>
          {meta ? (
            <span className="font-mono text-[9px] text-slate-400">
              {Object.keys(meta.topics ?? {}).length} topics ·{' '}
              {(meta.methods ?? []).length} methods · {meta.transport ?? '—'}
            </span>
          ) : (
            <span className="text-[10px] text-slate-500">no meta yet</span>
          )}
        </span>
        <span className="text-slate-500">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && meta && (
        <div className="space-y-2 border-t border-slate-800 bg-slate-950/40 p-2">
          {/* identity row */}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[10px]">
            <dt className="text-slate-500">runtime</dt>
            <dd className="text-slate-300">{meta.runtime_id ?? '—'}</dd>
            <dt className="text-slate-500">type/version</dt>
            <dd className="text-slate-300">{meta.type}@{meta.version ?? '?'}</dd>
            <dt className="text-slate-500">pid</dt>
            <dd className="text-slate-300">{meta.pid ?? '—'}</dd>
            <dt className="text-slate-500">root</dt>
            <dd className="select-all truncate text-sky-400" title={meta.topics_root}>{meta.topics_root}</dd>
          </dl>
          {/* topics map */}
          <div>
            <div className="mb-0.5 text-[9px] uppercase tracking-wider text-slate-500">bus topics</div>
            <ul className="space-y-0.5">
              {Object.entries(meta.topics ?? {}).map(([k, v]) => (
                <li key={k} className="flex items-baseline gap-2 font-mono text-[10px]">
                  <span className="w-24 shrink-0 text-slate-500">{k}</span>
                  <span className="select-all flex-1 truncate text-sky-400" title={v}>{v}</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); copyToClipboard(v) }}
                    onPointerDown={(e) => e.stopPropagation()}
                    title="Copy to clipboard"
                    className="nodrag nopan rounded px-1 py-0.5 text-[9px] text-slate-500 hover:bg-slate-800 hover:text-slate-200"
                  >
                    copy
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {/* methods — with arg schemas drawn from the type descriptor */}
          {(meta.methods ?? []).length > 0 && (
            <div>
              <div className="mb-0.5 text-[9px] uppercase tracking-wider text-slate-500">
                methods (sent to control topic as {`{action:"<name>", …}`})
              </div>
              <ul className="space-y-0.5 font-mono text-[10px]">
                {meta.methods!.map((m) => {
                  const tm = methodArgs(m.name)
                  const props = (tm?.args_schema as { properties?: Record<string, { type?: string }> } | undefined)?.properties ?? {}
                  const required = (tm?.args_schema as { required?: string[] } | undefined)?.required ?? []
                  const argList = Object.entries(props)
                    .map(([k, info]) => `${k}${required.includes(k) ? '' : '?'}: ${info?.type ?? 'any'}`)
                    .join(', ')
                  return (
                    <li key={m.name} className="flex items-baseline gap-2">
                      <span className="text-emerald-300">{m.name}</span>
                      <span className="text-slate-500">({argList})</span>
                      {m.doc && (
                        <span className="truncate text-slate-500" title={m.doc}>— {m.doc}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          {/* type schema link — show config + state JSON Schemas from
              /runtime/runtime/types/<type>. Collapsed by default so the
              expander doesn't dump a wall of schema on every open. */}
          {type && (type.config_schema || type.state_schema || (type.topic_schemas && Object.keys(type.topic_schemas).length > 0)) && (
            <div>
              <button
                type="button"
                onClick={() => setShowSchemas((v) => !v)}
                onPointerDown={(e) => e.stopPropagation()}
                className="nodrag nopan flex items-baseline gap-2 text-left text-[9px] uppercase tracking-wider text-slate-500 hover:text-slate-300"
              >
                <span>type schema</span>
                <span className="font-mono normal-case text-slate-600">@ {typeTopic}</span>
                <span>{showSchemas ? '▾' : '▸'}</span>
              </button>
              {showSchemas && (
                <div className="mt-1 space-y-1.5">
                  {type.config_schema && (
                    <SchemaBlock label="config_schema" schema={type.config_schema} />
                  )}
                  {type.state_schema && (
                    <SchemaBlock label="state_schema" schema={type.state_schema} />
                  )}
                  {type.topic_schemas && Object.entries(type.topic_schemas).map(([k, v]) => (
                    <SchemaBlock key={k} label={`topic_schemas.${k}`} schema={v} />
                  ))}
                </div>
              )}
            </div>
          )}
          {type && !type.schemas_complete && (
            <div className="font-mono text-[9px] text-amber-400" title={type.notes ?? ''}>
              schemas incomplete — {type.notes ?? 'subprocess type; subscribe to instance topics for live schemas'}
            </div>
          )}
        </div>
      )}
    </section>
  )
}


/** SchemaBlock — collapsed JSON Schema viewer. Render mode shows just
 * the properties list compact; click to switch to raw JSON for copy. */
function SchemaBlock({ label, schema }: { label: string; schema: Record<string, unknown> }) {
  const [raw, setRaw] = useState(false)
  const properties = (schema as { properties?: Record<string, { type?: string; description?: string }> }).properties ?? {}
  const required = ((schema as { required?: string[] }).required ?? [])
  return (
    <div className="rounded border border-slate-800 bg-slate-950 p-1.5">
      <button
        type="button"
        onClick={() => setRaw((v) => !v)}
        onPointerDown={(e) => e.stopPropagation()}
        className="nodrag nopan flex items-baseline gap-2 text-[9px] text-slate-400 hover:text-slate-200"
      >
        <span className="font-mono text-sky-400">{label}</span>
        <span className="text-slate-600">— click to {raw ? 'collapse' : 'view raw JSON'}</span>
      </button>
      {raw ? (
        <pre className="mt-1 max-h-64 overflow-auto rounded bg-black p-1.5 font-mono text-[9px] text-slate-300">
          {JSON.stringify(schema, null, 2)}
        </pre>
      ) : (
        <dl className="mt-1 grid grid-cols-[auto_auto_1fr] gap-x-2 gap-y-0.5 font-mono text-[10px]">
          {Object.entries(properties).map(([k, info]) => (
            <div key={k} className="contents">
              <dt className="text-slate-300">
                {k}
                {required.includes(k) && <span className="text-rose-400">*</span>}
              </dt>
              <dd className="text-amber-300">{info?.type ?? 'any'}</dd>
              <dd className="truncate text-slate-500" title={info?.description ?? ''}>
                {info?.description ?? ''}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}


/** PickOverlay — transparent capture layer on top of the MJPEG `<img>`.
 *
 * Rendered by VideoFullView when a filter's spatial-param input
 * requested picking. The overlay sits in the same ``relative``
 * container as the `<img>` so its absolute positioning matches the
 * image bounds exactly — even when the image is responsively resized
 * by the canvas card.
 *
 * The actual click → image-pixel translation lives in VideoFullView's
 * onOverlayClick so this component stays presentation-only.
 */
function PickOverlay({
  picking, rectDraft, mjpegImgRef,
  onMouseDown, onMouseMove, onMouseUp, onMouseLeave,
  onClear, onDone,
}: {
  picking: PickingRequest
  rectDraft: number[] | null
  mjpegImgRef: React.RefObject<HTMLImageElement | null>
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void
  onMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void
  onMouseUp: () => void
  onMouseLeave: () => void
  onClear: () => void
  onDone: () => void
}) {
  // Display the picked-so-far markers on the overlay. Coords are in
  // image-pixel space; convert back to overlay-pixel space using the
  // <img>'s currently-rendered size.
  const points: number[][] =
    picking.type === 'points'
      ? ((picking.value as number[][]) ?? [])
      : picking.type === 'point' && Array.isArray(picking.value) && picking.value.length >= 2
        ? [picking.value as number[]]
        : []
  // Committed rect (the value the filter has). The in-progress draft
  // (rectDraft) is drawn separately while the user holds the mouse.
  const committedRect: number[] | null =
    picking.type === 'rect'
      && Array.isArray(picking.value)
      && picking.value.length >= 4
      && (picking.value as number[])[2] > 0
      && (picking.value as number[])[3] > 0
      ? (picking.value as number[])
      : null
  const img = mjpegImgRef.current
  const scaleX = img && img.naturalWidth ? img.clientWidth / img.naturalWidth : 1
  const scaleY = img && img.naturalHeight ? img.clientHeight / img.naturalHeight : 1
  // Normalise a [x, y, w, h] rect with possibly-negative w/h into
  // positive coords for rendering (a backward drag is still valid).
  const renderRect = (r: number[], color: string, dashed: boolean) => {
    let [x, y, w, h] = r
    if (w < 0) { x = x + w; w = -w }
    if (h < 0) { y = y + h; h = -h }
    return (
      <div
        className="pointer-events-none absolute"
        style={{
          left: x * scaleX,
          top: y * scaleY,
          width: w * scaleX,
          height: h * scaleY,
          border: `2px ${dashed ? 'dashed' : 'solid'} ${color}`,
          background: `${color}15`,
        }}
      >
        <div
          className="absolute -top-5 left-0 rounded bg-slate-900/80 px-1.5 py-0.5 font-mono text-[10px]"
          style={{ color }}
        >
          {Math.round(w)}×{Math.round(h)}
        </div>
      </div>
    )
  }
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute inset-0 z-10 cursor-crosshair"
      style={{ background: 'rgba(255, 200, 0, 0.05)' }}
    >
      {/* Picked points — rendered as crosshair markers so the user
          can see what's been captured even before the filter's own
          draw_overlay paints them. */}
      {points.map(([x, y], i) => (
        <div
          key={i}
          className="pointer-events-none absolute"
          style={{
            left: x * scaleX,
            top: y * scaleY,
            transform: 'translate(-50%, -50%)',
            width: 14, height: 14,
          }}
        >
          <div className="h-full w-full rounded-full border-2 border-amber-300" />
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-amber-300/60" />
          <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-amber-300/60" />
        </div>
      ))}
      {/* Committed rect (solid amber) and live drag draft (dashed cyan).
          Draft takes precedence visually so the user sees their
          drag-in-progress; the committed rect remains as a faint
          backdrop. */}
      {committedRect && renderRect(committedRect, '#fbbf24', false)}
      {rectDraft && renderRect(rectDraft, '#22d3ee', true)}
      {/* Tiny control strip in the top-right of the overlay. */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
        className="absolute right-2 top-2 flex items-center gap-1 rounded border border-amber-700 bg-slate-900/90 px-2 py-1 text-[10px] text-amber-200 shadow"
      >
        <span className="font-mono">
          {picking.type === 'points'
            ? `${points.length} picked — click to add`
            : picking.type === 'rect'
              ? (committedRect
                  ? `rect ${committedRect[2]}×${committedRect[3]} — drag to redraw`
                  : 'drag to draw rectangle')
              : 'click to set'}
        </span>
        <button
          type="button"
          onClick={onClear}
          className="rounded px-1.5 py-0.5 hover:bg-slate-800"
        >
          clear
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded bg-emerald-700 px-1.5 py-0.5 text-white hover:bg-emerald-600"
        >
          done
        </button>
      </div>
    </div>
  )
}
