import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { RuntimeConnectionsProvider } from './contexts/RuntimeConnectionsContext'
import { ActiveRuntimeProvider } from './contexts/ActiveRuntimeContext'
import ProtectedRoute from './components/ProtectedRoute'
import { RedirectToActive } from './components/RedirectToActive'
import { RuntimeSwitcher } from './components/RuntimeSwitcher'
import RuntimeNav from './components/RuntimeNav'
import { ConfigSetSwitcher } from './components/ConfigSetSwitcher'
import SaveAllButton from './components/SaveAllButton'
import LoadAllButton from './components/LoadAllButton'
import SystemPowerMenu from './components/SystemPowerMenu'
import { NoRuntimesState } from './components/NoRuntimesState'
import Login from './pages/Login'
import ConfigPage from './pages/ConfigPage'
import WsDebug from './pages/WsDebug'
import Catalog from './pages/Catalog'
import Proxies from './pages/Proxies'
import Workspaces from './pages/Workspaces'
import Composer from './pages/Composer'
import Inspector from './pages/Inspector'
import DashboardPage from './pages/Dashboard'
import Scripts from './pages/Scripts'
import ScriptEditor from './pages/ScriptEditor'
import AdminState from './pages/AdminState'
import AdminTables from './pages/AdminTables'
import Logs from './pages/Logs'
import Traffic from './pages/Traffic'
import Topology from './pages/Topology'
import PythonIDE from './pages/PythonIDE'
import Users from './pages/Users'
import DockView from './pages/DockView'
import XrView from './pages/XrView'


/**
 * Route map. Two top-level categories:
 *
 *   1. Runtime-scoped routes under ``/r/:runtimeId/*`` — every page
 *      that touches a backend (Composer, Topology, Logs, Traffic,
 *      Python IDE, etc.) lives here. ActiveRuntimeProvider reads the
 *      param and exposes the matching RuntimeConnection via hooks.
 *
 *   2. Non-runtime routes (``/login``, ``/config``) — these don't
 *      target a specific runtime, so they sit at the top level.
 *
 * Legacy bare paths (``/workspaces/foo``, ``/topology``, …) hit the
 * RedirectToActive shim which prepends ``/r/<active-id>`` and
 * preserves the rest of the path. Old bookmarks survive; future
 * ``navigate(...)`` calls from inside pages can migrate piecemeal.
 */
export default function App() {
  return (
    <BrowserRouter>
      <RuntimeConnectionsProvider>
        <AuthProvider>
          <Routes>
            {/* ── Non-runtime routes ─────────────────────────────── */}
            <Route path="/login" element={<Login />} />
            <Route
              path="/config"
              element={<ProtectedRoute><ConfigPage /></ProtectedRoute>}
            />
            <Route
              path="/ws-debug"
              element={<ProtectedRoute><WsDebug /></ProtectedRoute>}
            />

            {/* ── Undockable single-service view ────────────────── */}
            {/* A service view popped out into its own chrome-less
                browser window (view_full's "Open in window" button).
                Same ProtectedRoute + ActiveRuntimeProvider wrapping as
                the runtime-scoped routes below — so it gets auth + the
                per-runtime bus — but NO RuntimeLayout, so there's no
                nav/switcher chrome. Declared BEFORE the splat route so
                ``/r/:id/dock/:proxyId`` wins over ``/r/:id/*``. */}
            <Route
              path="/r/:runtimeId/dock/:proxyId"
              element={
                <ProtectedRoute>
                  <ActiveRuntimeProvider>
                    <DockView />
                  </ActiveRuntimeProvider>
                </ProtectedRoute>
              }
            />

            {/* ── Immersive WebXR client (opened on the headset) ──── */}
            {/* Full-page, no chrome — like the dock route but loads the
                service's xr.js bundle instead of a composer view. Declared
                before the splat so it wins over /r/:id/*. */}
            <Route
              path="/r/:runtimeId/xr/:proxyId"
              element={
                <ProtectedRoute>
                  <ActiveRuntimeProvider>
                    <XrView />
                  </ActiveRuntimeProvider>
                </ProtectedRoute>
              }
            />

            {/* ── Runtime-scoped routes ─────────────────────────── */}
            <Route
              path="/r/:runtimeId/*"
              element={
                <ProtectedRoute>
                  <ActiveRuntimeProvider>
                    <RuntimeLayout />
                  </ActiveRuntimeProvider>
                </ProtectedRoute>
              }
            />

            {/* Empty-state — no connections in the list. Shown before
                the user has added their first runtime AND after they
                remove the last one. Single CTA: open the connect
                dialog. */}
            <Route path="/no-runtimes" element={<NoRuntimesState />} />

            {/* ── Legacy redirects to active runtime ────────────── */}
            <Route path="/workspaces" element={<RedirectToActive />} />
            <Route path="/workspaces/:id" element={<RedirectToActive />} />
            <Route path="/workspaces/:id/dashboard" element={<RedirectToActive />} />
            <Route path="/catalog" element={<RedirectToActive />} />
            <Route path="/proxies" element={<RedirectToActive />} />
            <Route path="/inspector" element={<RedirectToActive />} />
            <Route path="/scripts" element={<RedirectToActive />} />
            <Route path="/scripts/:id" element={<RedirectToActive />} />
            <Route path="/admin/tables" element={<RedirectToActive />} />
            <Route path="/admin/state" element={<RedirectToActive />} />
            <Route path="/traffic" element={<RedirectToActive />} />
            <Route path="/topology" element={<RedirectToActive />} />
            <Route path="/users" element={<RedirectToActive />} />
            <Route path="/python/:proxyId/ide" element={<RedirectToActive />} />
            <Route path="/logs" element={<RedirectToActive />} />

            {/* Root + catch-all → redirect to active runtime's canvas. */}
            <Route path="/" element={<Navigate to="/workspaces/runtime" replace />} />
            <Route path="*" element={<Navigate to="/workspaces/runtime" replace />} />
          </Routes>
        </AuthProvider>
      </RuntimeConnectionsProvider>
    </BrowserRouter>
  )
}


