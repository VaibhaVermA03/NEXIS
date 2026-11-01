import { Wrench } from 'lucide-react'
import { Badge, StatusIndicator } from '../ui/Feedback'
import { formatDuration } from '../../lib/utils'

const toStatus = { requested: 'queued', running: 'running', completed: 'completed', failed: 'failed' }
const pretty = (v) => { try { return JSON.stringify(v, null, 2) } catch { return String(v) } }

export function ToolCallCard({ call }) {
  return (
    <article className="rounded-lg border border-border bg-surface" aria-label={`Tool call ${call.tool}`}>
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <Wrench className="h-4 w-4 text-muted" aria-hidden="true" />
        <span className="break-all font-mono text-sm font-medium">{call.tool}</span>
        {call.sideEffect === 'external' && <Badge tone="info">Side effects</Badge>}
        <span className="ml-auto flex items-center gap-2">
          {call.durationMs !== undefined && <span className="text-xs text-muted">{formatDuration(call.durationMs)}</span>}
          <StatusIndicator status={toStatus[call.status] || call.status} />
        </span>
      </header>
      <div className="space-y-3 px-4 py-3 text-xs">
        {call.arguments && (<div><p className="mb-1 font-medium text-muted">Arguments</p>
          <pre className="max-h-40 overflow-auto rounded bg-surface-2 p-2 font-mono">{pretty(call.arguments)}</pre></div>)}
        {call.result !== undefined && (<div><p className="mb-1 font-medium text-muted">Result preview</p>
          <pre className="max-h-56 overflow-auto rounded bg-surface-2 p-2 font-mono">{pretty(call.result)}</pre></div>)}
        {call.error && (<div role="alert" className="rounded border border-danger/30 bg-danger/5 p-2 text-danger">
          <span className="font-mono">{call.error.code}</span>: {call.error.message}</div>)}
      </div>
    </article>
  )
}