// Import-map shim: resolves a service bundle's bare `react-dom` import to
// the host's single ReactDOM (set on window.__RLX__ in main.tsx). Needed
// by views that use createPortal (e.g. video's floating snapshot panel).
// See docs/TODO_SERVICE_UI_BUNDLES.md.
const D = window.__RLX__.reactDOM
export default D.default ?? D
// createPortal/flushSync for portal views; unstable_batchedUpdates is
// pulled by react-three-fiber's reconciler (v8). version for libs that
// feature-detect off it.
export const { createPortal, flushSync, unstable_batchedUpdates, version } = D
