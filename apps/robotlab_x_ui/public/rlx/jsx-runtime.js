// Import-map shim for the automatic JSX runtime — lets a service bundle
// built with the modern JSX transform resolve `react/jsx-runtime` to the
// host's React. See docs/TODO_SERVICE_UI_BUNDLES.md.
const J = window.__RLX__.jsxRuntime
export const { jsx, jsxs, Fragment } = J
