// Config-set switcher — stone 7 of the config-sets spec.
//
// Renders a compact chip showing the active set name. Click to open
// a dialog listing every set on disk; pick one + restart-required hint.
// Also exposes "Duplicate" and "Delete" file ops.
//
// Endpoints (config_set is a normal DSL model — generated router backed by
// services/config_set_service.py):
//   GET  /v1/config-sets            → ConfigSet[] (each flags active/pending)
//   GET  /v1/config-sets/{name}     → ConfigSet detail (start_order + candidates)
//   POST /v1/config-sets-request    → {action: switch|duplicate|delete, …}
//                                      returns {metadata, records}
//
// We share a singleton client via `useApiFetch` rather than a bespoke
// hook so the existing auth + base-url plumbing covers us for free.
import { useCallback, useEffect, useState } from 'react'
import { Boxes, Loader2 } from 'lucide-react'

import { useApiFetch } from '../contexts/ActiveRuntimeContext'
import { ConfirmDialog } from './ConfirmDialog'
import { PromptDialog } from './PromptDialog'
import { CopyButton } from './CopyButton'


// One record per set. The list endpoint returns ConfigSet[] — each row
// flags whether it's the live `active` set and/or the `pending` (next-boot)
// one, and carries the shared `root_dir`. (No wrapper object anymore.)
interface SetSummary {
  name: string
  active: boolean
  pending?: boolean
  proxy_count: number
  has_runtime_yml: boolean
  root_dir?: string
  path: string
}

interface ProxyFileInfo {
  proxy_id: string
  type_id: string | null
  in_start_order: boolean
  parse_error?: string | null
  path?: string | null
}

interface SetDetail {
  name: string
  active: boolean
  path: string
  start_order: string[]
  proxies: ProxyFileInfo[]
  candidates: ProxyFileInfo[]
}


