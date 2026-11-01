import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Select } from '../components/ui/Form'
import { Dialog } from '../components/ui/Overlay'
import { authed, mockFetch, renderApp } from './utils'

const css = readFileSync(resolve(process.cwd(), 'src/styles/index.css'), 'utf8')
const PAGE = (items = []) => ({ items, total: items.length, page: 1, page_size: 10 })
const AGENT = { id: 'a1', name: 'Support Bot', description: 'd', system_instructions: '', model: 'gpt-4o-mini', temperature: 0.2, max_steps: 6, enabled: true, tool_keys: [], execution_count: 3, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }
const WORKFLOW = { id: 'w1', name: 'Triage', description: '', enabled: true, run_count: 0, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', steps: [{ id: 's1', position: 0, agent_id: 'a1', agent_name: 'Support Bot', instruction: 'go' }] }
const TOOL_BUILTIN = { key: 'builtin:generate_report', kind: 'builtin', name: 'generate_report', description: 'Report', available: true, requires_approval: false, side_effect: 'none', input_schema: {}, timeout_seconds: 10, enabled: true }
const TOOL_CUSTOM = { key: 'custom:t1', kind: 'custom', id: 't1', name: 'get_weather', description: 'Weather', method: 'GET', url: 'https://api.example.com/w', auth_mode: 'none', auth_name: null, headers: {}, has_secret: false, input_schema: { type: 'object', properties: {} }, timeout_seconds: 10, enabled: true, available: true, side_effect: 'none', requires_approval: false }
const KEY = { id: 'k1', name: 'CI', prefix: 'nx_ab12cd34', scopes: ['executions:read'], created_at: '2026-10-01T00:00:00Z', last_used_at: null, revoked_at: null }
const SUMMARY = { period_days: 7, total_agents: 0, active_agents: 0, executions_in_period: 0, completed: 0, failed: 0, cancelled: 0, in_progress: 0, agent_usage: [], daily: [], recent_executions: [] }

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top })
const withRect = (el, r) => { el.getBoundingClientRect = () => r }
const realHeight = window.innerHeight
afterEach(() => { Object.defineProperty(window, 'innerHeight', { configurable: true, value: realHeight }) })

function Harness({ onChange, initial = 'b' }) {
  const [v, setV] = useState(initial)
  return (
    <Select label="Pick" value={v} onChange={(e) => { onChange?.(e); setV(e.target.value) }}>
      <option value="a">Alpha</option><option value="b">Beta</option><option value="c" disabled>Gamma</option><option value="d">Delta</option>
    </Select>)
}

