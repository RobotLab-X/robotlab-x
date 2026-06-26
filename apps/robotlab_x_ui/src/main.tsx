import { StrictMode } from 'react'
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as ReactJSXRuntime from 'react/jsx-runtime'
import { createRoot } from 'react-dom/client'
import App from './App'
import * as RlxUi from './rlx-ui'
import './index.css'

// Expose the host's singletons for dynamically-loaded modular service UIs
// (Option B). The import-map shims in /public/rlx/*.js re-export from here
// so a remote `import { useState } from 'react'` / `from '@rlx/ui'`
// resolves to the SAME instances the host uses. See
// docs/TODO_SERVICE_UI_BUNDLES.md.
;(window as unknown as { __RLX__: unknown }).__RLX__ = {
  react: React,
  reactDOM: ReactDOM,
  jsxRuntime: ReactJSXRuntime,
  rlxUi: RlxUi,
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