/**
 * Layout wrapper for ``/r/:runtimeId/*`` — puts the runtime switcher
 * chip bar across the top, then the page content underneath. Every
 * runtime-scoped page picks the switcher up automatically since the
 * layout wraps RuntimeRoutes.
 */
function RuntimeLayout() {
  return (
    <div className="flex h-screen flex-col">
      {/* Persistent primary navigation — shared across every page. */}
      <RuntimeNav />
      {/* Runtime + config-set context selectors. */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-950">
        <RuntimeSwitcher />
        {/* Save-all + config-set switcher, read left→right as
            "Save → into set <name>". */}
        <div className="flex items-center gap-2 pr-2">
          <SaveAllButton />
          <LoadAllButton />
          {/* Stone 7 — config-set switcher chip + manager dialog. */}
          <ConfigSetSwitcher />
          {/* Power (restart / shutdown) pinned to the trailing edge. */}
          <SystemPowerMenu />
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <RuntimeRoutes />
      </div>
    </div>
  )
}


/**
 * Routes that live UNDER ``/r/:runtimeId/*``. Mounted inside
 * RuntimeLayout (above) so every page picks up the switcher + color
 * stripe. The relative paths here are appended to ``/r/:runtimeId``,
 * so a page that was at ``/workspaces/foo`` is now at
 * ``/r/:runtimeId/workspaces/foo``.
 */
function RuntimeRoutes() {
  return (
    <Routes>
      <Route path="catalog" element={<Catalog />} />
      <Route path="proxies" element={<Proxies />} />
      <Route path="workspaces" element={<Workspaces />} />
      <Route path="workspaces/:id" element={<Composer />} />
      <Route path="workspaces/:id/dashboard" element={<DashboardPage />} />
      <Route path="inspector" element={<Inspector />} />
      <Route path="scripts" element={<Scripts />} />
      <Route path="scripts/:id" element={<ScriptEditor />} />
      <Route path="admin/tables" element={<AdminTables />} />
      <Route path="admin/state" element={<AdminState />} />
      <Route path="traffic" element={<Traffic />} />
      <Route path="topology" element={<Topology />} />
      <Route path="users" element={<Users />} />
      <Route path="python/:proxyId/ide" element={<PythonIDE />} />
      <Route path="logs" element={<Logs />} />
      {/* Default landing inside a runtime is the runtime workspace. */}
      <Route path="" element={<Navigate to="workspaces/runtime" replace />} />
      <Route path="*" element={<Navigate to="workspaces/runtime" replace />} />
    </Routes>
  )
}
