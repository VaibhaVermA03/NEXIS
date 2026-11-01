import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { authed, err, mockFetch, renderApp } from './utils'

const TOOLS = [
  { key: 'builtin:generate_report', kind: 'builtin', name: 'generate_report', description: 'Summarize structured rows', available: true, requires_approval: false, side_effect: 'none', input_schema: {}, timeout_seconds: 10, enabled: true },
  { key: 'builtin:http_request', kind: 'builtin', name: 'http_request', description: 'HTTP GET/POST to a public API', available: true, requires_approval: false, side_effect: 'external', input_schema: {}, timeout_seconds: 15, enabled: true },
  { key: 'builtin:web_search', kind: 'builtin', name: 'web_search', description: 'Search', available: false, unavailable_reason: 'Not configured: set TAVILY_API_KEY', requires_approval: false, side_effect: 'none', input_schema: {}, timeout_seconds: 10, enabled: true },
]
const AGENT = { id: 'a1', name: 'Support Bot', description: 'd', system_instructions: 'Be nice', model: 'gpt-4o-mini', temperature: 0.2, max_steps: 6, enabled: true, tool_keys: ['builtin:generate_report'], execution_count: 0, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }

describe('agent creation and editing', () => {
  it('validates the name, then creates an agent with the selected tools', async () => {
    const f = mockFetch(authed({ 'GET /agents': { items: [], total: 0, page: 1, page_size: 10 }, 'GET /tools': TOOLS, 'POST /agents': [201, { ...AGENT, id: 'new1', name: 'Fresh' }], 'GET /agents/new1': { ...AGENT, id: 'new1', name: 'Fresh' }, 'GET /auth/config': { openai_enabled: false } }))
    renderApp('/app/agents/new')
    const dlg = await screen.findByRole('dialog', { name: /new agent/i })
    await within(dlg).findByLabelText(/Name/)
    await userEvent.click(within(dlg).getByRole('button', { name: /create agent/i }))
    expect(await screen.findByText('Name is required')).toBeInTheDocument()
    expect(f.to('POST', '/agents')).toHaveLength(0)
    await userEvent.type(within(dlg).getByLabelText(/Name/), 'Fresh')
    await userEvent.click(await within(dlg).findByLabelText(/generate_report/))
    await userEvent.click(within(dlg).getByLabelText(/http_request/))
    await userEvent.click(within(dlg).getByRole('button', { name: /create agent/i }))
    await waitFor(() => expect(f.to('POST', '/agents')).toHaveLength(1))
    const body = f.to('POST', '/agents')[0].body
    expect(body).toMatchObject({ name: 'Fresh', model: 'gpt-4o-mini', max_steps: 6, enabled: true })
    expect(body.tool_keys.sort()).toEqual(['builtin:generate_report', 'builtin:http_request'])
    expect(await screen.findByRole('heading', { name: 'Fresh' })).toBeInTheDocument()
  })

  it('unavailable tools are disabled with a visible reason; write tools carry a "Needs approval" badge; nothing is labelled mock', async () => {
    const WRITE = { key: 'custom:t9', kind: 'custom', id: 't9', name: 'create_ticket', description: 'Creates a ticket', method: 'POST', url: 'https://api.example.com/t', auth_mode: 'none', auth_name: null, headers: {}, has_secret: false, input_schema: { type: 'object', properties: {} }, timeout_seconds: 10, enabled: true, available: true, side_effect: 'external', requires_approval: true }
    mockFetch(authed({ 'GET /agents': { items: [], total: 0, page: 1, page_size: 10 }, 'GET /tools': [...TOOLS, WRITE] }))
    renderApp('/app/agents/new')
    expect(await screen.findByLabelText(/web_search/)).toBeDisabled()
    expect(screen.getByText(/TAVILY_API_KEY/)).toBeInTheDocument()
    expect(screen.getByText('Needs approval')).toBeInTheDocument(); expect(screen.queryByText(/mock/i)).toBeNull()
  })

  it('shows a conflict error from the server', async () => {
    mockFetch(authed({ 'GET /agents': { items: [], total: 0, page: 1, page_size: 10 }, 'GET /tools': TOOLS, 'POST /agents': err(409, 'name_taken', 'You already have an agent with this name') }))
    renderApp('/app/agents/new')
    const dlg = await screen.findByRole('dialog', { name: /new agent/i })
    await userEvent.type(await within(dlg).findByLabelText(/Name/), 'Dup')
    await userEvent.click(within(dlg).getByRole('button', { name: /create agent/i }))
    expect(await screen.findByText('You already have an agent with this name')).toBeInTheDocument()
  })

  it('edits an existing agent and sends only through PATCH', async () => {
    const f = mockFetch(authed({ 'GET /tools': TOOLS, 'GET /agents/a1': AGENT, 'PATCH /agents/a1': { ...AGENT, name: 'Renamed' } }))
    renderApp('/app/agents/a1')
    await userEvent.click(await screen.findByRole('tab', { name: 'Configuration' }))
    const name = await screen.findByLabelText(/Name/)
    expect(name).toHaveValue('Support Bot')
    await userEvent.clear(name); await userEvent.type(name, 'Renamed')
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /save agent/i }))
    await waitFor(() => expect(f.to('PATCH', '/agents/a1')).toHaveLength(1))
    expect(f.to('PATCH', '/agents/a1')[0].body.name).toBe('Renamed')
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument())
  })

  it('deleting asks for confirmation first', async () => {
    const f = mockFetch(authed({ 'GET /agents': { items: [AGENT], total: 1, page: 1, page_size: 10 }, 'DELETE /agents/a1': [204, null] }))
    renderApp('/app/agents')
    await userEvent.click(await screen.findByRole('button', { name: /actions for support bot/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /delete/i }))
    const dlg = await screen.findByRole('dialog'); expect(f.to('DELETE', '/agents/a1')).toHaveLength(0)
    await userEvent.click(within(dlg).getByRole('button', { name: /delete agent/i }))
    await waitFor(() => expect(f.to('DELETE', '/agents/a1')).toHaveLength(1))
  })
})

