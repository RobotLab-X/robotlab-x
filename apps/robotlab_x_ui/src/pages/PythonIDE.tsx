import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Editor from '@monaco-editor/react'
import ConnectionIndicator from '../components/ConnectionIndicator'
import { useAuth } from '../contexts/AuthContext'
import { wsClient, type InboundFrame } from '../runtime/wsClient'

// Full-page IDE for a python service instance. URL: /python/{proxyId}/ide.
//
// Three regions:
//   * Left sidebar — searchable script list. Click to open in a new tab
//     (or focus the existing tab if already open).
//   * Center — tabbed Monaco editor; per-tab dirty state; toolbar with
//     Save/Run/Rename/Delete. Ctrl+S saves the active tab; Ctrl+Enter
//     runs it.
//   * Bottom — live output panel. Auto-scrolls; the active run is the
//     most-recent run of the active tab.
//
// Data flow:
//   /python/{id}/state  retained — script catalog (incl. bodies) + recent_runs
//   /python/{id}/output           — per-line output, scoped by run_id
//   /python/{id}/control          — outgoing actions (save_script, run_script, …)

interface Script {
  id: string
  name: string
  body?: string
  language?: string
  created_at?: string
  updated_at?: string
}

interface RunEntry {
  run_id: string
  script_name: string
  script_id?: string | null
  started_at: number
  status: string
  exit_code?: number
  duration_ms?: number
  finished_at?: number
}

interface OutputLine {
  run_id: string
  stream: 'stdout' | 'stderr' | 'meta'
  line?: string
  event?: string
  exit_code?: number
  timeout_seconds?: number
}

interface PythonState {
  scripts?: Script[]
  recent_runs?: RunEntry[]
}

// Open-tab record. ``id`` is the script's id for saved scripts, or a
// transient string like ``__new_1`` for unsaved drafts so we can key
// the tab list even before the script exists in the DB.
interface Tab {
  id: string
  name: string
  body: string
  dirty: boolean
  isNew: boolean           // true ⇒ no DB row yet
  lastRunId?: string | null
}

let _nextNewId = 1