export function ConfigSetSwitcher() {
  const apiFetch = useApiFetch()
  const [open, setOpen] = useState(false)
  const [sets, setSets] = useState<SetSummary[]>([])
  const [rootDir, setRootDir] = useState<string>('')
  const [activeName, setActiveName] = useState<string>('default')
  const [pendingName, setPendingName] = useState<string>('')
  const [detail, setDetail] = useState<SetDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)

  // Modal state for native-dialog replacements (rule:
  // feedback_no_native_dialogs — never use window.alert/confirm/prompt).
  const [restartNotice, setRestartNotice] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [copyTarget, setCopyTarget] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const refreshList = useCallback(async () => {
    setError(null)
    try {
      const data = await apiFetch<SetSummary[]>('/v1/config-sets')
      const list = Array.isArray(data) ? data : []
      const active = list.find((s) => s.active)?.name ?? 'default'
      setSets(list)
      setRootDir(list[0]?.root_dir ?? '')
      setActiveName(active)
      setPendingName(list.find((s) => s.pending)?.name ?? active)
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc))
    }
  }, [apiFetch])

  // Restart the backend so a pending config-set switch takes effect (works
  // headless — the process re-execs its recorded launch command). Then poll
  // until it's back, refresh to show the now-active set, and close the
  // dialog. The global connection indicator handles the ws reconnect.
  const doRestart = useCallback(async () => {
    setRestarting(true)
    setError(null)
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

    // Capture the current process's start time so we can tell the *new*
    // process from the old one — the backend stays up while it drains
    // services, so polling /v1/version alone would dismiss too early.
    let beforeStartedAt: number | null = null
    try {
      const info = await apiFetch<{ started_at?: number }>('/v1/system/info')
      beforeStartedAt = info.started_at ?? null
    } catch {
      /* ignore — we'll still poll below */
    }

    try {
      await apiFetch('/v1/system/restart', { method: 'POST' })
    } catch {
      /* the process is going down; the response may not arrive — fine. */
    }

    await sleep(1500)
    const deadline = Date.now() + 120_000 // drain + reboot can take a bit
    while (Date.now() < deadline) {
      try {
        const info = await apiFetch<{ started_at?: number }>('/v1/system/info')
        // A different started_at means the fresh (post-exec) process is up.
        if (beforeStartedAt == null || info.started_at !== beforeStartedAt) {
          await refreshList()        // reflect the now-active set
          setRestarting(false)
          setRestartNotice(null)     // dismiss the dialog
          return
        }
      } catch {
        /* still down / draining — keep polling */
      }
      await sleep(1000)
    }
    setRestarting(false)
    setError('Backend did not restart within 120s — check the server, then refresh.')
  }, [apiFetch, refreshList])

  // Always know the active name for the chip — refresh on mount.
  useEffect(() => {
    void refreshList()
  }, [refreshList])

  // When the dialog opens, load detail for the active set.
  useEffect(() => {
    if (!open) {
      setDetail(null)
      return
    }
    void refreshList()
  }, [open, refreshList])

  const loadDetail = useCallback(async (name: string) => {
    setDetailLoading(true)
    setError(null)
    try {
      const data = await apiFetch<SetDetail>(`/v1/config-sets/${encodeURIComponent(name)}`)
      setDetail(data)
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc))
    } finally {
      setDetailLoading(false)
    }
  }, [apiFetch])

  const handleSwitch = useCallback(async (name: string) => {
    if (name === activeName) return
    setPendingAction(`switch:${name}`)
    setError(null)
    try {
      await apiFetch('/v1/config-sets-request', {
        method: 'POST',
        body: JSON.stringify({ action: 'switch', name }),
      })
      await refreshList()
      // Show the restart-required hint via the in-app notice dialog.
      // The marker file is written; switching takes effect on next
      // backend boot.
      setRestartNotice(name)
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc))
    } finally {
      setPendingAction(null)
    }
  }, [activeName, apiFetch, refreshList])

  // Duplicate is a two-step flow: clicking "Copy" opens the prompt
  // dialog (set ``copyTarget``), then submitDuplicate runs the actual
  // POST. Same pattern for delete: confirm dialog → submitDelete.
  const submitDuplicate = useCallback(async (sourceName: string, newName: string) => {
    setPendingAction(`duplicate:${sourceName}`)
    setError(null)
    try {
      await apiFetch('/v1/config-sets-request', {
        method: 'POST',
        body: JSON.stringify({ action: 'duplicate', name: sourceName, new_name: newName }),
      })
      await refreshList()
      setCopyTarget(null)
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc))
    } finally {
      setPendingAction(null)
    }
  }, [apiFetch, refreshList])

  const submitDelete = useCallback(async (name: string) => {
    setPendingAction(`delete:${name}`)
    setError(null)
    try {
      await apiFetch('/v1/config-sets-request', {
        method: 'POST',
        body: JSON.stringify({ action: 'delete', name }),
      })
      await refreshList()
      if (detail?.name === name) setDetail(null)
      setDeleteTarget(null)
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc))
    } finally {
      setPendingAction(null)
    }
  }, [apiFetch, detail, refreshList])

  return (
    <>
      {/* Chip: matches the slate surface + sky accent of RuntimeSwitcher. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-200 hover:border-slate-500"
        title={
          pendingName && pendingName !== activeName
            ? `Running set: ${activeName} — ${pendingName} pending (restart to apply)`
            : `Active config set: ${activeName}`
        }
      >
        <Boxes size={14} className="text-slate-400" />
        <span className="text-slate-500">set</span>
        <span className="font-mono">{activeName}</span>
        {pendingName && pendingName !== activeName && (
          <span className="font-mono text-amber-300" title="Restart to apply">→ {pendingName}*</span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-[640px] max-h-[80vh] overflow-auto rounded border border-slate-700 bg-slate-950 p-4 text-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-100">Config sets</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                ×
              </button>
            </div>

            {/* Filesystem location — operators shell to this dir, git it,
                back it up. Shown as a monospace block they can select +
                copy without losing the slashes. */}
            {rootDir && (
              <div className="mb-3 flex items-center gap-2 rounded border border-slate-800 bg-slate-950/60 px-2 py-1 text-[11px]">
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-slate-500">
                  on disk
                </span>
                <code className="select-all truncate font-mono text-slate-300" title={rootDir}>
                  {rootDir}
                </code>
                <CopyButton value={rootDir} />
              </div>
            )}

            {error && (
              <div className="mb-2 rounded border border-red-900 bg-red-950/30 px-2 py-1 text-[11px] text-red-300">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              {/* Left: list of sets */}
              <ul className="flex flex-col gap-1">
                {sets.length === 0 ? (
                  <li className="text-slate-500">no sets discovered</li>
                ) : (
                  sets.map((s) => (
                    <li
                      key={s.name}
                      className={`flex items-center justify-between gap-2 rounded border px-2 py-1 ${
                        s.active ? 'border-emerald-700 bg-emerald-950/20' : 'border-slate-800 bg-slate-900/40'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => void loadDetail(s.name)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        title={s.path}
                      >
                        <span className={`text-[11px] ${s.active ? 'text-emerald-400' : 'text-slate-500'}`}>
                          {s.active ? '●' : '○'}
                        </span>
                        <span className="font-mono text-slate-200">{s.name}</span>
                        {s.active && (
                          <span className="rounded bg-emerald-900/60 px-1 text-[9px] uppercase tracking-wide text-emerald-300">live</span>
                        )}
                        {!s.active && s.name === pendingName && (
                          <span className="rounded bg-amber-900/60 px-1 text-[9px] uppercase tracking-wide text-amber-300" title="Selected for the next boot — restart to apply">next boot</span>
                        )}
                        <span className="text-[10px] text-slate-500">{s.proxy_count} proxies</span>
                      </button>
                      <div className="flex shrink-0 gap-1">
                        {!s.active && (
                          <button
                            type="button"
                            onClick={() => void handleSwitch(s.name)}
                            disabled={pendingAction !== null}
                            className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 disabled:opacity-40"
                          >
                            {pendingAction === `switch:${s.name}` ? <Loader2 size={10} className="animate-spin" /> : 'Switch'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setCopyTarget(s.name)}
                          disabled={pendingAction !== null}
                          className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 disabled:opacity-40"
                        >
                          Copy
                        </button>
                        {!s.active && s.name !== 'default' && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(s.name)}
                            disabled={pendingAction !== null}
                            className="rounded border border-red-900 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-950/50 disabled:opacity-40"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </li>
                  ))
                )}
              </ul>

              {/* Right: detail for a clicked set */}
              <div className="border-l border-slate-800 pl-3 text-[11px]">
                {detailLoading ? (
                  <div className="flex items-center gap-1 text-slate-500">
                    <Loader2 size={12} className="animate-spin" />
                    loading…
                  </div>
                ) : detail ? (
                  <>
                    <h3 className="mb-1 font-semibold text-slate-200">{detail.name}</h3>
                    {/* The set's own path — operators can copy this to
                        cd straight in. select-all so a single triple-
                        click grabs the whole thing. */}
                    <div className="mb-2 flex items-center gap-1 rounded border border-slate-800 bg-slate-950/60 px-1.5 py-0.5">
                      <code className="select-all break-all font-mono text-[10px] text-slate-400 flex-1" title={detail.path}>
                        {detail.path}
                      </code>
                      <CopyButton value={detail.path} size={10} />
                    </div>
                    <div className="mb-2 text-slate-500">
                      start_order ({detail.start_order.length}):
                    </div>
                    <ul className="mb-2 ml-2 list-disc text-slate-300">
                      {detail.proxies.map((p) => (
                        <li
                          key={p.proxy_id}
                          className={p.parse_error ? 'text-red-400' : ''}
                          title={p.path ?? ''}
                        >
                          <span className="font-mono">{p.proxy_id}</span>
                          {p.type_id && <span className="ml-1 text-slate-500">→ {p.type_id}</span>}
                          {p.parse_error && <span className="ml-1 text-red-400">({p.parse_error})</span>}
                        </li>
                      ))}
                    </ul>
                    {detail.candidates.length > 0 && (
                      <>
                        <div className="mb-1 text-slate-500">
                          candidates ({detail.candidates.length}):
                        </div>
                        <ul className="ml-2 list-disc text-slate-400">
                          {detail.candidates.map((c) => (
                            <li key={c.proxy_id} title={c.path ?? ''}>
                              <span className="font-mono">{c.proxy_id}</span>
                              {c.type_id && <span className="ml-1 text-slate-500">→ {c.type_id}</span>}
                              {c.parse_error && <span className="ml-1 text-red-400">({c.parse_error})</span>}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                ) : (
                  <div className="text-slate-500">
                    Click a set on the left to see its proxies + candidates.
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 border-t border-slate-800 pt-2 text-[10px] text-slate-500">
              {pendingName && pendingName !== activeName ? (
                <div className="mb-1 text-amber-300">
                  Running <span className="font-mono">{activeName}</span>; <span className="font-mono">{pendingName}</span> will load on next restart.
                  Live edits go to <span className="font-mono">{activeName}</span> (the running set) until you restart.
                </div>
              ) : null}
              Switching a set takes effect on the next backend restart — the
              live process keeps reading/writing the set it booted with, so a
              switch never alters the running set.
            </div>
          </div>
        </div>
      )}

      {/* Restart-required notice — the alert() replacement. Single-
          button dialog, dismisses on OK or Escape. */}
      {restartNotice !== null && (
        <ConfirmDialog
          title="Set switched — restart to apply"
          message={
            <>
              <p>
                Active set marker written: <span className="font-mono">{restartNotice}</span>
              </p>
              <p className="mt-2 text-[12px] text-slate-400">
                {restarting
                  ? 'Restarting the backend… the connection will drop and reconnect on its own.'
                  : 'Restart the backend now to switch to this set, or later. Until you restart, the current set keeps running.'}
              </p>
            </>
          }
          confirmLabel={restarting ? 'Restarting…' : 'Restart now'}
          cancelLabel={restarting ? null : 'Later'}
          onConfirm={() => { if (!restarting) void doRestart() }}
          onCancel={() => setRestartNotice(null)}
        />
      )}

      {/* Copy prompt — the prompt() replacement. Validates that the
          target name doesn't already exist in the set list. */}
      {copyTarget !== null && (
        <PromptDialog
          title={`Copy "${copyTarget}"`}
          message="The new set is a deep copy of every yml file in the source. You can switch to it from this dialog after creation."
          label="New set name"
          initialValue={`${copyTarget}-copy`}
          submitLabel="Copy"
          busy={pendingAction === `duplicate:${copyTarget}`}
          validate={(value) => {
            if (!/^[A-Za-z0-9][A-Za-z0-9_\-]*$/.test(value)) {
              return 'Only letters, digits, dash, underscore. Must start with a letter or digit.'
            }
            if (sets.some((s) => s.name === value)) {
              return `A set named ${value} already exists.`
            }
            return null
          }}
          onSubmit={(newName) => submitDuplicate(copyTarget, newName)}
          onCancel={() => setCopyTarget(null)}
        />
      )}

      {/* Delete confirmation — the confirm() replacement. Danger
          variant; the dialog itself is the friction the destructive
          action needs. */}
      {deleteTarget !== null && (
        <ConfirmDialog
          title={`Delete "${deleteTarget}"?`}
          message={
            <>
              <p>This removes every yml file under the set from disk.</p>
              <p className="mt-2 text-[12px] text-slate-400">
                Files are deleted, not moved to a trash folder. This can't be
                undone from the UI — recover via git or a filesystem backup.
              </p>
            </>
          }
          confirmLabel="Delete"
          variant="danger"
          busy={pendingAction === `delete:${deleteTarget}`}
          onConfirm={() => submitDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  )
}
