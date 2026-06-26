// @rlx/ui — the externalized contract a modular service UI binds to
// (Option B; see docs/TODO_SERVICE_UI_BUNDLES.md).
//
// A dynamically-loaded service view imports its bus/runtime hooks, types,
// and component kit from here. At runtime the bare `@rlx/ui` specifier is
// resolved (via the host's import map → /rlx/rlx-ui.js shim) to the host's
// SINGLE instance of these, so the view shares the host's React, bus
// client, and auth — no duplicate singletons, no version skew.
//
// The host also exposes this module on `window.__RLX__.rlxUi` (see
// main.tsx) which the shim re-exports.
export {
  useWsClient,
  useApiFetch,
  useActiveRuntime,
} from '../contexts/ActiveRuntimeContext'
// Request/reply hook (spinner + result state) used by attach/connect views.
export { useServiceRequest } from '../runtime/useServiceRequest'
export type { ServiceProxy } from '../models/ServiceProxy'
export type { ServiceMeta } from '../models/ServiceMeta'
export type { InboundFrame, WsClient } from '../runtime/wsClient'
// Component kit (grows as views are migrated). The dialog/menu primitives
// are shared host components promoted into the SDK so bundles (e.g. brain)
// reuse the host's single copy instead of vendoring their own.
export { Panel } from './Panel'
export { KeymapEditor } from './KeymapEditor'
export type { KeyBinding, KeymapEditorProps } from './KeymapEditor'
export { NumberInput } from '../components/NumberInput'
export { ConfirmDialog } from '../components/ConfirmDialog'
export { PromptDialog } from '../components/PromptDialog'
export { CopyButton } from '../components/CopyButton'
export { ContextMenu } from '../components/ContextMenu'
export type { ContextMenuItem } from '../components/ContextMenu'
