import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useApiFetch } from '../contexts/ActiveRuntimeContext'
import { useAuth } from '../contexts/AuthContext'
import type { User } from '../models/User'
import Banner from '../components/Banner'

// Users admin page. Mirrors what every cloudseeder app eventually needs
// once the first-user claim has happened: a place where the established
// admin lists / adds / edits / deletes the runtime's user accounts.
//
// Kept deliberately small — robotlab_x has a single role universe
// ("Admin") and no multi-tenant, so this file is ~250 lines instead of
// the 700+ in cannamatic_ui. The intent is the cannamatic file's good
// idea minus the multi-tenant noise.

interface UserDraft {
  id: string                  // empty when creating
  email: string
  password: string            // empty on edit → keep current
  roles: string               // comma-separated; chips below render the toggle
  status: 'active' | 'invited' | 'disabled' | 'locked'
}

const EMPTY_DRAFT: UserDraft = { id: '', email: '', password: '', roles: 'Admin', status: 'active' }

// Hash the same way auth.local_auth.generate_hash does (SHA-256 hex).
// The /v1/user CRUD endpoint stores password_hash verbatim, so the UI
// must match.
//
// Web Crypto (crypto.subtle) is only exposed in a *secure context* —
// HTTPS, or http://localhost / http://127.0.0.1. A robotlab_x bundle
// served over plain HTTP on a LAN IP (e.g. http://192.168.0.x:8001) has
// NO crypto.subtle, so `crypto.subtle.digest` throws "Cannot read
// properties of undefined (reading 'digest')" and the add-user form
// silently fails. We fall back to a self-contained SHA-256 over the
// same UTF-8 bytes so this works regardless of how the UI was reached.
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  return sha256HexFallback(bytes)
}

// Dependency-free SHA-256 (FIPS 180-4) over raw bytes. Used only when
// crypto.subtle is unavailable (insecure context). It hashes the exact
// UTF-8 bytes the caller already encoded via TextEncoder — which is
// available in every context — so the output is byte-identical to the
// crypto.subtle path. Verified against `sha256sum` for ASCII, empty,
// and multibyte/emoji inputs.
function sha256HexFallback(data: Uint8Array): string {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ])
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19
  const len = data.length
  const bitLen = len * 8
  const withOne = len + 1
  const pad = (56 - (withOne % 64) + 64) % 64
  const total = withOne + pad + 8
  const m = new Uint8Array(total)
  m.set(data)
  m[len] = 0x80
  const dv = new DataView(m.buffer)
  dv.setUint32(total - 4, bitLen >>> 0, false)
  dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000), false)
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) | 0
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((x) => (x >>> 0).toString(16).padStart(8, '0'))
    .join('')
}

function rolesFromString(s: string): string[] {
  return s.split(',').map((r) => r.trim()).filter(Boolean)
}

