#!/usr/bin/env node
// Build EVERY modular service-UI bundle (Option B —
// docs/TODO_SERVICE_UI_BUNDLES.md). Walks ../robotlab_x/repo/<svc>/<ver>/ui,
// installs each bundle's own deps (e.g. cli's @xterm) when it declares any,
// then compiles View.tsx → dist/ui.js via build-service-ui.mjs.
//
// Intended for CI (rebuild + vet bundles so the committed ui.js can't drift)
// and one-shot local rebuilds. Type-checking is separate:
//   npm run check:service-ui
import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const uiRoot = resolve(here, '..') // robotlab_x_ui
const repoRoot = resolve(uiRoot, '../robotlab_x/repo')

function dirs(p) {
  return existsSync(p) ? readdirSync(p).filter((n) => statSync(resolve(p, n)).isDirectory()) : []
}

const built = []
for (const svc of dirs(repoRoot)) {
  for (const ver of dirs(resolve(repoRoot, svc))) {
    const uiDir = resolve(repoRoot, svc, ver, 'ui')
    if (!existsSync(resolve(uiDir, 'View.tsx'))) continue
    // Install the bundle's own third-party deps when it declares any
    // (react / @rlx/ui are externals and never listed). cli → @xterm.
    const pkgPath = resolve(uiDir, 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      if (pkg.dependencies && Object.keys(pkg.dependencies).length) {
        const ci = existsSync(resolve(uiDir, 'package-lock.json'))
        // --legacy-peer-deps: a bundle's deps declare React peer ranges,
        // but React is a host-provided EXTERNAL (never bundled), so the
        // installed React version is irrelevant and peer conflicts between
        // deps (e.g. CodeMirror >=17 vs lucide <=18) are moot.
        const cmd = ci
          ? ['ci', '--no-audit', '--no-fund', '--legacy-peer-deps']
          : ['install', '--no-audit', '--no-fund', '--legacy-peer-deps']
        console.log(`[deps] ${svc}/${ver}: npm ${cmd[0]}`)
        execFileSync('npm', cmd, { cwd: uiDir, stdio: 'inherit' })
      }
    }
    execFileSync('node', [resolve(here, 'build-service-ui.mjs'), uiDir], {
      cwd: uiRoot, stdio: 'inherit',
    })
    built.push(`${svc}/${ver}`)
  }
}
console.log(`\n✓ built ${built.length} service UI bundle(s): ${built.join(', ')}`)
