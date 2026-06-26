import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ResponsiveGridLayout, useContainerWidth } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

// react-grid-layout v2 removed the Layout type export; its layout entries
// match our persisted WidgetLayoutEntry shape one-for-one.
type Layout = WidgetLayoutEntry

import { apiFetch } from '../lib/api'
import Banner from '../components/Banner'
import type { Workspace } from '../models/Workspace'
import { WidgetRenderer } from '../dashboard/widgets'
import type {
  DashboardState,
  WidgetConfig,
  WidgetLayoutEntry,
  WidgetType,
} from '../dashboard/types'
import { EMPTY_DASHBOARD } from '../dashboard/types'

const WIDGET_TYPE_LABELS: Record<WidgetType, string> = {
  log: 'Log',
  topic_stream: 'Topic stream',
  metric: 'Metric + sparkline',
  status: 'Service status',
}

const DEFAULT_LAYOUT_FOR_TYPE: Record<WidgetType, { w: number; h: number; minW: number; minH: number }> = {
  log: { w: 6, h: 6, minW: 3, minH: 3 },
  topic_stream: { w: 6, h: 8, minW: 3, minH: 4 },
  metric: { w: 3, h: 4, minW: 2, minH: 3 },
  status: { w: 2, h: 3, minW: 2, minH: 2 },
}

interface NewWidgetDraft {
  type: WidgetType
  title: string
  topic: string
  field: string
}