export default function PythonIDE() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const { proxyId: rawProxyId } = useParams<{ proxyId: string }>()
  const proxyId = decodeURIComponent(rawProxyId ?? '')
  const stateTopic = `/python/${proxyId}/state`
  const outputTopic = `/python/${proxyId}/output`
  const controlTopic = `/python/${proxyId}/control`

  const [state, setState] = useState<PythonState>({})
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [outputs, setOutputs] = useState<Record<string, OutputLine[]>>({})
  const [feedback, setFeedback] = useState<string | null>(null)

  // Mirror authoritative state — only updates the tab's body when the
  // tab is NOT dirty so we don't clobber the user's in-flight edits.
  useEffect(() => {
    if (!proxyId) return
    const off = wsClient.subscribe(stateTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const next = f.payload as PythonState
      setState(next)
      // Sync open tabs with server-side body changes that arrived from
      // another tab/session — but only when our local copy isn't dirty.
      const byId = new Map<string, Script>()
      for (const s of next.scripts ?? []) byId.set(s.id, s)
      setTabs((prev) => prev.map((t) => {
        if (t.isNew || t.dirty) return t
        const s = byId.get(t.id)
        if (!s) return t
        return { ...t, name: s.name, body: s.body ?? '' }
      }))
    })
    return off
  }, [proxyId, stateTopic])

  // Per-run output buffers. Only one subscription — we sort the
  // payloads by run_id into the right buffer.
  useEffect(() => {
    if (!proxyId) return
    const off = wsClient.subscribe(outputTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const p = f.payload as OutputLine | undefined
      if (!p?.run_id) return
      setOutputs((prev) => {
        const buf = prev[p.run_id] ?? []
        return { ...prev, [p.run_id]: buf.concat([p]).slice(-2000) }
      })
    })
    return off
  }, [proxyId, outputTopic])

  // Helpers ───────────────────────────────────────────────────────────
  const send = useCallback(
    (action: string, args: Record<string, unknown> = {}) => {
      wsClient.publish(controlTopic, { action, ...args })
    },
    [controlTopic],
  )

  const showFeedback = useCallback((msg: string) => {
    setFeedback(msg)
    setTimeout(() => setFeedback((cur) => (cur === msg ? null : cur)), 2000)
  }, [])

  const scripts = state.scripts ?? []
  const recentRuns = state.recent_runs ?? []

  // Tab management ────────────────────────────────────────────────────
  const openScript = useCallback((script: Script) => {
    setTabs((prev) => {
      if (prev.some((t) => t.id === script.id)) {
        setActiveTabId(script.id)
        return prev
      }
      const next = prev.concat([{
        id: script.id,
        name: script.name,
        body: script.body ?? '',
        dirty: false,
        isNew: false,
      }])
      setActiveTabId(script.id)
      return next
    })
  }, [])

  const newTab = useCallback(() => {
    const tempId = `__new_${_nextNewId++}`
    setTabs((prev) => prev.concat([{
      id: tempId,
      name: 'untitled',
      body: "# new script\nprint('hello')\n",
      dirty: true,
      isNew: true,
    }]))
    setActiveTabId(tempId)
  }, [])

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id)
      if (idx === -1) return prev
      const tab = prev[idx]
      if (tab.dirty) {
        // Soft confirm: in-page banner only. Reusing browser confirm
        // would violate the no-native-dialogs guideline.
        if (!window.__rlx_skip_close_confirm) {
          showFeedback(`"${tab.name}" has unsaved changes. Click × again to discard.`)
          // Mark a one-shot allow flag on window so the next × works.
          // (Quick-and-dirty; replace with a confirm dialog later.)
          window.__rlx_skip_close_confirm = true
          setTimeout(() => { window.__rlx_skip_close_confirm = false }, 2500)
          return prev
        }
        window.__rlx_skip_close_confirm = false
      }
      const next = prev.filter((_, i) => i !== idx)
      if (activeTabId === id) {
        setActiveTabId(next[Math.min(idx, next.length - 1)]?.id ?? null)
      }
      return next
    })
  }, [activeTabId, showFeedback])

  const updateActiveTab = useCallback((patch: Partial<Tab>) => {
    setTabs((prev) => prev.map((t) =>
      t.id === activeTabId ? { ...t, ...patch, dirty: true } : t,
    ))
  }, [activeTabId])

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  // Action handlers ───────────────────────────────────────────────────
  const onSave = useCallback(() => {
    if (!activeTab) return
    if (!activeTab.name.trim()) {
      showFeedback('Name required to save')
      return
    }
    if (activeTab.isNew) {
      send('save_script', { name: activeTab.name, body: activeTab.body })
      // We don't know the new id yet — the next /state will include it.
      // Mark the tab clean optimistically; the state sync will re-key
      // the tab to the real id on next snapshot.
      showFeedback('Saved.')
      // Optimistic: mark the temp tab as not-dirty. On next /state we
      // adopt the new row's id by replacing the temp tab.
      setTabs((prev) => prev.map((t) =>
        t.id === activeTab.id ? { ...t, dirty: false, _awaitRekey: true } as Tab : t,
      ))
    } else {
      send('save_script', { id: activeTab.id, name: activeTab.name, body: activeTab.body })
      setTabs((prev) => prev.map((t) =>
        t.id === activeTab.id ? { ...t, dirty: false } : t,
      ))
      showFeedback('Saved.')
    }
  }, [activeTab, send, showFeedback])

  // Adopt server-assigned id for newly-created scripts.
  useEffect(() => {
    setTabs((prev) => {
      let changed = false
      const next = prev.map((t) => {
        if (!('_awaitRekey' in t) || !(t as any)._awaitRekey) return t
        const match = scripts.find((s) => s.name === t.name && s.body === t.body)
        if (!match) return t
        changed = true
        if (activeTabId === t.id) {
          setActiveTabId(match.id)
        }
        return {
          id: match.id, name: match.name, body: match.body ?? '',
          dirty: false, isNew: false,
        }
      })
      return changed ? next : prev
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scripts])

  const onRun = useCallback(() => {
    if (!activeTab) return
    if (activeTab.isNew || activeTab.dirty) {
      // Run inline so users can iterate without saving every keystroke
      send('run_inline', { body: activeTab.body, name: activeTab.name || 'inline', timeout: 5.0 })
      showFeedback('Run dispatched (inline).')
    } else {
      send('run_script', { id: activeTab.id, timeout: 5.0 })
      showFeedback('Run dispatched.')
    }
  }, [activeTab, send, showFeedback])

  // Rename uses the inline name input as the source of truth — no
  // native prompt() (UI convention bans them). User edits the name
  // field, clicks Rename, server-side title-only update is dispatched.
  // Distinct from Save: doesn't touch the body, no full-save roundtrip.
  const onRename = useCallback(() => {
    if (!activeTab || activeTab.isNew) return
    const newName = activeTab.name.trim()
    if (!newName) {
      showFeedback('Name cannot be empty')
      return
    }
    send('rename_script', { id: activeTab.id, new_name: newName })
    showFeedback('Renamed.')
  }, [activeTab, send, showFeedback])

  const onDuplicate = useCallback(() => {
    if (!activeTab || activeTab.isNew) return
    send('duplicate_script', { id: activeTab.id })
    showFeedback('Duplicate dispatched — new tab will appear in the sidebar.')
  }, [activeTab, send, showFeedback])

  const onDelete = useCallback(() => {
    if (!activeTab || activeTab.isNew) return
    send('delete_script', { id: activeTab.id })
    closeTab(activeTab.id)
  }, [activeTab, send, closeTab])

  // Keyboard ──────────────────────────────────────────────────────────
  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      onSave()
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      onRun()
    }
  }, [onSave, onRun])

  // Search filter ─────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return scripts
    return scripts.filter((s) =>
      (s.name ?? '').toLowerCase().includes(q) ||
      (s.body ?? '').toLowerCase().includes(q)
    )
  }, [scripts, search])

  // Most recent run for the active tab → drives the output panel
  const activeRun = useMemo(() => {
    if (!activeTab) return null
    return recentRuns.find((r) =>
      r.script_id === activeTab.id || r.script_name === activeTab.name
    ) ?? recentRuns[0] ?? null
  }, [activeTab, recentRuns])

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100" onKeyDown={onKeyDown}>
      <Header
        proxyId={proxyId}
        user={user?.email ?? user?.id ?? 'unknown'}
        onBack={() => navigate(`/workspaces/runtime`)}
        onSignOut={signOut}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          scripts={filtered}
          search={search}
          onSearchChange={setSearch}
          activeId={activeTab?.id ?? null}
          onSelect={openScript}
          onNew={newTab}
        />

        <main className="flex flex-1 flex-col">
          <TabBar
            tabs={tabs}
            activeId={activeTabId}
            onSelect={setActiveTabId}
            onClose={closeTab}
          />
          {activeTab ? (
            <EditorPane
              tab={activeTab}
              onNameChange={(v) => updateActiveTab({ name: v })}
              onBodyChange={(v) => updateActiveTab({ body: v })}
              onSave={onSave}
              onRun={onRun}
              onRename={onRename}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
              feedback={feedback}
            />
          ) : (
            <EmptyState onNew={newTab} />
          )}
          <OutputPanel
            run={activeRun}
            lines={activeRun ? (outputs[activeRun.run_id] ?? []) : []}
          />
        </main>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────

