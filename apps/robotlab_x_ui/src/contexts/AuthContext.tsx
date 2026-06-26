import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  apiFetch,
  clearAuthToken,
  decodeJwtPayload,
  getAuthToken,
  setAuthToken,
} from '../lib/api'
import { wsClient } from '../runtime/wsClient'

export interface AppUser {
  id?: string
  email?: string
  fullname?: string | null
  roles?: string[]
}

interface LoginResponse {
  access_token?: string | null
  token_type?: string | null
  mfa_required?: boolean | null
  message?: string | null
  refresh_token?: string | null
}

interface AuthContextValue {
  user: AppUser | null
  loading: boolean
  signIn: (username: string, password: string) => Promise<{ error: Error | null }>
  // First-user enrollment — only succeeds on a runtime whose user table
  // is empty. The backend (POST /v1/auth/claim-first-user, see
  // robotlab_x/api/first_user_routes.py) atomically refuses on a
  // populated runtime; the UI normally only shows the claim form when
  // GET /v1/auth/has-users said exists=false. Returns the same
  // session-established shape as signIn.
  claimFirstUser: (email: string, password: string) => Promise<{ error: Error | null }>
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function userFromToken(token: string): AppUser | null {
  const payload = decodeJwtPayload(token)
  if (!payload || !payload.user) return null
  return payload.user as AppUser
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getAuthToken()
    if (token) {
      const u = userFromToken(token)
      if (u) {
        setUser(u)
        // Kick the WebSocket open eagerly — without this it'd only
        // connect lazily on the first subscribe, leaving the header
        // indicator red even though we're authenticated.
        wsClient.connect()
      } else {
        clearAuthToken()
      }
    }
    setLoading(false)
  }, [])

  // Listen for `auth:expired` events dispatched by apiFetch on 401.
  // Dropping `user` makes ProtectedRoute redirect to /login on the next
  // render — no manual navigate() call needed.
  useEffect(() => {
    const onExpired = () => {
      wsClient.disconnect()
      setUser(null)
    }
    window.addEventListener('auth:expired', onExpired)
    return () => window.removeEventListener('auth:expired', onExpired)
  }, [])

  const signIn = useCallback(
    async (username: string, password: string) => {
      try {
        const res = await apiFetch<LoginResponse>('/v1/login', {
          method: 'POST',
          body: JSON.stringify({ username, password }),
        })
        if (!res.access_token) {
          return { error: new Error(res.message || 'Login failed') }
        }
        setAuthToken(res.access_token)
        const u = userFromToken(res.access_token)
        setUser(u)
        // Open the bus immediately on sign-in so the indicator turns
        // green before the user navigates to any subscribing page.
        wsClient.connect()
        return { error: null }
      } catch (err) {
        return { error: err instanceof Error ? err : new Error(String(err)) }
      }
    },
    [],
  )

  const claimFirstUser = useCallback(
    async (email: string, password: string) => {
      try {
        const res = await apiFetch<LoginResponse>('/v1/auth/claim-first-user', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        })
        if (!res.access_token) {
          return { error: new Error(res.message || 'Could not create the first account') }
        }
        setAuthToken(res.access_token)
        const u = userFromToken(res.access_token)
        setUser(u)
        wsClient.connect()
        return { error: null }
      } catch (err) {
        return { error: err instanceof Error ? err : new Error(String(err)) }
      }
    },
    [],
  )

  const signOut = useCallback(() => {
    // Tear the WS down BEFORE clearing the token so the (now-orphaned)
    // socket doesn't try to reconnect with a stale Authorization.
    wsClient.disconnect()
    clearAuthToken()
    setUser(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, signIn, claimFirstUser, signOut }),
    [user, loading, signIn, claimFirstUser, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