describe('tool registry', () => {
  const custom = { key: 'custom:t1', kind: 'custom', id: 't1', name: 'get_weather', description: 'Weather', method: 'GET', url: 'https://api.example.com/w', auth_mode: 'bearer', auth_name: null, headers: {}, has_secret: true, input_schema: { type: 'object', properties: {} }, timeout_seconds: 10, enabled: true, available: true, side_effect: 'none', requires_approval: false }

  it('lists built-ins with honest availability and custom tools with masked secret state', async () => {
    mockFetch(authed({ 'GET /tools': [...TOOLS, custom] }))
    renderApp('/app/tools')
    expect(await screen.findByText('generate_report')).toBeInTheDocument(); expect(screen.queryByText('Mock')).toBeNull()
    expect(screen.getByText(/Not configured: set TAVILY_API_KEY/)).toBeInTheDocument()
    expect(screen.getByText(/bearer · secret set/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/secret_value|ciphertext/)
  })

  it('validates JSON schema and header fields client-side before submit', async () => {
    const f = mockFetch(authed({ 'GET /tools': TOOLS }))
    renderApp('/app/tools')
    await userEvent.click(await screen.findByRole('button', { name: /add custom tool/i }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.type(within(dlg).getByLabelText(/^Name/), 'BAD NAME')
    await userEvent.type(within(dlg).getByLabelText(/Description/), 'Does a thing')
    const schema = within(dlg).getByLabelText(/Input schema/); await userEvent.clear(schema); await userEvent.click(schema); await userEvent.paste('{not json')
    await userEvent.click(within(dlg).getByRole('button', { name: /create tool/i }))
    expect(await within(dlg).findByText(/snake_case/)).toBeInTheDocument(); expect(within(dlg).getByText('Must be a valid JSON object')).toBeInTheDocument()
    expect(f.to('POST', '/tools')).toHaveLength(0)
  })

  it('creates a tool with a write-only secret and parsed JSON payload; surfaces server SSRF rejection', async () => {
    let n = 0
    const f = mockFetch(authed({ 'GET /tools': TOOLS, 'POST /tools': () => (++n === 1 ? err(422, 'invalid_tool', 'Destination host is not allowed') : [201, custom] ) }))
    renderApp('/app/tools')
    await userEvent.click(await screen.findByRole('button', { name: /add custom tool/i }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.type(within(dlg).getByLabelText(/^Name/), 'get_weather'); await userEvent.type(within(dlg).getByLabelText(/Description/), 'Weather lookup')
    await userEvent.clear(within(dlg).getByLabelText(/Endpoint URL/)); await userEvent.type(within(dlg).getByLabelText(/Endpoint URL/), 'https://localhost/x')
    await userEvent.click(within(dlg).getByRole('combobox', { name: 'Authentication' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Bearer token' }))
    await userEvent.type(within(dlg).getByLabelText(/^Secret/), 'TOKEN-123')
    await userEvent.click(within(dlg).getByRole('button', { name: /create tool/i }))
    expect(await within(dlg).findByText('Destination host is not allowed')).toBeInTheDocument()
    await userEvent.click(within(dlg).getByRole('button', { name: /create tool/i }))
    await waitFor(() => expect(f.to('POST', '/tools')).toHaveLength(2))
    const body = f.to('POST', '/tools')[1].body
    expect(body).toMatchObject({ name: 'get_weather', auth_mode: 'bearer', secret_value: 'TOKEN-123', headers: {}, input_schema: { type: 'object' } })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('editing never pre-fills the stored secret and omits it unless replaced', async () => {
    const f = mockFetch(authed({ 'GET /tools': [...TOOLS, custom], 'PATCH /tools/t1': custom }))
    renderApp('/app/tools')
    await userEvent.click(await screen.findByRole('button', { name: /actions for get_weather/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /edit/i }))
    const dlg = await screen.findByRole('dialog')
    const secret = within(dlg).getByLabelText(/Replace secret/); expect(secret).toHaveValue('')
    expect(within(dlg).getByLabelText('Remove stored secret')).toBeInTheDocument()
    await userEvent.click(within(dlg).getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(f.to('PATCH', '/tools/t1')).toHaveLength(1))
    expect(f.to('PATCH', '/tools/t1')[0].body).not.toHaveProperty('secret_value')
  })

  it('test dialog runs a real test and shows both success and structured failure', async () => {
    let n = 0
    const f = mockFetch(authed({ 'GET /tools': [...TOOLS, custom], 'POST /tools/t1/test': () => (++n === 1 ? { ok: true, duration_ms: 42, result: { status_code: 200, json: { temp: 21 } }, error: null } : { ok: false, duration_ms: 3, result: null, error: { code: 'url_blocked', message: 'Destination resolves to a non-public network address' } }) }))
    renderApp('/app/tools')
    await userEvent.click(await screen.findByRole('button', { name: /actions for get_weather/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /test/i }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.click(within(dlg).getByRole('button', { name: /run test/i }))
    expect(await within(dlg).findByText(/Success in 42 ms/)).toBeInTheDocument(); expect(within(dlg).getByText(/"temp": 21/)).toBeInTheDocument()
    await userEvent.click(within(dlg).getByRole('button', { name: /run test/i }))
    expect(await within(dlg).findByText(/url_blocked/)).toBeInTheDocument()
    expect(f.to('POST', '/tools/t1/test')[0].body).toEqual({ arguments: {}, confirm_side_effects: false })
  })
})

describe('api keys: display once', () => {
  const key = { id: 'k1', name: 'CI', prefix: 'nx_ab12cd34', scopes: ['executions:read', 'executions:write'], created_at: '2026-10-01T00:00:00Z', last_used_at: null, revoked_at: null }
  const FULL = 'nx_ab12cd34_SUPERSECRETVALUE0123456789abcdefghijk'

  it('shows the full key exactly once and never lists it afterwards', async () => {
    let created = false
    const f = mockFetch(authed({ 'GET /api-keys': () => (created ? [key] : []), 'POST /api-keys': () => { created = true; return [201, { ...key, key: FULL }] } }))
    renderApp('/app/api-keys')
    await userEvent.click((await screen.findAllByRole('button', { name: /create key/i }))[0])
    const dlg = await screen.findByRole('dialog')
    await userEvent.click(within(dlg).getByRole('button', { name: /create key/i }))
    expect(await within(dlg).findByText('Name is required')).toBeInTheDocument()
    await userEvent.type(within(dlg).getByLabelText('Name'), 'CI')
    await userEvent.click(within(dlg).getByRole('button', { name: /create key/i }))
    expect(await screen.findByTestId('api-key-secret')).toHaveTextContent(FULL)
    expect(f.to('POST', '/api-keys')[0].body).toEqual({ name: 'CI', scopes: ['executions:read', 'executions:write'] })
    expect(screen.getByText(/only time the full key is shown/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /i have saved it/i }))
    await waitFor(() => expect(screen.queryByTestId('api-key-secret')).not.toBeInTheDocument())
    expect(await screen.findByText('nx_ab12cd34_••••••••')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('SUPERSECRETVALUE')
  })

  it('revoking requires confirmation and rotation reveals a new key once', async () => {
    const f = mockFetch(authed({ 'GET /api-keys': [key], 'DELETE /api-keys/k1': [204, null], 'POST /api-keys/k1/rotate': { ...key, prefix: 'nx_ffff0000', key: 'nx_ffff0000_NEWSECRET' } }))
    renderApp('/app/api-keys')
    await userEvent.click(await screen.findByRole('button', { name: /actions for ci/i })); await userEvent.click(screen.getByRole('menuitem', { name: /revoke/i }))
    expect(f.to('DELETE', '/api-keys/k1')).toHaveLength(0)
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /revoke key/i }))
    await waitFor(() => expect(f.to('DELETE', '/api-keys/k1')).toHaveLength(1))
    await userEvent.click(await screen.findByRole('button', { name: /actions for ci/i })); await userEvent.click(screen.getByRole('menuitem', { name: /rotate/i }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /rotate key/i }))
    expect(await screen.findByTestId('api-key-secret')).toHaveTextContent('nx_ffff0000_NEWSECRET')
  })
})