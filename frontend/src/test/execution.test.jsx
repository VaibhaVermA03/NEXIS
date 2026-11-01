import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExecutionLive } from '../components/executions/ExecutionLive'
import { parseSSEChunk } from '../lib/sse'
import { reduceEvents, describe as describeEvent } from '../lib/executionModel'
import { authed, endFrame, frame, mockFetch, renderApp, renderWithProviders, sseResponse } from './utils'

const EX = { id: 'ex1', agent_id: 'a1', agent_name: 'Analyst', workflow_id: null, task: 'Summarize sales by region', params: {}, status: 'running', mode: 'live', result: null, error: null, source: 'ui', created_at: '2026-10-24T10:00:00Z', started_at: '2026-10-24T10:00:00Z', finished_at: null, duration_ms: null, pending_approval: null }

const happy = [
  frame(1, 'execution.accepted', {}), frame(2, 'execution.started', {}), frame(3, 'agent.planning', { description: 'Task classification started' }),
  frame(4, 'agent.step.started', { step: 1, description: 'Deciding next action' }),
  frame(5, 'tool.call.requested', { tool: 'generate_report', call_id: 'c1', arguments: { title: 'Sales by region' }, side_effect: 'none' }),
  frame(6, 'tool.execution.started', { tool: 'generate_report', call_id: 'c1' }),
  frame(7, 'tool.execution.completed', { tool: 'generate_report', call_id: 'c1', duration_ms: 12, result_preview: { record_count: 2, title: 'Sales by region' } }),
  frame(8, 'agent.resumed', {}), frame(9, 'agent.response.started', {}),
  frame(10, 'agent.response.delta', { text: 'Sales rose in ' }), frame(11, 'agent.response.delta', { text: 'two regions.' }),
  frame(12, 'execution.completed', { duration_ms: 1800 }), endFrame('completed'),
]

describe('SSE + event model', () => {
  it('parses frames split across chunks and ignores comments/heartbeat-less frames', () => {
    const { messages, rest } = parseSSEChunk('retry: 2000\n\nid: 1\nevent: a\ndata: {"x":1}\n\nid: 2\nevent: b\ndata: {"y"')
    // the 'retry:' preamble carries no data and is dropped; the complete frame is kept; the partial one is buffered
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ id: '1', event: 'a', data: '{"x":1}' })
    expect(rest).toContain('id: 2')
    const second = parseSSEChunk(rest + ':2}\n\n')
    expect(second.messages[0]).toMatchObject({ id: '2', event: 'b', data: '{"y":2}' })
  })

  it('reduces events: dedupes replays, assembles text, groups tool calls, tracks terminal state', () => {
    const evs = [1, 2, 3, 3, 2].map((id) => ({ id, type: 'agent.response.delta', payload: { text: String(id) } }))
    expect(reduceEvents(evs).text).toBe('123')
    const m = reduceEvents(happy.filter((f) => f.startsWith('id:')).map((f) => JSON.parse(f.split('data: ')[1])))
    expect(m.toolCalls).toHaveLength(1); expect(m.toolCalls[0]).toMatchObject({ tool: 'generate_report', status: 'completed', durationMs: 12 })
    expect(m.text).toBe('Sales rose in two regions.'); expect(m.terminalStatus).toBe('completed')
    expect(m.timeline.some((e) => e.type === 'agent.response.delta')).toBe(false)
    expect(describeEvent({ type: 'tool.execution.failed', payload: { tool: 'x' } })).toBe('Tool execution failed: x')
  })
})

