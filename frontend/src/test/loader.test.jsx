import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { wakeConfig } from '../app/AuthContext'
import { FullScreenLoader, ServerWakeLoader, wakeTiming } from '../routes/ProtectedRoute'
import { anonymous, authed, err, mockFetch, renderApp, USER } from './utils'

const EMPTY = { period_days: 7, total_agents: 0, active_agents: 0, executions_in_period: 0, completed: 0, failed: 0, cancelled: 0, in_progress: 0, agent_usage: [], daily: [], recent_executions: [] }
const DEFAULT_WAKE = { ...wakeConfig }
const DEFAULT_TIMING = { ...wakeTiming }
afterEach(() => { Object.assign(wakeConfig, DEFAULT_WAKE); Object.assign(wakeTiming, DEFAULT_TIMING) })

describe('"Waking up the server…" screen', () => {
  it('shows a plain spinner first, then the Render free-plan message, then a "still starting" hint', async () => {
    Object.assign(wakeTiming, { showAfterMs: 40, longAfterMs: 220 })
    render(<ServerWakeLoader />)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByText(/waking up the server/i)).toBeNull()               // quick loads never flash the message
    expect(await screen.findByText(/waking up the server/i)).toBeInTheDocument()
    const body = screen.getByText(/deployed on Render/i)
    expect(body).toHaveTextContent('This project is deployed on Render’s free plan, which puts the server to sleep when it is idle.')
    expect(body).toHaveTextContent('The first load can take up to a minute. After that, everything is fast. Thanks for your patience!')
    expect(screen.queryByText(/still starting up/i)).toBeNull()
    expect(await screen.findByText(/still starting up/i)).toBeInTheDocument()
  })

  it('the generic page loader (code-splitting fallback) never claims the server is asleep', async () => {
    Object.assign(wakeTiming, { showAfterMs: 10, longAfterMs: 20 })
    render(<FullScreenLoader />)
    await new Promise((r) => setTimeout(r, 80))
    expect(screen.queryByText(/waking up|render/i)).toBeNull()
  })

  it('is what the app shows while it waits for the backend, and it keeps retrying 5xx instead of dropping to the login page', async () => {
    Object.assign(wakeConfig, { deadlineMs: 3000, firstDelayMs: 20, maxDelayMs: 40 }); Object.assign(wakeTiming, { showAfterMs: 30 })
    let n = 0
    const f = mockFetch(authed({ 'GET /dashboard/summary': EMPTY, 'GET /auth/me': () => (++n <= 3 ? err(503, 'unavailable', 'Service Unavailable') : { user: USER, csrf_token: 'c' }) }))
    renderApp('/app/dashboard')
    expect(await screen.findByText(/waking up the server/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /welcome back/i })).toBeNull()      // NOT treated as logged out
    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 2 })).toBeInTheDocument()
    expect(f.to('GET', '/auth/me')).toHaveLength(4)
  })

  it('also waits when the network itself fails (sleeping server), then lands on the login page for a real 401', async () => {
    Object.assign(wakeConfig, { deadlineMs: 3000, firstDelayMs: 20, maxDelayMs: 40 })
    let down = 2
    const f = mockFetch(anonymous())
    const real = globalThis.fetch
    globalThis.fetch = vi.fn((...a) => (down-- > 0 ? Promise.reject(new TypeError('Failed to fetch')) : real(...a)))
    renderApp('/app/agents')
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument()
    expect(f.to('GET', '/auth/me')).toHaveLength(1)                       // the first two attempts never reached the server
  })

  it('gives up after the waiting period with a clear screen and a working "Try again"', async () => {
    Object.assign(wakeConfig, { deadlineMs: 120, firstDelayMs: 20, maxDelayMs: 30 })
    let down = true
    const f = mockFetch(authed({ 'GET /dashboard/summary': EMPTY }))
    const real = globalThis.fetch
    globalThis.fetch = vi.fn((...a) => (down ? Promise.reject(new TypeError('Failed to fetch')) : real(...a)))
    renderApp('/app/dashboard')
    expect(await screen.findByRole('heading', { name: /can.t reach the server/i }, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /welcome back/i })).toBeNull()
    down = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 2 })).toBeInTheDocument()
    expect(f.to('GET', '/auth/me').length).toBeGreaterThanOrEqual(1)
  })

  it('a normal 401 (not logged in) is NOT retried', async () => {
    const f = mockFetch(anonymous())
    renderApp('/login')
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument()
    expect(f.to('GET', '/auth/me')).toHaveLength(1); expect(f.to('POST', '/auth/refresh')).toHaveLength(1)
  })

  it('also covers the public pages: a sleeping server shows the wake screen on /login too', async () => {
    Object.assign(wakeConfig, { deadlineMs: 3000, firstDelayMs: 20, maxDelayMs: 40 }); Object.assign(wakeTiming, { showAfterMs: 20 })
    let n = 0
    mockFetch(anonymous({ 'GET /auth/me': () => (++n <= 3 ? err(502, 'bad_gateway', 'Bad Gateway') : err(401, 'unauthorized', 'Authentication required')) }))
    renderApp('/login')
    expect(await screen.findByText(/waking up the server/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument())
  })
})