// =====================================================================================================
// 1) Dropdowns: parent + list are ONE rounded container, list is exactly as wide as the parent
// =====================================================================================================
describe('dropdown (custom select)', () => {
  it('opens a list that is exactly as wide as the field and joined to it as one rounded container', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('combobox', { name: 'Pick' })
    withRect(trigger, rect(20, 100, 200, 40))
    await userEvent.click(trigger)
    const list = await screen.findByRole('listbox')
    expect(list.style.width).toBe('200px'); expect(list.style.left).toBe('20px'); expect(list.style.top).toBe('140px')   // directly under the field, same width
    expect(list.parentElement).toBe(document.body)                                                                     // never clipped by dialogs/cards
    expect(trigger).toHaveClass('rounded-b-none', 'border-accent'); expect(list).toHaveClass('rounded-b-lg', 'border-t-0', 'border-accent')  // one joined container
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('flips upward (still joined, still same width) when there is no room below', async () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 })
    render(<Harness />)
    const trigger = screen.getByRole('combobox', { name: 'Pick' })
    withRect(trigger, rect(10, 260, 180, 40))
    await userEvent.click(trigger)
    const list = await screen.findByRole('listbox')
    expect(list.style.bottom).toBe('40px'); expect(list.style.top).toBe(''); expect(list.style.width).toBe('180px')
    expect(trigger).toHaveClass('rounded-t-none'); expect(list).toHaveClass('rounded-t-lg', 'border-b-0')
  })

  it('selects with mouse (shows the choice, closes) and ignores disabled options', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const trigger = screen.getByRole('combobox', { name: 'Pick' })
    expect(trigger).toHaveTextContent('Beta')
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('option', { name: 'Gamma' }))
    expect(onChange).not.toHaveBeenCalled(); expect(screen.getByRole('listbox')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('option', { name: 'Alpha' }))
    expect(onChange).toHaveBeenCalledWith({ target: { value: 'a', name: undefined } })
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument()); expect(trigger).toHaveTextContent('Alpha')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('works from the keyboard (skips disabled, Enter selects) and closes on outside click', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('combobox', { name: 'Pick' })
    trigger.focus(); await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('listbox')).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-activedescendant', expect.stringMatching(/-opt-1$/))   // starts on the current value
    await userEvent.keyboard('{ArrowDown}')                                                       // Gamma is disabled → jumps to Delta
    expect(trigger).toHaveAttribute('aria-activedescendant', expect.stringMatching(/-opt-3$/))
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument()); expect(trigger).toHaveTextContent('Delta')
    await userEvent.click(trigger); await screen.findByRole('listbox')
    await userEvent.click(document.body)
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  })

  it('Escape closes only the list, not the popup it lives in', async () => {
    const onClose = vi.fn()
    render(<Dialog open onClose={onClose} title="Popup"><Harness /></Dialog>)
    const trigger = screen.getByRole('combobox', { name: 'Pick' })
    await userEvent.click(trigger); await screen.findByRole('listbox')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled(); expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}'); expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Dashboard "Last 7/30/90 days" dropdown changes the period', async () => {
    const f = mockFetch(authed({ 'GET /dashboard/summary': (req) => ({ ...SUMMARY, period_days: Number(req.query.get('days')) }) }))
    renderApp('/app/dashboard')
    const box = await screen.findByRole('combobox', { name: 'Time period' })
    expect(box).toHaveTextContent('Last 7 days')
    await userEvent.click(box)
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Last 7 days', 'Last 30 days', 'Last 90 days'])
    await userEvent.click(screen.getByRole('option', { name: 'Last 90 days' }))
    await waitFor(() => expect(f.to('GET', '/dashboard/summary').some((c) => c.query.get('days') === '90')).toBe(true))
    expect(box).toHaveTextContent('Last 90 days')
  })

  it('every dropdown you listed is the new component and no native <select> is left', async () => {
    mockFetch(authed({
      'GET /dashboard/summary': SUMMARY, 'GET /dashboard/analytics': { period_days: 30, total: 0, success_rate: null, avg_duration_ms: null, p50_duration_ms: null, p95_duration_ms: null, by_mode: {}, daily: [], tool_usage: [] },
      'GET /agents': PAGE([AGENT]), 'GET /executions': PAGE(), 'GET /workflows': PAGE(), 'GET /tools': [TOOL_BUILTIN],
    }))
    // Dashboard + Analytics: "Last 7/30/90 days"
    let view = renderApp('/app/dashboard')
    expect(await screen.findByRole('combobox', { name: 'Time period' })).toBeInTheDocument(); expect(document.querySelector('select')).toBeNull(); view.unmount()
    view = renderApp('/app/analytics')
    expect(await screen.findByRole('combobox', { name: 'Time period' })).toBeInTheDocument(); expect(document.querySelector('select')).toBeNull(); view.unmount()
    // Executions: "Select an agent" and "All statuses" (the old demo-only "Model mode" dropdown no longer exists)
    view = renderApp('/app/executions')
    expect(await screen.findByRole('combobox', { name: /^Agent/ })).toHaveTextContent('Select an agent')
    expect(screen.queryByRole('combobox', { name: 'Model mode' })).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Filter by status' })).toHaveTextContent('All statuses')
    expect(document.querySelector('select')).toBeNull(); view.unmount()
    // Workflows → Create workflow → "Select agent"
    view = renderApp('/app/workflows')
    await userEvent.click(await screen.findByRole('button', { name: 'Create workflow' }))
    expect(await screen.findByRole('combobox', { name: 'Agent for step 1' })).toHaveTextContent('Select agent'); expect(document.querySelector('select')).toBeNull(); view.unmount()
    // Tool Registry → custom tool form → "HTTP method" and "Authentication"
    view = renderApp('/app/tools')
    await userEvent.click(await screen.findByRole('button', { name: 'Add custom tool' }))
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByRole('combobox', { name: 'HTTP method' })).toHaveTextContent('GET')
    expect(within(dlg).getByRole('combobox', { name: 'Authentication' })).toHaveTextContent('None'); expect(document.querySelector('select')).toBeNull()
  })

  it('the HTTP-method dropdown inside the tool popup opens above the popup and keeps its value in the form', async () => {
    const f = mockFetch(authed({ 'GET /tools': [TOOL_BUILTIN], 'POST /tools': [201, TOOL_CUSTOM] }))
    renderApp('/app/tools')
    await userEvent.click(await screen.findByRole('button', { name: 'Add custom tool' }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.click(within(dlg).getByRole('combobox', { name: 'HTTP method' }))
    const list = await screen.findByRole('listbox'); expect(list.parentElement).toBe(document.body)   // escapes the popup's scroll area
    await userEvent.click(within(list).getByRole('option', { name: 'POST' }))
    await userEvent.type(within(dlg).getByLabelText(/^Name/), 'make_thing'); await userEvent.type(within(dlg).getByLabelText(/Description/), 'Creates a thing')
    await userEvent.clear(within(dlg).getByLabelText(/Endpoint URL/)); await userEvent.type(within(dlg).getByLabelText(/Endpoint URL/), 'https://api.example.com/things')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Create tool' }))
    await waitFor(() => expect(f.to('POST', '/tools')).toHaveLength(1))
    expect(f.to('POST', '/tools')[0].body).toMatchObject({ method: 'POST', auth_mode: 'none', name: 'make_thing' })
  })
})

