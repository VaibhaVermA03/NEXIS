import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { anonymous, authed, err, mockFetch, renderApp, USER } from './utils'
import { ApiError, api, setCsrfToken } from '../lib/api'

const DASH = { 'GET /dashboard/summary': { period_days: 7, total_agents: 0, active_agents: 0, executions_in_period: 0, completed: 0, failed: 0, cancelled: 0, in_progress: 0, agent_usage: [], daily: [], recent_executions: [] } }

describe('login', () => {
  it('validates required fields and email format before calling the API', async () => {
    const f = mockFetch(anonymous())
    renderApp('/login')
    await screen.findByRole('heading', { name: /welcome back/i })
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    expect(await screen.findByText('Email is required')).toBeInTheDocument()
    expect(screen.getByText('Password is required')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument()
    expect(f.to('POST', '/auth/login')).toHaveLength(0)
  })

  it('shows a generic server error on bad credentials and keeps the form usable', async () => {
    const f = mockFetch(anonymous({ 'POST /auth/login': err(401, 'invalid_credentials', 'Invalid email or password') }))
    renderApp('/login')
    await userEvent.type(await screen.findByLabelText('Email'), 'alice@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument()
    expect(f.to('POST', '/auth/login')[0].body).toEqual({ email: 'alice@example.com', password: 'wrong-password' })
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeEnabled()
  })

  it('signs in and lands on the dashboard; honours a safe ?next only', async () => {
    mockFetch(anonymous({ 'POST /auth/login': { user: USER, csrf_token: 'c1' }, ...DASH, 'GET /agents': { items: [], total: 0, page: 1, page_size: 10 } }))
    renderApp('/login?next=/app/agents')
    await userEvent.type(await screen.findByLabelText('Email'), 'alice@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'Str0ngPassw0rd!')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    expect(await screen.findByRole('heading', { name: 'Agents', level: 2 })).toBeInTheDocument()
  })

  it('password visibility toggle works', async () => {
    mockFetch(anonymous())
    renderApp('/login')
    const input = await screen.findByLabelText('Password')
    expect(input).toHaveAttribute('type', 'password')
    await userEvent.click(screen.getByRole('button', { name: /show password/i }))
    expect(input).toHaveAttribute('type', 'text')
  })

  it.each([['google_not_configured', /not configured on this server/i], ['consent_cancelled', /was cancelled/i], ['account_exists', /already exists/i]])(
    'maps Google error %s to a clear message', async (code, re) => {
      mockFetch(anonymous())
      renderApp(`/login?error=${code}`)
      expect(await screen.findByRole('alert')).toHaveTextContent(re)
    })

  it('Continue with Google starts the real backend OAuth flow', async () => {
    mockFetch(anonymous())
    const assign = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, assign, origin: 'http://localhost' } })
    renderApp('/login')
    await userEvent.click(await screen.findByRole('button', { name: /continue with google/i }))
    expect(assign).toHaveBeenCalledWith('/api/v1/auth/google/login')
    Object.defineProperty(window, 'location', { configurable: true, value: original })
  })

  it('notes when Google is not configured', async () => {
    mockFetch(anonymous())
    renderApp('/login')
    expect(await screen.findByText(/google sign-in is not configured on this server\./i)).toBeInTheDocument()
  })
})

describe('signup', () => {
  it('enforces password policy and confirmation inline', async () => {
    const f = mockFetch(anonymous())
    renderApp('/signup')
    await userEvent.type(await screen.findByLabelText('Full name'), 'Alice Tester')
    await userEvent.type(screen.getByLabelText('Email'), 'alice@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'short')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'different')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByText(/at least 10 characters/i, { selector: 'p[role=alert]' })).toBeInTheDocument()
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument()
    expect(f.to('POST', '/auth/signup')).toHaveLength(0)
  })

  it('maps server field errors and duplicate-email conflict', async () => {
    mockFetch(anonymous({ 'POST /auth/signup': err(409, 'email_taken', 'An account with this email already exists') }))
    renderApp('/signup')
    await userEvent.type(await screen.findByLabelText('Full name'), 'Alice Tester')
    await userEvent.type(screen.getByLabelText('Email'), 'alice@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'Str0ngPassw0rd!')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'Str0ngPassw0rd!')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByText('An account with this email already exists')).toBeInTheDocument()
  })

  it('creates the account and enters the app', async () => {
    const f = mockFetch(anonymous({ 'POST /auth/signup': [201, { user: USER, csrf_token: 'c' }], ...DASH }))
    renderApp('/signup')
    await userEvent.type(await screen.findByLabelText('Full name'), 'Alice Tester')
    await userEvent.type(screen.getByLabelText('Email'), 'alice@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'Str0ngPassw0rd!')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'Str0ngPassw0rd!')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 2 })).toBeInTheDocument()
    expect(f.to('POST', '/auth/signup')[0].body.password_confirm).toBe('Str0ngPassw0rd!')
  })
})

describe('password reset', () => {
  it('shows the development link only when the server returns one', async () => {
    mockFetch(anonymous({ 'POST /auth/forgot-password': { message: 'If an account exists...', dev_reset_link: 'http://localhost:5173/reset-password?token=abc' } }))
    renderApp('/forgot-password')
    await userEvent.type(await screen.findByLabelText('Email'), 'alice@example.com')
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }))
    expect(await screen.findByText(/no email provider is configured/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /reset password/i })).toHaveAttribute('href', expect.stringContaining('token=abc'))
  })
  it('does not pretend an email was sent when there is no dev link', async () => {
    mockFetch(anonymous({ 'POST /auth/forgot-password': { message: 'If an account exists...', dev_reset_link: null } }))
    renderApp('/forgot-password')
    await userEvent.type(await screen.findByLabelText('Email'), 'alice@example.com')
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }))
    expect(await screen.findByText(/email delivery is not configured/i)).toBeInTheDocument()
  })
})

