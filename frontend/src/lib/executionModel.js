// Pure functions turning persisted execution events into UI state. Only backend-emitted events are shown.
const LABELS = {
  'execution.accepted': 'Execution accepted',
  'execution.started': 'Execution started',
  'agent.planning': 'Planning: task classification started',
  'agent.step.started': 'Agent step started',
  'tool.call.requested': 'Tool call requested',
  'approval.required': 'Approval required',
  'approval.granted': 'Approved by you',
  'approval.denied': 'Denied by you',
  'approval.expired': 'Approval timed out',
  'tool.execution.started': 'Tool execution started',
  'tool.execution.completed': 'Tool execution completed',
  'tool.execution.failed': 'Tool execution failed',
  'agent.resumed': 'Agent resumed',
  'agent.response.started': 'Final response started',
  'workflow.step.started': 'Workflow step started',
  'workflow.step.completed': 'Workflow step completed',
  'execution.completed': 'Execution completed',
  'execution.failed': 'Execution failed',
  'execution.cancelled': 'Execution cancelled',
}
const HIDDEN = new Set(['agent.response.delta', 'heartbeat'])

export const TERMINAL_EVENTS = ['execution.completed', 'execution.failed', 'execution.cancelled']

export function describe(ev) {
  const p = ev.payload || {}
  let label = LABELS[ev.type] || ev.type
  if (ev.type === 'agent.step.started') label = `Agent step ${p.step}: ${p.description || 'started'}`
  else if (p.tool && ev.type.startsWith('tool.')) label = `${LABELS[ev.type]}: ${p.tool}`
  else if (ev.type === 'approval.required') label = `Approval required to run ${p.tool}`
  else if (ev.type.startsWith('workflow.step')) label = `${LABELS[ev.type]} ${p.step}/${p.total}${p.agent ? ` (${p.agent})` : ''}`
  else if (ev.type === 'execution.failed') label = `Execution failed${p.message ? `: ${p.message}` : ''}`
  return label
}

export function tone(ev) {
  if (ev.type.endsWith('.failed') || ev.type === 'approval.denied' || ev.type === 'approval.expired') return 'danger'
  if (ev.type.endsWith('.completed') || ev.type === 'approval.granted') return 'success'
  if (ev.type === 'approval.required') return 'warning'
  if (ev.type === 'execution.cancelled') return 'neutral'
  return 'info'
}

export function reduceEvents(events) {
  const seen = new Set()
  const ordered = []
  for (const e of events) { if (!seen.has(e.id)) { seen.add(e.id); ordered.push(e) } }
  ordered.sort((a, b) => a.id - b.id)

  const calls = new Map()
  let text = ''
  let pendingApproval = null
  let terminal = null
  const timeline = []
  for (const ev of ordered) {
    const p = ev.payload || {}
    if (ev.type === 'agent.response.delta') { text += p.text || '' }
    if (!HIDDEN.has(ev.type)) timeline.push(ev)
    if (ev.type === 'tool.call.requested') calls.set(p.call_id, { callId: p.call_id, tool: p.tool, arguments: p.arguments, sideEffect: p.side_effect, status: 'requested', requiresApproval: p.requires_approval })
    const c = calls.get(p.call_id)
    if (c) {
      if (ev.type === 'tool.execution.started') c.status = 'running'
      if (ev.type === 'tool.execution.completed') { c.status = 'completed'; c.result = p.result_preview; c.durationMs = p.duration_ms }
      if (ev.type === 'tool.execution.failed') { c.status = 'failed'; c.error = { code: p.code, message: p.message }; c.durationMs = p.duration_ms }
    } else if (ev.type === 'tool.execution.failed' && p.call_id) {
      calls.set(p.call_id, { callId: p.call_id, tool: p.tool, status: 'failed', error: { code: p.code, message: p.message } })
    }
    if (ev.type === 'approval.required') pendingApproval = { approvalId: p.approval_id, tool: p.tool, arguments: p.arguments, timeoutSeconds: p.timeout_seconds }
    if (['approval.granted', 'approval.denied', 'approval.expired'].includes(ev.type)) pendingApproval = null
    if (TERMINAL_EVENTS.includes(ev.type)) { terminal = ev.type.split('.')[1]; pendingApproval = null }
  }
  return { events: ordered, timeline, toolCalls: [...calls.values()], text, pendingApproval, terminalStatus: terminal,
           lastId: ordered.length ? ordered[ordered.length - 1].id : 0 }
}