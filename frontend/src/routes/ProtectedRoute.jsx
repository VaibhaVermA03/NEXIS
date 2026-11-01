import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../app/AuthContext'
import { Logo } from '../components/ui/Logo'
import { Spinner } from '../components/ui/Button'

export function FullScreenLoader() {
  return (
    <div role="status" aria-label="Loading" className="flex min-h-screen flex-col items-center justify-center gap-4"><Logo /><Spinner className="h-5 w-5 text-muted" /></div>
  )
}

export function ProtectedRoute() {
  const { status } = useAuth()
  const loc = useLocation()
  if (status === 'loading') return <FullScreenLoader />
  if (status === 'anonymous') return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  return <Outlet />
}

export function PublicOnlyRoute() {
  const { status } = useAuth()
  if (status === 'loading') return <FullScreenLoader />
  if (status === 'authenticated') return <Navigate to="/app/dashboard" replace />
  return <Outlet />
}
