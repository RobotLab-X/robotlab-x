// Import-map shim: resolves a modular service bundle's bare `react`
// import to the HOST's single React instance (set on window.__RLX__ in
// main.tsx). Prevents a second React copy (which would break hooks).
// See docs/TODO_SERVICE_UI_BUNDLES.md.
const R = window.__RLX__.react
export default R.default ?? R
// Re-export the FULL React named-export surface — heavy bundles (r3f,
// drei, zustand, use-sync-external-store) import hooks beyond the basics
// (e.g. useDebugValue, useInsertionEffect). A missing name here surfaces
// as "module 'react' does not provide an export named X" at bundle load.
export const {
  createElement, cloneElement, createContext, createRef, createFactory,
  Fragment, Children, Component, PureComponent, Profiler, StrictMode,
  Suspense, forwardRef, memo, lazy, isValidElement, version,
  useState, useEffect, useLayoutEffect, useInsertionEffect, useRef,
  useMemo, useCallback, useContext, useReducer, useImperativeHandle,
  useId, useTransition, useDeferredValue, useSyncExternalStore,
  useDebugValue, startTransition,
} = R
