import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { apiFetch } from '../lib/api'
import Banner from '../components/Banner'

interface HasUsersResponse {
  exists: boolean
}

// Two-mode login page:
//  - "claim" mode (the runtime has no users yet) shows a "Set up this
//    runtime" form that creates the first admin account.
//  - "signin" mode (the normal case) shows the standard credentials form.
// The check happens on mount via GET /v1/auth/has-users. The page
// intentionally hides BOTH forms until the probe returns — without that,
// a fresh-install user briefly sees a sign-in form they have no
// credentials for, which was the original UX complaint.
type Mode = 'probing' | 'claim' | 'signin'

export default function Login() {
  const { signIn, claimFirstUser } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('probing')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiFetch<HasUsersResponse>('/v1/auth/has-users')
      .then((res) => {
        if (cancelled) return
        setMode(res.exists ? 'signin' : 'claim')
      })
      .catch(() => {
        // If the probe fails (older backend without the route, network
        // hiccup) default to the sign-in form — that's the safe fallback
        // because it never *creates* anything; a user with credentials
        // can still get in, and a user without can't accidentally
        // re-claim something.
        if (!cancelled) setMode('signin')
      })
    return () => { cancelled = true }
  }, [])

  async function handleSignIn(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error: err } = await signIn(username, password)
    setSubmitting(false)
    if (err) { setError(err.message); return }
    navigate('/workspaces', { replace: true })
  }

  async function handleClaim(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== passwordConfirm) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setSubmitting(true)
    const { error: err } = await claimFirstUser(username, password)
    setSubmitting(false)
    if (err) { setError(err.message); return }
    navigate('/workspaces', { replace: true })
  }

  if (mode === 'probing') {
    return (
      <div className="flex h-full items-center justify-center px-4 text-sm text-slate-400">
        Checking runtime status…
      </div>
    )
  }

  if (mode === 'claim') {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <form
          onSubmit={handleClaim}
          className="w-full max-w-sm space-y-4 rounded-lg border border-sky-700/60 bg-slate-900/60 p-6 shadow-xl"
        >
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Set up this runtime</h1>
            <p className="mt-1 text-sm text-slate-400">
              No accounts exist on this RobotLab-X runtime yet. Create the first
              administrator account to continue. This one-time form is closed once
              a user is established.
            </p>
          </div>

          {error && <Banner tone="error">{error}</Banner>}

          <label className="block space-y-1 text-sm">
            <span className="text-slate-300">Email</span>
            <input
              type="email"
              autoComplete="email"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-sky-500"
              placeholder="you@example.com"
            />
          </label>

          <label className="block space-y-1 text-sm">
            <span className="text-slate-300">Password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-sky-500"
              placeholder="at least 8 characters"
            />
          </label>

          <label className="block space-y-1 text-sm">
            <span className="text-slate-300">Confirm password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              required
              minLength={8}
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-sky-500"
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Creating account…' : 'Create admin account'}
          </button>

          <p className="text-[11px] text-slate-500">
            Tip: when you connect this runtime to peers, use the same email on each
            so federation auth resolves to the same identity across machines.
          </p>
        </form>
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center px-4">
      <form
        onSubmit={handleSignIn}
        className="w-full max-w-sm space-y-4 rounded-lg border border-slate-700 bg-slate-900/60 p-6 shadow-xl"
      >
        <h1 className="text-xl font-semibold tracking-tight">RobotLab-X</h1>
        <p className="text-sm text-slate-400">Sign in to continue.</p>

        {error && <Banner tone="error">{error}</Banner>}

        <label className="block space-y-1 text-sm">
          <span className="text-slate-300">Email or username</span>
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-sky-500"
          />
        </label>

        <label className="block space-y-1 text-sm">
          <span className="text-slate-300">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-sky-500"
          />
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
