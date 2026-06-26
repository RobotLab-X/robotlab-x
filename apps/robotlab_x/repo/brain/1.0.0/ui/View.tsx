// Brain — view_full panel for the brain service.
//
// Three stacked sections:
//   1. Workflows — fetched via list_workflows; one card per workflow with
//      a "Start" button that opens an input form for any required inputs.
//   2. Active runs — pulled from the retained /brain/{id}/state snapshot
//      (active_runs list). Each row shows status + Cancel; approval-gated
//      workflows also get an Approve / Deny pair.
//   3. Step log — subscribes to /brain/{id}/runs/<latest>/steps. Auto-
//      switches to whichever run was most recently started so the operator
//      sees the live trace without manually picking one. Falls back to the
//      first active run otherwise.
//
// Actions are dispatched the same way every other service view does it:
// publish to /brain/{id}/control with {action, ...args, reply_to} and
// listen for a one-shot reply on a /cli/reply/... topic.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'

import type { ServiceProxy } from '@rlx/ui'
import { type InboundFrame } from '@rlx/ui'
import { useApiFetch, useWsClient } from '@rlx/ui'
import { FileTree, entryKey, type FileTreeContextEvent } from './brain/FileTree'
import { FileViewer } from './brain/FileViewer'
import {
  deleteBrainPath,
  fetchBrainFile, fetchBrainTree, forkBrainWorkflow, duplicateBrainWorkflow,
  newBrainWorkflow, renameBrainPath, saveBrainFile,
  type FileContentResponse, type FileEntry, type FileSource, type FileTreeResponse,
  type ForkResponse, type MtimeConflictBody,
} from './brain/brainApi'
import { ConfirmDialog } from '@rlx/ui'
import { PromptDialog } from '@rlx/ui'
import { CopyButton } from '@rlx/ui'
import { ContextMenu, type ContextMenuItem } from '@rlx/ui'
import {
  Copy as CopyIcon, Edit3 as EditIcon,
  Pencil as RenameIcon, Settings as SettingsIcon, Trash2 as DeleteIcon,
  Plus as PlusIcon, RotateCw as RefreshIcon,
  Play as PlayIcon, Square as StopIcon, Save as SaveIcon,
} from 'lucide-react'


// ─── shapes mirroring brain/schemas.py + service responses ──────────

interface RunConfiguration {
  name: string
  backend: string
  model?: string | null
  description?: string
}

interface WorkflowSummary {
  name: string
  description: string
  // ``preferred_backend`` (one of mock/ollama/anthropic/openai) is
  // what the workflow declares as its default adapter. ``preferred_model``
  // (when set) pins a specific model id like ``llama3.2:3b`` —
  // overrides the backend's BrainConfig default just for this
  // workflow. Previously the brain returned ``model`` for the
  // backend; it was misleading because it never named a model.
  preferred_backend: string
  preferred_model?: string | null
  // Operator-curated alternates. The toolbar's configuration
  // dropdown surfaces these; picking one populates the backend +
  // model fields and clears the "override" tint.
  configurations?: RunConfiguration[]
  max_steps: number
  requires_human_approval: boolean
  source?: string
  error?: string  // set when the brain failed to parse this one
}

interface WorkflowInputSpec {
  type: 'string' | 'integer' | 'boolean' | 'number'
  description?: string
  required?: boolean
  default?: unknown
}

interface ListWorkflowsReply {
  workflows?: WorkflowSummary[]
  // Some sites return them keyed differently; the brain returns {workflows}.
}

// One backend descriptor as returned by get_backends. ``fields`` is
// per-backend specific — ollama has base_url+model, anthropic/openai add
// has_credential, mock has nothing.
interface BackendDescriptor {
  name: 'mock' | 'ollama' | 'anthropic' | 'openai'
  kind: 'stub' | 'local' | 'cloud'
  configured: boolean
  fields: {
    base_url?: string
    model?: string
    has_credential?: boolean
  }
}

interface GetBackendsReply {
  active: string
  backends: BackendDescriptor[]
}

// Mirrors brain/schemas.py::ToolDescriptor. Each entry is one action
// on one peer service that brain offers to the LLM as a callable tool.
interface ToolDescriptor {
  topic: string
  action: string
  description?: string
  parameters?: Record<string, unknown>
}

interface ListToolsReply {
  tools?: ToolDescriptor[]
  count?: number
}

interface TestBackendReply {
  ok: boolean
  detail?: string
  error?: string
  models?: string[]
}

interface StartWorkflowReply {
  run_id?: string
  status?: string
  error?: string
}

interface ActiveRunSummary {
  run_id: string
  status: string
  workflow: string
  // ``backend`` + ``model_id`` are the RESOLVED values the run is
  // using right now — per-call override > workflow.preferred_* >
  // config default. ``model_id`` is null when the adapter is using
  // its configured default (BrainConfig.<backend>_model). The UI's
  // active-run pill + workflow card read these to display what's
  // actually running, not what's in the yaml.
  backend?: string
  model_id?: string | null
}

interface BrainState {
  workspace?: string
  default_model?: string
  active_runs?: ActiveRunSummary[]
  tool_count?: number
  backends?: Array<{ name: string; configured: boolean }>
}

interface StepRecord {
  ts: string
  step: number
  model: string
  action?: {
    kind: 'tool' | 'done'
    topic?: string | null
    action?: string | null
    rationale?: string | null
  }
  verdict?: {
    allowed: boolean
    reason?: string
    guard?: string | null
  }
}

interface RunResultPayload {
  status: 'success' | 'failure' | 'cancelled'
  body: string
}

// Engine-published lifecycle event. Brain emits these on
// /brain/<proxy_id>/workflow_events at the bookends of every run.
// The Steps tab renders them as "framework" rows above the first
// model step (started) and below the last (ended) so the operator
// can see where the engine took over vs where the model was acting.
interface WorkflowEvent {
  event: 'started' | 'ended'
  workflow: string
  run_id: string
  started_at: string
  // started-only fields
  inputs?: Record<string, unknown>
  model?: string
  // ended-only fields
  ended_at?: string
  status?: string
  tool_calls_count?: number
  duration_ms?: number | null
  result_summary?: string
  failure_reason?: string
}

// Mirrors brain/schemas.py::ToolCallRecord. Each entry is one
// concrete bus message brain published to a peer service's control
// topic during a run, with the args sent + the result that came
// back. The Topics tab of the output pane renders these.
interface ToolCallMsg {
  ts: string
  step: number
  tool_call_id: string
  topic: string
  action: string
  args: Record<string, unknown>
  result: {
    status?: 'ok' | 'error' | 'timeout' | string
    body?: unknown
    error?: string | null
  }
}

// Reply timeout for list/start/cancel/approve.
const REPLY_TIMEOUT_MS = 8_000


// Workflow inputs are typically only a handful — fetch once and load on
// demand. We DON'T re-fetch on every render; instead the user can click
// "Refresh" if they edit workflow.yaml on disk and want the new list.
function defaultForInput(spec: WorkflowInputSpec): string {
  if (spec.default == null) return ''
  return String(spec.default)
}


// One brain instance per panel. The proxy id from the canvas drives every
// topic; switching runtimes re-mounts this component so we don't need to
// re-subscribe on prop changes here.
// Hide bundled (shipped, read-only) entries from the tree while keeping
// the structural "workflows" container. Workspace/forked entries + any
// surviving dirs stay. Recurses into children.
function filterOutBundled(
  entries: import('./brain/brainApi').FileEntry[],
): import('./brain/brainApi').FileEntry[] {
  const out: import('./brain/brainApi').FileEntry[] = []
  for (const e of entries) {
    if (e.source === 'bundled' && e.path !== 'workflows') continue
    out.push(e.children ? { ...e, children: filterOutBundled(e.children) } : e)
  }
  return out
}