function Header({
  proxyId, user, onBack, onSignOut,
}: {
  proxyId: string
  user: string
  onBack: () => void
  onSignOut: () => void
}) {
  return (
    <header className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          ← Canvas
        </button>
        <h1 className="text-sm font-semibold">
          {proxyId} <span className="text-slate-500">·</span>{' '}
          <span className="font-mono text-slate-400">script ide</span>
        </h1>
      </div>
      <div className="flex items-center gap-3 text-xs text-slate-400">
        <ConnectionIndicator />
        <span>{user}</span>
        <button
          type="button"
          onClick={onSignOut}
          className="rounded border border-slate-700 px-2 py-1 hover:border-slate-500"
        >
          Sign out
        </button>
      </div>
    </header>
  )
}

function Sidebar({
  scripts, search, onSearchChange, activeId, onSelect, onNew,
}: {
  scripts: Script[]
  search: string
  onSearchChange: (v: string) => void
  activeId: string | null
  onSelect: (s: Script) => void
  onNew: () => void
}) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900">
      <div className="border-b border-slate-800 p-2">
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="search name + body…"
          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-slate-500 focus:outline-none"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {scripts.length === 0 ? (
          <div className="p-3 text-xs text-slate-500">
            {search ? 'No matches.' : 'No scripts yet — click + new.'}
          </div>
        ) : (
          <ul className="space-y-0.5 p-1">
            {scripts.map((s) => (
              <li
                key={s.id}
                onClick={() => onSelect(s)}
                className={`group flex cursor-pointer items-center justify-between rounded px-2 py-1.5 ${activeId === s.id ? 'bg-slate-800 text-slate-100' : 'text-slate-300 hover:bg-slate-800/60'}`}
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs">{s.name}</div>
                  {s.updated_at && (
                    <div className="truncate text-[10px] text-slate-500">
                      {new Date(s.updated_at).toLocaleString()}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="border-t border-slate-800 p-2">
        <button
          type="button"
          onClick={onNew}
          className="w-full rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-slate-500"
        >
          + new script
        </button>
      </div>
    </aside>
  )
}

function TabBar({
  tabs, activeId, onSelect, onClose,
}: {
  tabs: Tab[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
}) {
  if (tabs.length === 0) return null
  return (
    <div className="flex items-center gap-0 overflow-x-auto border-b border-slate-800 bg-slate-900">
      {tabs.map((t) => (
        <div
          key={t.id}
          onClick={() => onSelect(t.id)}
          className={`flex shrink-0 cursor-pointer items-center gap-1 border-r border-slate-800 px-3 py-1.5 text-xs ${activeId === t.id ? 'bg-slate-950 text-slate-100' : 'bg-slate-900 text-slate-400 hover:text-slate-200'}`}
        >
          <span className="font-mono">{t.name}</span>
          {t.dirty && <span className="text-amber-400">●</span>}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClose(t.id) }}
            className="ml-1 rounded px-1 text-slate-500 hover:bg-slate-800 hover:text-rose-300"
            title="Close tab"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

function EditorPane({
  tab, onNameChange, onBodyChange, onSave, onRun, onRename, onDuplicate, onDelete, feedback,
}: {
  tab: Tab
  onNameChange: (v: string) => void
  onBodyChange: (v: string) => void
  onSave: () => void
  onRun: () => void
  onRename: () => void
  onDuplicate: () => void
  onDelete: () => void
  feedback: string | null
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 py-1.5">
        <input
          type="text"
          value={tab.name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="name"
          className="rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-200 focus:border-slate-500 focus:outline-none"
        />
        {tab.dirty && <span className="text-[10px] uppercase tracking-wider text-amber-400">unsaved</span>}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onSave}
            disabled={!tab.dirty}
            className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
            title="Ctrl+S"
          >
            Save
          </button>
          <button
            type="button"
            onClick={onRun}
            className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500"
            title="Ctrl+Enter"
          >
            {tab.isNew || tab.dirty ? 'Run (inline)' : 'Run'}
          </button>
          {!tab.isNew && (
            <>
              <button
                type="button"
                onClick={onRename}
                className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-slate-500"
              >
                Rename
              </button>
              <button
                type="button"
                onClick={onDuplicate}
                className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-slate-500"
              >
                Duplicate
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="rounded border border-rose-700 px-2 py-1 text-xs text-rose-300 hover:border-rose-500"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          defaultLanguage="python"
          language="python"
          theme="vs-dark"
          value={tab.body}
          onChange={(v) => onBodyChange(v ?? '')}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            tabSize: 4,
            insertSpaces: true,
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            renderWhitespace: 'selection',
          }}
        />
      </div>
      {feedback && (
        <div className="border-t border-slate-800 bg-slate-900 px-3 py-1 text-[11px] text-slate-300">
          {feedback}
        </div>
      )}
    </div>
  )
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-slate-500">
      <div className="text-sm">No script open.</div>
      <div className="text-xs">Pick one from the sidebar — or</div>
      <button
        type="button"
        onClick={onNew}
        className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
      >
        + new script
      </button>
    </div>
  )
}

function OutputPanel({ run, lines }: { run: RunEntry | null; lines: OutputLine[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [lines])

  return (
    <section className="flex h-56 shrink-0 flex-col border-t border-slate-800 bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-1 text-[11px]">
        <div className="flex items-center gap-2 text-slate-400">
          <span className="uppercase tracking-wider">output</span>
          {run && (
            <>
              <span className="text-slate-600">·</span>
              <span className="font-mono">{run.script_name}</span>
              <StatusBadge status={run.status} />
              {typeof run.duration_ms === 'number' && (
                <span className="font-mono text-slate-500">{run.duration_ms}ms</span>
              )}
              {typeof run.exit_code === 'number' && run.exit_code !== 0 && (
                <span className="font-mono text-rose-400">exit {run.exit_code}</span>
              )}
            </>
          )}
        </div>
        {run && <span className="font-mono text-slate-600">run {run.run_id}</span>}
      </div>
      <div ref={scrollRef} className="flex-1 overflow-auto p-2 font-mono text-[11px]">
        {!run ? (
          <div className="text-slate-500">Run a script to see output here.</div>
        ) : lines.length === 0 ? (
          <div className="text-slate-500">Waiting for output…</div>
        ) : (
          lines.map((l, i) => (
            <div key={i} className={
              l.stream === 'stderr' ? 'text-rose-300'
              : l.stream === 'meta' ? 'text-amber-300'
              : 'text-slate-200'
            }>
              {l.stream === 'meta'
                ? `[${l.event ?? '?'}]${l.exit_code != null ? ` exit=${l.exit_code}` : ''}${l.timeout_seconds != null ? ` timeout=${l.timeout_seconds}s` : ''}`
                : (l.line ?? '')}
            </div>
          ))
        )}
      </div>
    </section>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    running: 'bg-sky-700 text-sky-200',
    completed: 'bg-emerald-800 text-emerald-200',
    error: 'bg-rose-800 text-rose-200',
    timeout: 'bg-amber-800 text-amber-200',
  }
  return (
    <span className={`rounded px-1.5 py-0 text-[9px] uppercase tracking-wider ${map[status] ?? 'bg-slate-700 text-slate-200'}`}>
      {status}
    </span>
  )
}

// Window-scoped flag for the close-confirm dance. Typed locally so
// TypeScript stops complaining.
declare global {
  interface Window {
    __rlx_skip_close_confirm?: boolean
  }
}
