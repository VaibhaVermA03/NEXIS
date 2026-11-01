import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const Ctx = createContext(null)
const KEY = 'nexis-theme'  // theme preference only; never auth data

function resolve(pref) {
  if (pref === 'system') return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  return pref
}

export function ThemeProvider({ children }) {
  const [pref, setPref] = useState(() => { try { return localStorage.getItem(KEY) || 'system' } catch { return 'system' } })
  const apply = useCallback((p) => document.documentElement.classList.toggle('dark', resolve(p) === 'dark'), [])
  useEffect(() => { apply(pref) }, [pref, apply])
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq || pref !== 'system') return undefined
    const fn = () => apply('system'); mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [pref, apply])
  const value = useMemo(() => ({
    preference: pref, resolved: resolve(pref),
    setPreference: (p) => { try { localStorage.setItem(KEY, p) } catch { /* storage unavailable */ } setPref(p) },
  }), [pref])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useTheme = () => useContext(Ctx)
