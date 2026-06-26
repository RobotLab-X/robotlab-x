#!/usr/bin/env node
// Framework-owned builder for modular service UIs (Option B —
// docs/TODO_SERVICE_UI_BUNDLES.md). Compiles a service's ui/View.tsx into
// a single self-contained ui/dist/ui.js (react / react-dom / @rlx/ui
// externalized; the view's own deps + CSS bundled/inlined in).
//
// If the service ALSO has ui/xr/View.tsx, a second self-contained
// ui/dist/xr.js is emitted the same way — used for full-page immersive
// WebXR clients (opened on a headset) that the desktop panel shouldn't
// pay the bundle cost for.
//
//   node scripts/build-service-ui.mjs <abs-or-rel path to a service ui/ dir>
//
// e.g. node scripts/build-service-ui.mjs ../robotlab_x/repo/cli/1.0.0/ui
import { build } from 'vite'
import { resolve, isAbsolute } from 'node:path'
import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import react from '@vitejs/plugin-react'

const arg = process.argv[2]
if (!arg) {
  console.error('usage: node scripts/build-service-ui.mjs <service ui/ dir>')
  process.exit(1)
}
const uiDir = isAbsolute(arg) ? arg : resolve(process.cwd(), arg)
const outDir = resolve(uiDir, 'dist')

// Optional per-bundle module aliases, declared in the bundle's
// package.json under `rlx.aliases` ({ specifier: relativePath }). Lets a
// bundle stub a heavy optional dependency it never executes (e.g. webxr
// aliases the IWER emulator packages to a no-op so ~7MB of synthetic
// environments stay out of xr.js). Paths resolve against the ui/ dir.
let aliases = {}
try {
  const pkg = JSON.parse(readFileSync(resolve(uiDir, 'package.json'), 'utf8'))
  const raw = pkg?.rlx?.aliases
  if (raw && typeof raw === 'object') {
    for (const [spec, rel] of Object.entries(raw)) aliases[spec] = resolve(uiDir, rel)
  }
} catch { /* no package.json / no aliases — fine */ }
const mainEntry = resolve(uiDir, 'View.tsx')
if (!existsSync(mainEntry)) {
  console.error(`no View.tsx at ${mainEntry}`)
  process.exit(1)
}

// Build one entry → <outDir>/<outName>, externalizing the host singletons
// and inlining any emitted CSS into the JS so each artifact is a single
// self-contained module the host loader can import by URL.
async function buildEntry(entry, outName, emptyOutDir) {
  await build({
    configFile: false,
    plugins: [react()],
    resolve: { alias: aliases },
    // Bundled deps (e.g. react-three-fiber's react-reconciler) reference
    // process.env.NODE_ENV for dev-only warnings. The browser has no
    // `process`, so without replacement the bundle throws "process is not
    // defined" at load. Pin NODE_ENV to production (dead-codes dev branches)
    // and stub the rest of process.env to {}.
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.env': '{}',
    },
    publicDir: false,
    build: {
      outDir,
      emptyOutDir,
      copyPublicDir: false,
      lib: { entry, formats: ['es'], fileName: () => outName },
      rollupOptions: {
        external: ['react', 'react-dom', 'react/jsx-runtime', '@rlx/ui'],
        // The host loads a bundle as a SINGLE ESM by URL
        // (/repo/<name>/<version>/<outName>); it can't resolve sibling
        // chunk files. Inline every dynamic import so each artifact stays
        // one self-contained module (matters for deps that code-split,
        // e.g. @react-three/xr's emulator).
        output: { inlineDynamicImports: true },
      },
      minify: false,
      target: 'es2022',
    },
  })

  // Inline emitted CSS INTO <outName> as an injected <style>, then delete
  // the css file — so the artifact is a single self-contained module.
  const cssFiles = readdirSync(outDir).filter((f) => f.endsWith('.css'))
  if (cssFiles.length) {
    const css = cssFiles.map((f) => readFileSync(resolve(outDir, f), 'utf8')).join('\n')
    const jsPath = resolve(outDir, outName)
    const js = readFileSync(jsPath, 'utf8')
    const inject =
      `(()=>{try{if(typeof document!=='undefined'){` +
      `const s=document.createElement('style');` +
      `s.setAttribute('data-rlx-bundle-css','');` +
      `s.textContent=${JSON.stringify(css)};` +
      `document.head.appendChild(s);}}catch(e){}})();\n`
    writeFileSync(jsPath, inject + js)
    for (const f of cssFiles) rmSync(resolve(outDir, f))
    console.log(`  inlined ${cssFiles.join(', ')} (${css.length} bytes) into ${outName}`)
  }
  console.log(`built ${entry} → ${outDir}/${outName}`)
}

// Main desktop bundle (empties dist first).
await buildEntry(mainEntry, 'ui.js', true)

// Optional immersive WebXR bundle (kept; do NOT empty dist).
const xrEntry = resolve(uiDir, 'xr', 'View.tsx')
if (existsSync(xrEntry)) {
  await buildEntry(xrEntry, 'xr.js', false)
}
