import { useEffect, useState, type FormEvent } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import type { Config } from '../models/Config'
import Banner from '../components/Banner'
import ConnectionIndicator from '../components/ConnectionIndicator'

const DEFAULT_ID = 'default'

export default function ConfigPage() {
  const { user, signOut } = useAuth()
  const [config, setConfig] = useState<Config | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const item = await apiFetch<Config>(`/v1/config/${DEFAULT_ID}`)
        if (!cancelled) setConfig(item)
      } catch (err) {
        if (cancelled) return
        if (err instanceof Error) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!config) return
    setSaving(true)
    setError(null)
    setStatus(null)
    try {
      const updated = await apiFetch<Config>(`/v1/config/${DEFAULT_ID}`, {
        method: 'PUT',
        body: JSON.stringify(config),
      })
      setConfig(updated)
      setStatus('Saved.')
    } catch (err) {
      if (err instanceof Error) setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function update<K extends keyof Config>(key: K, value: Config[K]) {
    setConfig((c) => (c ? { ...c, [key]: value } : c))
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">RobotLab-X · Config</h1>
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <ConnectionIndicator />
          <span>{user?.email ?? user?.id ?? 'unknown'}</span>
          <button
            type="button"
            onClick={signOut}
            className="rounded border border-slate-700 px-2 py-1 text-xs hover:border-slate-500"
          >
            Sign out
          </button>
        </div>
      </header>

      {error && <Banner tone="error">{error}</Banner>}
      {status && <Banner tone="success">{status}</Banner>}

      {loading && <Banner tone="info">Loading config…</Banner>}

      {!loading && config && (
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-lg border border-slate-700 bg-slate-900/60 p-5"
        >
          <Field label="database_type">
            <select
              value={config.database_type ?? 'lowdb'}
              onChange={(e) =>
                update(
                  'database_type',
                  e.target.value as Config['database_type'],
                )
              }
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            >
              <option value="postgres">postgres</option>
              <option value="lowdb">lowdb</option>
              <option value="filesystem">filesystem</option>
              <option value="none">none</option>
            </select>
          </Field>

          <Field label="data_dir">
            <input
              type="text"
              value={config.data_dir ?? ''}
              onChange={(e) => update('data_dir', e.target.value)}
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </Field>

          <Field label="repo_dir">
            <input
              type="text"
              value={config.repo_dir ?? ''}
              onChange={(e) => update('repo_dir', e.target.value)}
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </Field>

          <button
            type="submit"
            disabled={saving}
            className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </form>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-slate-300">{label}</span>
      {children}
    </label>
  )
}
