import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Logo } from '../components/ui/Logo'
import { authed, mockFetch, renderApp } from './utils'

const AGENT = { id: 'a1', name: 'Support Bot', description: 'd', system_instructions: '', model: 'gpt-4o-mini', temperature: 0.2, max_steps: 6, enabled: true, tool_keys: ['builtin:order_lookup'], execution_count: 3, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }
const EMPTY = { period_days: 7, total_agents: 0, active_agents: 0, executions_in_period: 0, completed: 0, failed: 0, cancelled: 0, in_progress: 0, agent_usage: [], daily: [], recent_executions: [] }

const realMatchMedia = window.matchMedia
const asDesktop = () => { window.matchMedia = (q) => ({ matches: q.includes('1024'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) }
afterEach(() => { window.matchMedia = realMatchMedia; localStorage.clear() })

describe('palette', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/index.css'), 'utf8')
  it('uses exactly the requested light and dark colours as design tokens', () => {
    const light = css.slice(css.indexOf(':root {'), css.indexOf('.dark {'))
    const dark = css.slice(css.indexOf('.dark {'), css.indexOf('html { color-scheme'))
    const rgb = (hex) => hex.match(/\w\w/g).map((h) => parseInt(h, 16)).join(' ')
    for (const hex of ['fcfdfd', 'edeff3', 'c6d1d7', '9fa0b5', '2f7eda', '555663']) expect(light).toContain(rgb(hex))
    for (const hex of ['e0e0e1', 'a6a5a2', 'd26e41', '655b55', '322628', '0a181e']) expect(dark).toContain(rgb(hex))
  })
  it('declares the custom brand font and inverts the logo in dark mode', () => {
    expect(css).toMatch(/@font-face\s*{[^}]*font-family:\s*'Garne'[^}]*\/fonts\/GarneFont\.otf/s)
    expect(css).toMatch(/\.dark\s*{[^}]*--logo-filter:\s*invert\(1\)/s)
    expect(css).toMatch(/\.logo-img\s*{\s*filter:\s*var\(--logo-filter\)/)
  })
})

describe('Logo', () => {
  it('shows the logo image and the NEXIS wordmark in the brand font', () => {
    const { container } = render(<Logo />)
    const img = container.querySelector('img.logo-img')
    expect(img).toHaveAttribute('src', '/brand/nexis-logo.svg')
    const word = screen.getByText('NEXIS'); expect(word).toHaveClass('font-brand')
  })
  it('keeps just the wordmark when the logo file is missing (no invented logo)', () => {
    const { container } = render(<Logo />)
    fireEvent.error(container.querySelector('img'))
    expect(container.querySelector('img')).toBeNull(); expect(screen.getByText('NEXIS')).toBeInTheDocument()
  })
})

describe('desktop sidebar', () => {
  it('is open by default, pushes content right, and collapses/expands on toggle (preference persisted)', async () => {
    asDesktop(); mockFetch(authed({ 'GET /dashboard/summary': EMPTY }))
    const { container } = renderApp('/app/dashboard')
    const root = await waitFor(() => { const r = container.querySelector('[data-sidebar]'); expect(r).not.toBeNull(); return r })
    expect(root).toHaveAttribute('data-sidebar', 'open')
    const aside = screen.getByRole('complementary', { name: 'Navigation drawer' })
    expect(aside).toHaveClass('translate-x-0'); expect(root.querySelector('main').parentElement).toHaveClass('lg:pl-64')
    const header = container.querySelector('header')  // the sidebar has its own close button, hidden on desktop via CSS (jsdom has no CSS)
    await userEvent.click(within(header).getByRole('button', { name: 'Close navigation' }))
    expect(root).toHaveAttribute('data-sidebar', 'closed')
    expect(screen.getByLabelText('Navigation drawer')).toHaveClass('-translate-x-full')
    expect(root.querySelector('main').parentElement).toHaveClass('lg:pl-0')  // content is centred again
    expect(localStorage.getItem('nexis-sidebar')).toBe('closed')
    await userEvent.click(within(header).getByRole('button', { name: 'Open navigation' }))
    expect(root).toHaveAttribute('data-sidebar', 'open'); expect(localStorage.getItem('nexis-sidebar')).toBe('open')
  })
  it('remembers a closed sidebar and never leaves hidden links tabbable', async () => {
    asDesktop(); localStorage.setItem('nexis-sidebar', 'closed'); mockFetch(authed({ 'GET /dashboard/summary': EMPTY }))
    const { container } = renderApp('/app/dashboard')
    await waitFor(() => expect(container.querySelector('[data-sidebar]')).toHaveAttribute('data-sidebar', 'closed'))
    expect(screen.getByLabelText('Navigation drawer')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByLabelText('Navigation drawer').inert).toBe(true)
  })
})

describe('row action menu (the 3-dots fix)', () => {
  it('opens in a portal outside the table, so the agent container never grows a scrollbar', async () => {
    mockFetch(authed({ 'GET /agents': { items: [AGENT], total: 1, page: 1, page_size: 10 } }))
    renderApp('/app/agents')
    await userEvent.click(await screen.findByRole('button', { name: /actions for support bot/i }))
    const menu = await screen.findByRole('menu')
    expect(menu.parentElement).toBe(document.body)            // portal: escapes every overflow container
    expect(menu.closest('table')).toBeNull(); expect(menu.closest('.overflow-x-auto')).toBeNull()
    expect(menu.style.position).toBe('fixed')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Open', 'Duplicate', 'Delete'])
  })
  it('supports keyboard (arrows, Escape returns focus) and closes on outside click', async () => {
    mockFetch(authed({ 'GET /agents': { items: [AGENT], total: 1, page: 1, page_size: 10 } }))
    renderApp('/app/agents')
    const trigger = await screen.findByRole('button', { name: /actions for support bot/i })
    await userEvent.click(trigger)
    const items = within(await screen.findByRole('menu')).getAllByRole('menuitem')
    expect(items[0]).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}'); expect(items[1]).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}{ArrowUp}'); expect(items[2]).toHaveFocus()   // wraps
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument()); expect(trigger).toHaveFocus()
    await userEvent.click(trigger); await screen.findByRole('menu')
    await userEvent.click(document.body)
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })
})

describe('mobile tables', () => {
  it('every cell carries its column label so rows can render as cards on phones', async () => {
    mockFetch(authed({ 'GET /agents': { items: [AGENT], total: 1, page: 1, page_size: 10 } }))
    const { container } = renderApp('/app/agents')
    await screen.findByText('Support Bot')
    const labels = [...container.querySelectorAll('tbody tr td')].map((td) => td.getAttribute('data-label'))
    expect(labels).toEqual(['Name', 'Model', 'Tools', 'Runs', 'Status', ''])  // actions column has no label
    expect(container.querySelector('table')).toHaveClass('table-stack')
  })
})