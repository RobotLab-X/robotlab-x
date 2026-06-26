import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function readApiTargetFromEnvFiles(mode: string): string {
  const root = process.cwd()
  const candidates = [`.env.${mode}.local`, `.env.${mode}`, '.env.local', '.env']
  for (const filename of candidates) {
    const fullPath = path.join(root, filename)
    if (!fs.existsSync(fullPath)) continue
    const content = fs.readFileSync(fullPath, 'utf8')
    const match = content.match(/^VITE_API_URL\s*=\s*(.+)\s*$/m)
    if (!match) continue
    return match[1].trim().replace(/^['"]|['"]$/g, '')
  }
  return ''
}

export default defineConfig(({ mode }) => {
  // Default to localhost:8998 — matches apps/robotlab_x/.env. The .env
  // file in this directory (VITE_API_URL=...) overrides this fallback.
  const apiTarget = readApiTargetFromEnvFiles(mode) || 'http://localhost:8998'
  return {
    plugins: [react()],
    // Pre-bundle the singletons that modular service UIs (Option B) share
    // via window.__RLX__ + the import map. Listing them here keeps Vite
    // from re-optimizing mid-session (which 504s in-flight modules) when
    // main.tsx adds an explicit import of one. See
    // docs/TODO_SERVICE_UI_BUNDLES.md.
    optimizeDeps: {
      include: ['react', 'react-dom', 'react/jsx-runtime'],
    },
    server: {
      port: 5051,
      // Fail fast instead of auto-picking 5052 when 5051 is busy. We
      // bookmark http://localhost:5051 elsewhere and silently shifting
      // the port breaks those.
      strictPort: true,
      proxy: {
        // ws: true is required for the WebSocket upgrade at /v1/ws to
        // actually negotiate — without it the proxy treats the upgrade
        // as a regular HTTP request, the handshake never completes,
        // and the indicator stays stuck on "connecting" forever.
        '/v1': { target: apiTarget, changeOrigin: true, ws: true },
        '/openapi.json': { target: apiTarget, changeOrigin: true },
        // Repo-served service icons (GET /repo/<name>/<version>/icon).
        // Without this rule the SPA's catch-all would serve index.html
        // and the <img> would silently fall back to the Package default.
        '/repo': { target: apiTarget, changeOrigin: true },
      },
    },
  }
})
