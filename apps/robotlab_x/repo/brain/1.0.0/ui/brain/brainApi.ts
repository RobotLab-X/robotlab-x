// Typed wrappers around the brain workspace file API (stone A of
// docs/TODO_BRAIN_VIEWER.md).
//
// The backend lives in src/robotlab_x/api/brain_files_api.py. Endpoints:
//   GET /v1/service-proxy/{proxy_id}/files          → tree
//   GET /v1/service-proxy/{proxy_id}/files/content  → file body
//
// Stone A is read-only; write endpoints land in stone C.

export type FileSource = 'workspace' | 'bundled'


export interface FileEntry {
  name: string
  /** Virtual path under the brain root — e.g. workflows/observe_room/prompt.md.
   *  This is the key passed back to /files/content. */
  path: string
  type: 'dir' | 'file'
  source: FileSource
  /** True iff this bundled entry has a workspace override at the
   *  same name. The local one wins at runtime; the UI dims the
   *  bundled twin so the operator sees both exist. */
  shadowed?: boolean
  /** file-only metadata */
  size?: number | null
  mtime?: number | null
  children?: FileEntry[]
}


export interface FileTreeResponse {
  proxy_id: string
  workspace_dir: string
  bundled_dir: string | null
  entries: FileEntry[]
}


export interface FileContentResponse {
  proxy_id: string
  path: string
  source: FileSource
  content: string
  mtime: number
  size: number
  writable: boolean
  mime: string
}


/** Read the merged file tree for a brain proxy.
 *
 * Caller supplies a fetch-like ``apiFetch`` from the active runtime
 * context (so requests carry the right auth + base URL). */
export function fetchBrainTree(
  apiFetch: <T = unknown>(path: string, init?: RequestInit) => Promise<T>,
  proxyId: string,
): Promise<FileTreeResponse> {
  return apiFetch<FileTreeResponse>(`/v1/service-proxy/${encodeURIComponent(proxyId)}/files`)
}


/** Read one file's content. Stone A is text-only (markdown, yaml,
 *  text). Binary or non-utf8 content returns 415. */
export function fetchBrainFile(
  apiFetch: <T = unknown>(path: string, init?: RequestInit) => Promise<T>,
  proxyId: string,
  path: string,
  source?: FileSource,
): Promise<FileContentResponse> {
  const params = new URLSearchParams({ path })
  if (source) params.set('source', source)
  return apiFetch<FileContentResponse>(
    `/v1/service-proxy/${encodeURIComponent(proxyId)}/files/content?${params.toString()}`,
  )
}


// Stone C: write endpoint.

export interface PutFileResponse {
  proxy_id: string
  path: string
  written: boolean
  mtime: number
  size: number
}


export interface MtimeConflictBody {
  error: 'mtime_conflict'
  expected_mtime: number
  actual_mtime: number
  actual_content: string
}


/** Save a file to the workspace.
 *
 * ``expectedMtime`` is the mtime from the last GET. Backend rejects
 * with HTTP 409 if disk has moved since (another tab, the brain
 * itself, an external editor). The 409 body carries the current
 * on-disk content so the UI can render a conflict dialog without a
 * follow-up GET.
 *
 * Throws the standard ``ApiError`` from lib/api on any error; callers
 * inspect ``.status === 409`` + ``.body`` to handle conflict
 * resolution. */
export function saveBrainFile(
  apiFetch: <T = unknown>(path: string, init?: RequestInit) => Promise<T>,
  proxyId: string,
  path: string,
  content: string,
  expectedMtime: number | null,
): Promise<PutFileResponse> {
  const params = new URLSearchParams({ path })
  const body: Record<string, unknown> = { content }
  if (expectedMtime !== null) body.expected_mtime = expectedMtime
  return apiFetch<PutFileResponse>(
    `/v1/service-proxy/${encodeURIComponent(proxyId)}/files/content?${params.toString()}`,
    { method: 'PUT', body: JSON.stringify(body) },
  )
}


