// Import-map shim: resolves a service bundle's bare `@rlx/ui` import to
// the host's SDK instance (bus/runtime hooks + component kit), so the
// view shares the host's single bus client + auth. Re-exports from
// window.__RLX__.rlxUi (set in main.tsx). Keep in sync with src/rlx-ui.
// See docs/TODO_SERVICE_UI_BUNDLES.md.
const U = window.__RLX__.rlxUi
export const {
  useWsClient, useApiFetch, useActiveRuntime, useServiceRequest,
  Panel, KeymapEditor, NumberInput, ConfirmDialog, PromptDialog, CopyButton, ContextMenu,
} = U