describe('execution rendering', () => {
  it('renders real events as timeline + tool cards + final response with copy', async () => {
    mockFetch(authed({ 'GET /executions/ex1': () => ({ ...EX, status: 'completed', result: 'Sales rose in two regions.', duration_ms: 1800 }), 'GET /executions/ex1/stream': () => sseResponse(happy) }))
    renderWithProviders(<ExecutionLive executionId="ex1" />)
    const tl = await screen.findByRole('list', { name: /event timeline/i })
    await waitFor(() => expect(within(tl).getByText('Execution completed')).toBeInTheDocument())
    for (const label of ['Execution accepted', 'Planning: task classification started', 'Tool call requested: generate_report', 'Tool execution started: generate_report', 'Tool execution completed: generate_report', 'Agent resumed', 'Final response started']) expect(within(tl).getByText(label)).toBeInTheDocument()
    const card = screen.getByRole('article', { name: /tool call generate_report/i })
    expect(within(card).getByText(/Arguments/).parentElement).toHaveTextContent('"title": "Sales by region"'); expect(within(card).getByText(/Result preview/).parentElement).toHaveTextContent('"record_count": 2')
    expect(screen.getByLabelText('Final response', { selector: 'section' })).toHaveTextContent('Sales rose in two regions.')
    expect(screen.getByRole('button', { name: /copy output/i })).toBeInTheDocument()
    expect(screen.queryByText(/mock|demo/i)).toBeNull(); expect(screen.getByLabelText('Duration')).toHaveTextContent('1.8 s')
    expect(screen.getByRole('link', { name: /details/i })).toHaveAttribute('href', '/app/executions/ex1')
  })

  it('shows failure state with the persisted error and failed tool call', async () => {
    const evs = [frame(1, 'execution.accepted'), frame(2, 'execution.started'), frame(3, 'tool.call.requested', { tool: 'flaky_api', call_id: 'c9', arguments: {}, mock: false }),
      frame(4, 'tool.execution.failed', { tool: 'flaky_api', call_id: 'c9', code: 'timeout', message: 'Request timed out after 10s' }), frame(5, 'execution.failed', { code: 'openai_rate_limited', message: 'OpenAI rate limit or quota reached.' }), endFrame('failed')]
    mockFetch(authed({ 'GET /executions/ex1': { ...EX, status: 'failed', error: 'OpenAI rate limit or quota reached.' }, 'GET /executions/ex1/stream': () => sseResponse(evs) }))
    renderWithProviders(<ExecutionLive executionId="ex1" />)
    expect(await screen.findByText('Execution failed', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getAllByText(/OpenAI rate limit or quota reached/).length).toBeGreaterThan(0)
    expect(within(screen.getByRole('article', { name: /flaky_api/ })).getByRole('alert')).toHaveTextContent('timeout')
    expect(screen.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument()
  })

  it('cancelled runs show the cancelled state and no cancel button', async () => {
    mockFetch(authed({ 'GET /executions/ex1': { ...EX, status: 'cancelled', error: 'Cancelled by user' }, 'GET /executions/ex1/stream': () => sseResponse([frame(1, 'execution.accepted'), frame(2, 'execution.cancelled', {}), endFrame('cancelled')]) }))
    renderWithProviders(<ExecutionLive executionId="ex1" />)
    expect(await screen.findByText('This execution was cancelled.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument()
  })

  it('a running execution can be cancelled via the API', async () => {
    const f = mockFetch(authed({ 'GET /executions/ex1': EX, 'POST /executions/ex1/cancel': { ...EX, status: 'running' }, 'GET /executions/ex1/stream': () => sseResponse([frame(1, 'execution.accepted'), frame(2, 'execution.started')]) }))
    renderWithProviders(<ExecutionLive executionId="ex1" />)
    await userEvent.click(await screen.findByRole('button', { name: /cancel/i }))
    await waitFor(() => expect(f.to('POST', '/executions/ex1/cancel')).toHaveLength(1))
  })

  it('approval gate: shows the arguments and posts the decision', async () => {
    const evs = [frame(1, 'execution.accepted'), frame(2, 'execution.started'), frame(3, 'tool.call.requested', { tool: 'create_ticket', call_id: 'c2', arguments: { title: 'Refund order' }, requires_approval: true, mock: true }),
      frame(4, 'approval.required', { approval_id: 'ap1', tool: 'create_ticket', arguments: { title: 'Refund order' }, timeout_seconds: 120 })]
    const f = mockFetch(authed({ 'GET /executions/ex1': { ...EX, status: 'awaiting_approval' }, 'GET /executions/ex1/stream': () => sseResponse(evs), 'POST /executions/ex1/approval': { ...EX } }))
    renderWithProviders(<ExecutionLive executionId="ex1" />)
    const box = await screen.findByRole('alertdialog', { name: /approval required/i })
    expect(within(box).getByText(/Refund order/)).toBeInTheDocument(); expect(screen.getByText('Needs approval')).toBeInTheDocument()
    await userEvent.click(within(box).getByRole('button', { name: /^deny$/i }))
    await waitFor(() => expect(f.to('POST', '/executions/ex1/approval')[0]?.body).toEqual({ approve: false }))
  })

  it('reconnects with Last-Event-ID and does not duplicate replayed events', async () => {
    let call = 0
    const f = mockFetch(authed({ 'GET /executions/ex1': { ...EX, status: 'completed', result: 'ok' },
      'GET /executions/ex1/stream': () => (++call === 1 ? sseResponse([frame(1, 'execution.accepted'), frame(2, 'execution.started')]) : sseResponse([frame(2, 'execution.started'), frame(3, 'execution.completed'), endFrame()])) }))
    renderWithProviders(<ExecutionLive executionId="ex1" />)
    const tl = await screen.findByRole('list', { name: /event timeline/i })
    await waitFor(() => expect(within(tl).getByText('Execution completed')).toBeInTheDocument(), { timeout: 4000 })
    expect(within(tl).getAllByText('Execution started')).toHaveLength(1)
    expect(f.calls.filter((c) => c.path === '/executions/ex1/stream').length).toBeGreaterThanOrEqual(2)
  })

  it('shows an error state when the execution does not exist', async () => {
    mockFetch(authed({ 'GET /executions/nope': [404, { error: { code: 'not_found', message: 'Execution not found' } }], 'GET /executions/nope/stream': [404, { error: { code: 'not_found', message: 'x' } }] }))
    renderWithProviders(<ExecutionLive executionId="nope" />)
    expect(await screen.findByText('Could not load execution')).toBeInTheDocument()
  })
})

describe('terminal run form', () => {
  const agents = { items: [{ id: 'a1', name: 'Analyst', enabled: true, tool_keys: [] }], total: 1, page: 1, page_size: 100 }
  const AI = { google_enabled: false, openai_enabled: true, email_delivery_enabled: false, environment: 'test' }

  it('runs real tasks only: no mock mode, no example chips, and no "mode" is sent', async () => {
    const f = mockFetch(authed({ 'GET /auth/config': AI, 'GET /agents': agents, 'POST /executions': [202, EX], 'GET /executions': { items: [], total: 0 }, 'GET /executions/ex1': EX, 'GET /executions/ex1/stream': () => sseResponse([frame(1, 'execution.accepted')]) }))
    renderApp('/app/executions')
    await userEvent.click(await screen.findByRole('combobox', { name: /^Agent/ }))
    await userEvent.click(await screen.findByRole('option', { name: 'Analyst' }))
    await userEvent.type(screen.getByLabelText(/^Task/), 'Summarize sales by region')
    expect(screen.queryByRole('combobox', { name: 'Model mode' })).toBeNull(); expect(screen.queryByText(/try an example/i)).toBeNull(); expect(screen.queryByText('AI is not configured')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^run$/i }))
    await waitFor(() => expect(f.to('POST', '/executions')).toHaveLength(1))
    expect(f.to('POST', '/executions')[0].body).toEqual({ agent_id: 'a1', task: 'Summarize sales by region', params: {} })
    expect(await screen.findByTestId('execution-live')).toBeInTheDocument()
  })

  it('without an OpenAI key on the server it says so and blocks Run (never fakes an answer)', async () => {
    const f = mockFetch(authed({ 'GET /agents': agents, 'GET /executions': { items: [], total: 0 } }))   // default config: openai_enabled = false
    renderApp('/app/executions')
    expect(await screen.findByText('AI is not configured')).toBeInTheDocument()
    const run = screen.getByRole('button', { name: /^run$/i }); expect(run).toBeDisabled()
    await userEvent.click(run); expect(f.to('POST', '/executions')).toHaveLength(0)
  })

  it('requires a task and an agent', async () => {
    const f = mockFetch(authed({ 'GET /auth/config': AI, 'GET /agents': agents, 'GET /executions': { items: [], total: 0 } }))
    renderApp('/app/executions')
    await userEvent.click(await screen.findByRole('button', { name: /^run$/i }))
    expect(await screen.findByText('Enter a task first.')).toBeInTheDocument(); expect(f.to('POST', '/executions')).toHaveLength(0)
  })

  it('points to the Agents page when there is no enabled agent yet', async () => {
    mockFetch(authed({ 'GET /auth/config': AI, 'GET /agents': { items: [], total: 0, page: 1, page_size: 100 }, 'GET /executions': { items: [], total: 0 } }))
    renderApp('/app/executions')
    expect(await screen.findByText(/no enabled agents yet/i)).toBeInTheDocument()
  })
})