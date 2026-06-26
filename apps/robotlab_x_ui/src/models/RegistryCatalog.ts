// Types for the remote service registry endpoints (Phase 2-4 of
// docs/TODO_REPO.md). These mirror the FastAPI response models in
// apps/robotlab_x/src/robotlab_x/api/registry_api.py — they're API
// shapes, not DB models, so they live here hand-written rather than
// being generated from the model template.

// Per (name, version) install state. ABSENT is implicit — a catalog
// entry whose "<name>@<version>" key is missing from local_state.
export type TypeState = 'absent' | 'loaded' | 'installing' | 'installed' | 'failed'

export interface CatalogVersion {
  version: string
  archive?: string
  sha256?: string
  size_bytes?: number
  language?: string
  status?: string
  min_runtime?: string
  os?: string[]
  arch?: string[]
  [k: string]: unknown
}

export interface CatalogEntry {
  name: string
  description?: string
  tags?: string[]
  implements?: string[]
  requires?: string[]
  versions: CatalogVersion[]
  // Which registry URL served this entry (first-wins across registries).
  source_registry?: string
}

export interface RepoRootInfo {
  path: string
  writable: boolean
  exists: boolean
}

export interface SourcesResponse {
  repo_roots: RepoRootInfo[]
  registries: string[]
}

export interface CatalogResponse {
  registry_version: number
  // Comma-joined list of the registry URLs that were merged.
  registry_url: string
  services: CatalogEntry[]
  // "<name>@<version>" → state. Missing key ⇒ ABSENT.
  local_state: Record<string, TypeState>
}

export interface TypeStateResponse {
  name: string
  version: string
  state: TypeState
  archive?: string
  sha256?: string
  description?: string
  load_error?: string
  install_error?: string
}