// =====================================================================================================
// 3) New agent = popup, same as Create workflow
// =====================================================================================================
describe('New agent popup', () => {
  const setup = (extra = {}) => mockFetch(authed({ 'GET /agents': PAGE([AGENT]), 'GET /tools': [TOOL_BUILTIN], 'GET /workflows': PAGE(), ...extra }))

  it('opens as a popup over the agents list and is built exactly like the Create workflow popup', async () => {
    setup()
    const { router } = renderApp('/app/agents')
    await userEvent.click(await screen.findByRole('button', { name: 'New agent' }))
    const agentDlg = await screen.findByRole('dialog', { name: 'New agent' })
    expect(router.state.location.pathname).toBe('/app/agents/new')
    expect(screen.getByRole('heading', { name: 'Agents', level: 2 })).toBeInTheDocument()        // the list stays behind the popup (no separate page)
    expect(within(agentDlg).getByLabelText(/^Name/)).toBeInTheDocument(); expect(within(agentDlg).getByRole('button', { name: 'Create agent' })).toBeInTheDocument()
    await userEvent.click(within(agentDlg).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(router.state.location.pathname).toBe('/app/agents')

    const { router: r2 } = renderApp('/app/workflows')   // same container classes as Create workflow (mobile bottom-sheet + desktop centred)
    await userEvent.click(await screen.findByRole('button', { name: 'Create workflow' }))
    const wfDlg = await screen.findByRole('dialog', { name: 'New workflow' })
    expect(r2.state.location.pathname).toBe('/app/workflows')
    for (const dlg of [agentDlg, wfDlg]) expect(dlg).toHaveClass('sm:max-w-2xl', 'rounded-t-2xl', 'sm:rounded-2xl', 'animate-sheet')
  })

  it('the quick-action / deep link /app/agents/new opens the popup directly', async () => {
    setup()
    renderApp('/app/agents/new')
    expect(await screen.findByRole('dialog', { name: 'New agent' })).toBeInTheDocument()
    expect(await screen.findByText('Support Bot')).toBeInTheDocument()   // list rendered underneath
  })

  it('asks before discarding typed changes, and creating an agent lands on its page', async () => {
    const f = setup({ 'POST /agents': [201, { ...AGENT, id: 'new1', name: 'Fresh' }], 'GET /agents/new1': { ...AGENT, id: 'new1', name: 'Fresh' } })
    const { router } = renderApp('/app/agents/new')
    const dlg = await screen.findByRole('dialog', { name: 'New agent' })
    await userEvent.type(await within(dlg).findByLabelText(/^Name/), 'Fresh')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }))
    const confirm = await screen.findByRole('dialog', { name: /discard unsaved changes/i })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))                // keep editing
    expect(router.state.location.pathname).toBe('/app/agents/new'); expect(screen.getByRole('dialog', { name: 'New agent' })).toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('dialog', { name: 'New agent' })).getByRole('button', { name: 'Create agent' }))
    await waitFor(() => expect(f.to('POST', '/agents')).toHaveLength(1))
    expect(await screen.findByRole('heading', { name: 'Fresh' })).toBeInTheDocument(); expect(router.state.location.pathname).toBe('/app/agents/new1')
  })

  it('the old standalone /app/agents/new page no longer exists as a separate screen', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/routes/index.jsx'), 'utf8')
    expect(src).not.toMatch(/AgentNewPage/); expect(src).toMatch(/agents\/new', element: <AgentsPage/)
  })
})