export default function BrainFullView({ proxy }: { proxy: ServiceProxy }) {
  const wsClient = useWsClient()
  const proxyId = proxy.id ?? proxy.name ?? ''
  const stateTopic = `/brain/${proxyId}/state`
  const controlTopic = `/brain/${proxyId}/control`

  const [state, setState] = useState<BrainState>({})
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([])
  // Backend catalog (full detail — base_url, model, has_credential) loaded
  // via get_backends. Refreshed after every set/clear so the UI always
  // shows the persisted truth.
  const [backends, setBackends] = useState<BackendDescriptor[]>([])
  const [activeBackend, setActiveBackend] = useState<string>('mock')
  // Per-backend draft for the inline edit form. Keyed by name + field
  // so a half-typed api_key for openai doesn't bleed into anthropic.
  // ``api_key`` lives only in this draft state — once Apply runs it's
  // sent to the backend and cleared from the draft (we never echo it
  // back from the service).
  const [backendDraft, setBackendDraft] = useState<Record<string, { base_url?: string; api_key?: string; model?: string }>>({})
  // Last test result per backend, keyed by name.
  const [testResult, setTestResult] = useState<Record<string, TestBackendReply>>({})
  // Cached list of available models per backend, populated lazily
  // via the brain's list_backend_models action. Drives the model
  // input's datalist suggestions so the operator picks from real
  // ids instead of typing them. Empty value (``[]``) means "fetched
  // but came back empty"; missing key means "not yet fetched".
  const [backendModels, setBackendModels] = useState<Record<string, string[]>>({})
  const [backendModelsBusy, setBackendModelsBusy] = useState<Record<string, boolean>>({})
  // Which backend's settings form is currently expanded.
  const [expandedBackend, setExpandedBackend] = useState<string | null>(null)
  // The backend section is collapsed by default — once the operator
  // picks a backend for the session, they rarely need to revisit it.
  // Clicking "Change…" expands the full picker; collapses back on
  // successful Apply.
  const [showBackendPicker, setShowBackendPicker] = useState(false)
  // Tool catalog inspector. Clicking the "<N> tools" chip dispatches
  // list_tools and toggles the inline panel. Refreshed each open so
  // the count + the list stay in sync as services come and go.
  const [showTools, setShowTools] = useState(false)
  const [toolsList, setToolsList] = useState<ToolDescriptor[] | null>(null)
  const [toolsFilter, setToolsFilter] = useState('')

  // Wire log — a rolling buffer of every request/reply pair sent through
  // dispatch(). Helps the operator see exactly what the panel sent and
  // what the brain answered without resorting to devtools. Last 20.
  type WireEntry = {
    ts: number
    action: string
    request: Record<string, unknown>
    reply?: unknown
    error?: string
    latencyMs?: number
  }
  const [wireLog, setWireLog] = useState<WireEntry[]>([])
  // Bottom output pane — tabbed view of run output.
  //   * steps  → engine step trace (live from /steps subscription)
  //   * wire   → request/reply for every dispatch() call this panel made
  //   * topics → bus messages brain published during the run, with
  //              args + result (live from /tool_calls subscription)
  // ``outputCollapsed`` hides the body but keeps the tab bar visible
  // so the operator can still see "wire (5)" pulse during a request.
  const [outputTab, setOutputTab] = useState<'steps' | 'wire' | 'topics'>('steps')
  const [outputCollapsed, setOutputCollapsed] = useState<boolean>(false)
  const [toolCalls, setToolCalls] = useState<ToolCallMsg[]>([])
  const [expandedToolCallId, setExpandedToolCallId] = useState<string | null>(null)
  // Settings drawer — slides over the right side of the brain panel
  // when the gear icon is clicked. Holds backend picker + filesystem
  // paths. Closed by default so the main view stays clean.
  const [showSettings, setShowSettings] = useState(false)
  // Splitter sizes — both have drag handles. Bounds keep them
  // pragmatically usable: drawer can't take more than 90% of the
  // brain panel width; output pane between ~80px (tab bar barely
  // visible) and 800px (very generous).
  const [drawerWidth, setDrawerWidth] = useState(420)
  const [outputHeight, setOutputHeight] = useState(192)
  // Explorer (file tree) width — drag-resizable so the operator can
  // give long workflow names room without truncating. Persisted to
  // localStorage so the chosen width survives reloads. 256px default
  // matches the previous fixed ``w-64``.
  const [explorerWidth, setExplorerWidth] = useState<number>(() => {
    try {
      const v = parseInt(localStorage.getItem('rlx-brain-explorer-width') || '', 10)
      return Number.isFinite(v) && v >= 160 ? v : 256
    } catch {
      return 256
    }
  })
  useEffect(() => {
    try { localStorage.setItem('rlx-brain-explorer-width', String(explorerWidth)) } catch { /* ignore */ }
  }, [explorerWidth])
  const [splitHover, setSplitHover] = useState(false)
  // Show/hide bundled (read-only, shipped) workflows in the tree. Off =
  // only your workspace/forked workflows show. Persisted.
  const [showBundled, setShowBundled] = useState<boolean>(() => {
    try { return localStorage.getItem('rlx-brain-show-bundled') !== '0' } catch { return true }
  })
  useEffect(() => {
    try { localStorage.setItem('rlx-brain-show-bundled', showBundled ? '1' : '0') } catch { /* ignore */ }
  }, [showBundled])
  // Shared splitter-drag helper — installs window mousemove/up
  // listeners while the user drags. Callers compute the new
  // dimension in ``apply`` (passing the delta from drag start) and
  // clamp to whatever bounds make sense for the splitter.
  const startDrag = useCallback(
    (
      startClient: number,
      axis: 'x' | 'y',
      apply: (delta: number) => void,
    ) => {
      const onMove = (mv: MouseEvent) => {
        const cur = axis === 'x' ? mv.clientX : mv.clientY
        apply(cur - startClient)
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
      }
      // Lock text-selection + show the resize cursor for the whole drag,
      // not just while the pointer is over the 6px handle.
      document.body.style.userSelect = 'none'
      document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [],
  )

  // ── file browser state (stone A of TODO_BRAIN_VIEWER.md) ─────────
  const apiFetch = useApiFetch()
  const [tree, setTree] = useState<FileTreeResponse | null>(null)
  // Currently-highlighted tree entry. Drives what the right pane
  // shows:
  //   * workflow directory  → Workflow card (Run/Stop + inputs form)
  //   * other directory     → empty hint
  //   * file                → existing FileViewer (selection follows
  //                           ``openFile``)
  // Selection is independent of expansion: clicking a folder row
  // selects it without auto-opening its children. The chevron handles
  // expand/collapse separately. Mirrors VSCode/JetBrains behaviour.
  const [selectedEntry, setSelectedEntry] = useState<FileEntry | null>(null)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [openFile, setOpenFile] = useState<FileContentResponse | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  // Stone C: edit state. ``editBuffer`` is null when not editing; the
  // string value when editing. ``dirty`` derives from comparing
  // buffer to the on-disk content we last loaded.
  const [editBuffer, setEditBuffer] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Pending file the operator wants to open while a dirty edit is in
  // progress. We park the open intent + show a ConfirmDialog; the
  // user decides whether to discard or stay.
  const [pendingOpen, setPendingOpen] = useState<{ path: string; source: FileSource } | null>(null)
  // mtime conflict dialog payload. When set, the operator chooses
  // between "keep mine (force overwrite)" + "take theirs (discard
  // my buffer + reload)".
  const [conflict, setConflict] = useState<MtimeConflictBody | null>(null)
  // Stone D: fork confirmation. When viewing a bundled file, the
  // operator clicks "Fork to workspace" → this captures the target
  // (always normalized to the workflow directory) → ConfirmDialog
  // shows what'll be copied → on confirm POST /files/fork + reopen
  // the same file from workspace.
  const [forkPrompt, setForkPrompt] = useState<string | null>(null)
  const [forking, setForking] = useState(false)
  const [forkSuccess, setForkSuccess] = useState<ForkResponse | null>(null)
  // Tree context menu — open when the operator right-clicks a row or
  // clicks the hover-revealed "..." button. Items derived from the
  // entry by ``contextMenuForEntry`` below.
  const [contextMenu, setContextMenu] = useState<{
    items: ContextMenuItem[]
    position: { x: number; y: number }
  } | null>(null)
  // Stone E: new-workflow + rename + delete dialogs. Each operation
  // is a two-step (button → dialog → confirm) flow so the operator
  // can't accidentally trash a workflow with a stray click.
  const [showNewWorkflow, setShowNewWorkflow] = useState(false)
  const [busyNewWorkflow, setBusyNewWorkflow] = useState(false)
  const [renameTarget, setRenameTarget] = useState<{ path: string; basename: string } | null>(null)
  const [busyRename, setBusyRename] = useState(false)
  const [duplicateTarget, setDuplicateTarget] = useState<{ sourcePath: string; srcName: string } | null>(null)
  const [busyDuplicate, setBusyDuplicate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<
    { path: string; isDir: boolean; label: string } | null
  >(null)
  const [busyDelete, setBusyDelete] = useState(false)
  // "Clear all runs data" confirm + busy flags. Clears the on-disk run
  // artifacts (<workspace>/runs/) via the brain's clear_runs method;
  // in-flight runs are preserved server-side.
  const [clearRunsOpen, setClearRunsOpen] = useState(false)
  const [clearingRuns, setClearingRuns] = useState(false)
  // Per-section collapse state for the remaining inline section
  // ("active runs"). Keyed by section id; ``true`` = collapsed.
  // Empty default = open. Backends moved to the Settings drawer,
  // and Step log / Wire / Topics moved into the unified output
  // pane, so this map is much smaller than before.
  const [sectionCollapsed, setSectionCollapsed] = useState<Record<string, boolean>>({})
  const toggleSection = useCallback((key: string) => {
    setSectionCollapsed((c) => ({ ...c, [key]: !c[key] }))
  }, [])

  const refreshTree = useCallback(async () => {
    setTreeError(null)
    try {
      const t = await fetchBrainTree(apiFetch, proxyId)
      setTree(t)
    } catch (exc) {
      setTreeError(exc instanceof Error ? exc.message : String(exc))
    }
  }, [apiFetch, proxyId])

  // Initial tree load + reload on demand. The operator can hit
  // Refresh manually; stone F's bus subscription below auto-refreshes
  // when the brain or another tab writes.
  useEffect(() => {
    void refreshTree()
  }, [refreshTree])

  // ``dirty`` = the buffer has unsaved changes. We compute it on read
  // rather than tracking a separate bool so it can never drift out of
  // sync with the buffer + on-disk content.
  const dirty = openFile !== null && editBuffer !== null && editBuffer !== openFile.content

  const performOpen = useCallback(async (path: string, source: FileSource) => {
    setFileError(null)
    setFileLoading(true)
    setSaveError(null)
    setEditBuffer(null)  // exit any prior edit session
    try {
      const f = await fetchBrainFile(apiFetch, proxyId, path, source)
      setOpenFile(f)
    } catch (exc) {
      setFileError(exc instanceof Error ? exc.message : String(exc))
      setOpenFile(null)
    } finally {
      setFileLoading(false)
    }
  }, [apiFetch, proxyId])

  const openFileAt = useCallback((path: string, source: FileSource) => {
    // If the current buffer is dirty, ask before discarding.
    if (dirty) {
      setPendingOpen({ path, source })
      return
    }
    void performOpen(path, source)
  }, [dirty, performOpen])

  // Tree row click. Files are handled by ``onOpen`` (opens content);
  // here we just track the selection so the tree highlights it and
  // — when a workflow directory is picked — the right pane swaps from
  // the file viewer to the Workflow card.
  const handleTreeSelect = useCallback((entry: FileEntry) => {
    setSelectedEntry(entry)
    if (entry.type === 'dir') {
      // Clear the open file so the right pane re-rents itself to the
      // Workflow card / dir hint without the previous file lingering.
      // If the operator wants the file back they can click it again.
      if (!dirty) {
        setOpenFile(null)
        setEditBuffer(null)
        setFileError(null)
      }
      // While editing, keep the buffer — selecting a folder shouldn't
      // dump unsaved work. The file still shows next to the Workflow
      // card if both have content; today the pane can only show one
      // at a time, so file wins until the operator saves or discards.
    }
  }, [dirty])

  // A "workflow" is a directory at ``workflows/<name>``. Bundled and
  // workspace sources both qualify; the workflow card just looks the
  // name up in the brain's discovered list.
  // Which workflow "is in focus" — derived from the selected tree entry.
  // Resolves whether you select the workflow FOLDER (workflows/<name>) OR
  // any file inside it (workflows/<name>/prompt.md, …) so picking a file
  // still tells the operator (and the Run button) which workflow runs.
  const selectedWorkflowName = useMemo<string | null>(() => {
    if (!selectedEntry) return null
    const parts = selectedEntry.path.split('/')
    return parts.length >= 2 && parts[0] === 'workflows' ? parts[1] : null
  }, [selectedEntry])

  // An EXAMPLE is a bundled (shipped, read-only) workflow. Examples
  // aren't run directly — the operator duplicates one to an editable
  // workspace copy first. Derived from the tree entry's source so it
  // works whether the folder or a file within it is selected.
  const selectedIsExample = !!selectedWorkflowName && selectedEntry?.source === 'bundled'

  // Names already taken (workspace + examples) — duplication must not
  // collide with any of them, and the prefilled name auto-increments to
  // the first free one.
  const takenWorkflowNames = useMemo(() => new Set(workflows.map((w) => w.name)), [workflows])
  const freeWorkflowName = useCallback((base: string) => {
    let cand = `${base}_copy`
    if (!takenWorkflowNames.has(cand)) return cand
    let i = 2
    while (takenWorkflowNames.has(`${base}_copy_${i}`)) i++
    return `${base}_copy_${i}`
  }, [takenWorkflowNames])

  // Stone C: edit / save / discard handlers.

  const startEdit = useCallback(() => {
    if (!openFile || !openFile.writable) return
    setSaveError(null)
    setEditBuffer(openFile.content)
  }, [openFile])

  const discardEdit = useCallback(() => {
    setEditBuffer(null)
    setSaveError(null)
  }, [])

  const saveEdit = useCallback(async (forceOverwrite = false) => {
    if (!openFile || editBuffer === null) return
    setSaving(true)
    setSaveError(null)
    try {
      const result = await saveBrainFile(
        apiFetch, proxyId, openFile.path, editBuffer,
        forceOverwrite ? null : openFile.mtime,
      )
      // Successful save: update the open file's stamp + size, exit
      // edit mode. Tree mtime is best-effort refreshed; stale by
      // milliseconds is fine in stone C.
      setOpenFile({
        ...openFile,
        content: editBuffer,
        mtime: result.mtime,
        size: result.size,
      })
      setEditBuffer(null)
      void refreshTree()
    } catch (exc) {
      // ApiError exposes status + body — detect 409 conflict.
      const anyExc = exc as { status?: number; body?: unknown; message?: string }
      if (anyExc.status === 409 && anyExc.body && typeof anyExc.body === 'object') {
        const body = anyExc.body as MtimeConflictBody
        if (body.error === 'mtime_conflict') {
          setConflict(body)
        } else {
          setSaveError(anyExc.message ?? 'save failed')
        }
      } else {
        setSaveError(anyExc.message ?? (exc instanceof Error ? exc.message : String(exc)))
      }
    } finally {
      setSaving(false)
    }
  }, [apiFetch, editBuffer, openFile, proxyId, refreshTree])

  const resolveConflictKeepMine = useCallback(() => {
    setConflict(null)
    void saveEdit(true)  // force overwrite
  }, [saveEdit])

  const resolveConflictTakeTheirs = useCallback(() => {
    if (!conflict || !openFile) return
    setOpenFile({
      ...openFile,
      content: conflict.actual_content,
      mtime: conflict.actual_mtime,
    })
    setEditBuffer(null)
    setConflict(null)
  }, [conflict, openFile])

  // Stone D: derive the fork target. Two entry points lead here:
  //   1. The viewer-header "Fork to workspace" button — only available
  //      when ``openFile`` is a bundled file inside a workflow dir.
  //   2. The file-tree kebab "Fork to workspace" — sets ``forkPrompt``
  //      to the workflow dir path. This works even when no file is
  //      open or the open file isn't part of the workflow being
  //      forked.
  // ``forkPrompt`` (the explicit kebab path) wins when both are
  // present, so the kebab choice always reflects what the operator
  // actually clicked. Returns null when neither source yields a
  // valid ``workflows/<name>`` path.
  const forkTarget = useMemo(() => {
    const candidate =
      forkPrompt
        ?? (openFile && openFile.source === 'bundled' ? openFile.path : null)
    if (!candidate) return null
    const parts = candidate.split('/')
    if (parts.length < 2 || parts[0] !== 'workflows') return null
    return { workflowDir: `workflows/${parts[1]}`, workflowName: parts[1] }
  }, [forkPrompt, openFile])

  const performFork = useCallback(async () => {
    if (!forkTarget) return
    setForking(true)
    setSaveError(null)
    try {
      const result = await forkBrainWorkflow(apiFetch, proxyId, forkTarget.workflowDir)
      // Refresh the tree so the new workspace entry appears + the
      // bundled twin gets a shadowed flag on its next render.
      await refreshTree()
      // Refresh the workflow list too so the editor pane's metadata
      // (model, max_steps, etc.) picks up the new workspace copy.
      // ``refreshWorkflows`` is declared later in this component, so
      // we go through the ref to avoid a TDZ reference here.
      await refreshWorkflowsRef.current?.()
      // If the operator was viewing a file inside the forked workflow,
      // reopen it from the workspace copy so the Edit button activates.
      if (openFile && openFile.path.startsWith(forkTarget.workflowDir + '/')) {
        await performOpen(openFile.path, 'workspace')
      }
      // Select the new workspace workflow in the tree so the editor
      // pane re-renders against the fresh copy.
      setSelectedEntry({
        path: forkTarget.workflowDir,
        name: forkTarget.workflowName,
        type: 'dir',
        source: 'workspace',
      } as FileEntry)
      setForkSuccess(result)
    } catch (exc) {
      const anyExc = exc as { message?: string }
      setSaveError(anyExc.message ?? (exc instanceof Error ? exc.message : String(exc)))
    } finally {
      setForking(false)
      setForkPrompt(null)
    }
  }, [apiFetch, forkTarget, openFile, performOpen, proxyId, refreshTree])

  // Stone E: new-workflow scaffolds the five canonical files in
  // workspace then opens prompt.md so the operator can immediately
  // start editing the task description.
  const performNewWorkflow = useCallback(async (name: string) => {
    setBusyNewWorkflow(true)
    setSaveError(null)
    try {
      const result = await newBrainWorkflow(apiFetch, proxyId, name)
      await refreshTree()
      await performOpen(`${result.dest_path}/prompt.md`, 'workspace')
      setShowNewWorkflow(false)
    } catch (exc) {
      const anyExc = exc as { message?: string }
      setSaveError(anyExc.message ?? (exc instanceof Error ? exc.message : String(exc)))
    } finally {
      setBusyNewWorkflow(false)
    }
  }, [apiFetch, performOpen, proxyId, refreshTree])

  // Duplicate an existing workspace workflow under a new name.
  const performDuplicate = useCallback(async (destName: string) => {
    if (!duplicateTarget) return
    setBusyDuplicate(true)
    setSaveError(null)
    try {
      const result = await duplicateBrainWorkflow(apiFetch, proxyId, duplicateTarget.sourcePath, destName)
      await refreshTree()
      // Refresh the workflow SUMMARY list too (list_workflows), not just
      // the file tree — otherwise the new copy shows in the tree but
      // ``workflows.find(name)`` can't match it, so the Run pane reports
      // "Brain hasn't reported this workflow yet". ``refreshWorkflows``
      // is declared later in this component, so go through the ref to
      // avoid a TDZ reference (same pattern as performFork).
      await refreshWorkflowsRef.current?.()
      // Select the new workflow so it's immediately "ready to run", and
      // open its prompt.md for review (no auto-run — deliberately safer).
      const newName = result.dest_path.split('/').pop() ?? destName
      setSelectedEntry({ name: newName, path: result.dest_path, type: 'dir', source: 'workspace' })
      await performOpen(`${result.dest_path}/prompt.md`, 'workspace')
      setDuplicateTarget(null)
    } catch (exc) {
      const anyExc = exc as { message?: string }
      setSaveError(anyExc.message ?? (exc instanceof Error ? exc.message : String(exc)))
    } finally {
      setBusyDuplicate(false)
    }
  }, [apiFetch, duplicateTarget, performOpen, proxyId, refreshTree])

  // Stone E: rename a workspace file OR workflow folder. The new path
  // keeps the same parent dir + replaces only the basename — operators
  // don't move files between dirs from this UI yet (stone F+ extension).
  const performRename = useCallback(async (newBasename: string) => {
    if (!renameTarget) return
    const parent = renameTarget.path.split('/').slice(0, -1).join('/')
    const toPath = parent ? `${parent}/${newBasename}` : newBasename
    if (toPath === renameTarget.path) {
      setRenameTarget(null)
      return
    }
    setBusyRename(true)
    setSaveError(null)
    try {
      await renameBrainPath(apiFetch, proxyId, renameTarget.path, toPath)
      await refreshTree()
      // Refresh the workflow SUMMARY list too — a folder rename changes
      // which workflows exist; without this the renamed workflow can't
      // be matched and the Run pane reports "Brain hasn't reported this
      // workflow yet". (Same omission that bit Duplicate.)
      await refreshWorkflowsRef.current?.()
      // If a file was open at (or under) the renamed path, reopen it at
      // its new location so the viewer header + future saves track the
      // move. Renaming a FOLDER must not try to open the dir as a file.
      const open = openFile
      if (open && (open.path === renameTarget.path || open.path.startsWith(renameTarget.path + '/'))) {
        const newOpenPath = toPath + open.path.slice(renameTarget.path.length)
        await performOpen(newOpenPath, 'workspace')
      }
      // If the renamed entry is a workflow folder, select it so the Run
      // pane immediately points at the new name (ready to run).
      const toParts = toPath.split('/')
      if (toParts.length === 2 && toParts[0] === 'workflows') {
        setSelectedEntry({ path: toPath, name: newBasename, type: 'dir', source: 'workspace' } as FileEntry)
      }
      setRenameTarget(null)
    } catch (exc) {
      const anyExc = exc as { message?: string }
      setSaveError(anyExc.message ?? (exc instanceof Error ? exc.message : String(exc)))
    } finally {
      setBusyRename(false)
    }
  }, [apiFetch, openFile, performOpen, proxyId, refreshTree, renameTarget])

  // Stone E: delete. ``isDir`` controls whether we pass recursive=true
  // (always true here — operators are deleting whole workflow dirs;
  // the confirm dialog is the friction the operation needs).
  const performDelete = useCallback(async () => {
    if (!deleteTarget) return
    setBusyDelete(true)
    setSaveError(null)
    try {
      await deleteBrainPath(apiFetch, proxyId, deleteTarget.path, deleteTarget.isDir)
      await refreshTree()
      // Drop the deleted workflow from the Run pane's list too, not just
      // the tree (mirrors fork/duplicate/rename).
      await refreshWorkflowsRef.current?.()
      // If the deleted path was (or contained) the open file, close
      // the viewer — otherwise the operator would be staring at a
      // file that no longer exists on disk.
      if (openFile && (openFile.path === deleteTarget.path
          || openFile.path.startsWith(deleteTarget.path + '/'))) {
        setOpenFile(null)
        setEditBuffer(null)
      }
      setDeleteTarget(null)
    } catch (exc) {
      const anyExc = exc as { message?: string }
      setSaveError(anyExc.message ?? (exc instanceof Error ? exc.message : String(exc)))
    } finally {
      setBusyDelete(false)
    }
  }, [apiFetch, deleteTarget, openFile, proxyId, refreshTree])

  // Build the right-click / "..." menu for one tree entry. Items are
  // gated by source (workspace vs bundled), type (file vs dir), and
  // shape (workflow dirs vs top-level workspace dirs like memory/runs).
  // This is the ONE place all per-node actions live — anywhere that
  // wants to fire them (tree, future keyboard shortcuts, future
  // toolbar) goes through this map.
  const contextMenuForEntry = useCallback((entry: import('./brain/brainApi').FileEntry): ContextMenuItem[] => {
    const items: ContextMenuItem[] = []
    const isDir = entry.type === 'dir'
    const isWorkspace = entry.source === 'workspace'
    const parts = entry.path.split('/')
    const isWorkflowDir = isDir && parts.length === 2 && parts[0] === 'workflows'
    const isProtectedTopLevel = isDir && parts.length === 1
      && (parts[0] === 'memory' || parts[0] === 'runs' || parts[0] === 'workflows')

    // Files always get Open at the top — single-click already opens
    // but having it in the menu makes the action discoverable for
    // operators driving via right-click only.
    if (!isDir) {
      items.push({
        label: 'Open',
        icon: <EditIcon size={12} />,
        onClick: () => void performOpen(entry.path, entry.source),
      })
    }

    // Bundled workflow folders + files inside them → Fork.
    if (!isWorkspace) {
      // The fork target is always the workflow dir (workflows/<name>),
      // not the individual file. We figure it out from the entry path.
      let forkPath: string | null = null
      if (isWorkflowDir) forkPath = entry.path
      else if (parts.length >= 3 && parts[0] === 'workflows') forkPath = `workflows/${parts[1]}`
      if (forkPath) {
        items.push({
          label: 'Duplicate to workspace',
          icon: <CopyIcon size={12} />,
          hint: 'Make an editable workspace copy of this example',
          onClick: () => setDuplicateTarget({ sourcePath: forkPath!, srcName: forkPath!.split('/')[1] }),
        })
      }
    }

    // Workspace items get Rename + Delete. Files + workflow folders
    // can be renamed/deleted; protected top-level dirs cannot (deleting
    // ``memory/`` would surprise the operator and the brain itself
    // recreates it on next workflow run).
    if (isWorkspace && !isProtectedTopLevel) {
      // Duplicate a workspace workflow under a new name (workflow dir,
      // or any file within one — normalized to the workflow dir).
      let dupSource: string | null = null
      if (isWorkflowDir) dupSource = entry.path
      else if (parts.length >= 3 && parts[0] === 'workflows') dupSource = `workflows/${parts[1]}`
      if (dupSource) {
        const srcName = dupSource.split('/')[1]
        items.push({
          label: 'Duplicate',
          icon: <CopyIcon size={12} />,
          hint: 'Make a copy of this workflow under a new name',
          onClick: () => setDuplicateTarget({ sourcePath: dupSource!, srcName }),
        })
      }
      items.push({
        label: 'Rename',
        icon: <RenameIcon size={12} />,
        onClick: () => setRenameTarget({
          path: entry.path,
          basename: entry.name,
        }),
      })
      items.push({
        label: isDir ? `Delete ${isWorkflowDir ? 'workflow' : 'folder'}` : 'Delete',
        icon: <DeleteIcon size={12} />,
        destructive: true,
        onClick: () => setDeleteTarget({
          path: entry.path,
          isDir,
          label: isWorkflowDir ? parts[1] : entry.path,
        }),
      })
    }

    // Always offer "Copy path" — useful for shell access, regardless of
    // source. Copies the ABSOLUTE filesystem path: workspace entries hang
    // off workspace_dir; bundled entries off bundled_dir (which already
    // ends in /workflows, so drop the leading "workflows/" segment from
    // the virtual path — matches the backend's _safe_resolve). Falls back
    // to the virtual path if a root isn't known yet.
    const joinPath = (a: string, b: string) => (b ? `${a.replace(/\/+$/, '')}/${b}` : a)
    let fullPath = entry.path
    if (entry.source === 'workspace' && tree?.workspace_dir) {
      fullPath = joinPath(tree.workspace_dir, entry.path)
    } else if (entry.source === 'bundled' && tree?.bundled_dir) {
      const rest = entry.path.split('/').slice(1).join('/')
      fullPath = joinPath(tree.bundled_dir, rest)
    }
    items.push({
      label: 'Copy path',
      icon: <CopyIcon size={12} />,
      hint: fullPath,
      onClick: () => {
        try {
          if (navigator.clipboard && window.isSecureContext) {
            void navigator.clipboard.writeText(fullPath)
          }
        } catch { /* ignore — operator can hover to copy too */ }
      },
    })

    return items
  }, [performOpen, tree])

  const handleTreeContextMenu = useCallback((event: FileTreeContextEvent) => {
    setContextMenu({
      items: contextMenuForEntry(event.entry),
      position: event.position,
    })
  }, [contextMenuForEntry])

  // ── stone F: live file-change subscription ───────────────────────
  //
  // The brain publishes /brain/<proxy_id>/files/changed whenever it
  // writes (memory/, runs/) and the file API publishes for operator
  // edits (PUT, fork, rename, delete, new-workflow). The UI:
  //
  //   * debounces tree refresh — runs spam events per step; we
  //     coalesce within 400ms idle so the tree updates once
  //   * if the changed path matches the open file AND we're not
  //     editing, silently reload its content so the operator sees
  //     the new content without a click
  //
  // We track the latest open file via a ref so the subscription
  // handler (bound once on mount) reads current state.
  const openFileRef = useRef<FileContentResponse | null>(null)
  const editBufferRef = useRef<string | null>(null)
  useEffect(() => { openFileRef.current = openFile }, [openFile])
  useEffect(() => { editBufferRef.current = editBuffer }, [editBuffer])
  const refreshTreeRef = useRef(refreshTree)
  useEffect(() => { refreshTreeRef.current = refreshTree }, [refreshTree])
  const performOpenRef = useRef(performOpen)
  useEffect(() => { performOpenRef.current = performOpen }, [performOpen])
  // ``refreshWorkflows`` is declared later in this component (it
  // depends on ``dispatch`` which depends on the WS client). Holding
  // it through a ref lets ``performFork`` (declared earlier) call it
  // post-fork without a TDZ reference.
  const refreshWorkflowsRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    if (!proxyId) return
    const topic = `/brain/${proxyId}/files/changed`
    let treeTimer: ReturnType<typeof setTimeout> | null = null
    let reloadTimer: ReturnType<typeof setTimeout> | null = null
    // Whether any event in the current debounce window changed the SET
    // of workflows (a workflow dir created or deleted). Such changes —
    // fork, duplicate, rename, delete, new-workflow — must refresh the
    // workflow SUMMARY list (list_workflows), not just the file tree;
    // otherwise the Run pane can't match the new/renamed workflow and
    // shows "Brain hasn't reported this workflow yet". This is the
    // single choke point that structurally covers every mutation: the
    // backend publishes files/changed for all of them.
    let wantWorkflows = false

    const off = wsClient.subscribe(topic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const event = f.payload as { path?: string; kind?: string }
      if (!event?.path) return
      if (event.kind === 'created' || event.kind === 'deleted') wantWorkflows = true
      // Debounced tree refresh — coalesce all events within a 400ms
      // window into one fetch. Run-step events fire 10/sec during a
      // workflow; this caps tree traffic at ~2.5 RPS.
      if (treeTimer) clearTimeout(treeTimer)
      treeTimer = setTimeout(() => {
        void refreshTreeRef.current()
        if (wantWorkflows) {
          wantWorkflows = false
          void refreshWorkflowsRef.current?.()
        }
      }, 400)

      // If the changed path matches the open file AND we're not
      // editing, reload its content so the operator sees live updates
      // (e.g. memory/observations.md growing as the brain writes).
      // Edit mode skips reload — we won't trash the operator's buffer.
      const open = openFileRef.current
      const editing = editBufferRef.current !== null
      if (!open || editing) return
      // Reload when the open file IS the changed path or the changed
      // path is its parent dir being deleted.
      const matches = event.path === open.path
        || (event.kind === 'deleted' && open.path.startsWith(event.path + '/'))
      if (!matches) return
      if (event.kind === 'deleted') {
        setOpenFile(null)
        return
      }
      if (reloadTimer) clearTimeout(reloadTimer)
      reloadTimer = setTimeout(() => {
        void performOpenRef.current(open.path, open.source)
      }, 200)
    })
    return () => {
      if (treeTimer) clearTimeout(treeTimer)
      if (reloadTimer) clearTimeout(reloadTimer)
      off()
    }
  }, [proxyId, wsClient])
  // Per-workflow inputs the operator has typed into the form. Keyed by
  // workflow name so the values survive switching tabs / re-clicking
  // the workflow folder in the tree.
  const [workflowInputs, setWorkflowInputs] = useState<Record<string, Record<string, string>>>({})
  // Per-workflow Run configuration overrides — the backend + model
  // the operator has picked for the NEXT run of this workflow.
  // Empty/absent means "use workflow.preferred_* / config default".
  // Keyed by workflow name so selections survive switching workflow
  // folders in the tree. Cleared explicitly via the Reset button.
  const [runConfigOverrides, setRunConfigOverrides] = useState<
    Record<string, { backend?: string; model?: string }>
  >({})
  // Save-as-preferred dialog state. When the operator clicks Save on
  // a bundled workflow, the backend returns ``needs_fork: true``; we
  // hold the pending save's args here while the operator confirms
  // the fork. ``null`` means no dialog showing.
  const [savePrefsPending, setSavePrefsPending] = useState<{
    workflowName: string
    workflowDir: string
    backend: string
    model: string | null
  } | null>(null)
  const [savePrefsBusy, setSavePrefsBusy] = useState(false)
  // Transient success message after a successful save. Auto-clears
  // after a few seconds so it doesn't crowd the UI.
  const [savePrefsToast, setSavePrefsToast] = useState<string | null>(null)
  // Save-as-configuration dialog state. ``saveAsPending`` carries
  // the workflow + override snapshot the operator is about to save;
  // the dialog opens when they hit ``save`` in the toolbar and the
  // current selection doesn't match any saved configuration. On
  // submit, the operator's typed name flows into
  // save_run_configuration.
  const [saveAsPending, setSaveAsPending] = useState<{
    workflowName: string
    backend: string
    model: string | null
    suggestedName: string
  } | null>(null)
  const [saveAsBusy, setSaveAsBusy] = useState(false)
  // Toast-ish error banner — short-lived, dismissed by the next action.
  const [actionError, setActionError] = useState<string | null>(null)
  // Most-recently-started run id; we follow this one in the step log.
  const [followedRunId, setFollowedRunId] = useState<string | null>(null)
  const [steps, setSteps] = useState<StepRecord[]>([])
  const [runResult, setRunResult] = useState<RunResultPayload | null>(null)
  // Framework lifecycle events (started/ended). Brain publishes them
  // to /brain/<proxy_id>/workflow_events (non-retained, one-shot).
  //
  // Stored by run_id rather than scoped to the followed run: the
  // subscription is mounted once at panel open, NOT when targetRunId
  // becomes available. Without this, ``started`` events race the
  // ``start_workflow`` reply — brain emits ``started`` inside
  // ``engine.run()`` before the reply lands, so a subscription
  // gated by ``targetRunId !== null`` would miss it every time.
  // Filtering happens at render time inside the Steps tab.
  const [eventsByRunId, setEventsByRunId] = useState<Record<string, WorkflowEvent[]>>({})

  // We need full input specs to render the form. The service only returns
  // a summary from list_workflows (no input shapes), so we keep a cache
  // populated lazily — when the operator opens a workflow card, we fetch
  // the per-workflow detail. For now we lean on a convention: workflow
  // names we know about hardcode their inputs in this map, and unknown
  // ones get a generic "run with defaults" button. This keeps the UI
  // shipping without a new bus action; we can swap it for a real
  // get_workflow call later if the catalog grows past a handful.
  //
  // KEEP IN SYNC with repo/brain/<ver>/workflows/<name>/workflow.yaml.
  const inputSpecs: Record<string, Record<string, WorkflowInputSpec>> = useMemo(() => ({
    observe_room: {},
    inspect_object: {
      target_hint: {
        type: 'string',
        required: true,
        description: 'Short hint identifying the object to inspect (e.g. "the red cup on the left").',
      },
    },
    emergency_stop: {
      reason: {
        type: 'string',
        required: false,
        default: 'operator triggered',
        description: 'Short note logged with the stop event.',
      },
    },
  }), [])

  // Stable counter so concurrent reply topics never collide.
  const replyCounterRef = useRef(0)

  // ─── retained state subscription ──────────────────────────────────

  useEffect(() => {
    if (!proxyId) return
    const off = wsClient.subscribe(stateTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      setState((f.payload as BrainState) || {})
    })
    return off
  }, [proxyId, stateTopic, wsClient])

  // ─── action dispatch helper ───────────────────────────────────────

  const dispatch = useCallback(
    async <T,>(action: string, args: Record<string, unknown> = {}): Promise<T> => {
      const myId = ++replyCounterRef.current
      // Unique reply topic per call so concurrent dispatch()es never
      // collide. Suffix uses Date.now() rather than re-using the counter
      // twice — keeps the format mildly informative for debugging.
      const replyTopic = `/cli/reply/brain-${proxyId}-${myId}-${Date.now()}`
      const startedAt = Date.now()
      const requestPayload = { action, ...args, reply_to: replyTopic }
      const appendWire = (patch: Partial<WireEntry>) => {
        setWireLog((prev) => [
          ...prev.slice(-19),
          {
            ts: startedAt,
            action,
            request: requestPayload,
            ...patch,
          },
        ])
      }
      return await new Promise<T>((resolve, reject) => {
        let resolved = false
        const finalize = (patch: Partial<WireEntry>) => {
          appendWire({ ...patch, latencyMs: Date.now() - startedAt })
        }
        const off = wsClient.subscribe(replyTopic, (f: InboundFrame) => {
          if (f.method !== 'message' || resolved) return
          resolved = true
          off()
          const payload = (f.payload ?? {}) as T
          finalize({ reply: payload })
          resolve(payload)
        })
        const timer = setTimeout(() => {
          if (resolved) return
          resolved = true
          off()
          const msg = `no reply within ${REPLY_TIMEOUT_MS / 1000}s for action=${action}`
          finalize({ error: msg })
          reject(new Error(msg))
        }, REPLY_TIMEOUT_MS)
        // Wait for the WS server to ack the subscribe BEFORE publishing.
        // Without this, fast in-process methods reply before the server-
        // side pump task has registered with the bus, and the reply
        // drops on the floor.
        wsClient.awaitSubscribed(replyTopic).then(() => {
          if (resolved) return
          wsClient.publish(controlTopic, requestPayload)
        }).catch((exc) => {
          if (resolved) return
          resolved = true
          clearTimeout(timer)
          off()
          const msg = `subscribe ack failed: ${exc instanceof Error ? exc.message : String(exc)}`
          finalize({ error: msg })
          reject(new Error(msg))
        })
      })
    },
    [controlTopic, proxyId, wsClient],
  )

  // ─── workflows list ───────────────────────────────────────────────

  const refreshWorkflows = useCallback(async () => {
    setActionError(null)
    try {
      const reply = await dispatch<ListWorkflowsReply>('list_workflows')
      setWorkflows(reply.workflows ?? [])
    } catch (exc) {
      setActionError(exc instanceof Error ? exc.message : String(exc))
    }
  }, [dispatch])
  useEffect(() => { refreshWorkflowsRef.current = refreshWorkflows }, [refreshWorkflows])

  const refreshBackends = useCallback(async () => {
    setActionError(null)
    try {
      const reply = await dispatch<GetBackendsReply>('get_backends')
      setBackends(reply.backends ?? [])
      setActiveBackend(reply.active ?? 'mock')
    } catch (exc) {
      setActionError(exc instanceof Error ? exc.message : String(exc))
    }
  }, [dispatch])

  // Fetch + cache the list of available models for one backend.
  // Hits the provider's free models endpoint (no completions
  // charged). Errors are swallowed — the UI gracefully falls back
  // to its previous suggestions (BrainConfig defaults + recent
  // active_runs model_ids).
  const fetchBackendModels = useCallback(async (backend: string, force = false) => {
    if (!backend) return
    if (!force && backendModels[backend] !== undefined) return
    if (backendModelsBusy[backend]) return
    setBackendModelsBusy((prev) => ({ ...prev, [backend]: true }))
    try {
      const reply = await dispatch<{ ok?: boolean; models?: string[]; error?: string }>(
        'list_backend_models',
        { backend },
      )
      if (reply.ok && Array.isArray(reply.models)) {
        setBackendModels((prev) => ({ ...prev, [backend]: reply.models! }))
      } else {
        // Cache the empty result so we don't re-fetch on every
        // backend change. ``force=true`` from a manual refresh
        // button can override.
        setBackendModels((prev) => ({ ...prev, [backend]: [] }))
      }
    } catch {
      setBackendModels((prev) => ({ ...prev, [backend]: [] }))
    } finally {
      setBackendModelsBusy((prev) => {
        const next = { ...prev }
        delete next[backend]
        return next
      })
    }
  }, [dispatch, backendModels, backendModelsBusy])

  // Auto-fetch models for whichever backend the operator is currently
  // pointing at via the toolbar. Reads the effective backend the
  // same way the toolbar's IIFE does (override > preferred). Lazy +
  // cached — the fetch happens once per backend until force-refreshed.
  useEffect(() => {
    if (!selectedWorkflowName) return
    const wf = workflows.find((w) => w.name === selectedWorkflowName)
    if (!wf) return
    const override = runConfigOverrides[selectedWorkflowName] ?? {}
    const effective = override.backend ?? wf.preferred_backend
    if (effective) void fetchBackendModels(effective)
  }, [selectedWorkflowName, runConfigOverrides, workflows, fetchBackendModels])

  const refreshTools = useCallback(async () => {
    setActionError(null)
    try {
      const reply = await dispatch<ListToolsReply>('list_tools')
      setToolsList(reply.tools ?? [])
    } catch (exc) {
      setActionError(exc instanceof Error ? exc.message : String(exc))
    }
  }, [dispatch])

  // Initial load when the panel mounts AND the brain reports its workspace
  // (i.e. on_start has completed). Polling state for the workspace key is
  // the cheapest readiness signal we have.
  const ready = !!state.workspace
  useEffect(() => {
    if (!ready) return
    void refreshWorkflows()
    void refreshBackends()
  }, [ready, refreshBackends, refreshWorkflows])

  // ─── backend actions ──────────────────────────────────────────────

  const setBackendField = (name: string, field: 'base_url' | 'api_key' | 'model', value: string) => {
    setBackendDraft((prev) => ({ ...prev, [name]: { ...(prev[name] ?? {}), [field]: value } }))
  }

  const applyBackend = useCallback(async (name: string, makeActive: boolean) => {
    setActionError(null)
    const draft = backendDraft[name] ?? {}
    const args: Record<string, unknown> = { name, make_active: makeActive }
    if (draft.base_url !== undefined) args.base_url = draft.base_url
    if (draft.api_key !== undefined) args.api_key = draft.api_key
    if (draft.model !== undefined) args.model = draft.model
    try {
      const reply = await dispatch<GetBackendsReply>('set_backend', args)
      if (reply.backends) {
        setBackends(reply.backends)
        setActiveBackend(reply.active)
      }
      // Drop the api_key from the local draft now that it's been sent.
      // base_url + model can stay so the operator sees the value they
      // just typed reflected in the form.
      setBackendDraft((prev) => {
        const next = { ...prev }
        if (next[name]) next[name] = { ...next[name], api_key: undefined }
        return next
      })
      // Once the operator has applied a backend config, collapse the
      // picker so the panel returns to its compact resting state.
      setExpandedBackend(null)
      setShowBackendPicker(false)
    } catch (exc) {
      setActionError(exc instanceof Error ? exc.message : String(exc))
    }
  }, [backendDraft, dispatch])

  const clearBackend = useCallback(async (name: string) => {
    setActionError(null)
    try {
      const reply = await dispatch<GetBackendsReply>('clear_backend', { name })
      if (reply.backends) {
        setBackends(reply.backends)
        setActiveBackend(reply.active)
      }
      setBackendDraft((prev) => ({ ...prev, [name]: {} }))
      setTestResult((prev) => ({ ...prev, [name]: { ok: false, error: 'cleared' } }))
    } catch (exc) {
      setActionError(exc instanceof Error ? exc.message : String(exc))
    }
  }, [dispatch])

  const testBackend = useCallback(async (name: string) => {
    setActionError(null)
    try {
      const reply = await dispatch<TestBackendReply>('test_backend', { name })
      setTestResult((prev) => ({ ...prev, [name]: reply }))
    } catch (exc) {
      setTestResult((prev) => ({ ...prev, [name]: { ok: false, error: exc instanceof Error ? exc.message : String(exc) } }))
    }
  }, [dispatch])

  const activateBackend = useCallback(async (name: string) => {
    setActionError(null)
    try {
      await dispatch('set_active_backend', { name })
      setActiveBackend(name)
      // Pull fresh to keep configured flags in sync.
      void refreshBackends()
    } catch (exc) {
      setActionError(exc instanceof Error ? exc.message : String(exc))
    }
  }, [dispatch, refreshBackends])

  // ─── start / cancel / approve ─────────────────────────────────────

  const startWorkflow = useCallback(async (
    wf: WorkflowSummary,
    e?: FormEvent,
    overrides?: { backend?: string; model?: string },
  ) => {
    e?.preventDefault()
    setActionError(null)
    const specs = inputSpecs[wf.name] ?? {}
    const draft = workflowInputs[wf.name] ?? {}
    // Coerce input strings to the declared types. Empty + non-required ->
    // omit; empty + required -> bail with a banner.
    const inputs: Record<string, unknown> = {}
    for (const [key, spec] of Object.entries(specs)) {
      const raw = draft[key] ?? defaultForInput(spec)
      if (raw === '' || raw == null) {
        if (spec.required) {
          setActionError(`input "${key}" is required for ${wf.name}`)
          return
        }
        continue
      }
      switch (spec.type) {
        case 'integer': {
          const n = Number.parseInt(raw, 10)
          if (Number.isNaN(n)) { setActionError(`input "${key}" must be an integer`); return }
          inputs[key] = n
          break
        }
        case 'number': {
          const n = Number.parseFloat(raw)
          if (Number.isNaN(n)) { setActionError(`input "${key}" must be a number`); return }
          inputs[key] = n
          break
        }
        case 'boolean':
          inputs[key] = raw.toLowerCase() === 'true' || raw === '1'
          break
        default:
          inputs[key] = raw
      }
    }
    try {
      // Forward backend + model overrides separately. ``model`` arg
      // is now strictly a model id (no longer a backend alias);
      // resolution lives on the brain side. Empty/undefined values
      // mean "let brain fall back to workflow.preferred_* / config
      // default" — only send keys that are actually set.
      const args: Record<string, unknown> = { name: wf.name, inputs }
      if (overrides?.backend) args.backend = overrides.backend
      if (overrides?.model) args.model = overrides.model
      const reply = await dispatch<StartWorkflowReply>('start_workflow', args)
      if (reply.error) { setActionError(reply.error); return }
      if (reply.run_id) {
        setFollowedRunId(reply.run_id)
        setSteps([])
        setRunResult(null)
      }
    } catch (exc) {
      setActionError(exc instanceof Error ? exc.message : String(exc))
    }
  }, [dispatch, inputSpecs, workflowInputs])

  const cancelRun = useCallback(async (runId: string) => {
    setActionError(null)
    try {
      await dispatch('cancel', { run_id: runId, reason: 'operator cancelled from panel' })
    } catch (exc) {
      setActionError(exc instanceof Error ? exc.message : String(exc))
    }
  }, [dispatch])

  const approveRun = useCallback(async (runId: string, decision: boolean) => {
    setActionError(null)
    try {
      await dispatch('approve', { run_id: runId, decision })
    } catch (exc) {
      setActionError(exc instanceof Error ? exc.message : String(exc))
    }
  }, [dispatch])

  // Clear all on-disk run artifacts (<workspace>/runs/) via the brain's
  // clear_runs method. In-flight runs are preserved server-side. We then
  // reset the local step-log view (it may point at a now-deleted run)
  // and refresh the tree (runs/ shows there).
  const performClearRuns = useCallback(async () => {
    setClearingRuns(true)
    setActionError(null)
    try {
      const res = await dispatch<{ removed?: number; skipped_active?: number }>('clear_runs')
      setSteps([])
      setRunResult(null)
      setFollowedRunId(null)
      await refreshTree()
      const removed = res?.removed ?? 0
      const skipped = res?.skipped_active ?? 0
      setSavePrefsToast(
        `Cleared ${removed} run${removed === 1 ? '' : 's'}${skipped ? ` (kept ${skipped} active)` : ''}`,
      )
    } catch (exc) {
      setActionError(exc instanceof Error ? exc.message : String(exc))
    } finally {
      setClearingRuns(false)
      setClearRunsOpen(false)
    }
  }, [dispatch, refreshTree])

  // Save current run-config overrides into the workflow's yaml as
  // its new preferred_backend / preferred_model. Two-phase when the
  // workflow is bundled: first call returns needs_fork=true, we show
  // a confirm dialog, then on confirm we fork via REST + retry.
  // ``allowFork`` controls whether the second phase runs (gated by
  // the dialog confirmation).
  const saveWorkflowPreferences = useCallback(async (
    workflowName: string,
    backend: string,
    model: string | null,
    allowFork: boolean,
  ) => {
    setActionError(null)
    setSavePrefsBusy(true)
    try {
      const reply = await dispatch<{
        saved?: boolean
        needs_fork?: boolean
        workflow_dir?: string
        error?: string
        path?: string
      }>('save_workflow_preferences', {
        name: workflowName,
        preferred_backend: backend,
        preferred_model: model,
      })
      if (reply.error) { setActionError(reply.error); return }
      if (reply.needs_fork && reply.workflow_dir && !allowFork) {
        setSavePrefsPending({
          workflowName,
          workflowDir: reply.workflow_dir,
          backend,
          model,
        })
        return
      }
      if (reply.needs_fork && reply.workflow_dir && allowFork) {
        // Fork the bundled workflow into workspace, then retry.
        try {
          await forkBrainWorkflow(apiFetch, proxyId, reply.workflow_dir)
        } catch (exc) {
          setActionError(`fork failed: ${exc instanceof Error ? exc.message : String(exc)}`)
          return
        }
        const retry = await dispatch<{ saved?: boolean; error?: string }>(
          'save_workflow_preferences',
          { name: workflowName, preferred_backend: backend, preferred_model: model },
        )
        if (retry.error) { setActionError(retry.error); return }
        if (retry.saved) {
          await refreshWorkflows()
          await refreshTree()
          // Clear the override since the yaml now IS what was overridden.
          setRunConfigOverrides((prev) => {
            const next = { ...prev }
            delete next[workflowName]
            return next
          })
          setSavePrefsToast(`Forked ${workflowName} to workspace + saved preferences`)
        }
        return
      }
      if (reply.saved) {
        await refreshWorkflows()
        setRunConfigOverrides((prev) => {
          const next = { ...prev }
          delete next[workflowName]
          return next
        })
        setSavePrefsToast(`Saved preferences for ${workflowName}`)
      }
    } catch (exc) {
      setActionError(exc instanceof Error ? exc.message : String(exc))
    } finally {
      setSavePrefsBusy(false)
      setSavePrefsPending(null)
    }
  }, [apiFetch, dispatch, proxyId, refreshTree, refreshWorkflows])

  // Save a named (backend, model) combo to the workflow's
  // configurations[]. Triggered from the toolbar's save button when
  // the current selection doesn't match any saved configuration —
  // the operator types a name in the PromptDialog and confirms.
  const saveRunConfiguration = useCallback(async (
    workflowName: string,
    name: string,
    backend: string,
    model: string | null,
  ) => {
    setActionError(null)
    setSaveAsBusy(true)
    try {
      const reply = await dispatch<{
        saved?: boolean
        needs_fork?: boolean
        workflow_dir?: string
        error?: string
      }>('save_run_configuration', {
        workflow: workflowName,
        name,
        backend,
        ...(model ? { model } : {}),
      })
      if (reply.error) { setActionError(reply.error); return }
      if (reply.needs_fork && reply.workflow_dir) {
        // Bundled workflow — defer to the existing fork-confirm
        // dialog by stashing the save into savePrefsPending. Reuse
        // saveWorkflowPreferences's fork flow but adapt the
        // "needs_fork → confirm → retry" by inlining here: just
        // call forkBrainWorkflow + retry save_run_configuration.
        try {
          await forkBrainWorkflow(apiFetch, proxyId, reply.workflow_dir)
        } catch (exc) {
          setActionError(`fork failed: ${exc instanceof Error ? exc.message : String(exc)}`)
          return
        }
        const retry = await dispatch<{ saved?: boolean; error?: string }>(
          'save_run_configuration',
          { workflow: workflowName, name, backend, ...(model ? { model } : {}) },
        )
        if (retry.error) { setActionError(retry.error); return }
        if (retry.saved) {
          await refreshWorkflows()
          await refreshTree()
          setSavePrefsToast(`Forked ${workflowName} to workspace + saved "${name}"`)
        }
        return
      }
      if (reply.saved) {
        await refreshWorkflows()
        setSavePrefsToast(`Saved configuration "${name}"`)
      }
    } catch (exc) {
      setActionError(exc instanceof Error ? exc.message : String(exc))
    } finally {
      setSaveAsBusy(false)
      setSaveAsPending(null)
    }
  }, [apiFetch, dispatch, proxyId, refreshTree, refreshWorkflows])

  // Auto-clear the success toast after 4 seconds.
  useEffect(() => {
    if (!savePrefsToast) return
    const id = setTimeout(() => setSavePrefsToast(null), 4000)
    return () => clearTimeout(id)
  }, [savePrefsToast])

  // ─── step log subscription ────────────────────────────────────────

  // Pick the run we follow: the explicit one (just-started), else the
  // first active run if any. Falling back means an operator who opened
  // the panel after a run started still sees something live.
  const activeRunsList = state.active_runs ?? []
  const targetRunId = followedRunId ?? activeRunsList[0]?.run_id ?? null

  useEffect(() => {
    if (!targetRunId) {
      setSteps([])
      setRunResult(null)
      setToolCalls([])
      return
    }
    const stepsTopic = `/brain/${proxyId}/runs/${targetRunId}/steps`
    const resultTopic = `/brain/${proxyId}/runs/${targetRunId}/result`
    const toolCallsTopic = `/brain/${proxyId}/runs/${targetRunId}/tool_calls`
    const offSteps = wsClient.subscribe(stepsTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const rec = f.payload as StepRecord
      setSteps((prev) => [...prev.slice(-99), rec])  // keep last 100
    })
    const offResult = wsClient.subscribe(resultTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      setRunResult(f.payload as RunResultPayload)
    })
    // Tool calls carry the full args + result for each concrete bus
    // message brain published to a peer service. The Topics tab
    // renders them — that's where the operator drills into payloads.
    const offToolCalls = wsClient.subscribe(toolCallsTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const rec = f.payload as ToolCallMsg
      setToolCalls((prev) => [...prev.slice(-99), rec])
    })
    return () => { offSteps(); offResult(); offToolCalls() }
  }, [proxyId, targetRunId, wsClient])

  // ─── workflow_events: always-on subscription ─────────────────────
  //
  // The brain emits ``started`` immediately when engine.run() begins,
  // before the start_workflow reply that carries the new run_id
  // lands at the UI. If we waited for ``targetRunId`` to be set
  // before subscribing, we'd miss every ``started`` event. Mount the
  // sub at panel-open time + buffer events keyed by run_id; the
  // Steps tab filters by the currently-followed run at render time.
  useEffect(() => {
    if (!proxyId) return
    const eventsTopic = `/brain/${proxyId}/workflow_events`
    const off = wsClient.subscribe(eventsTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const evt = f.payload as WorkflowEvent
      if (!evt?.run_id) return
      setEventsByRunId((prev) => ({
        ...prev,
        [evt.run_id]: [...(prev[evt.run_id] ?? []), evt],
      }))
    })
    return () => { off() }
  }, [proxyId, wsClient])

  const serviceRunning = proxy.status === 'running' || proxy.status === 'starting'

  return (
    <div
      className="relative flex h-full min-h-[320px] min-w-[420px] flex-col gap-3 p-3 text-xs"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Header — provider + tool catalog size on the left; active-run
          pill (when a workflow is in flight) in the middle; wire-log
          toggle on the right. ``proxy_id`` was dropped: the surrounding
          panel title bar already labels the node by name. Workspace
          path is hover-visible on the provider chip. */}
      <div className="flex items-baseline justify-between gap-3 border-b border-slate-800 pb-2 text-[11px] text-slate-500">
        <span className="flex items-baseline gap-3">
          {/* Service default — the backend + model the brain falls
              back to when a workflow's ``preferred_backend`` /
              ``preferred_model`` aren't set AND the operator didn't
              override at Run time. Workflows in flight may be using
              something different — see the active-run pill (which
              shows the resolved values) or the workflow card's
              ``(live)`` row. Tooltip spells this out so the
              operator doesn't read this as "what's running". */}
          <span
            title={`Service default backend — falls back when workflow.preferred_backend is unset. Active runs may use a different backend (see the run pill).\nWorkspace: ${state.workspace ?? '?'}`}
            className="text-slate-300"
          >
            {activeBackend}
          </span>
          {(() => {
            const active = backends.find((b) => b.name === activeBackend)
            const model = active?.fields.model
            return (
              <span
                className="font-mono text-slate-500"
                title={model ? `${activeBackend} default model — runs override via workflow.preferred_model or start_workflow(model=...)` : undefined}
              >
                {model ?? (active?.name === 'mock' ? 'stub' : '—')}
              </span>
            )
          })()}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setShowTools((v) => {
                const next = !v
                if (next) void refreshTools()
                return next
              })
            }}
            className="nodrag nopan rounded border border-transparent text-slate-400 hover:border-slate-700 hover:text-slate-200"
            title="Click to list every tool brain currently offers to the LLM. One row per (service, action) — derived from /+/+/meta."
          >
            {state.tool_count ?? 0} tools {showTools ? '▾' : '▸'}
          </button>
        </span>
        {/* Active-run pill — appears when any workflow has a live run.
            Clicking it focuses the output pane on that run + opens
            the Steps tab so the operator can watch progress. Shows
            the most recent run; ``+N`` suffix indicates additional
            concurrent runs. */}
        {activeRunsList.length > 0 && (() => {
          const r0 = activeRunsList[0]
          // Show [backend/model_id] so the operator can read which
          // adapter + model the run is using — different from the
          // brain panel header's "service default", different from
          // the workflow.yaml's preferred_*, this is the ACTUAL
          // resolved value (per-call override > preferred_* > config
          // default). ``model_id`` is null when the adapter uses its
          // configured default; render it as ``default`` so the
          // operator can still tell the run is using *something*.
          const cfg = `${r0.backend ?? '?'}/${r0.model_id ?? 'default'}`
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setFollowedRunId(r0.run_id)
                setOutputTab('steps')
                setOutputCollapsed(false)
              }}
              className="nodrag nopan flex items-baseline gap-2 rounded border border-emerald-900/60 bg-emerald-950/30 px-2 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-900/40 hover:text-emerald-200"
              title={`Focus output pane on ${r0.run_id} — running ${cfg}`}
            >
              <span>▶</span>
              <span className="font-mono">{r0.workflow}</span>
              <span className="font-mono text-emerald-500/80">[{cfg}]</span>
              <span className="font-mono text-emerald-500/70">{r0.run_id}</span>
              {activeRunsList.length > 1 && (
                <span className="text-emerald-500/70">+{activeRunsList.length - 1}</span>
              )}
            </button>
          )
        })()}
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setOutputTab('wire')
              setOutputCollapsed(false)
            }}
            className="nodrag nopan rounded border border-slate-700 px-1.5 py-0 text-[10px] text-slate-400 hover:border-slate-500"
            title="Focus the output pane on the wire tab — request/reply traffic between this panel and the brain service"
          >
            wire {wireLog.length > 0 && <span className="ml-1 text-slate-500">({wireLog.length})</span>}
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowSettings(true) }}
            className="nodrag nopan flex items-center rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            title="Settings — backends + paths"
            aria-label="Settings"
          >
            <SettingsIcon size={12} />
          </button>
        </span>
      </div>

      {/* Tool catalog inspector — shown when the operator clicks the
          "<N> tools" chip in the header. Grouped by topic (one section
          per peer service) with a filter input at the top. Keeps case
          intact: action + topic are real identifiers the operator can
          paste into workflow.yaml. */}
      {showTools && (
        <div className="flex flex-col gap-1 rounded border border-slate-800 bg-slate-950/40 p-2 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500">tool catalog</span>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={toolsFilter}
                onChange={(e) => setToolsFilter(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                placeholder="filter…"
                className="nodrag nopan w-32 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-200 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void refreshTools() }}
                className="nodrag nopan rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 hover:border-slate-500"
              >
                refresh
              </button>
            </div>
          </div>
          {toolsList === null ? (
            <div className="text-slate-500">loading…</div>
          ) : toolsList.length === 0 ? (
            <div className="text-slate-500">no tools — service may not be running, or no peers have published meta yet.</div>
          ) : (() => {
            const f = toolsFilter.trim().toLowerCase()
            const filtered = f === ''
              ? toolsList
              : toolsList.filter((t) =>
                  t.topic.toLowerCase().includes(f)
                  || t.action.toLowerCase().includes(f)
                  || (t.description ?? '').toLowerCase().includes(f)
                )
            // Group by topic — each peer service contributes a section.
            const byTopic = new Map<string, ToolDescriptor[]>()
            for (const t of filtered) {
              const arr = byTopic.get(t.topic) ?? []
              arr.push(t)
              byTopic.set(t.topic, arr)
            }
            const topics = Array.from(byTopic.keys()).sort()
            return (
              <div className="flex flex-col gap-2">
                <div className="text-[10px] text-slate-600">
                  {filtered.length} of {toolsList.length} · {topics.length} {topics.length === 1 ? 'service' : 'services'}
                </div>
                {topics.map((topic) => (
                  <div key={topic} className="rounded border border-slate-800 bg-slate-900/40 p-1.5">
                    <div className="mb-1 font-mono text-[10px] text-slate-400">{topic}</div>
                    <ul className="flex flex-col gap-0.5">
                      {(byTopic.get(topic) ?? []).map((t) => (
                        <li key={`${topic}::${t.action}`} className="flex items-baseline gap-2 font-mono text-[11px]">
                          <span className="text-emerald-400">{t.action}</span>
                          {t.description && (
                            <span className="truncate text-[10px] text-slate-500" title={t.description}>
                              — {t.description.split('\n')[0]}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )
          })()}
        </div>
      )}

      {actionError && (
        <div className="rounded border border-red-900/60 bg-red-950/40 px-2 py-1 text-[11px] text-red-300">
          {actionError}
        </div>
      )}

      {/* Files ─────────────────────────────────────────────────────
          Stone A of docs/TODO_BRAIN_VIEWER.md. Two-pane layout — tree
          on the left, viewer on the right. Double-click a file to open.

          The tree merges per-instance workspace files with bundled
          workflow defaults; bundled entries are dimmed + tagged, and
          shadowed bundles (overridden locally) get a strikethrough so
          the operator sees both exist.

          Layout: ``flex-1 min-h-0`` makes the section claim all
          remaining vertical space and lets its child use flex-1 too
          (without min-h-0, nested flex children won't shrink below
          their content size — drama if the viewer overflows). */}
      <section className="flex min-h-0 flex-1 flex-col gap-1">
        {/* IDE-style toolbar above the explorer + editor area. Left
            half is FILE OPS (new workflow + refresh — explorer-y
            actions). Right half is RUN CONTROLS that mirror VSCode's
            debug toolbar: backend dropdown, model input, ▶ Run / ⏹
            Stop, save-as-preferred when overrides diverge. Run
            controls are scoped to whichever workflow the operator
            has selected in the tree; when nothing is selected they
            stay rendered but greyed out, so the operator can see
            the affordance ahead of time. */}
        {(() => {
          const wfName = selectedWorkflowName ?? ''
          const wf = wfName ? (workflows.find((w) => w.name === wfName) ?? null) : null
          const activeRun = wf ? activeRunsList.find((r) => r.workflow === wf.name) ?? null : null
          const override = wfName ? (runConfigOverrides[wfName] ?? {}) : {}
          const effectiveBackend = override.backend ?? wf?.preferred_backend ?? ''
          const effectiveModel = override.model ?? wf?.preferred_model ?? ''
          const isOverridden = wf !== null && (
            (override.backend !== undefined && override.backend !== wf.preferred_backend)
            || (override.model !== undefined && override.model !== (wf.preferred_model ?? ''))
          )
          const setBackend = (b: string) => {
            if (!wfName) return
            setRunConfigOverrides((prev) => ({
              ...prev,
              [wfName]: { ...(prev[wfName] ?? {}), backend: b },
            }))
          }
          const setModel = (m: string) => {
            if (!wfName) return
            setRunConfigOverrides((prev) => ({
              ...prev,
              [wfName]: { ...(prev[wfName] ?? {}), model: m },
            }))
          }
          const backendNames = backends.length === 0
            ? ['mock', 'ollama', 'anthropic', 'openai']
            : backends.map((b) => b.name)
          const runBackendDescriptor = backends.find((b) => b.name === effectiveBackend)
          const runBackendConfigured = effectiveBackend === 'mock'
            || (runBackendDescriptor?.configured ?? false)
          const runDisabled = !wf || !serviceRunning || !runBackendConfigured
          const runTitle = !wf ? 'Select a workflow folder in the tree to run it'
            : !serviceRunning ? 'Brain service not running'
            : !runBackendConfigured ? `${effectiveBackend} backend isn’t configured — open Settings to add credentials`
            : `Run ${wf.name} (${effectiveBackend}${effectiveModel ? '/' + effectiveModel : ''})`
          // Datalist suggestions for the model field. Sources, in
          // priority order:
          //   1. Live list from the backend's provider — populated
          //      via list_backend_models (ollama: /api/tags,
          //      anthropic/openai: /v1/models). Fetched lazily on
          //      backend change; cached in state so the dropdown
          //      stays responsive after the first fetch.
          //   2. The backend's configured default from BrainConfig.
          //   3. Any model_id seen on a current active run.
          const liveModels = backendModels[effectiveBackend] ?? []
          const backendDefaults = backends
            .map((b) => (b.name === effectiveBackend ? b.fields.model : null))
            .filter((s): s is string => !!s)
          const recentRunModels = activeRunsList
            .map((r) => r.model_id)
            .filter((s): s is string => !!s)
          const modelSuggestions = Array.from(new Set([
            ...liveModels, ...backendDefaults, ...recentRunModels,
          ]))
          return (
            <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-1">
              {/* LEFT — file operations */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setShowNewWorkflow(true) }}
                  disabled={!serviceRunning}
                  className="nodrag nopan flex items-center gap-1 rounded border border-emerald-700 bg-emerald-950/40 px-2 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-900/60 disabled:opacity-40"
                  title="Scaffold a new workflow under workflows/<name>/ with the five canonical files."
                >
                  <PlusIcon size={11} />
                  <span>New workflow</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void refreshTree() }}
                  disabled={!serviceRunning}
                  className="nodrag nopan rounded border border-slate-700 p-1 text-slate-300 hover:border-slate-500 disabled:opacity-40"
                  title="Refresh file tree"
                  aria-label="Refresh file tree"
                >
                  <RefreshIcon size={11} />
                </button>
                {/* Toggle bundled (shipped, read-only) workflows in the tree. */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setShowBundled((v) => !v) }}
                  className={`nodrag nopan flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] ${
                    showBundled
                      ? 'border-slate-700 text-slate-300 hover:border-slate-500'
                      : 'border-sky-700 bg-sky-950/30 text-sky-300 hover:border-sky-500'
                  }`}
                  title={showBundled
                    ? 'Example (shipped, read-only) workflows are shown — click to hide them'
                    : 'Example workflows are hidden — click to show them'}
                >
                  <span>{showBundled ? '☑' : '☐'} examples</span>
                </button>
              </div>

              {/* CENTER — which workflow the Run button will execute, so
                  it's never ambiguous. Resolves from the selected folder
                  OR a selected file within a workflow. */}
              <div className="flex min-w-0 flex-1 items-center justify-center px-2">
                {!wf ? (
                  <span className="text-[11px] text-slate-500">select a workflow to run</span>
                ) : selectedIsExample ? (
                  <span
                    className="flex min-w-0 items-center gap-1 rounded border border-amber-700 bg-amber-950/40 px-2 py-0.5 text-[11px] text-amber-300"
                    title={`${wf.name} is a read-only example — duplicate it to run.`}
                  >
                    <span className="shrink-0">example — duplicate to run:</span>
                    <span className="truncate font-mono font-medium">{wf.name}</span>
                  </span>
                ) : (
                  <span
                    className="flex min-w-0 items-center gap-1 rounded border border-emerald-700 bg-emerald-950/40 px-2 py-0.5 text-[11px] text-emerald-300"
                    title={`The Run button will execute ${wf.name}`}
                  >
                    <span className="shrink-0">▶ will run:</span>
                    <span className="truncate font-mono font-medium">{wf.name}</span>
                  </span>
                )}
              </div>

              {/* RIGHT — run configuration + Run/Stop. Always rendered;
                  disabled when no workflow is selected so the
                  affordance is visible up front. */}
              <div className={`flex items-center gap-1 ${wf ? '' : 'opacity-40'}`}>
                {/* Configuration dropdown — saved (backend, model)
                    combos. "(preferred)" is the no-override state.
                    "(custom)" appears only when the current
                    selection doesn't match any saved entry, as a
                    read-only sentinel. Picking a name writes its
                    backend + model into the overrides. */}
                {(() => {
                  const cfgs = wf?.configurations ?? []
                  const picked = cfgs.find((c) =>
                    c.backend === effectiveBackend
                    && (c.model ?? '') === effectiveModel,
                  )
                  // Sentinel values are reserved + can't collide with
                  // user-chosen names (those can't start with "$").
                  const PREFERRED = '$preferred'
                  const CUSTOM = '$custom'
                  const currentValue = !isOverridden ? PREFERRED
                    : picked ? picked.name
                    : CUSTOM
                  return (
                    <select
                      value={currentValue}
                      onChange={(e) => {
                        const val = e.target.value
                        if (!wfName) return
                        if (val === PREFERRED) {
                          // Clear override → use workflow.preferred_*
                          setRunConfigOverrides((prev) => {
                            const next = { ...prev }
                            delete next[wfName]
                            return next
                          })
                          return
                        }
                        if (val === CUSTOM) return  // sentinel — no-op
                        const cfg = cfgs.find((c) => c.name === val)
                        if (!cfg) return
                        setRunConfigOverrides((prev) => ({
                          ...prev,
                          [wfName]: { backend: cfg.backend, model: cfg.model ?? '' },
                        }))
                      }}
                      onClick={(e) => e.stopPropagation()}
                      disabled={!wf}
                      className="nodrag nopan rounded border border-slate-700 bg-slate-950 px-1 py-0.5 font-mono text-[10px] text-slate-100 focus:border-slate-500 focus:outline-none disabled:opacity-50"
                      title={wf ? 'Saved (backend, model) configurations for this workflow' : 'select a workflow'}
                    >
                      <option value={PREFERRED}>(preferred)</option>
                      {cfgs.map((c) => (
                        <option key={c.name} value={c.name} title={c.description ?? ''}>
                          {c.name}
                        </option>
                      ))}
                      {currentValue === CUSTOM && <option value={CUSTOM}>(custom)</option>}
                    </select>
                  )
                })()}
                <select
                  value={effectiveBackend}
                  onChange={(e) => setBackend(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  disabled={!wf}
                  className="nodrag nopan rounded border border-slate-700 bg-slate-950 px-1 py-0.5 font-mono text-[10px] text-slate-100 focus:border-slate-500 focus:outline-none disabled:opacity-50"
                  title={wf ? `Backend for the next run (preferred: ${wf.preferred_backend})` : 'select a workflow'}
                >
                  {!effectiveBackend && <option value="" disabled>(no backend)</option>}
                  {backendNames.map((name) => {
                    const b = backends.find((x) => x.name === name)
                    const configured = b ? b.configured : name === 'mock'
                    return (
                      <option key={name} value={name}>
                        {name}{configured ? '' : ' ⚠'}
                      </option>
                    )
                  })}
                </select>
                <input
                  type="text"
                  list="brain-toolbar-models"
                  value={effectiveModel}
                  onChange={(e) => setModel(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  disabled={!wf}
                  placeholder={effectiveBackend ? `default for ${effectiveBackend}` : 'model'}
                  className="nodrag nopan w-32 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-100 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none disabled:opacity-50"
                  title={wf ? `Model id for the next run (preferred: ${wf.preferred_model ?? 'adapter default'})` : 'select a workflow'}
                />
                <datalist id="brain-toolbar-models">
                  {modelSuggestions.map((m) => <option key={m} value={m} />)}
                </datalist>

                {/* Save current (backend, model) as a named
                    configuration. Only shown when the current
                    selection isn't already a saved entry — once
                    saved, the dropdown above shows it as picked +
                    the save button disappears until the operator
                    diverges again. Bundled workflows trigger the
                    fork-confirm flow inside saveRunConfiguration. */}
                {wf && isOverridden && !(wf.configurations ?? []).find((c) =>
                  c.backend === effectiveBackend
                  && (c.model ?? '') === effectiveModel,
                ) && (
                  <button
                    type="button"
                    disabled={savePrefsBusy || saveAsBusy}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSaveAsPending({
                        workflowName: wf.name,
                        backend: effectiveBackend,
                        model: effectiveModel || null,
                        suggestedName: `${effectiveBackend}/${effectiveModel || 'default'}`,
                      })
                    }}
                    className="nodrag nopan flex items-center gap-1 rounded border border-sky-700 bg-sky-950/30 px-1.5 py-0.5 text-[10px] text-sky-200 hover:bg-sky-900/40 disabled:opacity-40"
                    title={`Save ${effectiveBackend}/${effectiveModel || 'default'} as a named configuration of ${wf.name}`}
                  >
                    <SaveIcon size={11} />
                    <span>save</span>
                  </button>
                )}

                {activeRun ? (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void cancelRun(activeRun.run_id) }}
                    className="nodrag nopan flex items-center gap-1 rounded border border-red-700 bg-red-950/40 px-2 py-0.5 text-[11px] text-red-300 hover:bg-red-900/60"
                    title={`Stop run ${activeRun.run_id}`}
                  >
                    <StopIcon size={11} />
                    <span>Stop</span>
                  </button>
                ) : selectedIsExample ? (
                  // Examples are read-only templates — never run directly.
                  // Offer "Duplicate to run" instead (creates an editable
                  // workspace copy, then it's ready to run).
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDuplicateTarget({ sourcePath: `workflows/${wfName}`, srcName: wfName })
                    }}
                    className="nodrag nopan flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-500"
                    title="Examples can't run directly — duplicate this example to an editable workspace workflow, then run it."
                  >
                    <CopyIcon size={11} />
                    <span>Duplicate to run</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (wf) void startWorkflow(wf, undefined, runConfigOverrides[wfName] ?? undefined)
                    }}
                    disabled={runDisabled}
                    className="nodrag nopan flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                    title={runTitle}
                  >
                    <PlayIcon size={11} />
                    <span>Run</span>
                  </button>
                )}
              </div>
            </div>
          )
        })()}

        {/* Workspace + bundled paths moved to the Settings drawer
            (gear icon in the title bar). Operators want them visible
            occasionally for copy-paste, not on every interaction. */}

        {treeError && (
          <div className="rounded border border-red-900/60 bg-red-950/40 px-2 py-1 text-[11px] text-red-300">
            {treeError}
          </div>
        )}

        <div className="flex min-h-0 flex-1 gap-0 rounded border border-slate-800 bg-slate-950/30">
          {/* Left: file tree. min-h-0 lets the overflow scroll work
              inside a flex parent. Width is drag-resizable via the
              splitter on its right edge. */}
          <div
            style={{ width: explorerWidth }}
            className="shrink-0 overflow-auto p-1"
          >
            {tree === null ? (
              <div className="text-[11px] text-slate-500">
                {serviceRunning ? 'loading…' : 'service not running'}
              </div>
            ) : tree.entries.length === 0 ? (
              <div className="text-[11px] text-slate-500">workspace is empty</div>
            ) : (
              <FileTree
                entries={showBundled ? tree.entries : filterOutBundled(tree.entries)}
                openPath={openFile?.path ?? null}
                selectedKey={selectedEntry ? entryKey(selectedEntry.path, selectedEntry.source) : null}
                onOpen={openFileAt}
                onSelect={handleTreeSelect}
                onContextMenu={handleTreeContextMenu}
              />
            )}
          </div>

          {/* Vertical splitter between explorer and editor. Drag
              RIGHT (positive delta) grows the explorer. Clamped to
              keep both panes usable. */}
          <div
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              const startW = explorerWidth
              startDrag(e.clientX, 'x', (delta) => {
                setExplorerWidth(Math.min(900, Math.max(160, startW + delta)))
              })
            }}
            onDoubleClick={() => setExplorerWidth(256)}
            onMouseEnter={() => setSplitHover(true)}
            onMouseLeave={() => setSplitHover(false)}
            title="Drag to resize the folder pane (double-click to reset)"
            // Inline styles, NOT Tailwind classes: service-UI bundles only
            // get CSS for utility classes the HOST already uses (its
            // tailwind `content` doesn't scan repo bundles), so uncommon
            // classes silently render nothing. Inline styles always apply.
            style={{
              position: 'relative',
              width: 8,
              flexShrink: 0,
              alignSelf: 'stretch',
              cursor: 'col-resize',
              background: splitHover ? '#0ea5e9' : '#475569',
            }}
          >
            {/* Wider transparent hit strip so the 8px bar is easy to grab. */}
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: -5, right: -5 }} />
            {/* Grip dots — read as a draggable handle. */}
            <div style={{
              position: 'absolute', top: 0, bottom: 0, left: '50%',
              transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 4, pointerEvents: 'none',
            }}>
              <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#e2e8f0' }} />
              <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#e2e8f0' }} />
              <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#e2e8f0' }} />
            </div>
          </div>

          {/* Right: viewer pane. ``overflow-hidden`` so the inner
              renderer (markdown or CodeMirror) owns scrolling — without
              this CodeMirror gets 0 height because the parent is "as
              tall as content" via overflow-auto. */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-2">
            {selectedWorkflowName && openFile === null ? (
              (() => {
                // Workflow editor pane. Looks up the workflow's
                // metadata (model / max_steps / description / inputs)
                // in the brain's discovered list. Falls back gracefully
                // when the directory is named like a workflow but the
                // brain hasn't loaded it yet (or it failed to parse).
                const wfName = selectedWorkflowName
                const wf = workflows.find((w) => w.name === wfName) ?? null
                const specs = inputSpecs[wfName] ?? {}
                const draft = workflowInputs[wfName] ?? {}
                const hasInputs = Object.keys(specs).length > 0
                const activeRun = activeRunsList.find((r) => r.workflow === wfName) ?? null
                const setInput = (key: string, value: string) => {
                  setWorkflowInputs((prev) => ({
                    ...prev,
                    [wfName]: { ...(prev[wfName] ?? {}), [key]: value },
                  }))
                }
                return (
                  <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto">
                    {/* Workflow toolbar — IDE-style run/stop controls
                        sit at the top of the editor pane. Run is
                        disabled while the service is down OR while
                        this workflow already has an active run; Stop
                        appears in its place when there's a run to
                        cancel. */}
                    <header className="flex items-start justify-between gap-2 border-b border-slate-800 pb-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <h3 className="font-mono text-sm text-slate-100">{wfName}</h3>
                          <span className="font-mono text-[10px] text-slate-500" title={selectedEntry?.path}>
                            {selectedEntry?.source}
                          </span>
                          {wf?.error && <span className="text-[10px] text-red-400" title={wf.error}>parse error</span>}
                        </div>
                        {wf?.description && (
                          <p className="mt-1 whitespace-pre-wrap text-[11px] text-slate-400">{wf.description}</p>
                        )}
                        {wf && (
                          <div className="mt-1 flex items-baseline gap-3 text-[10px] text-slate-500">
                            {/* Live vs preferred: when a run is in
                                flight for this workflow, show what
                                the run is actually using (could
                                differ from the yaml if the operator
                                overrode at start). Otherwise show
                                the yaml's preferred — the default
                                the next Run would use. The tag
                                ``(live)`` / ``(preferred)`` is
                                small but unambiguous about which
                                you're looking at. */}
                            {activeRun ? (
                              <>
                                <span>
                                  backend: <span className="font-mono text-emerald-300">{activeRun.backend ?? '?'}</span>
                                  <span className="ml-1 text-[9px] text-emerald-500/70">(live)</span>
                                </span>
                                <span>
                                  model: <span className="font-mono text-emerald-300">{activeRun.model_id ?? 'default'}</span>
                                </span>
                              </>
                            ) : (
                              <>
                                <span>
                                  backend: <span className="font-mono text-slate-300">{wf.preferred_backend}</span>
                                  <span className="ml-1 text-[9px] text-slate-600">(preferred)</span>
                                </span>
                                {wf.preferred_model && (
                                  <span>model: <span className="font-mono text-slate-300">{wf.preferred_model}</span></span>
                                )}
                              </>
                            )}
                            <span>max_steps: <span className="font-mono text-slate-300">{wf.max_steps}</span></span>
                            {wf.requires_human_approval && <span className="text-amber-400">approval-gated</span>}
                          </div>
                        )}
                      </div>
                      {/* Run / Stop + run-config UI live in the
                          IDE-style toolbar above the explorer + editor
                          panes (in the section header), not in the
                          workflow card. Removed from here to declutter
                          + mirror VSCode's debug-toolbar pattern. */}
                    </header>


                    {/* Inputs form lives inline in the editor pane —
                        no accordion. Submitting (Enter inside any
                        field) is the same as clicking Run, mirroring
                        VSCode's launch.json args UX. */}
                    {hasInputs && (
                      <form
                        onSubmit={(e) => { e.preventDefault(); if (wf) void startWorkflow(wf, e, runConfigOverrides[wfName] ?? undefined) }}
                        className="flex flex-col gap-2"
                      >
                        <div className="text-[10px] text-slate-500">inputs</div>
                        {Object.entries(specs).map(([key, spec]) => (
                          <label key={key} className="flex flex-col gap-1 text-[11px]">
                            <span className="flex items-baseline gap-2 text-slate-400">
                              <span className="font-mono">{key}</span>
                              {spec.required && <span className="text-amber-400" title="required">*</span>}
                              <span className="text-[10px] text-slate-600">{spec.type}</span>
                            </span>
                            <input
                              type="text"
                              value={draft[key] ?? (spec.default as string | undefined) ?? ''}
                              onChange={(e) => setInput(key, e.target.value)}
                              placeholder={spec.description ?? ''}
                              className="nodrag nopan rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100 focus:border-slate-500 focus:outline-none"
                            />
                            {spec.description && <span className="text-[10px] text-slate-500">{spec.description}</span>}
                          </label>
                        ))}
                      </form>
                    )}

                    {/* Active run summary, when applicable. The full
                        per-run step trace lives in the Step log
                        section below; this is just a "yes it's
                        running" indicator inside the workflow pane. */}
                    {activeRun && (
                      <div className="rounded border border-emerald-900/60 bg-emerald-950/30 px-2 py-1 text-[11px] text-emerald-300">
                        ▶ <span className="font-mono">{activeRun.run_id}</span> · {activeRun.status}
                      </div>
                    )}

                    {!wf && (
                      <div className="rounded border border-slate-800 bg-slate-950/40 px-2 py-1 text-[11px] text-slate-500">
                        Brain hasn’t reported this workflow yet. Try expanding the folder + opening <span className="font-mono">workflow.yaml</span> to inspect it directly, or refresh the workflows list.
                      </div>
                    )}
                  </div>
                )
              })()
            ) : openFile === null ? (
              fileLoading ? (
                <div className="text-[11px] text-slate-500">loading file…</div>
              ) : fileError ? (
                <div className="rounded border border-red-900/60 bg-red-950/40 px-2 py-1 text-[11px] text-red-300">
                  {fileError}
                </div>
              ) : (
                <div className="text-[11px] text-slate-500">
                  Click a workflow folder for its summary + Run controls, or click a file to open it here.
                </div>
              )
            ) : (
              <>
                {/* Viewer header: file path + source/readonly badges +
                    edit/save/discard controls. The dirty dot + the
                    Save button enable as soon as the buffer diverges
                    from the on-disk content. Ctrl/Cmd-S inside the
                    editor saves too (handled in CodeEditor). */}
                <div className="mb-2 flex items-center justify-between border-b border-slate-800 pb-1 text-[10px]">
                  <div className="flex min-w-0 items-center gap-2">
                    <code className="truncate font-mono text-slate-400" title={openFile.path}>
                      {openFile.path}
                    </code>
                    {dirty && (
                      <span className="shrink-0 text-amber-400" title="unsaved changes">●</span>
                    )}
                    <span className={`shrink-0 rounded px-1 text-[9px] tracking-wider ${
                      openFile.source === 'workspace'
                        ? 'bg-slate-800 text-slate-300'
                        : 'bg-slate-800 text-slate-500'
                    }`}>
                      {openFile.source === 'bundled' ? 'example' : openFile.source}
                    </span>
                    {!openFile.writable && (
                      <span className="shrink-0 rounded bg-slate-800 px-1 text-[9px] tracking-wider text-slate-500">
                        read-only
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {editBuffer === null ? (
                      // View mode: bundled files get a Fork button
                      // (stone D), workspace files get an Edit button
                      // (stone C). A bundled file outside any workflow
                      // dir has no fork target — fall through to the
                      // disabled Edit button.
                      forkTarget ? (
                        <button
                          type="button"
                          onClick={() => setDuplicateTarget({ sourcePath: forkTarget.workflowDir, srcName: forkTarget.workflowName })}
                          className="rounded border border-emerald-700 bg-emerald-950/40 px-2 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-900/60"
                          title={`Duplicate the ${forkTarget.workflowName} example into an editable workspace workflow.`}
                        >
                          Duplicate to edit
                        </button>
                      ) : (
                        // Edit-only viewer-header action. Rename /
                        // Delete / Delete-workflow live in the tree's
                        // right-click / kebab menu so there's exactly
                        // one place each file-system action exists.
                        // Edit stays here because it operates on the
                        // currently-OPEN file's content, not its
                        // identity — it's a viewer-mode action, not a
                        // tree action.
                        <button
                          type="button"
                          onClick={startEdit}
                          disabled={!openFile.writable}
                          className="rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 disabled:opacity-40"
                          title={openFile.writable
                            ? 'Edit this file in source mode'
                            : 'Bundled files are read-only — fork the workflow to edit'}
                        >
                          Edit
                        </button>
                      )
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => void saveEdit()}
                          disabled={!dirty || saving}
                          className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
                          title="Save (Ctrl/Cmd-S)"
                        >
                          {saving ? '…' : 'Save'}
                        </button>
                        <button
                          type="button"
                          onClick={discardEdit}
                          disabled={saving}
                          className="rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 disabled:opacity-40"
                          title="Discard unsaved changes + return to view mode"
                        >
                          Discard
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {saveError && (
                  <div className="mb-1 rounded border border-red-900/60 bg-red-950/40 px-2 py-1 text-[11px] text-red-300">
                    {saveError}
                  </div>
                )}
                <div className="min-h-0 flex-1">
                  <FileViewer
                    content={editBuffer ?? openFile.content}
                    mime={openFile.mime}
                    filename={openFile.path.split('/').pop()}
                    editing={editBuffer !== null}
                    onChange={(v) => setEditBuffer(v)}
                    onSave={() => void saveEdit()}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Inline sections below the file browser. Each section header is
          a click-to-collapse toggle so the operator can hide what they
          don't need. Previously these all lived in a "Brain controls"
          modal; that has been retired in favour of integrated panels. */}

      {/* Backends moved to Settings drawer (gear icon in title bar). */}

      {/* The standalone Workflows accordion section was removed in
          Phase 1 of the IDE-style redesign — workflows are now
          discovered + run from the file tree (click a workflow
          folder → the right pane shows the Workflow card with the
          inputs form + Run/Stop toolbar). The workflow list is still
          fetched into ``workflows`` state because the editor pane
          looks up metadata (model, max_steps, description) from it.
          ``refreshWorkflows`` lives on the file-tree Refresh button. */}

      {/* Active runs ───────────────────────────────────────────────── */}
      <section className="flex flex-col gap-1">
        <div className="flex items-center justify-between border-b border-slate-800 pb-1">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleSection('runs') }}
            aria-expanded={!sectionCollapsed.runs}
            className="nodrag nopan flex items-center gap-2 text-[11px] text-slate-400 hover:text-slate-200"
          >
            <span className="text-slate-600">{sectionCollapsed.runs ? '▸' : '▾'}</span>
            <span>active runs</span>
            <span className="text-[10px] text-slate-600">({activeRunsList.length})</span>
          </button>
          {/* Clear all on-disk run history (workspace/runs/). In-flight
              runs are kept server-side. */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setClearRunsOpen(true) }}
            disabled={clearingRuns}
            title="Delete all saved run data (workspace/runs). Active runs are kept."
            className="nodrag nopan rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400 hover:border-red-800 hover:text-red-300 disabled:opacity-50"
          >
            {clearingRuns ? 'Clearing…' : 'Clear runs'}
          </button>
        </div>
        {!sectionCollapsed.runs && (activeRunsList.length === 0 ? (
          <div className="text-slate-500">idle</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {activeRunsList.map((r) => {
              const wf = workflows.find((w) => w.name === r.workflow)
              const needsApproval = !!wf?.requires_human_approval
              const isFollowed = targetRunId === r.run_id
              return (
                <li
                  key={r.run_id}
                  className={`rounded border bg-slate-950/40 p-2 ${isFollowed ? 'border-emerald-700' : 'border-slate-800'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="font-mono text-slate-200">{r.workflow}</span>
                      <span className="font-mono text-[10px] text-slate-500">{r.run_id}</span>
                      <span className="text-[10px] text-slate-400">{r.status}</span>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setFollowedRunId(r.run_id); setSteps([]); setRunResult(null) }}
                        className="nodrag nopan rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:border-slate-500"
                      >
                        Follow
                      </button>
                      {needsApproval && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void approveRun(r.run_id, true) }}
                            className="nodrag nopan rounded bg-emerald-700 px-2 py-1 text-[10px] font-medium text-white hover:bg-emerald-600"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void approveRun(r.run_id, false) }}
                            className="nodrag nopan rounded border border-red-900 px-2 py-1 text-[10px] text-red-300 hover:bg-red-950/50"
                          >
                            Deny
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void cancelRun(r.run_id) }}
                        className="nodrag nopan rounded border border-red-900 px-2 py-1 text-[10px] text-red-300 hover:bg-red-950/50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        ))}
      </section>

      {/* Output pane ──────────────────────────────────────────────────
          IDE-style bottom panel. Three tabs:
            * steps  — engine step trace (one row per step)
            * wire   — request/reply for every dispatch() call from
                       this panel to brain
            * topics — bus messages brain published during the run,
                       with full args + result (drill-in)
          Counters on each tab give a quick read on activity. The
          chevron collapses the body while keeping the tab bar
          visible so the operator can still see traffic counts.
          Vertical resize handle at the top of the section lets the
          operator give the output more or less room — same affordance
          as VSCode's terminal panel splitter. */}
      <section className="flex flex-col gap-1">
        {!outputCollapsed && (
          <div
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              const startH = outputHeight
              // Drag UP grows the pane (delta is negative when moving
              // up). Clamp to a usable range.
              startDrag(e.clientY, 'y', (delta) => {
                setOutputHeight(Math.min(800, Math.max(80, startH - delta)))
              })
            }}
            className="h-1 cursor-row-resize rounded bg-slate-800 hover:bg-sky-500"
            title="Drag to resize output pane"
          />
        )}
        <div className="flex items-center justify-between border-b border-slate-800 pb-1">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setOutputCollapsed((v) => !v) }}
              aria-expanded={!outputCollapsed}
              className="nodrag nopan rounded p-0.5 text-slate-600 hover:bg-slate-800 hover:text-slate-300"
              title={outputCollapsed ? 'Expand output' : 'Collapse output'}
            >
              {outputCollapsed ? '▸' : '▾'}
            </button>
            {([
              { id: 'steps', label: 'steps', count: steps.length },
              { id: 'wire', label: 'wire', count: wireLog.length },
              { id: 'topics', label: 'topics', count: toolCalls.length },
            ] as const).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={(e) => { e.stopPropagation(); setOutputTab(t.id); setOutputCollapsed(false) }}
                className={`nodrag nopan flex items-baseline gap-1 rounded px-2 py-0.5 text-[11px] ${
                  outputTab === t.id
                    ? 'bg-slate-800 text-sky-300'
                    : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                }`}
              >
                <span>{t.label}</span>
                {t.count > 0 && <span className="text-[10px] text-slate-500">{t.count}</span>}
              </button>
            ))}
            {targetRunId && (
              <span className="ml-1 font-mono text-[10px] text-slate-600" title="Run currently being followed">
                {targetRunId}
              </span>
            )}
          </div>
          {/* Per-tab "Clear" affordance — same button slot for all
              tabs, action depends on which tab is active. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              if (outputTab === 'steps') {
                setSteps([]); setRunResult(null)
                if (targetRunId) setEventsByRunId((prev) => {
                  const next = { ...prev }
                  delete next[targetRunId]
                  return next
                })
              }
              else if (outputTab === 'wire') setWireLog([])
              else if (outputTab === 'topics') { setToolCalls([]); setExpandedToolCallId(null) }
            }}
            className="nodrag nopan text-[10px] text-slate-500 hover:text-slate-300"
            title={`Clear ${outputTab}`}
          >
            Clear
          </button>
        </div>

        {!outputCollapsed && outputTab === 'steps' && (<>
        {/* Approval gate — when the followed run is parked waiting
            for operator approval, surface approve/deny right here
            so the operator doesn't have to fish for it. Mirrors
            VSCode's "continue/skip" breakpoint affordance. */}
        {(() => {
          const followedRun = activeRunsList.find((r) => r.run_id === targetRunId)
          if (!followedRun || followedRun.status !== 'awaiting_approval') return null
          return (
            <div className="flex items-center justify-between gap-2 rounded border border-amber-900/60 bg-amber-950/30 px-2 py-1 text-[11px] text-amber-200">
              <span>
                <span className="font-medium">approval required</span> · run paused before next tool call
              </span>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void approveRun(followedRun.run_id, true) }}
                  className="nodrag nopan rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-500"
                  title="Allow the run to continue"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void approveRun(followedRun.run_id, false) }}
                  className="nodrag nopan rounded border border-red-700 bg-red-950/40 px-2 py-0.5 text-[10px] text-red-300 hover:bg-red-900/60"
                  title="Cancel the run instead of approving"
                >
                  Deny
                </button>
              </div>
            </div>
          )
        })()}
        <div
          style={{ height: outputHeight }}
          className="overflow-y-auto rounded border border-slate-800 bg-slate-950/60 p-1 font-mono text-[11px]"
        >
          {/* Framework: STARTED bookend. Brain's engine publishes
              this on /brain/<id>/workflow_events the moment a run
              begins. Renders italic + with a "framework" tag so the
              operator can distinguish engine boundaries from model
              steps. Lists the resolved backend + inputs so the
              start-of-run context is captured in the log too. */}
          {(eventsByRunId[targetRunId ?? ''] ?? []).filter((e) => e.event === 'started').map((e, i) => (
            <div
              key={`started-${i}`}
              className="flex items-baseline gap-2 border-b border-slate-800 px-1 py-0.5 italic text-sky-400"
            >
              <span className="w-6 shrink-0 text-slate-600">▶</span>
              <span className="truncate">
                <span className="text-[9px] uppercase tracking-wider text-slate-500">framework</span>
                <span className="ml-1">started</span>
                {e.model && <span className="ml-2 text-slate-400">backend={e.model}</span>}
                {e.inputs && Object.keys(e.inputs).length > 0 && (
                  <span className="ml-2 text-slate-500">inputs={JSON.stringify(e.inputs)}</span>
                )}
              </span>
            </div>
          ))}
          {steps.length === 0 && (eventsByRunId[targetRunId ?? ''] ?? []).length === 0 ? (
            <div className="px-1 text-slate-600">no steps yet — pick a workflow and press Run</div>
          ) : (
            steps.map((s, i) => {
              const verdictBad = s.verdict && !s.verdict.allowed
              const isDone = s.action?.kind === 'done'
              // Cross-tab jump: clicking a step that corresponds to a
              // tool call switches to the Topics tab and expands the
              // matching row so the operator can see args + result.
              // Matched by step number — brain's run_logger emits one
              // tool_call per step (step.action.kind === 'tool').
              const matching = !isDone ? toolCalls.find((tc) => tc.step === s.step) : null
              return (
                <button
                  key={i}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!matching) return
                    setOutputTab('topics')
                    setExpandedToolCallId(matching.tool_call_id)
                  }}
                  disabled={!matching}
                  className={`flex w-full items-baseline gap-2 px-1 py-0.5 text-left ${verdictBad ? 'text-red-300' : isDone ? 'text-emerald-300' : 'text-slate-300'} ${matching ? 'cursor-pointer hover:bg-slate-900/60' : 'cursor-default'}`}
                  title={matching ? 'Click to see args + result in the Topics tab' : undefined}
                >
                  <span className="w-6 shrink-0 text-slate-600">#{s.step}</span>
                  {isDone ? (
                    <span className="truncate">done — {s.action?.rationale ?? ''}</span>
                  ) : (
                    <span className="truncate">
                      {s.action?.topic}::{s.action?.action}
                      {verdictBad && (
                        <span className="ml-1 text-red-400">[{s.verdict?.guard ?? 'denied'}]</span>
                      )}
                      {matching && <span className="ml-2 text-[9px] text-sky-400">→ topics</span>}
                    </span>
                  )}
                </button>
              )
            })
          )}
          {/* Framework: ENDED bookend. Mirrors the STARTED row with
              the engine's published end-of-run summary — duration,
              tool-call count, terminal status, and failure_reason
              when applicable. Visual cue that the engine took back
              control from the model. */}
          {(eventsByRunId[targetRunId ?? ''] ?? []).filter((e) => e.event === 'ended').map((e, i) => {
            const okTone = e.status === 'success' ? 'text-emerald-400'
              : e.status === 'cancelled' ? 'text-yellow-400'
              : 'text-red-400'
            return (
              <div
                key={`ended-${i}`}
                className={`flex items-baseline gap-2 border-t border-slate-800 px-1 py-0.5 italic ${okTone}`}
              >
                <span className="w-6 shrink-0 text-slate-600">■</span>
                <span className="truncate">
                  <span className="text-[9px] uppercase tracking-wider text-slate-500">framework</span>
                  <span className="ml-1">ended</span>
                  <span className="ml-2">{e.status}</span>
                  {typeof e.duration_ms === 'number' && (
                    <span className="ml-2 text-slate-500">{(e.duration_ms / 1000).toFixed(2)}s</span>
                  )}
                  {typeof e.tool_calls_count === 'number' && (
                    <span className="ml-2 text-slate-500">{e.tool_calls_count} tool calls</span>
                  )}
                  {e.failure_reason && (
                    <span className="ml-2 truncate text-slate-400" title={e.failure_reason}>
                      — {e.failure_reason}
                    </span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
        {runResult && (
          <div
            className={`rounded border px-2 py-1 text-[11px] ${
              runResult.status === 'success'
                ? 'border-emerald-900/60 bg-emerald-950/30 text-emerald-300'
                : runResult.status === 'cancelled'
                  ? 'border-yellow-900/60 bg-yellow-950/30 text-yellow-300'
                  : 'border-red-900/60 bg-red-950/30 text-red-300'
            }`}
          >
            <span className="font-medium">{runResult.status}</span>
            <span className="ml-2">{runResult.body}</span>
          </div>
        )}
        </>)}

        {!outputCollapsed && outputTab === 'wire' && (
          <div
            style={{ height: outputHeight }}
            className="overflow-y-auto rounded border border-slate-800 bg-slate-950/60 p-1 font-mono text-[10px]"
          >
            {wireLog.length === 0 ? (
              <div className="px-1 text-slate-600">no traffic yet</div>
            ) : (
              wireLog.map((w, i) => {
                const t = new Date(w.ts).toISOString().slice(11, 19)
                const ok = !w.error
                return (
                  <details key={i} className={`px-1 py-0.5 ${ok ? 'text-slate-300' : 'text-red-300'}`}>
                    <summary className="cursor-pointer truncate">
                      <span className="text-slate-600">{t}</span>
                      <span className="ml-2">{ok ? '→' : '✗'} {w.action}</span>
                      {w.latencyMs !== undefined && (
                        <span className="ml-2 text-slate-500">{w.latencyMs}ms</span>
                      )}
                      {w.error && <span className="ml-2 truncate text-red-400">{w.error}</span>}
                    </summary>
                    <div className="ml-3 mt-0.5 flex flex-col gap-0.5">
                      <div>
                        <span className="text-slate-500">req: </span>
                        <span className="break-all">{JSON.stringify(w.request)}</span>
                      </div>
                      {w.reply !== undefined && (
                        <div>
                          <span className="text-slate-500">res: </span>
                          <span className="break-all">{JSON.stringify(w.reply)}</span>
                        </div>
                      )}
                    </div>
                  </details>
                )
              })
            )}
          </div>
        )}

        {!outputCollapsed && outputTab === 'topics' && (
          <div
            style={{ height: outputHeight }}
            className="overflow-y-auto rounded border border-slate-800 bg-slate-950/60 p-1 font-mono text-[10px]"
          >
            {toolCalls.length === 0 ? (
              <div className="px-1 text-slate-600">
                no tool calls yet — Run a workflow and any tool calls brain makes will appear here with full args + result.
              </div>
            ) : (
              toolCalls.map((tc) => {
                const t = tc.ts.slice(11, 19)
                const isOpen = expandedToolCallId === tc.tool_call_id
                const status = tc.result?.status ?? 'ok'
                const statusColor =
                  status === 'ok' ? 'text-emerald-300'
                  : status === 'timeout' ? 'text-amber-300'
                  : 'text-red-300'
                return (
                  <div key={tc.tool_call_id} className="border-b border-slate-900 px-1 py-0.5 last:border-b-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setExpandedToolCallId(isOpen ? null : tc.tool_call_id)
                      }}
                      className="nodrag nopan flex w-full items-baseline gap-2 text-left text-slate-300 hover:text-slate-100"
                    >
                      <span className="w-6 shrink-0 text-slate-600">#{tc.step}</span>
                      <span className="text-slate-600">{t}</span>
                      <span className="truncate">
                        <span className="text-slate-400">{tc.topic}</span>
                        <span className="text-slate-500">::</span>
                        <span className="text-sky-300">{tc.action}</span>
                      </span>
                      <span className={`ml-auto shrink-0 ${statusColor}`}>{status}</span>
                      <span className="shrink-0 text-slate-600">{isOpen ? '▾' : '▸'}</span>
                    </button>
                    {isOpen && (
                      <div className="ml-3 mt-1 flex flex-col gap-1 text-[10px]">
                        <div>
                          <span className="text-slate-500">args: </span>
                          <pre className="break-all whitespace-pre-wrap text-slate-300">
                            {JSON.stringify(tc.args, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <span className="text-slate-500">result: </span>
                          <pre className="break-all whitespace-pre-wrap text-slate-300">
                            {JSON.stringify(tc.result, null, 2)}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}
      </section>


      {/* Unsaved-changes prompt when the operator double-clicks
          another file while a buffer is dirty. Confirms before throwing
          away their edits. */}
      {pendingOpen !== null && (
        <ConfirmDialog
          title="Unsaved changes"
          message={
            <p>
              You have unsaved edits on{' '}
              <code className="font-mono text-slate-400">{openFile?.path}</code>.
              Discard them and open the new file?
            </p>
          }
          confirmLabel="Discard + open"
          variant="danger"
          onConfirm={() => {
            const target = pendingOpen
            setPendingOpen(null)
            setEditBuffer(null)
            if (target) void performOpen(target.path, target.source)
          }}
          onCancel={() => setPendingOpen(null)}
        />
      )}

      {/* Tree context menu — right-click or "..." on any node opens
          this. Items derived from the entry by contextMenuForEntry. */}
      {contextMenu && (
        <ContextMenu
          items={contextMenu.items}
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Stone E: new-workflow prompt. Scaffolds the 5 canonical
          files from templates + opens prompt.md so the operator is
          immediately in their primary editing surface. */}
      {showNewWorkflow && (
        <PromptDialog
          title="New workflow"
          message="Creates workflows/<name>/ in the workspace with workflow.yaml + prompt.md + allowed_tools.yaml + success.md + failure.md pre-populated from safe templates."
          label="Workflow name"
          placeholder="my_workflow"
          initialValue=""
          submitLabel="Create"
          busy={busyNewWorkflow}
          validate={(value) => {
            if (!/^[a-z][a-z0-9_]*$/.test(value)) {
              return 'Lowercase letters, digits, underscores. Must start with a letter.'
            }
            return null
          }}
          onSubmit={(name) => void performNewWorkflow(name)}
          onCancel={() => setShowNewWorkflow(false)}
        />
      )}

      {/* Stone E: rename. The operator can only change the basename;
          the parent dir stays put. Validation rejects names that
          would land outside the parent or collide with an existing
          file (the backend rechecks). */}
      {renameTarget !== null && (
        <PromptDialog
          title={`Rename ${renameTarget.basename}`}
          message="Choose a new file name. The file stays in the same directory."
          label="New name"
          initialValue={renameTarget.basename}
          submitLabel="Rename"
          busy={busyRename}
          validate={(value) => {
            if (value.includes('/') || value.includes('\\')) {
              return 'Name cannot contain slashes (use Move — coming later — to relocate).'
            }
            if (value.startsWith('.')) {
              return 'Hidden names (starting with .) are not allowed in the file tree.'
            }
            return null
          }}
          onSubmit={(newName) => void performRename(newName)}
          onCancel={() => setRenameTarget(null)}
        />
      )}

      {/* Duplicate a workflow (workspace OR example) under a new name —
          prefilled with the first free name, live collision check, never
          overwrites. */}
      {duplicateTarget !== null && (
        <PromptDialog
          title={`Duplicate ${duplicateTarget.srcName}`}
          message={`Copies workflows/${duplicateTarget.srcName}/ to a new, editable workflow in your workspace.`}
          label="New workflow name"
          placeholder={freeWorkflowName(duplicateTarget.srcName)}
          initialValue={freeWorkflowName(duplicateTarget.srcName)}
          submitLabel="Duplicate"
          busy={busyDuplicate}
          validate={(value) => {
            if (!/^[a-z][a-z0-9_]*$/.test(value)) {
              return 'Lowercase letters, digits, underscores. Must start with a letter.'
            }
            if (takenWorkflowNames.has(value)) {
              return `A workflow named "${value}" already exists — choose another.`
            }
            return null
          }}
          onSubmit={(name) => void performDuplicate(name)}
          onCancel={() => setDuplicateTarget(null)}
        />
      )}

      {/* Stone E: delete confirmation. Single dialog handles both
          single-file deletes + recursive workflow-dir deletes — the
          ``isDir`` flag in deleteTarget drives the message + the
          recursive=true flag the backend gets. */}
      {deleteTarget !== null && (
        <ConfirmDialog
          title={deleteTarget.isDir
            ? `Delete workflow ${deleteTarget.label}?`
            : `Delete ${deleteTarget.label}?`}
          message={
            deleteTarget.isDir ? (
              <>
                <p>
                  This removes every file under{' '}
                  <code className="font-mono text-slate-400">{deleteTarget.path}</code>
                  {' '}from the workspace.
                </p>
                <p className="mt-2 text-[12px] text-slate-400">
                  If the bundled copy of this workflow still exists, it'll
                  reappear in the tree after deletion (no longer shadowed).
                </p>
              </>
            ) : (
              <>
                <p>This removes the file from the workspace.</p>
                <p className="mt-2 text-[12px] text-slate-400">
                  Files are deleted, not moved to a trash folder. This can't
                  be undone from the UI — recover via git or a filesystem
                  backup.
                </p>
              </>
            )
          }
          confirmLabel="Delete"
          variant="danger"
          busy={busyDelete}
          onConfirm={() => void performDelete()}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Clear-all-runs confirmation. Wipes the on-disk run history;
          in-flight runs are preserved server-side. */}
      {clearRunsOpen && (
        <ConfirmDialog
          title="Clear all run data?"
          message={
            <>
              <p>
                This permanently deletes every saved run under{' '}
                <code className="font-mono text-slate-400">workspace/runs/</code>{' '}
                — inputs, step logs, tool calls, and results.
              </p>
              <p className="mt-2 text-[12px] text-slate-400">
                Any run still in progress is kept. Deleted runs can't be
                recovered from the UI.
              </p>
            </>
          }
          confirmLabel="Clear runs"
          variant="danger"
          busy={clearingRuns}
          onConfirm={() => void performClearRuns()}
          onCancel={() => setClearRunsOpen(false)}
        />
      )}

      {/* Fork-to-workspace confirmation. Bundled workflows are
          read-only — the operator must copy one into their workspace
          to edit it. Forking is workflow-directory granular: the 5
          sibling files (workflow.yaml + prompt.md + allowed_tools.yaml
          + success.md + failure.md) come along as a coherent set. */}
      {forkPrompt !== null && forkTarget && (
        <ConfirmDialog
          title={`Fork ${forkTarget.workflowName} to workspace?`}
          message={
            <>
              <p>
                This copies <code className="font-mono text-slate-400">{forkPrompt}</code>{' '}
                from the bundled workflows into your workspace at the
                same path. The local copy shadows the bundled original
                at runtime; the bundled files stay on disk so you can
                "reset to defaults" later.
              </p>
              <p className="mt-2 text-[12px] text-slate-400">
                After fork, the file you were viewing reopens from
                workspace + the Edit button activates.
              </p>
            </>
          }
          confirmLabel="Fork"
          busy={forking}
          onConfirm={performFork}
          onCancel={() => setForkPrompt(null)}
        />
      )}

      {/* Save-as-preferred (Stage 4). When the operator clicks Save on
          a bundled workflow's run-config overrides, the backend
          refuses to write the bundled copy + returns ``needs_fork``.
          This dialog explains the fork side-effect + lets the
          operator confirm. On confirm, the panel forks first then
          re-issues save_workflow_preferences against the new
          workspace copy. */}
      {savePrefsPending && (
        <ConfirmDialog
          title={`Fork ${savePrefsPending.workflowName} to workspace + save?`}
          message={
            <>
              <p>
                Saving preferences will write to{' '}
                <code className="font-mono text-slate-400">
                  {savePrefsPending.workflowDir}/workflow.yaml
                </code>
                , but that workflow is currently bundled (read-only).
                Confirming will copy it to your workspace first, then
                write{' '}
                <code className="font-mono text-slate-400">
                  preferred_backend: {savePrefsPending.backend}
                </code>
                {savePrefsPending.model && (
                  <>
                    {' '}+{' '}
                    <code className="font-mono text-slate-400">
                      preferred_model: {savePrefsPending.model}
                    </code>
                  </>
                )}{' '}
                into the workspace copy.
              </p>
              <p className="mt-2 text-[12px] text-slate-400">
                The bundled original stays on disk; your workspace
                copy shadows it at runtime. To revert to defaults,
                delete the workflow from your workspace tree.
              </p>
            </>
          }
          confirmLabel="Fork + save"
          busy={savePrefsBusy}
          onConfirm={() => void saveWorkflowPreferences(
            savePrefsPending.workflowName,
            savePrefsPending.backend,
            savePrefsPending.model,
            true,
          )}
          onCancel={() => setSavePrefsPending(null)}
        />
      )}

      {/* Save-as-configuration prompt. Operator typed a name; we
          dispatch save_run_configuration with it. The dialog auto-
          dismisses on success via the saveAsPending=null reset
          inside the dispatch helper. */}
      {saveAsPending && (
        <PromptDialog
          title={`Save run configuration for ${saveAsPending.workflowName}`}
          message={`Add ${saveAsPending.backend}${saveAsPending.model ? '/' + saveAsPending.model : ''} as a named configuration. Pick a short, memorable label — operators usually use "fast", "smart", "production", or "dev".`}
          label="Configuration name"
          placeholder="e.g. fast, smart, production"
          initialValue={saveAsPending.suggestedName}
          submitLabel="Save"
          busy={saveAsBusy}
          validate={(value) => {
            if (!value.trim()) return 'name is required'
            if (value.startsWith('$')) return 'name cannot start with $ (reserved for dropdown sentinels)'
            return null
          }}
          onSubmit={(value) => void saveRunConfiguration(
            saveAsPending.workflowName,
            value.trim(),
            saveAsPending.backend,
            saveAsPending.model,
          )}
          onCancel={() => setSaveAsPending(null)}
        />
      )}

      {savePrefsToast && (
        <div className="fixed bottom-4 right-4 z-50 rounded border border-emerald-700 bg-emerald-950/90 px-3 py-2 text-[11px] text-emerald-200 shadow-lg">
          {savePrefsToast}
        </div>
      )}

      {/* Fork-success notice — quick confirmation listing what was
          copied. Dismisses on OK. */}
      {forkSuccess !== null && (
        <ConfirmDialog
          title="Forked"
          message={
            <>
              <p>
                Copied {forkSuccess.files.length} file(s) into{' '}
                <code className="font-mono text-slate-400">{forkSuccess.dest_path}</code>.
              </p>
              <ul className="mt-2 max-h-40 overflow-auto rounded border border-slate-800 bg-slate-950/60 p-2 text-[10px] font-mono text-slate-400">
                {forkSuccess.files.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </>
          }
          confirmLabel="OK"
          cancelLabel={null}
          onConfirm={() => setForkSuccess(null)}
          onCancel={() => setForkSuccess(null)}
        />
      )}

      {/* mtime conflict — disk changed under us. Operator picks one
          version; there's no auto-merge in stone C. */}
      {conflict !== null && (
        <ConfirmDialog
          title="File changed on disk"
          message={
            <>
              <p>
                Another writer modified{' '}
                <code className="font-mono text-slate-400">{openFile?.path}</code>{' '}
                while you were editing.
              </p>
              <p className="mt-2 text-[12px] text-slate-400">
                "Keep mine" overwrites the disk version with your buffer.
                "Take theirs" reloads the on-disk content and discards
                your edits.
              </p>
            </>
          }
          confirmLabel="Keep mine (overwrite)"
          cancelLabel="Take theirs (reload)"
          variant="danger"
          onConfirm={resolveConflictKeepMine}
          onCancel={resolveConflictTakeTheirs}
        />
      )}

      {/* The standalone Wire log panel was merged into the unified
          Output pane (Steps · Wire · Topics tabs) above. The title-bar
          ``wire`` button now focuses that pane on the Wire tab. */}

      {/* Settings drawer ──────────────────────────────────────────────
          Slide-in overlay from the right when the gear icon is
          clicked. Hosts the backend picker + filesystem paths so
          they're not in the operator's face on every interaction —
          they're "set up once" data. Backdrop click + × close it. */}
      {showSettings && (
        <div
          className="absolute inset-0 z-20 flex"
          role="dialog"
          aria-modal="true"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div
            className="flex-1 bg-slate-950/60"
            onClick={() => setShowSettings(false)}
          />
          <aside
            style={{ width: drawerWidth }}
            className="relative flex max-w-[90%] flex-col gap-3 overflow-auto border-l border-slate-700 bg-slate-900 p-3 shadow-2xl"
          >
            {/* Left-edge drag handle. Drawer is anchored on the right
                so dragging LEFT (negative delta) GROWS it. Clamped to
                a usable range — too narrow hides the form fields,
                too wide eats the panel. */}
            <div
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const startW = drawerWidth
                startDrag(e.clientX, 'x', (delta) => {
                  setDrawerWidth(Math.min(900, Math.max(280, startW - delta)))
                })
              }}
              className="absolute inset-y-0 left-0 w-1 cursor-col-resize bg-slate-800 hover:bg-sky-500"
              title="Drag to resize settings drawer"
            />
            <header className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <SettingsIcon size={14} className="text-slate-400" />
                Settings
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowSettings(false) }}
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                aria-label="Close settings"
              >
                ×
              </button>
            </header>

            {/* Paths — filesystem locations brain reads from. Useful
                when forking workflows or debugging which file
                actually loaded. */}
            <section className="flex flex-col gap-1">
              <h3 className="text-[10px] tracking-wider text-slate-500">paths</h3>
              {tree ? (
                <div className="flex flex-col gap-0.5 rounded border border-slate-800 bg-slate-950/40 px-2 py-1 text-[10px]">
                  <div className="flex items-center gap-2">
                    <span className="w-16 shrink-0 tracking-wider text-slate-500">workspace</span>
                    <code className="select-all truncate font-mono text-slate-400" title={tree.workspace_dir}>
                      {tree.workspace_dir}
                    </code>
                    <CopyButton value={tree.workspace_dir} />
                  </div>
                  {tree.bundled_dir && (
                    <div className="flex items-center gap-2">
                      <span className="w-16 shrink-0 tracking-wider text-slate-500">bundled</span>
                      <code className="select-all truncate font-mono text-slate-500" title={tree.bundled_dir}>
                        {tree.bundled_dir}
                      </code>
                      <CopyButton value={tree.bundled_dir} />
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-[11px] text-slate-500">
                  {serviceRunning ? 'loading…' : 'service not running'}
                </div>
              )}
            </section>

            {/* Backends — the LLM provider picker. Hoisted into the
                Settings drawer in Phase 3. Active backend visible at
                a glance in the title bar; the operator only opens
                this when they want to change or configure providers. */}
            <section className="flex flex-col gap-1">
              <h3 className="text-[10px] tracking-wider text-slate-500">backends</h3>
              {(() => {
                const active = backends.find((b) => b.name === activeBackend)
                const activeTest = testResult[activeBackend]
                const summaryDetail = !active
                  ? (serviceRunning ? 'loading…' : 'service not running')
                  : active.name === 'mock'
                    ? 'stub adapter'
                    : active.fields.model ?? '(no model)'
                const statusColor = !active
                  ? 'text-slate-500'
                  : activeTest
                    ? (activeTest.ok ? 'text-emerald-400' : 'text-red-400')
                    : active.configured
                      ? 'text-emerald-400'
                      : 'text-yellow-400'
                const statusText = !active
                  ? '·'
                  : activeTest
                    ? (activeTest.ok ? '✓ reachable' : '✗ ' + (activeTest.error ?? 'unreachable'))
                    : active.configured
                      ? 'configured'
                      : 'missing config'
                return (
                  <div className="flex items-center justify-between gap-2 rounded border border-slate-800 bg-slate-950/40 px-2 py-1">
                    <div className="flex min-w-0 flex-1 items-baseline gap-2">
                      <span className="text-[10px] tracking-wider text-slate-500">active</span>
                      <span className="font-mono text-slate-200">{active?.name ?? '—'}</span>
                      <span className="truncate text-[11px] text-slate-400" title={summaryDetail}>{summaryDetail}</span>
                      <span className={`truncate text-[10px] ${statusColor}`} title={statusText}>{statusText}</span>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {active && active.name !== 'mock' && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void testBackend(active.name) }}
                          className="nodrag nopan rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:border-slate-500"
                        >
                          Test
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setShowBackendPicker((v) => !v); if (!showBackendPicker) void refreshBackends() }}
                        disabled={!serviceRunning}
                        className="nodrag nopan rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 disabled:opacity-40"
                      >
                        {showBackendPicker ? 'Done' : 'Change…'}
                      </button>
                    </div>
                  </div>
                )
              })()}

              {showBackendPicker && (backends.length === 0 ? (
                <div className="text-slate-500">{serviceRunning ? 'loading…' : 'service not running'}</div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {backends.map((b) => {
                    const isActive = activeBackend === b.name
                    const isExpanded = expandedBackend === b.name
                    const draft = backendDraft[b.name] ?? {}
                    const test = testResult[b.name]
                    const hasFields = b.name !== 'mock'
                    return (
                      <li
                        key={b.name}
                        className={`rounded border bg-slate-950/40 p-2 ${isActive ? 'border-emerald-700' : 'border-slate-800'}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <label className="flex min-w-0 flex-1 items-center gap-2">
                            <input
                              type="radio"
                              checked={isActive}
                              onChange={(e) => { e.stopPropagation(); void activateBackend(b.name) }}
                              onClick={(e) => e.stopPropagation()}
                              className="nodrag nopan accent-emerald-500"
                            />
                            <span className="font-mono text-slate-200">{b.name}</span>
                            <span className="text-[10px] text-slate-500">
                              {b.kind}
                              {b.fields.model && ` · ${b.fields.model}`}
                            </span>
                            {b.configured ? (
                              <span className="text-[10px] text-emerald-400">configured</span>
                            ) : b.name !== 'mock' ? (
                              <span className="text-[10px] text-yellow-400">missing</span>
                            ) : null}
                          </label>
                          <div className="flex shrink-0 gap-1">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); void testBackend(b.name) }}
                              className="nodrag nopan rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:border-slate-500"
                            >
                              Test
                            </button>
                            {hasFields && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setExpandedBackend(isExpanded ? null : b.name) }}
                                className="nodrag nopan rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:border-slate-500"
                              >
                                {isExpanded ? 'Close' : 'Configure…'}
                              </button>
                            )}
                          </div>
                        </div>

                        {test && (
                          <div
                            className={`mt-1 truncate text-[10px] ${test.ok ? 'text-emerald-400' : 'text-red-400'}`}
                            title={test.ok ? test.detail : test.error}
                          >
                            {test.ok ? '✓ ' : '✗ '}{test.ok ? test.detail : test.error}
                            {test.models && test.models.length > 0 && (
                              <span className="ml-1 text-slate-500">({test.models.length} models)</span>
                            )}
                          </div>
                        )}

                        {isExpanded && hasFields && (
                          <form
                            onSubmit={(e) => { e.preventDefault(); void applyBackend(b.name, isActive) }}
                            className="mt-2 flex flex-col gap-1 border-t border-slate-800 pt-2"
                          >
                            <label className="flex items-center gap-2 text-[10px]">
                              <span className="w-20 shrink-0 text-slate-500">base_url</span>
                              <input
                                type="text"
                                value={draft.base_url ?? b.fields.base_url ?? ''}
                                onChange={(e) => setBackendField(b.name, 'base_url', e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                className="nodrag nopan flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100 focus:border-slate-500 focus:outline-none"
                              />
                            </label>
                            <label className="flex items-center gap-2 text-[10px]">
                              <span className="w-20 shrink-0 text-slate-500">model</span>
                              <input
                                type="text"
                                value={draft.model ?? b.fields.model ?? ''}
                                onChange={(e) => setBackendField(b.name, 'model', e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                className="nodrag nopan flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100 focus:border-slate-500 focus:outline-none"
                              />
                            </label>
                            {b.kind === 'cloud' && (
                              <label className="flex items-center gap-2 text-[10px]">
                                <span className="w-20 shrink-0 text-slate-500">api_key</span>
                                <input
                                  type="password"
                                  value={draft.api_key ?? ''}
                                  placeholder={b.fields.has_credential ? '(stored — leave blank to keep)' : '(none stored)'}
                                  onChange={(e) => setBackendField(b.name, 'api_key', e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="nodrag nopan flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100 focus:border-slate-500 focus:outline-none"
                                />
                              </label>
                            )}
                            <div className="flex justify-end gap-1">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); void clearBackend(b.name) }}
                                className="nodrag nopan rounded border border-red-900 px-2 py-1 text-[10px] text-red-300 hover:bg-red-950/50"
                              >
                                Clear
                              </button>
                              <button
                                type="submit"
                                onClick={(e) => e.stopPropagation()}
                                className="nodrag nopan rounded bg-emerald-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-emerald-500"
                              >
                                Apply
                              </button>
                            </div>
                          </form>
                        )}
                      </li>
                    )
                  })}
                </ul>
              ))}
            </section>
          </aside>
        </div>
      )}
    </div>
  )
}
