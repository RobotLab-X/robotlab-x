// Persistent primary navigation for every runtime-scoped page. Rendered
// once in RuntimeLayout so every page shares the same nav — replacing the
// per-page hand-rolled headers that each linked to a single sibling (and
// bounced the user between Catalog ↔ Proxies). All links are
// runtime-prefixed (/r/:runtimeId/…) so there's no redirect hop, and the
// current section is highlighted.
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ChevronDown, Wrench, User as UserIcon } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useApiFetch } from '../contexts/ActiveRuntimeContext'
import ConnectionIndicator from './ConnectionIndicator'

// Primary destinations (always visible). `active(rel)` decides the
// highlight from the runtime-relative path. Canvas (a specific workspace
// canvas, workspaces/<id>) and Workspaces (the saved-view list at
// 'workspaces') share a prefix, so they need distinct matchers.
const PRIMARY: { label: string; to: string; active: (rel: string) => boolean }[] = [
  { label: 'Canvas', to: 'workspaces/runtime', active: (rel) => rel.startsWith('workspaces/') },
  { label: 'Workspaces', to: 'workspaces', active: (rel) => rel === 'workspaces' },
  { label: 'Catalog', to: 'catalog', active: (rel) => rel === 'catalog' || rel.startsWith('catalog/') },
  { label: 'Proxies', to: 'proxies', active: (rel) => rel === 'proxies' || rel.startsWith('proxies/') },
  { label: 'Logs', to: 'logs', active: (rel) => rel === 'logs' },
]

// Secondary / debug / admin destinations, grouped under a Tools menu so
// the bar stays uncluttered as pages are added.
const TOOLS = [
  { label: 'Inspector', to: 'inspector' },
  { label: 'Topology', to: 'topology' },
  { label: 'Traffic', to: 'traffic' },
  { label: 'Tables', to: 'admin/tables' },
  { label: 'State', to: 'admin/state' },
  { label: 'Scripts', to: 'scripts' },
  { label: 'Users', to: 'users' },
]

function useClickAway(onAway: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onAway()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onAway])
  return ref
}

export default function RuntimeNav() {
  const { runtimeId } = useParams<{ runtimeId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const apiFetch = useApiFetch()
  const [toolsOpen, setToolsOpen] = useState(false)
  const [userOpen, setUserOpen] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle')
  const toolsRef = useClickAway(() => setToolsOpen(false))
  const userRef = useClickAway(() => setUserOpen(false))

  // useParams returns the DECODED id; the runtime id can be a URL
  // (http://…), so re-encode it the same way RedirectToActive does or the
  // ':' and '/' mangle the path → "no connection for runtime http:…".
  const prefix = `/r/${encodeURIComponent(runtimeId ?? '')}/`
  const rel = location.pathname.startsWith(prefix)
    ? location.pathname.slice(prefix.length)
    : ''
  const isActive = (match: string) => rel === match || rel.startsWith(match + '/')
  const toolActive = TOOLS.some((t) => isActive(t.to))

  const linkBase = 'rounded px-2.5 py-1 text-sm transition-colors'
  const active = 'bg-slate-800 text-slate-100'
  const idle = 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'

  return (
    <nav className="flex items-center gap-1 border-b border-slate-800 bg-slate-950 px-3 py-1.5">
      <Link to={`${prefix}workspaces/runtime`} className="mr-2 text-sm font-semibold text-sky-300">
        RobotLab-X
      </Link>

      {PRIMARY.map((item) => (
        <Link
          key={item.to}
          to={`${prefix}${item.to}`}
          className={`${linkBase} ${item.active(rel) ? active : idle}`}
        >
          {item.label}
        </Link>
      ))}

      {/* Tools dropdown */}
      <div className="relative" ref={toolsRef}>
        <button
          type="button"
          onClick={() => setToolsOpen((v) => !v)}
          className={`${linkBase} flex items-center gap-1 ${toolActive ? active : idle}`}
        >
          <Wrench className="h-3.5 w-3.5" />
          Tools
          <ChevronDown className="h-3 w-3" />
        </button>
        {toolsOpen && (
          <div className="absolute left-0 z-50 mt-1 w-40 rounded border border-slate-700 bg-slate-900 py-1 shadow-xl">
            {TOOLS.map((t) => (
              <button
                key={t.to}
                type="button"
                onClick={() => { setToolsOpen(false); navigate(`${prefix}${t.to}`) }}
                className={`block w-full px-3 py-1.5 text-left text-sm ${
                  isActive(t.to) ? 'text-sky-300' : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1" />

      <ConnectionIndicator />

      {/* User menu */}
      <div className="relative" ref={userRef}>
        <button
          type="button"
          onClick={() => setUserOpen((v) => { if (!v) setSaveState('idle'); return !v })}
          className={`${linkBase} flex items-center gap-1.5 ${idle}`}
        >
          <UserIcon className="h-3.5 w-3.5" />
          <span className="max-w-[160px] truncate">{user?.email ?? user?.id ?? 'account'}</span>
          <ChevronDown className="h-3 w-3" />
        </button>
        {userOpen && (
          <div className="absolute right-0 z-50 mt-1 w-44 rounded border border-slate-700 bg-slate-900 py-1 shadow-xl">
            <button
              type="button"
              onClick={() => { setUserOpen(false); navigate('/config') }}
              className="block w-full px-3 py-1.5 text-left text-sm text-slate-300 hover:bg-slate-800"
            >
              Settings
            </button>
            <button
              type="button"
              disabled={saveState === 'saving'}
              onClick={() => {
                // Snapshot every service's config + run-state into the active
                // config set, so a later restart restores the exact current
                // state (which services run vs are created, clock ticks, …).
                // The menu stays open so the operator sees the result.
                setSaveState('saving')
                void apiFetch('/v1/system/save-config', { method: 'POST' })
                  .then((r) => setSaveState(r && (r as { ok?: boolean }).ok !== false ? 'done' : 'error'))
                  .catch(() => setSaveState('error'))
              }}
              className="block w-full px-3 py-1.5 text-left text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
              title="Save all services' current state as the restore point for the next restart"
            >
              {saveState === 'saving'
                ? 'Saving services…'
                : saveState === 'done'
                  ? 'Saved ✓'
                  : saveState === 'error'
                    ? 'Save failed — retry'
                    : 'Save all services'}
            </button>
            <button
              type="button"
              onClick={() => {
                setUserOpen(false)
                if (window.confirm('Restart the backend? The connection will drop and reconnect on its own.')) {
                  void apiFetch('/v1/system/restart', { method: 'POST' }).catch(() => {})
                }
              }}
              className="block w-full px-3 py-1.5 text-left text-sm text-slate-300 hover:bg-slate-800"
            >
              Restart backend
            </button>
            <button
              type="button"
              onClick={() => { setUserOpen(false); signOut() }}
              className="block w-full px-3 py-1.5 text-left text-sm text-rose-300 hover:bg-rose-900/40"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </nav>
  )
}