export default function Users() {
  const apiFetch = useApiFetch()
  const { user } = useAuth()

  const [rows, setRows] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<UserDraft | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // RBAC gate: only Admin sees this page. Without the check, /v1/user-list
  // would 403 and the page would just look broken. Better to redirect
  // (the role is in the JWT so we can decide locally).
  const isAdmin = useMemo(() => (user?.roles ?? []).includes('Admin'), [user])

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch<User[]>('/v1/user-list')
      // Don't surface the password hash to the table — even though
      // it's just a hash, displaying it is noisy and invites copy-paste
      // mistakes. We keep it in state for the edit form, just don't render.
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    if (isAdmin) reload()
  }, [isAdmin, reload])

  const onSave = useCallback(async (e?: FormEvent) => {
    e?.preventDefault()
    if (!editing) return
    setBusy(true)
    setError(null)
    try {
      const email = editing.email.trim().toLowerCase()
      const roles = rolesFromString(editing.roles)
      const now = Date.now()

      // Only hash + send password_hash when the operator actually typed
      // a password. On edit, blank means "keep current" — sending an
      // empty hash would lock the account.
      const passwordHash = editing.password
        ? await sha256Hex(editing.password)
        : undefined

      if (editing.id) {
        // PUT — full record per CRUD convention. We start from the
        // existing row so any field we don't expose in the form
        // (created, login_count, etc.) survives the round-trip.
        const existing = rows.find((r) => r.id === editing.id)
        if (!existing) throw new Error(`user ${editing.id} no longer exists`)
        const next: User = {
          ...existing,
          email,
          roles,
          status: editing.status,
          modified: now,
        }
        if (passwordHash) {
          next.password_hash = passwordHash
          next.password_updated_at = now
        }
        await apiFetch(`/v1/user/${encodeURIComponent(editing.id)}`, {
          method: 'PUT',
          body: JSON.stringify(next),
        })
      } else {
        // POST — new user. password is required at create time.
        if (!passwordHash) throw new Error('Password is required for a new user')
        const created: User = {
          id: email,
          email,
          email_verified: true,
          roles,
          status: editing.status,
          auth_provider: 'local',
          is_mfa_enabled: false,
          password_hash: passwordHash,
          password_updated_at: now,
          created: now,
          modified: now,
        }
        await apiFetch('/v1/user', { method: 'POST', body: JSON.stringify(created) })
      }
      setEditing(null)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [editing, rows, apiFetch, reload])

  const onDelete = useCallback(async (id: string) => {
    setBusy(true)
    setError(null)
    try {
      await apiFetch(`/v1/user/${encodeURIComponent(id)}`, { method: 'DELETE' })
      setConfirmDelete(null)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [apiFetch, reload])

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-6 text-sm text-slate-300">
        <h1 className="text-lg font-semibold">Users</h1>
        <Banner tone="error">
          Admin role required to manage users on this runtime.
        </Banner>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <header>
        <h1 className="text-lg font-semibold">Users</h1>
      </header>

      {error && <Banner tone="error">{error}</Banner>}
      {loading && <Banner tone="info">Loading users…</Banner>}

      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">{rows.length} user{rows.length === 1 ? '' : 's'}</span>
        <button
          type="button"
          onClick={() => setEditing({ ...EMPTY_DRAFT })}
          className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
        >
          + Add user
        </button>
      </div>

      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
          <tr>
            <th className="py-2">Email</th>
            <th className="py-2">Roles</th>
            <th className="py-2">Status</th>
            <th className="py-2">Last login</th>
            <th className="py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isSelf = user?.id === r.id
            const isDeleting = confirmDelete === r.id
            return (
              <tr key={r.id} className="border-t border-slate-800">
                <td className="py-2 font-mono text-xs text-slate-200">{r.email ?? r.id}</td>
                <td className="py-2 text-xs text-slate-300">{(r.roles ?? []).join(', ') || '—'}</td>
                <td className="py-2 text-xs">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${
                    r.status === 'active' ? 'bg-emerald-900 text-emerald-200'
                      : r.status === 'disabled' ? 'bg-slate-700 text-slate-300'
                      : 'bg-amber-900 text-amber-200'
                  }`}>{r.status}</span>
                </td>
                <td className="py-2 text-xs text-slate-400">
                  {r.last_login ? new Date(r.last_login).toLocaleString() : '—'}
                </td>
                <td className="py-2 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditing({
                        id: r.id ?? '',
                        email: r.email ?? '',
                        password: '',
                        roles: (r.roles ?? []).join(', '),
                        status: r.status,
                      })}
                      className="rounded border border-slate-700 px-2 py-0.5 text-xs hover:border-slate-500"
                    >
                      Edit
                    </button>
                    {isDeleting ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onDelete(r.id!)}
                          className="rounded border border-rose-700 bg-rose-900/40 px-2 py-0.5 text-xs text-rose-200 hover:border-rose-500 disabled:opacity-40"
                        >
                          Confirm delete?
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(null)}
                          className="rounded border border-slate-700 px-2 py-0.5 text-xs hover:border-slate-500"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={isSelf}
                        title={isSelf ? "You can't delete yourself" : ''}
                        onClick={() => setConfirmDelete(r.id ?? null)}
                        className="rounded border border-rose-700 px-2 py-0.5 text-xs text-rose-300 hover:border-rose-500 disabled:opacity-40"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {editing && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setEditing(null) }}
        >
          <form
            onSubmit={onSave}
            className="w-full max-w-md space-y-3 rounded-lg border border-slate-700 bg-slate-900 p-5 text-sm"
          >
            <h2 className="text-base font-semibold">{editing.id ? 'Edit user' : 'New user'}</h2>

            <label className="block space-y-1">
              <span className="text-xs text-slate-400">Email</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={editing.email}
                onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                disabled={!!editing.id}    // id == email; don't allow rename
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-1.5 disabled:opacity-60"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs text-slate-400">
                Password {editing.id && <span className="text-slate-500">(leave blank to keep current)</span>}
              </span>
              <input
                type="password"
                autoComplete="new-password"
                required={!editing.id}
                minLength={editing.password ? 8 : 0}
                value={editing.password}
                onChange={(e) => setEditing({ ...editing, password: e.target.value })}
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-1.5"
                placeholder={editing.id ? '' : 'at least 8 characters'}
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs text-slate-400">Roles (comma-separated)</span>
              <input
                type="text"
                value={editing.roles}
                onChange={(e) => setEditing({ ...editing, roles: e.target.value })}
                placeholder="Admin"
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-xs"
              />
              <span className="block text-[10px] text-slate-500">
                Robotlab_x uses <code className="text-slate-400">Admin</code> as its only meaningful role today.
                Anything else here is for forward-compatibility.
              </span>
            </label>

            <label className="block space-y-1">
              <span className="text-xs text-slate-400">Status</span>
              <select
                value={editing.status}
                onChange={(e) => setEditing({ ...editing, status: e.target.value as UserDraft['status'] })}
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-1.5"
              >
                <option value="active">active</option>
                <option value="disabled">disabled</option>
                <option value="locked">locked</option>
                <option value="invited">invited</option>
              </select>
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded border border-slate-700 px-3 py-1.5 text-xs hover:border-slate-500"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-40"
              >
                {busy ? 'Saving…' : editing.id ? 'Save' : 'Create user'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
