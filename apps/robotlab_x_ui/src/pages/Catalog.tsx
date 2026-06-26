// Service Catalog — the single surface for managing service TYPES and
// the sources they come from. It does NOT manage instances; dropping a
// type onto the Composer canvas is how you create a running instance.
//
// Three things on this page:
//
//   * SOURCES panel — the actual repo/registry config, editable in place:
//       - local repo roots (writable first, then read-only repo_paths)
//       - remote registries (ordered)
//     repo_paths + registries can be added / edited / deleted / reordered
//     and saved (persists to config/default, effective immediately).
//
//   * INSTALLED (local) — types on disk in the local repo(s). Each card
//     shows which root it's from. pip types that are only LOADED show
//     "Install" (build venv); INSTALLED pip types show "Uninstall";
//     builtins are always installed (no action).
//
//   * BROWSE REGISTRY (remote) — the merged remote catalog. Each row
//     shows which registry served it + its lifecycle chip, with
//     Load / Install / Uninstall actions and distinct failure banners.
//
// See docs/TODO_REPO.md + docs/TODO_REPO_PLAN.md.
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../lib/api'
import Banner from '../components/Banner'
import InstallProgress, { type InstallProgressState } from '../components/InstallProgress'
import { useInstallProgress } from '../runtime/useInstallProgress'
import { ServiceIcon, serviceTitle } from '../composerViews/_shared'
import type { ServiceMeta } from '../models/ServiceMeta'
import type { ServiceProxy } from '../models/ServiceProxy'
import type { ServiceRequest } from '../models/ServiceRequest'
import type { CatalogResponse, SourcesResponse, TypeState } from '../models/RegistryCatalog'

type View = 'installed' | 'browse'

interface BrowseRow {
  name: string
  version: string
  metaId: string
  description?: string
  tags: string[]
  state: TypeState
  sourceRegistry?: string
}

const STATE_CHIP: Record<TypeState, { label: string; cls: string }> = {
  absent: { label: 'available', cls: 'bg-slate-800 text-slate-400' },
  loaded: { label: 'loaded', cls: 'bg-sky-900/60 text-sky-300' },
  installing: { label: 'installing…', cls: 'bg-amber-900/60 text-amber-300' },
  installed: { label: 'installed', cls: 'bg-emerald-900/60 text-emerald-300' },
  failed: { label: 'failed', cls: 'bg-rose-900/60 text-rose-300' },
}

function shortPath(p: string, keep = 3): string {
  const parts = p.replace(/\/+$/, '').split('/')
  return parts.length <= keep ? p : '…/' + parts.slice(-keep).join('/')
}