// =====================================================================================================
// 4) One create button at a time
// =====================================================================================================
describe('no duplicate create buttons', () => {
  it('Agents: empty → only "Create agent"; with agents → only "New agent"', async () => {
    mockFetch(authed({ 'GET /agents': PAGE() }))
    let v = renderApp('/app/agents')
    await screen.findByText('No agents yet')
    expect(screen.queryByRole('button', { name: 'New agent' })).toBeNull(); expect(screen.getAllByRole('button', { name: /create agent/i })).toHaveLength(1); v.unmount()
    mockFetch(authed({ 'GET /agents': PAGE([AGENT]) }))
    v = renderApp('/app/agents')
    expect(await screen.findByRole('button', { name: 'New agent' })).toBeInTheDocument(); expect(screen.queryByRole('button', { name: /create agent/i })).toBeNull()
  })

  it('Workflows: empty → no "New workflow" button (only "Create workflow" below); with workflows → header button returns', async () => {
    mockFetch(authed({ 'GET /workflows': PAGE(), 'GET /agents': PAGE([AGENT]) }))
    let v = renderApp('/app/workflows')
    await screen.findByText('No workflows yet')
    expect(screen.queryByRole('button', { name: /new workflow/i })).toBeNull(); expect(screen.getAllByRole('button', { name: /create workflow/i })).toHaveLength(1); v.unmount()
    mockFetch(authed({ 'GET /workflows': PAGE([WORKFLOW]), 'GET /agents': PAGE([AGENT]) }))
    v = renderApp('/app/workflows')
    expect(await screen.findByRole('button', { name: /new workflow/i })).toBeInTheDocument(); expect(screen.queryByRole('button', { name: /create workflow/i })).toBeNull()
  })

  it('Tool Registry: no custom tools → no "Custom REST tool" header button (only "Add custom tool"); with tools → header returns', async () => {
    mockFetch(authed({ 'GET /tools': [TOOL_BUILTIN] }))
    let v = renderApp('/app/tools')
    await screen.findByText('No custom tools yet')
    expect(screen.queryByRole('button', { name: /custom rest tool/i })).toBeNull(); expect(screen.getAllByRole('button', { name: /add custom tool/i })).toHaveLength(1); v.unmount()
    mockFetch(authed({ 'GET /tools': [TOOL_BUILTIN, TOOL_CUSTOM] }))
    v = renderApp('/app/tools')
    expect(await screen.findByRole('button', { name: /custom rest tool/i })).toBeInTheDocument(); expect(screen.queryByRole('button', { name: /add custom tool/i })).toBeNull()
  })

  it('API Keys: exactly one "Create key" button whether the list is empty or not', async () => {
    mockFetch(authed({ 'GET /api-keys': [] }))
    let v = renderApp('/app/api-keys')
    await screen.findByText('No API keys')
    expect(screen.getAllByRole('button', { name: 'Create key' })).toHaveLength(1); v.unmount()   // before the fix this was 2
    mockFetch(authed({ 'GET /api-keys': [KEY] }))
    v = renderApp('/app/api-keys')
    await screen.findByText('nx_ab12cd34_••••••••')
    expect(screen.getAllByRole('button', { name: 'Create key' })).toHaveLength(1)
  })

  it('a failed load keeps the header button so creating is never impossible', async () => {
    mockFetch(authed({ 'GET /api-keys': [500, { error: { code: 'internal_error', message: 'boom' } }] }))
    renderApp('/app/api-keys')
    expect(await screen.findByText('Could not load this data')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create key' })).toBeInTheDocument()
  })
})

// =====================================================================================================
// 2) Mobile layout guards (jsdom has no layout engine, so these lock in the classes/CSS that fix overflow)
// =====================================================================================================
describe('mobile layout', () => {
  it('Run a task: no demo chips or mock mode; Run is full-width on phones; a missing AI key is explained and blocks Run', async () => {
    const f = mockFetch(authed({ 'GET /agents': PAGE([AGENT]), 'GET /executions': PAGE() }))   // config: openai_enabled = false
    renderApp('/app/executions')
    expect(await screen.findByText('AI is not configured')).toBeInTheDocument()
    expect(screen.queryByText(/try an example/i)).toBeNull(); expect(screen.queryByRole('combobox', { name: 'Model mode' })).toBeNull()
    const run = screen.getByRole('button', { name: /^run$/i })
    expect(run).toHaveClass('w-full', 'sm:w-auto'); expect(run).toBeDisabled()
    await userEvent.click(run); expect(f.to('POST', '/executions')).toHaveLength(0)
  })

  it('Dashboard: recent-execution rows stack on phones and long meta text wraps instead of pushing the badge off-screen', async () => {
    const recent = [{ id: 'e1', task: 'Summarize all open support tickets and list the oldest ones together with their owners', status: 'completed', agent_name: 'Support Analyst', created_at: new Date().toISOString(), duration_ms: 1500 }]
    mockFetch(authed({ 'GET /dashboard/summary': { ...SUMMARY, total_agents: 1, active_agents: 1, executions_in_period: 1, completed: 1, agent_usage: [{ agent_id: 'a', name: 'Support Analyst', executions: 1 }], daily: [{ date: '2026-10-24', total: 1, completed: 1, failed: 0, avg_duration_ms: 1500 }], recent_executions: recent } }))
    renderApp('/app/dashboard')
    const link = await screen.findByRole('link', { name: /Summarize all open support tickets/ })
    expect(link).toHaveClass('flex-col', 'sm:flex-row'); expect(link.querySelectorAll('p')[1]).toHaveClass('break-words')
    expect(link.querySelector('span.shrink-0')).not.toBeNull()
    for (const name of ['Agent usage', 'Recent executions', 'Executions per day']) expect(screen.getByLabelText(name, { selector: 'section' })).toHaveClass('min-w-0', 'overflow-hidden')
  })

  it('global CSS: grid children can shrink, and stacked table cells wrap long text', () => {
    expect(css).toMatch(/\.grid\s*>\s*\*\s*{\s*min-width:\s*0;\s*}/)
    const mobile = css.slice(css.indexOf('@media (max-width: 767px)'), css.indexOf('/* ---------- Motion'))
    expect(mobile).toMatch(/white-space:\s*normal\s*!important/); expect(mobile).toMatch(/overflow-wrap:\s*anywhere/); expect(mobile).toMatch(/\.flex-wrap\s*{\s*justify-content:\s*flex-end/)
  })

  it('selectors in page headers are full width on phones', async () => {
    mockFetch(authed({ 'GET /dashboard/summary': SUMMARY }))
    renderApp('/app/dashboard')
    expect((await screen.findByRole('combobox', { name: 'Time period' })).closest('div.w-full')).toHaveClass('sm:w-44')
  })
})