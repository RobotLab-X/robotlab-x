import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Framework-owned build for modular service UIs (Option B — see
// docs/TODO_SERVICE_UI_BUNDLES.md). A service ships only `ui/View.tsx`;
// this compiles it to `ui/dist/ui.js` as a single ES module, EXTERNALIZING
// the host singletons (react + @rlx/ui) so the bundle stays tiny and shares
// the host's instances via the import map at runtime. A service's OWN
// third-party libs (e.g. xterm) are NOT external — they bundle in.
//
// Reuses the host UI's toolchain (vite + @vitejs/plugin-react already in
// node_modules) — no per-service install. Driven by env vars so one config
// builds any service's bundle (see scripts/build-service-ui.mjs):
//
//   RLX_UI_ENTRY=<abs View.tsx>  RLX_UI_OUTDIR=<abs ui/dist> \
//     npx vite build -c vite.lib.config.ts
const entry = process.env.RLX_UI_ENTRY
const outDir = process.env.RLX_UI_OUTDIR
if (!entry || !outDir) {
  throw new Error('RLX_UI_ENTRY and RLX_UI_OUTDIR env vars are required')
}

export default defineConfig({
  plugins: [react()],
  // Bundled deps (e.g. react-three-fiber's react-reconciler) reference
  // `process.env.NODE_ENV` for dev-only warnings. In the browser there is
  // no `process`, so without replacement the bundle throws
  // "process is not defined" at load. Pin it to production (dead-codes the
  // dev branches) and stub the rest of process.env to an empty object.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': '{}',
  },
  // Don't drag the host UI's public/ (favicon, /rlx shims) into the bundle.
  publicDir: false,
  build: {
    outDir,
    emptyOutDir: true,
    copyPublicDir: false,
    lib: { entry, formats: ['es'], fileName: () => 'ui.js' },
    rollupOptions: {
      // Host provides these via the import map → never bundle them.
      external: ['react', 'react-dom', 'react/jsx-runtime', '@rlx/ui'],
    },
    // Keep readable while we bootstrap; flip on for production bundles.
    minify: false,
    target: 'es2022',
  },
})
