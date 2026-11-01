import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { authed, mockFetch, renderApp } from './utils'

const EMPTY = { period_days: 7, total_agents: 0, active_agents: 0, executions_in_period: 0, completed: 0, failed: 0, cancelled: 0, in_progress: 0, agent_usage: [], daily: [], recent_executions: [] }
const FULL = { ...EMPTY, total_agents: 3, active_agents: 2, executions_in_period: 5, completed: 4, failed: 1, agent_usage: [{ agent_id: 'a', name: 'Analyst', executions: 5 }], daily: [{ date: '2026-10-24', total: 5, completed: 4, failed: 1, avg_duration_ms: 1500 }], recent_executions: [{ id: 'e1', task: 'Summarize open tickets', status: 'completed', agent_name: 'Analyst', created_at: new Date().toISOString(), duration_ms: 1500 }] }

describe('dashboard', () => {
  it('shows a meaningful empty state for a new account (no fabricated numbers)', async () => {
    mockFetch(authed({ 'GET /dashboard/summary': EMPTY }))
    renderApp('/app/dashboard')
    expect(await screen.findByText('Welcome to NEXIS')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /create your first agent/i })).toHaveAttribute('href', '/app/agents/new')
    const quick = screen.getByLabelText('Quick actions')
    for (const n of [/create agent/i, /run task/i, /add tool/i]) expect(within(quick).getByRole('link', { name: n })).toBeInTheDocument()
    expect(screen.queryByText('Successful')).not.toBeInTheDocument()
  })
  it('renders real backend numbers and recent executions', async () => {
    mockFetch(authed({ 'GET /dashboard/summary': FULL }))
    renderApp('/app/dashboard')
    expect(await screen.findByText('Total agents')).toBeInTheDocument()
    expect(screen.getByText('2 active')).toBeInTheDocument(); expect(screen.getByText('Successful').closest('div').parentElement).toHaveTextContent('4')
    expect(screen.getByRole('link', { name: /Summarize open tickets/ })).toHaveAttribute('href', '/app/executions/e1')
  })
  it('surfaces a load failure with retry', async () => {
    mockFetch(authed({ 'GET /dashboard/summary': [500, { error: { code: 'internal_error', message: 'boom' } }] }))
    renderApp('/app/dashboard')
    expect(await screen.findByText('Could not load this data')).toBeInTheDocument()
  })
})

describe('responsive navigation', () => {
  it('mobile drawer opens from the hamburger, navigates, and closes', async () => {
    mockFetch(authed({ 'GET /dashboard/summary': EMPTY, 'GET /agents': { items: [], total: 0, page: 1, page_size: 10 } }))
    const { router } = renderApp('/app/dashboard')
    const open = await screen.findByRole('button', { name: /open navigation/i })
    expect(screen.queryByRole('complementary', { name: /navigation drawer/i })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Navigation drawer')).toHaveAttribute('aria-hidden', 'true')  // mounted (for the slide animation) but hidden
    await userEvent.click(open)
    const drawer = await screen.findByRole('complementary', { name: 'Navigation drawer' }); expect(open).toHaveAttribute('aria-expanded', 'true')
    expect(drawer).toHaveAttribute('aria-hidden', 'false')
    for (const n of ['Dashboard', 'Agents', 'Workflows', 'Executions', 'Tool Registry', 'API Keys', 'Analytics', 'Settings']) expect(within(drawer).getByRole('link', { name: n })).toBeInTheDocument()
    await userEvent.click(within(drawer).getByRole('link', { name: 'Agents' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/agents'))
    await waitFor(() => expect(screen.getByLabelText('Navigation drawer')).toHaveAttribute('aria-hidden', 'true'))
  })
  it('close button dismisses the drawer; active route is marked', async () => {
    mockFetch(authed({ 'GET /dashboard/summary': EMPTY }))
    renderApp('/app/dashboard')
    await userEvent.click(await screen.findByRole('button', { name: /open navigation/i }))
    const drawer = await screen.findByRole('complementary', { name: 'Navigation drawer' })
    expect(within(drawer).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(within(drawer).getByRole('button', { name: /close navigation/i }))
    expect(screen.getByLabelText('Navigation drawer')).toHaveAttribute('aria-hidden', 'true')
  })
  it('theme toggle persists the preference locally and sign out returns to login', async () => {
    const f = mockFetch(authed({ 'GET /dashboard/summary': EMPTY, 'POST /auth/logout': [204, null] }))
    renderApp('/app/dashboard')
    await userEvent.click(await screen.findByRole('button', { name: /change theme/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /dark/i }))
    expect(localStorage.getItem('nexis-theme')).toBe('dark'); expect(document.documentElement).toHaveClass('dark')
    expect(Object.keys(localStorage).join()).not.toMatch(/token|auth|session/i)
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /sign out/i }))
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument()
    expect(f.to('POST', '/auth/logout')).toHaveLength(1)
  })
})