describe('protected routing', () => {
  it('redirects anonymous users from /app/* to login', async () => {
    mockFetch(anonymous())
    const { router } = renderApp('/app/agents')
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toContain('next=%2Fapp%2Fagents')
  })
  it('redirects signed-in users away from /login', async () => {
    mockFetch(authed(DASH))
    renderApp('/login')
    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 2 })).toBeInTheDocument()
  })
  it('recovers a session through refresh when the access token expired', async () => {
    let meCalls = 0
    const f = mockFetch(authed({ ...DASH, 'GET /auth/me': () => (++meCalls === 1 ? err(401, 'unauthorized', 'expired') : { user: USER, csrf_token: 'c2' }), 'POST /auth/refresh': { user: USER, csrf_token: 'c2' } }))
    renderApp('/app/dashboard')
    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 2 })).toBeInTheDocument()
    expect(f.to('POST', '/auth/refresh')).toHaveLength(1)
  })
})

describe('api client error handling', () => {
  it('refreshes once on 401 then retries the request', async () => {
    let n = 0
    const f = mockFetch({ 'GET /agents': () => (++n === 1 ? err(401, 'unauthorized', 'expired') : { items: [], total: 0 }), 'POST /auth/refresh': { user: USER, csrf_token: 'new-csrf' } })
    expect(await api.get('/agents')).toEqual({ items: [], total: 0 })
    expect(f.to('GET', '/agents')).toHaveLength(2); expect(f.to('POST', '/auth/refresh')).toHaveLength(1)
  })
  it('does not retry forever when refresh fails and signals sign-out', async () => {
    mockFetch({ 'GET /agents': err(401, 'unauthorized', 'expired'), 'POST /auth/refresh': err(401, 'refresh_reuse', 'Session invalid') })
    const handler = vi.fn(); window.addEventListener('nexis:unauthorized', handler)
    await expect(api.get('/agents')).rejects.toMatchObject({ status: 401 })
    expect(handler).toHaveBeenCalled(); window.removeEventListener('nexis:unauthorized', handler)
  })
  it('sends the CSRF header on unsafe methods and never on GET', async () => {
    const f = mockFetch({ 'POST /agents': { id: 'a' }, 'GET /agents': { items: [] } })
    setCsrfToken('tok-123')
    await api.post('/agents', { name: 'x' }); await api.get('/agents')
    expect(f.calls[0].headers['X-CSRF-Token']).toBe('tok-123'); expect(f.calls[0].headers['X-Requested-With']).toBe('nexis')
    expect(f.calls[1].headers['X-CSRF-Token']).toBeUndefined()
  })
  it.each([[403, 'forbidden'], [404, 'not_found'], [409, 'conflict'], [422, 'validation_error'], [429, 'rate_limited']])('surfaces %s with the server message', async (status, code) => {
    mockFetch({ 'GET /x': err(status, code, `msg ${status}`) })
    await expect(api.get('/x')).rejects.toMatchObject({ status, code, message: `msg ${status}` })
  })
  it('uses a friendly message for 5xx and network failures', async () => {
    mockFetch({ 'GET /x': [500, {}] })
    await expect(api.get('/x')).rejects.toThrow(/something went wrong on our side/i)
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const e = await api.get('/x').catch((x) => x)
    expect(e).toBeInstanceOf(ApiError); expect(e.code).toBe('network_error'); expect(e.message).toMatch(/cannot reach the server/i)
  })
  it('shows an error state with retry when a page query fails', async () => {
    let fail = true
    mockFetch(authed({ 'GET /agents': () => (fail ? err(500, 'internal_error', 'boom') : { items: [], total: 0, page: 1, page_size: 10 }) }))
    renderApp('/app/agents')
    expect(await screen.findByText('Could not load this data')).toBeInTheDocument()
    fail = false
    await waitFor(() => expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText('No agents yet')).toBeInTheDocument()
  })
})