export default function Catalog() {
  const [view, setView] = useState<View>('installed')

  const [entries, setEntries] = useState<ServiceMeta[]>([])
  const [proxies, setProxies] = useState<ServiceProxy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [pendingUninstall, setPendingUninstall] = useState<ServiceMeta | null>(null)
  const [uninstalling, setUninstalling] = useState(false)

  const [sources, setSources] = useState<SourcesResponse | null>(null)
  const [sourcesError, setSourcesError] = useState<string | null>(null)
  const [savingSources, setSavingSources] = useState(false)

  const loadSources = useCallback(async () => {
    setSourcesError(null)
    try {
      setSources(await apiFetch<SourcesResponse>('/v1/registry/sources'))
    } catch (err) {
      setSourcesError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const [catalog, setCatalog] = useState<CatalogResponse | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ metaId: string; phase: 'load' | 'install'; msg: string } | null>(null)
  const [regBusy, setRegBusy] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  // Live install progress, keyed by `name@version` metaId, fed from the
  // /registry/install/{metaId}/progress stream. Same hook + same
  // <InstallProgress> renderer the Composer canvas uses, so an install
  // looks and behaves identically wherever it's triggered.
  const { progress: installProgress, watch: watchInstall, dismiss: dismissInstall } = useInstallProgress()

  async function reload() {
    try {
      const [rows, proxyRows] = await Promise.all([
        apiFetch<ServiceMeta[]>('/v1/service-meta-list'),
        apiFetch<ServiceProxy[]>('/v1/service-proxy-list'),
      ])
      setEntries(Array.isArray(rows) ? rows : [])
      setProxies(Array.isArray(proxyRows) ? proxyRows : [])
    } catch (err) {
      if (err instanceof Error) setError(err.message)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void Promise.all([
      apiFetch<ServiceMeta[]>('/v1/service-meta-list'),
      apiFetch<ServiceProxy[]>('/v1/service-proxy-list'),
    ])
      .then(([rows, proxyRows]) => {
        if (cancelled) return
        setEntries(Array.isArray(rows) ? rows : [])
        setProxies(Array.isArray(proxyRows) ? proxyRows : [])
      })
      .catch((err: Error) => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    // Sources load independently so a failure here surfaces in the panel
    // instead of silently hiding it.
    void loadSources()
    return () => { cancelled = true }
  }, [loadSources])

  const rootWritable: Record<string, boolean> = {}
  for (const r of sources?.repo_roots ?? []) rootWritable[r.path] = r.writable

  const [rescanning, setRescanning] = useState(false)
  // Re-run the local repo reconcile (the same one that runs at boot) so a
  // package the operator just dropped into repo/ shows up in the Installed
  // view without a backend restart, then refresh the meta list.
  const rescanLocal = useCallback(async () => {
    setRescanning(true)
    setError(null)
    try {
      const r = await apiFetch<{ inserted: number; upserted: number; removed: number; found: number }>(
        '/v1/registry/reconcile', { method: 'POST' },
      )
      await reload()
      setStatus(`Rescanned local repos — ${r.found} type(s): +${r.inserted} new, ${r.upserted} refreshed, −${r.removed} removed.`)
    } catch (err) {
      if (err instanceof Error) setError(err.message)
    } finally {
      setRescanning(false)
    }
  }, [])

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true)
    setCatalogError(null)
    try {
      setCatalog(await apiFetch<CatalogResponse>('/v1/registry/catalog'))
    } catch (err) {
      if (err instanceof Error) setCatalogError(err.message)
    } finally {
      setCatalogLoading(false)
    }
  }, [])

  useEffect(() => {
    if (view === 'browse' && catalog === null && !catalogLoading && !catalogError) void loadCatalog()
  }, [view, catalog, catalogLoading, catalogError, loadCatalog])

  // While ANY type is mid-install (pip venv builds run on a backend
  // thread), poll both lists until it settles — regardless of which view
  // triggered it. The Installed view reads `entries`; the Browse view
  // reads `catalog.local_state`; an install shows up in both, so we check
  // both and refresh both.
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const installing =
      entries.some((m) => (m.install_phase as string | undefined) === 'installing') ||
      (catalog ? Object.values(catalog.local_state).some((s) => s === 'installing') : false)
    if (!installing) return
    pollRef.current = setTimeout(() => {
      void reload()
      if (catalog) void loadCatalog()
    }, 2500)
    return () => { if (pollRef.current) clearTimeout(pollRef.current) }
  }, [entries, catalog, loadCatalog])

  // When a live install reaches a terminal state, refresh the lists once so
  // the state chip flips (installed/failed) without waiting on the 2.5s
  // poll. A ref tracks which metaIds we've already refreshed for so the
  // effect doesn't re-fire on every unrelated progress update.
  const refreshedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    let dirty = false
    for (const [id, st] of Object.entries(installProgress)) {
      if (st.overall !== 'running' && !refreshedRef.current.has(id)) {
        refreshedRef.current.add(id)
        dirty = true
      }
      if (st.overall === 'running') refreshedRef.current.delete(id)
    }
    if (dirty) {
      void reload()
      if (catalog) void loadCatalog()
    }
  }, [installProgress, catalog, loadCatalog])

  // ── Sources editing — persists the full ordered lists. ──
  async function saveSources(repoPaths: string[], registries: string[]) {
    setSavingSources(true)
    setError(null)
    try {
      const updated = await apiFetch<SourcesResponse>('/v1/registry/sources', {
        method: 'PUT',
        body: JSON.stringify({ repo_paths: repoPaths, registries }),
      })
      setSources(updated)
      setStatus('Sources saved')
      // Reflect the new sources everywhere.
      await reload()
      if (view === 'browse') await loadCatalog()
    } catch (err) {
      if (err instanceof Error) setError(err.message)
      throw err
    } finally {
      setSavingSources(false)
    }
  }

  // ── Type-level install/uninstall (Installed view). ──
  async function doTypeInstall(meta: ServiceMeta) {
    const id = `${meta.name}@${meta.version}`
    setBusyId(id)
    setError(null)
    // Subscribe BEFORE the POST — the backend builds the venv on a thread
    // and streams milestones immediately, so we'd miss the first frames if
    // we waited for the response.
    watchInstall(id, `/registry/install/${id}/progress`)
    try {
      await apiFetch('/v1/registry/install', {
        method: 'POST',
        body: JSON.stringify({ name: meta.name, version: meta.version }),
      })
      setStatus(`Installing ${id}…`)
      await reload()
    } catch (err) {
      if (err instanceof Error) setError(err.message)
      dismissInstall(id)
    } finally {
      setBusyId(null)
    }
  }

  async function confirmUninstall(meta: ServiceMeta) {
    const id = `${meta.name}@${meta.version}`
    setUninstalling(true)
    setError(null)
    try {
      // Lifecycle uninstall_type drops the venv AND reverts existing
      // instances to placeholders (what the confirm dialog promises),
      // which the bare registry.uninstall does not.
      const result = await apiFetch<ServiceRequest>('/v1/service-request', {
        method: 'POST',
        body: JSON.stringify({ action: 'uninstall_type', service_meta_id: id }),
      })
      if (result.status === 'failed') {
        setError(result.result ?? 'uninstall failed')
        return
      }
      setStatus(`Uninstalled: ${id}`)
      setPendingUninstall(null)
      await reload()
    } catch (err) {
      if (err instanceof Error) setError(err.message)
    } finally {
      setUninstalling(false)
    }
  }

  // ── Registry (Browse view) actions. ──
  async function regAction(endpoint: 'load' | 'install' | 'uninstall', row: BrowseRow) {
    setRegBusy(row.metaId)
    setRowError(null)
    // Same subscribe-before-POST as the Installed view so the Browse row
    // shows the live install steps + log via <InstallProgress>.
    if (endpoint === 'install') watchInstall(row.metaId, `/registry/install/${row.metaId}/progress`)
    try {
      await apiFetch(`/v1/registry/${endpoint}`, {
        method: 'POST',
        body: JSON.stringify({ name: row.name, version: row.version }),
      })
      await Promise.all([loadCatalog(), reload()])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setRowError({ metaId: row.metaId, phase: endpoint === 'load' ? 'load' : 'install', msg })
      if (endpoint === 'install') dismissInstall(row.metaId)
    } finally {
      setRegBusy(null)
    }
  }

  function browseRows(): BrowseRow[] {
    if (!catalog) return []
    const q = query.trim().toLowerCase()
    const rows: BrowseRow[] = []
    for (const svc of catalog.services) {
      for (const ver of svc.versions) {
        const metaId = `${svc.name}@${ver.version}`
        if (q) {
          const hay = [svc.name, svc.description ?? '', ...(svc.tags ?? [])].join(' ').toLowerCase()
          if (!hay.includes(q)) continue
        }
        rows.push({
          name: svc.name, version: ver.version, metaId,
          description: svc.description, tags: svc.tags ?? [],
          state: catalog.local_state[metaId] ?? 'absent',
          sourceRegistry: svc.source_registry,
        })
      }
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <header className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold">Service Catalog</h1>
          <div className="flex items-center gap-2">
            <div className="flex rounded border border-slate-700 text-xs">
              <button type="button" onClick={() => setView('installed')}
                className={`px-3 py-1.5 ${view === 'installed' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>
                Installed (local)
              </button>
              <button type="button" onClick={() => setView('browse')}
                className={`px-3 py-1.5 ${view === 'browse' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>
                Browse registry (remote)
              </button>
            </div>
            {view === 'browse' ? (
              <button type="button" onClick={() => void loadCatalog()} disabled={catalogLoading}
                className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-60">
                {catalogLoading ? 'Refreshing…' : 'Refresh ↻'}
              </button>
            ) : (
              <button type="button" onClick={() => void rescanLocal()} disabled={rescanning}
                title="Rescan local repo folders for newly-added service packages (no restart needed)"
                className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-60">
                {rescanning ? 'Rescanning…' : 'Rescan local ↻'}
              </button>
            )}
          </div>
        </div>
        <p className="text-sm text-slate-400">
          {view === 'installed'
            ? 'Service TYPES on disk in your local repo(s). Install builds a type’s dependencies; Uninstall removes them. (To run one, drag it onto the Composer canvas.)'
            : 'Service types offered by your registries. Load downloads a type into your writable repo; Install builds its dependencies.'}
        </p>
        <SourcesPanel sources={sources} error={sourcesError} onRetry={loadSources} saving={savingSources} onSave={saveSources} />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={view === 'installed' ? 'Search installed types…' : 'Search registry…'}
          className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
        />
      </header>

      {error && <Banner tone="error">{error}</Banner>}
      {status && <Banner tone="success">{status}</Banner>}

      {view === 'installed' ? (
        <InstalledView
          entries={entries} loading={loading} busyId={busyId} query={query}
          doTypeInstall={doTypeInstall} setPendingUninstall={setPendingUninstall}
          uninstalling={uninstalling} setError={setError} rootWritable={rootWritable}
          installProgress={installProgress} onDismissInstall={dismissInstall}
        />
      ) : (
        <BrowseView
          rows={browseRows()} loading={catalogLoading && catalog === null} error={catalogError}
          query={query} regBusy={regBusy} rowError={rowError} onAction={regAction}
          installProgress={installProgress} onDismissInstall={dismissInstall}
        />
      )}

      {pendingUninstall && (() => {
        const metaId = `${pendingUninstall.name}@${pendingUninstall.version}`
        const instances = proxies.filter((p) => p.service_meta_id === metaId)
        const active = instances.filter((p) => ['installing', 'starting', 'running', 'stopping'].includes(p.status ?? ''))
        const willReset = instances.filter((p) => p.status !== 'placeholder')
        const blocked = active.length > 0
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl">
              <h2 className="text-base font-semibold text-slate-100">Uninstall {pendingUninstall.name}?</h2>
              <p className="mt-2 text-sm text-slate-300">
                Removes the installed dependencies for <span className="font-mono">{metaId}</span> (its shared
                virtual environment). Re-installing later rebuilds them.
              </p>
              {blocked ? (
                <div className="mt-3 rounded bg-rose-950/50 p-2 text-xs text-rose-200">
                  Stop these running instance(s) first:{' '}
                  <span className="font-mono">{active.map((p) => p.id).join(', ')}</span>
                </div>
              ) : willReset.length > 0 ? (
                <div className="mt-3 rounded bg-slate-800/60 p-2 text-xs text-slate-300">
                  {willReset.length} instance(s) will revert to grey placeholders and reinstall on next start:{' '}
                  <span className="font-mono">{willReset.map((p) => p.id).join(', ')}</span>
                </div>
              ) : null}
              {error && <div className="mt-3"><Banner tone="error">{error}</Banner></div>}
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => { setPendingUninstall(null); setError(null) }}
                  className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500">Cancel</button>
                <button type="button" onClick={() => confirmUninstall(pendingUninstall)} disabled={blocked || uninstalling}
                  className="rounded bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60">
                  {uninstalling ? 'Uninstalling…' : 'Uninstall'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ─── Sources panel (editable) ─────────────────────────────────────────

function SourcesPanel({
  sources, error, onRetry, saving, onSave,
}: {
  sources: SourcesResponse | null
  error: string | null
  onRetry: () => void
  saving: boolean
  onSave: (repoPaths: string[], registries: string[]) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [repoPaths, setRepoPaths] = useState<string[]>([])
  const [registries, setRegistries] = useState<string[]>([])

  // The writable root is config, not list-editable. Read-only repo_paths
  // are everything after it.
  const writableRoot = sources?.repo_roots.find((r) => r.writable)?.path
  const readonlyRoots = (sources?.repo_roots ?? []).filter((r) => !r.writable).map((r) => r.path)

  function beginEdit() {
    setRepoPaths(readonlyRoots)
    setRegistries(sources?.registries ?? [])
    setEditing(true)
  }

  // Don't silently vanish — surface why sources couldn't load (most
  // often: the backend serving this UI predates the /v1/registry/sources
  // endpoint and needs a restart).
  if (!sources) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-xs">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-semibold uppercase tracking-wide text-slate-400">Sources</span>
          <button type="button" onClick={onRetry} className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 hover:border-slate-500">Retry</button>
        </div>
        {error ? (
          <p className="text-amber-300">
            Couldn't load sources: {error}.{' '}
            <span className="text-slate-400">If you just updated, restart the backend (the /v1/registry/sources endpoint may not exist yet).</span>
          </p>
        ) : (
          <p className="text-slate-500">Loading sources…</p>
        )}
      </div>
    )
  }

  const move = (arr: string[], i: number, d: -1 | 1): string[] => {
    const j = i + d
    if (j < 0 || j >= arr.length) return arr
    const copy = [...arr]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    return copy
  }

  if (!editing) {
    // Collapsed by default — just a one-line signpost + Edit. The repo /
    // registry detail (and editing) appears only after Edit is pushed.
    const nRepos = sources.repo_roots.length
    const nReg = sources.registries.length
    return (
      <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs">
        <span className="text-slate-400">
          <span className="font-semibold uppercase tracking-wide">Sources</span>
          <span className="ml-2 text-slate-500">
            {nRepos} local repo{nRepos === 1 ? '' : 's'} · {nReg} registr{nReg === 1 ? 'y' : 'ies'}
          </span>
        </span>
        <button type="button" onClick={beginEdit} className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 hover:border-slate-500">Edit</button>
      </div>
    )
  }

  // ── edit mode ──
  return (
    <div className="rounded-lg border border-sky-800 bg-slate-900/60 p-3 text-xs">
      <div className="mb-2 font-semibold uppercase tracking-wide text-sky-300">Edit sources</div>

      <EditList
        title="Local repo paths (read-only roots; writable root is fixed)"
        placeholder="/path/to/robotlab_x-services"
        items={repoPaths} setItems={setRepoPaths} move={move}
        note={writableRoot ? `writable root (fixed): ${writableRoot}` : undefined}
      />
      <div className="my-3 border-t border-slate-800" />
      <EditList
        title="Registries (catalog.yml URLs, searched in order)"
        placeholder="https://repo.example/catalog.yml"
        items={registries} setItems={setRegistries} move={move}
      />

      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={() => setEditing(false)} disabled={saving}
          className="rounded border border-slate-700 px-3 py-1 text-slate-300 hover:border-slate-500 disabled:opacity-60">Cancel</button>
        <button type="button" disabled={saving}
          onClick={async () => { try { await onSave(repoPaths, registries); setEditing(false) } catch { /* error shown by parent */ } }}
          className="rounded bg-sky-600 px-3 py-1 font-medium text-white hover:bg-sky-500 disabled:opacity-60">
          {saving ? 'Saving…' : 'Save sources'}
        </button>
      </div>
    </div>
  )
}

function EditList({
  title, placeholder, items, setItems, move, note,
}: {
  title: string
  placeholder: string
  items: string[]
  setItems: (s: string[]) => void
  move: (arr: string[], i: number, d: -1 | 1) => string[]
  note?: string
}) {
  return (
    <div>
      <div className="mb-1 text-slate-400">{title}</div>
      {note && <div className="mb-1 font-mono text-[10px] text-slate-500">{note}</div>}
      <ul className="space-y-1">
        {items.map((val, i) => (
          <li key={i} className="flex items-center gap-1">
            <span className="w-5 shrink-0 text-right text-slate-500">{i + 1}.</span>
            <input value={val} placeholder={placeholder}
              onChange={(e) => { const c = [...items]; c[i] = e.target.value; setItems(c) }}
              className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-slate-200 focus:border-sky-500 focus:outline-none" />
            <button type="button" title="Move up" onClick={() => setItems(move(items, i, -1))} disabled={i === 0}
              className="rounded px-1 text-slate-400 hover:text-slate-200 disabled:opacity-30">↑</button>
            <button type="button" title="Move down" onClick={() => setItems(move(items, i, 1))} disabled={i === items.length - 1}
              className="rounded px-1 text-slate-400 hover:text-slate-200 disabled:opacity-30">↓</button>
            <button type="button" title="Delete" onClick={() => setItems(items.filter((_, k) => k !== i))}
              className="rounded px-1 text-rose-400 hover:text-rose-300">✕</button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => setItems([...items, ''])}
        className="mt-1 rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 hover:border-slate-500">+ Add</button>
    </div>
  )
}

// ─── INSTALLED view (type management only) ────────────────────────────

interface InstalledViewProps {
  entries: ServiceMeta[]
  loading: boolean
  busyId: string | null
  query: string
  doTypeInstall: (m: ServiceMeta) => void
  setPendingUninstall: (m: ServiceMeta | null) => void
  uninstalling: boolean
  setError: (s: string | null) => void
  rootWritable: Record<string, boolean>
  installProgress: Record<string, InstallProgressState>
  onDismissInstall: (id: string) => void
}

function InstalledView({
  entries, loading, busyId, query, doTypeInstall, setPendingUninstall, uninstalling, setError, rootWritable,
  installProgress, onDismissInstall,
}: InstalledViewProps) {
  const q = query.trim().toLowerCase()
  const shown = q
    ? entries.filter((m) =>
        [m.name, m.title ?? '', m.description ?? '', ...((m.tags as string[]) ?? [])].join(' ').toLowerCase().includes(q))
    : entries
  return (
    <div className="space-y-3">
      {loading && <Banner tone="info">Loading catalog…</Banner>}
      {shown.map((meta) => {
        const id = `${meta.name}@${meta.version}`
        const isPipType = !!meta.dependency_manager
        const phase = (meta.install_phase as TypeState | undefined)
          ?? (isPipType ? (meta.installed ? 'installed' : 'loaded') : 'installed')
        const installed = phase === 'installed'
        const busy = busyId === id
        const chip = STATE_CHIP[phase] ?? STATE_CHIP.loaded
        const root = meta.repo_root
        const writable = root ? rootWritable[root] : undefined
        const prog = installProgress[id]
        return (
          <article key={id} className="rounded-lg border border-slate-700 bg-slate-900/60 p-4">
            <header className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <ServiceIcon name={meta.name} version={meta.version} className="mt-0.5 h-8 w-8 shrink-0" />
                <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <h2 className="truncate text-sm font-semibold text-sky-300">{serviceTitle(meta)}</h2>
                  {!isPipType ? (
                    <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">builtin</span>
                  ) : (
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${chip.cls}`}>{chip.label}</span>
                  )}
                </div>
                <div className="truncate font-mono text-[11px] text-slate-500">{id}</div>
                {meta.description && <p className="mt-1 text-sm text-slate-300">{meta.description}</p>}
                {root && (
                  <p className="mt-1 text-[11px] text-slate-500" title={root}>
                    from <span className="font-mono text-slate-400">local: {shortPath(root)}</span>
                    {writable === false && <span className="ml-1 rounded bg-slate-800 px-1 text-[10px] text-slate-400">read-only</span>}
                  </p>
                )}
                {meta.tags && meta.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {meta.tags.map((tag: string) => (
                      <span key={tag} className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300">{tag}</span>
                    ))}
                  </div>
                )}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                {/* Builtins are installed-by-construction — no type action. */}
                {isPipType && installed && (
                  <button type="button" onClick={() => { setPendingUninstall(meta); setError(null) }} disabled={busy || uninstalling}
                    className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-rose-500 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-60">
                    Uninstall
                  </button>
                )}
                {/* "building venv…" only when there's no live progress to
                    render (e.g. an install kicked off elsewhere, or the
                    page reloaded mid-install). When `prog` exists the
                    InstallProgress panel below carries the detail. */}
                {isPipType && phase === 'installing' && !prog && <span className="text-xs text-amber-300">building venv…</span>}
                {isPipType && (phase === 'loaded' || phase === 'failed') && !prog && (
                  <button type="button" onClick={() => doTypeInstall(meta)} disabled={busy}
                    className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60">
                    {busy ? 'Installing…' : phase === 'failed' ? 'Retry install' : 'Install'}
                  </button>
                )}
              </div>
            </header>
            {/* Live install steps + log + retry — the same component the
                Composer canvas inspector uses. Supersedes the bare
                install_error line while a stream is attached. */}
            {prog ? (
              <div className="mt-3">
                <InstallProgress
                  state={prog}
                  onRetry={() => doTypeInstall(meta)}
                  onDismiss={() => onDismissInstall(id)}
                />
              </div>
            ) : meta.install_error && phase === 'failed' ? (
              <div className="mt-3 rounded bg-rose-950/50 p-2 text-xs text-rose-200">install failed: {meta.install_error}</div>
            ) : null}
          </article>
        )
      })}
      {!loading && shown.length === 0 && (
        <Banner tone="info">
          {q ? `No installed types match “${query.trim()}”.` : 'No services in the local catalog yet — try the Browse registry tab.'}
        </Banner>
      )}
    </div>
  )
}

// ─── BROWSE (registry) view ───────────────────────────────────────────

interface BrowseViewProps {
  rows: BrowseRow[]
  loading: boolean
  error: string | null
  query: string
  regBusy: string | null
  rowError: { metaId: string; phase: 'load' | 'install'; msg: string } | null
  onAction: (endpoint: 'load' | 'install' | 'uninstall', row: BrowseRow) => void
  installProgress: Record<string, InstallProgressState>
  onDismissInstall: (id: string) => void
}

function BrowseView({ rows, loading, error, query, regBusy, rowError, onAction, installProgress, onDismissInstall }: BrowseViewProps) {
  if (error) return <Banner tone="error">Couldn't reach the registry: {error}. Check the Registries list above.</Banner>
  return (
    <div className="space-y-3">
      {loading && <Banner tone="info">Loading registry…</Banner>}
      {!loading && rows.length === 0 && (
        <Banner tone="info">{query ? `No services match “${query.trim()}”.` : 'The registry is empty.'}</Banner>
      )}
      {rows.map((row) => {
        const chip = STATE_CHIP[row.state]
        const busy = regBusy === row.metaId
        const err = rowError && rowError.metaId === row.metaId ? rowError : null
        const prog = installProgress[row.metaId]
        return (
          <article key={row.metaId} className="rounded-lg border border-slate-700 bg-slate-900/60 p-4">
            <header className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <ServiceIcon name={row.name} version={row.version} className="mt-0.5 h-8 w-8 shrink-0" />
                <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <h2 className="truncate font-mono text-sm font-semibold text-sky-300">{row.metaId}</h2>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${chip.cls}`}>{chip.label}</span>
                </div>
                {row.description && <p className="mt-1 text-sm text-slate-300">{row.description}</p>}
                {row.sourceRegistry && (
                  <p className="mt-1 break-all text-[11px] text-slate-500">
                    from <span className="font-mono text-slate-400">registry: {row.sourceRegistry}</span>
                  </p>
                )}
                {row.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {row.tags.map((t) => (<span key={t} className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300">{t}</span>))}
                  </div>
                )}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                {row.state === 'absent' && (
                  <ActionButton busy={busy} label="Load" busyLabel="Loading…" tone="sky" onClick={() => onAction('load', row)} />
                )}
                {(row.state === 'loaded' || row.state === 'failed') && (
                  <ActionButton busy={busy} label={row.state === 'failed' ? 'Retry install' : 'Install'} busyLabel="Installing…" tone="emerald" onClick={() => onAction('install', row)} />
                )}
                {row.state === 'failed' && (
                  <ActionButton busy={busy} label="Re-load" busyLabel="Loading…" tone="ghost" onClick={() => onAction('load', row)} />
                )}
                {row.state === 'installing' && !prog && <span className="text-xs text-amber-300">building venv…</span>}
                {row.state === 'installed' && (
                  <ActionButton busy={busy} label="Uninstall" busyLabel="Uninstalling…" tone="ghost" onClick={() => onAction('uninstall', row)} />
                )}
              </div>
            </header>
            {/* Live install steps + log — identical component + behavior to
                the Installed view and the Composer canvas inspector. */}
            {prog ? (
              <div className="mt-3">
                <InstallProgress
                  state={prog}
                  onRetry={() => onAction('install', row)}
                  onDismiss={() => onDismissInstall(row.metaId)}
                />
              </div>
            ) : err ? (
              <div className="mt-3 rounded bg-rose-950/50 p-2 text-xs text-rose-200">
                {err.phase === 'load' ? 'Load failed (could not fetch/verify the bits): ' : 'Install failed (dependency build): '}
                {err.msg}
              </div>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}

function ActionButton({
  busy, label, busyLabel, tone, onClick,
}: {
  busy: boolean
  label: string
  busyLabel: string
  tone: 'sky' | 'emerald' | 'ghost'
  onClick: () => void
}) {
  const cls = tone === 'sky'
    ? 'bg-sky-600 text-white hover:bg-sky-500'
    : tone === 'emerald'
      ? 'bg-emerald-600 text-white hover:bg-emerald-500'
      : 'border border-slate-700 text-slate-300 hover:border-rose-500 hover:text-rose-300'
  return (
    <button type="button" onClick={onClick} disabled={busy}
      className={`rounded px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${cls}`}>
      {busy ? busyLabel : label}
    </button>
  )
}
