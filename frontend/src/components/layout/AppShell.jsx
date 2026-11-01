import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ChartColumn, ChevronDown, KeyRound, LayoutDashboard, LogOut, Menu, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Play, Settings, Sparkles, SquareTerminal, Sun, Workflow, Wrench, X } from 'lucide-react'
import { useAuth } from '../../app/AuthContext'
import { useTheme } from '../../app/ThemeContext'
import { Logo } from '../ui/Logo'
import { Dropdown, DropdownItem } from '../ui/Overlay'
import { ButtonLink } from '../ui/Button'
import { cn } from '../../lib/utils'

const NAV = [
  { to: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/app/agents', label: 'Agents', icon: Sparkles },
  { to: '/app/workflows', label: 'Workflows', icon: Workflow },
  { to: '/app/executions', label: 'Executions', icon: SquareTerminal },
  { to: '/app/tools', label: 'Tool Registry', icon: Wrench },
  { to: '/app/api-keys', label: 'API Keys', icon: KeyRound },
  { to: '/app/analytics', label: 'Analytics', icon: ChartColumn },
  { to: '/app/settings', label: 'Settings', icon: Settings },
]
const TITLES = [['/app/agents', 'Agents'], ['/app/workflows', 'Workflows'], ['/app/executions', 'Executions'],
  ['/app/tools', 'Tool Registry'], ['/app/api-keys', 'API Keys'], ['/app/analytics', 'Analytics'], ['/app/settings', 'Settings'], ['/app/dashboard', 'Dashboard']]

const DESKTOP = '(min-width: 1024px)'
const SIDEBAR_KEY = 'nexis-sidebar'  // UI preference only (open/closed)

function useIsDesktop() {
  const [v, setV] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(DESKTOP).matches : false))
  useEffect(() => {
    if (!window.matchMedia) return undefined
    const m = window.matchMedia(DESKTOP)
    const fn = () => setV(m.matches)
    m.addEventListener('change', fn)
    return () => m.removeEventListener('change', fn)
  }, [])
  return v
}

export function ThemeToggle() {
  const { preference, setPreference, resolved } = useTheme()
  const Icon = resolved === 'dark' ? Moon : Sun
  return (
    <Dropdown label="Change theme" trigger={<span className="flex h-10 w-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text sm:h-9 sm:w-9"><Icon className="h-[18px] w-[18px]" /></span>}>
      {[['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'System', Monitor]].map(([v, l, I]) => (
        <DropdownItem key={v} icon={I} onClick={() => setPreference(v)}>{l}{preference === v && <span className="ml-auto text-accent">✓</span>}</DropdownItem>))}
    </Dropdown>
  )
}

function SidebarContent({ onNavigate, onClose }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-5">
        <Link to="/app/dashboard" onClick={onNavigate} aria-label="NEXIS home" className="rounded-lg"><Logo /></Link>
        <button onClick={onClose} aria-label="Close navigation" className="-mr-2 rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-text lg:hidden"><X className="h-5 w-5" /></button>
      </div>
      <div className="px-3 pt-4">
        <div className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-xs">
          <p className="font-medium text-text">Personal workspace</p><p className="text-muted">Single-workspace account</p>
        </div>
      </div>
      <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} onClick={onNavigate}
            className={({ isActive }) => cn('group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors sm:py-2',
              isActive ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-surface-2 hover:text-text')}>
            {({ isActive }) => (<>
              <span className={cn('absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent transition-opacity', isActive ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
              <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />{label}
            </>)}
          </NavLink>))}
      </nav>
    </div>
  )
}

