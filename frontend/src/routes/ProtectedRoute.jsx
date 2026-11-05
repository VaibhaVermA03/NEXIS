import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Server, WifiOff } from 'lucide-react'
import { useAuth } from '../app/AuthContext'
import { Logo } from '../components/ui/Logo'
import { Button, Spinner } from '../components/ui/Button'

/** When the "waking up" message appears / when the "still starting" hint appears. Mutable for tests. */
export const wakeTiming = { showAfterMs: 2500, longAfterMs: 70_000 }

function useAfter(ms) {
  const [on, setOn] = useState(false)
  useEffect(() => { const t = setTimeout(() => setOn(true), ms); return () => clearTimeout(t) }, [ms])
  return on
}

/** Generic loader (e.g. while a page's code is downloading). No server message here. */
export function FullScreenLoader() {
  return (
    <div role="status" aria-label="Loading" className="flex min-h-[100dvh] flex-col items-center justify-center gap-4"><Logo /><Spinner className="h-5 w-5 text-muted" /></div>
  )
}

/** Shown while the app is waiting for the backend (Render's free plan puts it to sleep when idle). */
export function ServerWakeLoader() {
  const show = useAfter(wakeTiming.showAfterMs)    // quick loads never flash the message
  const long = useAfter(wakeTiming.longAfterMs)
  return (
    <div role="status" aria-live="polite" aria-label="Loading" className="flex min-h-[100dvh] flex-col items-center justify-center gap-7 px-5 py-10 text-center">
      <Logo />
      {!show ? <Spinner className="h-5 w-5 text-muted" /> : (
        <div className="animate-fade-up w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-card sm:p-7">
          <div className="relative mx-auto mb-4 flex h-14 w-14 items-center justify-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-accent/20" aria-hidden="true" />
            <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent"><Server className="h-6 w-6" aria-hidden="true" /></span>
          </div>
          <h2 className="text-lg font-semibold">Waking up the server<span className="caret">…</span></h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            This project is deployed on Render’s free plan, which puts the server to sleep when it is idle. The first load can take up to a minute. After that, everything is fast. Thanks for your patience!
          </p>
          <div className="wake-bar mt-5" aria-hidden="true"><span /></div>
          {long && <p className="mt-4 text-xs text-muted">Still starting up — hang tight. If nothing happens in a minute or two, refresh the page.</p>}
        </div>
      )}
    </div>
  )
}

/** The server did not answer within the waiting period. */
export function ServerUnavailable({ onRetry }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-7 px-5 py-10 text-center">
      <Logo />
      <div className="animate-fade-up w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-card sm:p-7">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-danger/10 text-danger"><WifiOff className="h-6 w-6" aria-hidden="true" /></div>
        <h2 className="text-lg font-semibold">Can’t reach the server</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">The server did not respond. If it was asleep it may still be starting up (this can take up to a minute on Render’s free plan). Please try again.</p>
        <Button className="mt-5 w-full" onClick={onRetry}>Try again</Button>
      </div>
    </div>
  )
}

export function ProtectedRoute() {
  const { status, retry } = useAuth()
  const loc = useLocation()
  if (status === 'loading') return <ServerWakeLoader />
  if (status === 'unavailable') return <ServerUnavailable onRetry={retry} />
  if (status === 'anonymous') return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  return <Outlet />
}

export function PublicOnlyRoute() {
  const { status, retry } = useAuth()
  if (status === 'loading') return <ServerWakeLoader />
  if (status === 'unavailable') return <ServerUnavailable onRetry={retry} />
  if (status === 'authenticated') return <Navigate to="/app/dashboard" replace />
  return <Outlet />
}