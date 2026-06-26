const TOKEN_STORAGE_KEY = 'robotlab_x.access_token'

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY)
}

export function setAuthToken(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token)
}

export function clearAuthToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY)
}

export interface JwtPayload {
  exp?: number
  user?: { id?: string; email?: string; fullname?: string; roles?: string[] }
  [key: string]: unknown
}

export function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const [, payload] = token.split('.')
    if (!payload) return null
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
    const json = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(json) as JwtPayload
  } catch {
    return null
  }
}

export class ApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, message: string, body: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

/**
 * Per-runtime apiFetch configuration.
 *
 * ``baseUrl`` is the origin of the target runtime, e.g.
 * ``http://10.0.0.5:8998``. Empty string means "same origin" — the
 * default ``apiFetch`` factory below uses that so existing callers
 * keep hitting ``/v1/...`` via Vite's dev proxy or the same backend
 * that served the SPA.
 *
 * ``getToken`` returns the current access token (or null) for THIS
 * runtime. It's a callback rather than a value so the apiFetch always
 * sees the live token — important because tokens rotate on refresh
 * and because the multi-runtime layer keeps tokens in-memory per
 * connection.
 *
 * ``onAuthExpired`` is called when a request returns 401 with a token
 * attached (i.e. the server explicitly rejected us). The default
 * clears localStorage + fires a window-level ``auth:expired`` event
 * for the AuthContext / ProtectedRoute machinery. The multi-runtime
 * layer (Phase 3) will pass a per-connection handler so an expiry on
 * one runtime doesn't sign the user out of every other one.
 */
export interface ApiFetchConfig {
  baseUrl: string
  getToken: () => string | null
  onAuthExpired?: () => void
}

/**
 * Build an apiFetch bound to a specific runtime.
 *
 * Each call returns an independent function with its own
 * baseUrl/getToken closure. The multi-runtime layer holds one of
 * these per ``RuntimeConnection``.
 */
export function createApiFetch(cfg: ApiFetchConfig) {
  const baseUrl = (cfg.baseUrl || '').replace(/\/+$/, '')
  return async function apiFetch<T = unknown>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const headers = new Headers(init.headers)
    if (!headers.has('Content-Type') && init.body) {
      headers.set('Content-Type', 'application/json')
    }
    const token = cfg.getToken()
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`)
    }

    // ``baseUrl + path`` works for both same-origin ("" + "/v1/foo")
    // and cross-origin ("http://10.0.0.5:8998" + "/v1/foo"). Path is
    // expected to start with '/'.
    const url = baseUrl + path
    const response = await fetch(url, { ...init, headers })
    const contentType = response.headers.get('content-type') ?? ''
    const body = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text().catch(() => '')

    if (!response.ok) {
      // 401 from any endpoint means the JWT is invalid/expired. Tell
      // the configured handler — the default below clears the global
      // token + fires the auth:expired window event; the multi-runtime
      // layer will pass a per-connection handler instead.
      if (response.status === 401 && token) {
        cfg.onAuthExpired?.()
      }
      const detail =
        (body && typeof body === 'object' && 'detail' in body
          ? String((body as { detail: unknown }).detail)
          : null) ?? `HTTP ${response.status}`
      throw new ApiError(response.status, detail, body)
    }
    return body as T
  }
}

/**
 * Default same-origin apiFetch — preserves today's behaviour
 * (relative paths hit the SPA's origin, token from localStorage,
 * window-level ``auth:expired`` event). Existing imports
 * (``import { apiFetch } from '../lib/api'``) keep working unchanged.
 */
export const apiFetch = createApiFetch({
  baseUrl: '',
  getToken: getAuthToken,
  onAuthExpired: () => {
    clearAuthToken()
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('auth:expired'))
    }
  },
})