export function AppShell() {
  const { user, logout } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const isDesktop = useIsDesktop()
  const [desktopOpen, setDesktopOpen] = useState(() => { try { return localStorage.getItem(SIDEBAR_KEY) !== 'closed' } catch { return true } })
  const [mobileOpen, setMobileOpen] = useState(false)
  const asideRef = useRef(null)
  const open = isDesktop ? desktopOpen : mobileOpen

  const toggle = useCallback(() => {
    if (isDesktop) {
      setDesktopOpen((o) => { const n = !o; try { localStorage.setItem(SIDEBAR_KEY, n ? 'open' : 'closed') } catch { /* storage unavailable */ } return n })
    } else setMobileOpen((o) => !o)
  }, [isDesktop])

  useEffect(() => { setMobileOpen(false) }, [pathname])
  useEffect(() => { if (isDesktop) setMobileOpen(false) }, [isDesktop])
  useEffect(() => { if (asideRef.current) asideRef.current.inert = !open }, [open])  // closed sidebar must not be tabbable
  useEffect(() => {
    if (!mobileOpen || isDesktop) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setMobileOpen(false) }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [mobileOpen, isDesktop])

  const title = (TITLES.find(([p]) => pathname.startsWith(p)) || [null, 'NEXIS'])[1]
  const initials = (user?.full_name || '?').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase()
  const ToggleIcon = isDesktop ? (open ? PanelLeftClose : PanelLeftOpen) : Menu

  return (
    <div className="min-h-screen" data-sidebar={open ? 'open' : 'closed'}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[80] focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg">Skip to content</a>

      {/* phone/tablet backdrop */}
      <div onClick={() => setMobileOpen(false)} aria-hidden="true"
        className={cn('fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] transition-opacity duration-300 lg:hidden', mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0')} />

      {/* the sidebar: slides in/out on every screen size */}
      <aside id="app-sidebar" ref={asideRef} aria-label="Navigation drawer" aria-hidden={!open}
        className={cn('fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] border-r border-border bg-surface transition-transform duration-300 ease-smooth will-change-transform lg:z-30 lg:w-64 lg:max-w-none',
          open ? 'translate-x-0 shadow-pop lg:shadow-none' : '-translate-x-full')}>
        <SidebarContent onNavigate={() => setMobileOpen(false)} onClose={() => setMobileOpen(false)} />
      </aside>

      {/* content: centred when the sidebar is closed, pushed right (smoothly) when it is open on desktop */}
      <div className={cn('min-w-0 transition-[padding] duration-300 ease-smooth', open ? 'lg:pl-64' : 'lg:pl-0')}>
        <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-border bg-surface/85 px-3 backdrop-blur-md sm:gap-3 sm:px-6">
          <button onClick={toggle} aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} aria-controls="app-sidebar"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text">
            <ToggleIcon className="h-5 w-5" />
          </button>
          <h1 className="min-w-0 truncate text-base font-semibold">{title}</h1>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <ButtonLink to="/app/executions" size="sm" className="hidden sm:inline-flex"><Play className="h-3.5 w-3.5" />Run task</ButtonLink>
            <ThemeToggle />
            <Dropdown label="Account menu" trigger={
              <span className="flex items-center gap-1.5 rounded-lg p-1 transition-colors hover:bg-surface-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent sm:h-8 sm:w-8">{initials}</span>
                <ChevronDown className="hidden h-4 w-4 text-muted sm:block" />
              </span>}>
              <div className="mb-1 border-b border-border px-3 pb-2 pt-1"><p className="truncate text-sm font-medium">{user?.full_name}</p><p className="truncate text-xs text-muted">{user?.email}</p></div>
              <DropdownItem icon={Settings} onClick={() => navigate('/app/settings/profile')}>Profile</DropdownItem>
              <DropdownItem icon={KeyRound} onClick={() => navigate('/app/settings/security')}>Security</DropdownItem>
              <DropdownItem icon={LogOut} danger onClick={async () => { await logout(); navigate('/login') }}>Sign out</DropdownItem>
            </Dropdown>
          </div>
        </header>
        <main id="main" className="mx-auto w-full min-w-0 max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8"><Outlet /></main>
      </div>
    </div>
  )
}

export function PageHeader({ title, description, actions, back }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
      <div className="min-w-0">{back}<h2 className="text-2xl font-semibold tracking-tight">{title}</h2>{description && <p className="mt-1 text-sm text-muted">{description}</p>}</div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}