import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, onUnauthorized, setCsrfToken } from '../lib/api'
import { authApi } from '../services/endpoints'

const Ctx = createContext(null)

/** How long the app keeps waiting for a sleeping/unreachable server (e.g. Render free plan cold start). Mutable for tests. */
export const wakeConfig = { deadlineMs: 90_000, firstDelayMs: 1500, maxDelayMs: 6000 }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// Network failure or a 5xx means "the server is not ready", NOT "you are logged out". A 401 is a real answer.
const isTransient = (e) => e instanceof ApiError && (e.status === 0 || e.status >= 500)

// The API client already refreshes an expired access token and retries once, so a single call is enough here.
const loadSession = () => authApi.me()

export function AuthProvider({ children }) {
  const qc = useQueryClient()
  const [state, setState] = useState({ status: 'loading', user: null })   // loading | authenticated | anonymous | unavailable
  const [attempt, setAttempt] = useState(0)

  const clear = useCallback(() => { setCsrfToken(null); qc.clear(); setState({ status: 'anonymous', user: null }) }, [qc])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const started = Date.now()
      let delay = wakeConfig.firstDelayMs
      for (;;) {
        try {
          const data = await loadSession()
          if (alive) setState({ status: 'authenticated', user: data.user })
          return
        } catch (e) {
          if (!alive) return
          if (!isTransient(e)) { setState({ status: 'anonymous', user: null }); return }
          if (Date.now() - started >= wakeConfig.deadlineMs) { setState({ status: 'unavailable', user: null }); return }
          await sleep(delay)                                   // keep the "waking up" screen and try again
          delay = Math.min(Math.round(delay * 1.5), wakeConfig.maxDelayMs)
          if (!alive) return
        }
      }
    })()
    const off = onUnauthorized(() => alive && clear())
    return () => { alive = false; off() }
  }, [clear, attempt])

  const retry = useCallback(() => { setState({ status: 'loading', user: null }); setAttempt((a) => a + 1) }, [])

  const value = useMemo(() => ({
    ...state,
    retry,
    login: async (body) => { const d = await authApi.login(body); setState({ status: 'authenticated', user: d.user }); return d.user },
    signup: async (body) => { const d = await authApi.signup(body); setState({ status: 'authenticated', user: d.user }); return d.user },
    completeExternalLogin: async () => { const d = await authApi.me(); setState({ status: 'authenticated', user: d.user }); return d.user },
    logout: async () => { try { await authApi.logout() } finally { clear() } },
    setUser: (user) => setState((s) => ({ ...s, user })),
  }), [state, clear, retry])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useAuth = () => {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside AuthProvider')
  return v
}