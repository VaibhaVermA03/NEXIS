import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, onUnauthorized, refreshSession, setCsrfToken } from '../lib/api'
import { authApi } from '../services/endpoints'

const Ctx = createContext(null)

export function AuthProvider({ children }) {
  const qc = useQueryClient()
  const [state, setState] = useState({ status: 'loading', user: null })

  const clear = useCallback(() => { setCsrfToken(null); qc.clear(); setState({ status: 'anonymous', user: null }) }, [qc])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        let data
        try { data = await authApi.me() } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 401) throw e
          await refreshSession(); data = await authApi.me()
        }
        if (alive) setState({ status: 'authenticated', user: data.user })
      } catch { if (alive) setState({ status: 'anonymous', user: null }) }
    })()
    const off = onUnauthorized(() => alive && clear())
    return () => { alive = false; off() }
  }, [clear])

  const value = useMemo(() => ({
    ...state,
    login: async (body) => { const d = await authApi.login(body); setState({ status: 'authenticated', user: d.user }); return d.user },
    signup: async (body) => { const d = await authApi.signup(body); setState({ status: 'authenticated', user: d.user }); return d.user },
    completeExternalLogin: async () => { const d = await authApi.me(); setState({ status: 'authenticated', user: d.user }); return d.user },
    logout: async () => { try { await authApi.logout() } finally { clear() } },
    setUser: (user) => setState((s) => ({ ...s, user })),
  }), [state, clear])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useAuth = () => {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside AuthProvider')
  return v
}