function newId(): string {
  return `w-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const { id: rawId } = useParams<{ id: string }>()
  const workspaceId = decodeURIComponent(rawId ?? '')

  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [dashboard, setDashboard] = useState<DashboardState>(EMPTY_DASHBOARD)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<NewWidgetDraft | null>(null)

  // Debounce persistence — react-grid-layout fires onLayoutChange constantly
  // while a user drags.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<{ workspace: Workspace; dashboard: DashboardState } | null>(null)

  // v2 react-grid-layout requires an explicit width — the WidthProvider HOC
  // is gone. useContainerWidth measures the wrapping div via ResizeObserver.
  const { width: gridWidth, containerRef: gridContainerRef, mounted: gridMounted } = useContainerWidth()

  const persist = useCallback((nextWs: Workspace, nextDash: DashboardState) => {
    pending.current = { workspace: nextWs, dashboard: nextDash }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      const payload = pending.current
      if (!payload?.workspace.id) return
      try {
        await apiFetch<Workspace>(
          `/v1/workspace/${encodeURIComponent(payload.workspace.id)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              ...payload.workspace,
              dashboard: payload.dashboard,
            }),
          },
        )
      } catch (err) {
        if (err instanceof Error) setError(err.message)
      }
    }, 350)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiFetch<Workspace>(`/v1/workspace/${encodeURIComponent(workspaceId)}`)
      .then((ws) => {
        if (cancelled) return
        setWorkspace(ws)
        const stored = ws.dashboard as DashboardState | undefined
        if (stored && Array.isArray(stored.widgets)) {
          setDashboard({
            widgets: stored.widgets,
            layout: Array.isArray(stored.layout) ? stored.layout : [],
          })
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  const layouts = useMemo(() => {
    const lg: Layout[] = dashboard.widgets.map((widget) => {
      const entry = dashboard.layout.find((l) => l.i === widget.id)
      if (entry) return { ...entry }
      const def = DEFAULT_LAYOUT_FOR_TYPE[widget.type]
      return { i: widget.id, x: 0, y: Infinity, w: def.w, h: def.h, minW: def.minW, minH: def.minH }
    })
    return { lg }
  }, [dashboard])

  function openDraft() {
    setDraft({ type: 'log', title: 'New widget', topic: '/demo/tick', field: '' })
    setError(null)
  }

  // react-grid-layout's v2 type for onLayoutChange uses a readonly array
  // with a wider LayoutItem shape. We narrow back to our persisted entry.
  function handleLayoutChange(
    _: readonly Layout[],
    all: Partial<Record<string, readonly Layout[]>>,
  ) {
    if (!workspace) return
    const lg = all.lg
    const entries: WidgetLayoutEntry[] =
      lg?.map((l) => ({
        i: l.i,
        x: l.x,
        y: l.y,
        w: l.w,
        h: l.h,
        minW: l.minW,
        minH: l.minH,
      })) ?? []
    const next = { ...dashboard, layout: entries }
    setDashboard(next)
    persist(workspace, next)
  }

  function addWidget(e: FormEvent) {
    e.preventDefault()
    if (!draft || !workspace) return
    const { type, title, topic, field } = draft
    const trimTopic = topic.trim()
    if (!trimTopic) {
      setError('Widget topic is required')
      return
    }
    if (type === 'metric' && !field.trim()) {
      setError('Metric widgets need a payload field path (e.g. seq, position.x)')
      return
    }
    let widget: WidgetConfig
    const id = newId()
    if (type === 'metric') {
      widget = { id, type, title: title.trim() || 'metric', topic: trimTopic, field: field.trim() }
    } else if (type === 'log') {
      widget = { id, type, title: title.trim() || 'log', topic: trimTopic, field: field.trim() || undefined }
    } else if (type === 'status') {
      widget = { id, type, title: title.trim() || 'status', topic: trimTopic }
    } else {
      widget = { id, type, title: title.trim() || 'stream', topic: trimTopic }
    }
    const def = DEFAULT_LAYOUT_FOR_TYPE[type]
    const entry: WidgetLayoutEntry = {
      i: id,
      x: 0,
      y: Infinity,
      w: def.w,
      h: def.h,
      minW: def.minW,
      minH: def.minH,
    }
    const next: DashboardState = {
      widgets: [...dashboard.widgets, widget],
      layout: [...dashboard.layout, entry],
    }
    setDashboard(next)
    setDraft(null)
    persist(workspace, next)
  }

  function removeWidget(widgetId: string) {
    if (!workspace) return
    const next: DashboardState = {
      widgets: dashboard.widgets.filter((w) => w.id !== widgetId),
      layout: dashboard.layout.filter((l) => l.i !== widgetId),
    }
    setDashboard(next)
    persist(workspace, next)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(`/workspaces/${encodeURIComponent(workspaceId)}`)}
            className="text-sm text-slate-400 hover:text-slate-200"
          >
            ← Canvas
          </button>
          <h1 className="text-base font-semibold">{workspace?.name ?? workspaceId} · Dashboard</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openDraft}
            className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
          >
            Add widget
          </button>
        </div>
      </header>

      {error && (
        <div className="border-b border-rose-900 px-4 py-2">
          <Banner tone="error">{error}</Banner>
        </div>
      )}

      {draft && (
        <form
          onSubmit={addWidget}
          className="grid grid-cols-2 gap-3 border-b border-slate-800 bg-slate-900/60 p-4 md:grid-cols-5"
        >
          <Field label="type">
            <select
              value={draft.type}
              onChange={(e) =>
                setDraft({ ...draft, type: e.target.value as WidgetType })
              }
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
            >
              {Object.entries(WIDGET_TYPE_LABELS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="title">
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="topic">
            <input
              type="text"
              value={draft.topic}
              onChange={(e) => setDraft({ ...draft, topic: e.target.value })}
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-sm"
              placeholder="/demo/tick"
            />
          </Field>
          {(draft.type === 'metric' || draft.type === 'log') && (
            <Field label={draft.type === 'metric' ? 'numeric field' : 'field (optional)'}>
              <input
                type="text"
                value={draft.field}
                onChange={(e) => setDraft({ ...draft, field: e.target.value })}
                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-sm"
                placeholder="seq"
              />
            </Field>
          )}
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div
        ref={gridContainerRef as React.RefObject<HTMLDivElement>}
        className="flex-1 overflow-auto bg-slate-950 p-3"
      >
        {loading && <Banner tone="info">Loading dashboard…</Banner>}
        {!loading && dashboard.widgets.length === 0 && (
          <div className="mx-auto mt-12 max-w-md text-center text-sm text-slate-500">
            No widgets yet. Click <span className="text-slate-300">Add widget</span> to attach a log,
            metric, status, or topic stream to this dashboard.
          </div>
        )}
        {dashboard.widgets.length > 0 && gridMounted && (
          <ResponsiveGridLayout
            className="layout"
            layouts={layouts}
            width={gridWidth}
            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
            cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
            rowHeight={32}
            margin={[8, 8]}
            onLayoutChange={handleLayoutChange}
          >
            {dashboard.widgets.map((widget) => (
              <div key={widget.id}>
                <WidgetRenderer cfg={widget} onRemove={() => removeWidget(widget.id)} />
              </div>
            ))}
          </ResponsiveGridLayout>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-xs">
      <span className="text-slate-400">{label}</span>
      {children}
    </label>
  )
}