// Stone D: fork a bundled workflow into the workspace.

export interface ForkResponse {
  proxy_id: string
  source_path: string
  dest_path: string
  files: string[]
}


/** Copy a bundled workflow directory into the workspace so the
 *  operator can edit it. ``sourcePath`` is a virtual path under
 *  ``workflows/`` — either the workflow dir (``workflows/observe_room``)
 *  or any file inside it; backend normalizes to the workflow
 *  directory. Refuses (409) if a workspace copy already exists. */
export function forkBrainWorkflow(
  apiFetch: <T = unknown>(path: string, init?: RequestInit) => Promise<T>,
  proxyId: string,
  sourcePath: string,
): Promise<ForkResponse> {
  return apiFetch<ForkResponse>(
    `/v1/service-proxy/${encodeURIComponent(proxyId)}/files/fork`,
    { method: 'POST', body: JSON.stringify({ source_path: sourcePath }) },
  )
}

/** Duplicate an existing WORKSPACE workflow under a new name
 *  (workflows/<src> → workflows/<destName>, both in the workspace).
 *  Refuses (409) if the destination already exists. */
export function duplicateBrainWorkflow(
  apiFetch: <T = unknown>(path: string, init?: RequestInit) => Promise<T>,
  proxyId: string,
  sourcePath: string,
  destName: string,
): Promise<ForkResponse> {
  return apiFetch<ForkResponse>(
    `/v1/service-proxy/${encodeURIComponent(proxyId)}/files/duplicate`,
    { method: 'POST', body: JSON.stringify({ source_path: sourcePath, dest_name: destName }) },
  )
}


// Stone E: create / rename / delete.

export interface NewWorkflowResponse {
  proxy_id: string
  name: string
  dest_path: string
  files: string[]
}


export interface RenameResponse {
  proxy_id: string
  from_path: string
  to_path: string
}


export interface DeleteResponse {
  proxy_id: string
  path: string
  deleted_files: number
}


/** Scaffold a new workflow with the five canonical files
 *  pre-populated from safe templates. Refuses (409) if a workflow
 *  with the same name already exists in the workspace. */
export function newBrainWorkflow(
  apiFetch: <T = unknown>(path: string, init?: RequestInit) => Promise<T>,
  proxyId: string,
  name: string,
): Promise<NewWorkflowResponse> {
  return apiFetch<NewWorkflowResponse>(
    `/v1/service-proxy/${encodeURIComponent(proxyId)}/files/new-workflow`,
    { method: 'POST', body: JSON.stringify({ name }) },
  )
}


/** Rename a workspace file or directory. Both ``from_path`` and
 *  ``to_path`` are workspace-relative; the backend rejects (409) if
 *  the target already exists, and (404) if the source doesn't. */
export function renameBrainPath(
  apiFetch: <T = unknown>(path: string, init?: RequestInit) => Promise<T>,
  proxyId: string,
  fromPath: string,
  toPath: string,
): Promise<RenameResponse> {
  return apiFetch<RenameResponse>(
    `/v1/service-proxy/${encodeURIComponent(proxyId)}/files/rename`,
    { method: 'POST', body: JSON.stringify({ from_path: fromPath, to_path: toPath }) },
  )
}


/** Delete a workspace file or directory. ``recursive=true`` is
 *  required for non-empty dirs — the operator opted in via the
 *  confirm dialog. */
export function deleteBrainPath(
  apiFetch: <T = unknown>(path: string, init?: RequestInit) => Promise<T>,
  proxyId: string,
  path: string,
  recursive = false,
): Promise<DeleteResponse> {
  const params = new URLSearchParams({ path, recursive: String(recursive) })
  return apiFetch<DeleteResponse>(
    `/v1/service-proxy/${encodeURIComponent(proxyId)}/files/content?${params.toString()}`,
    { method: 'DELETE' },
  )
}
