import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, ShieldQuestion, Square } from 'lucide-react'
import { executionsApi } from '../../services/endpoints'
import { useExecutionStream } from '../../hooks/useExecutionStream'
import { reduceEvents } from '../../lib/executionModel'
import { formatDuration, isTerminal } from '../../lib/utils'
import { Alert, Badge, CopyButton, ErrorState, Skeleton, StatusIndicator } from '../ui/Feedback'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'
import { ExecutionTimeline } from './ExecutionTimeline'
import { ToolCallCard } from './ToolCallCard'

export function ExecutionLive({ executionId, showLink = true }) {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['execution', executionId], queryFn: () => executionsApi.get(executionId) })
  const { events, connection } = useExecutionStream(executionId)
  const m = useMemo(() => reduceEvents(events), [events])
  const exec = q.data

  useEffect(() => {
    if (m.terminalStatus) {
      q.refetch()
      qc.invalidateQueries({ queryKey: ['executions'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); qc.invalidateQueries({ queryKey: ['agents'] })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.terminalStatus])

  const status = m.terminalStatus || (m.pendingApproval ? 'awaiting_approval' : (exec && isTerminal(exec.status) ? exec.status : (events.length > 1 ? 'running' : exec?.status || 'queued')))
  const done = isTerminal(status)

  const [now, setNow] = useState(Date.now())
  useEffect(() => { if (done) return undefined; const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t) }, [done])
  const startedAt = exec?.started_at || exec?.created_at
  const elapsed = done && exec?.duration_ms != null ? exec.duration_ms : startedAt ? Math.max(0, now - new Date(startedAt + (startedAt.endsWith('Z') || startedAt.includes('+') ? '' : 'Z')).getTime()) : null

  const cancel = useMutation({ mutationFn: () => executionsApi.cancel(executionId),
    onSuccess: () => toast.info('Cancellation requested'), onError: (e) => toast.error(e.message) })
  const decide = useMutation({ mutationFn: (approve) => executionsApi.decide(executionId, approve),
    onSuccess: (_d, approve) => toast.info(approve ? 'Approved. The agent will continue.' : 'Denied. The action will be skipped.'),
    onError: (e) => toast.error(e.message) })

  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-10" /><Skeleton className="h-40" /></div>
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} title="Could not load execution" />

  const finalText = done && exec?.result ? exec.result : m.text
  return (
    <div className="space-y-5" data-testid="execution-live">
      <div className="flex flex-wrap items-center gap-2">
        <StatusIndicator status={status} />
        <span className="text-sm text-muted" aria-label="Duration">{formatDuration(elapsed)}</span>
        {connection === 'polling' && <Badge>Polling updates</Badge>}
        <div className="ml-auto flex gap-2">
          {showLink && <Link to={`/app/executions/${executionId}`} className="inline-flex h-8 items-center gap-1.5 rounded border border-border px-3 text-sm hover:bg-surface-2"><ExternalLink className="h-3.5 w-3.5" />Details</Link>}
          {!done && <Button size="sm" variant="danger-outline" onClick={() => cancel.mutate()} loading={cancel.isPending}><Square className="h-3.5 w-3.5" />Cancel</Button>}
        </div>
      </div>

      {m.pendingApproval && (
        <div role="alertdialog" aria-label="Approval required" className="rounded-lg border border-warning/40 bg-warning/10 p-4">
          <div className="flex items-start gap-3">
            <ShieldQuestion className="mt-0.5 h-5 w-5 text-warning" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">Approve action: <span className="font-mono">{m.pendingApproval.tool}</span></p>
              <p className="mt-0.5 text-sm text-muted">The agent wants to run a sensitive tool. Review the arguments below.</p>
              <pre className="mt-2 max-h-48 overflow-auto rounded bg-surface p-2 font-mono text-xs">{JSON.stringify(m.pendingApproval.arguments, null, 2)}</pre>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => decide.mutate(true)} loading={decide.isPending}>Approve</Button>
                <Button size="sm" variant="secondary" onClick={() => decide.mutate(false)} disabled={decide.isPending}>Deny</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {status === 'failed' && <Alert tone="danger" title="Execution failed">{exec?.error || 'The run failed. See the timeline for details.'}</Alert>}
      {status === 'cancelled' && <Alert tone="info">This execution was cancelled.</Alert>}

      <section aria-label="Final response" className="card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h3 className="text-sm font-semibold">Final response</h3>
          {finalText && done && <CopyButton value={finalText} label="Copy output" />}
        </div>
        <div className="min-h-[3.5rem] whitespace-pre-wrap break-words px-4 py-3 text-sm leading-relaxed" aria-live="polite">
          {finalText || <span className="text-muted">{done ? 'No output was produced.' : 'The response will appear here as it is produced…'}</span>}
        </div>
      </section>

      {m.toolCalls.length > 0 && (
        <section aria-label="Tool calls" className="space-y-3">
          <h3 className="text-sm font-semibold">Tool calls</h3>
          {m.toolCalls.map((c) => <ToolCallCard key={c.callId} call={c} />)}
        </section>
      )}

      <section aria-label="Event timeline" className="card p-4">
        <h3 className="mb-3 text-sm font-semibold">Event timeline</h3>
        <ExecutionTimeline timeline={m.timeline} />
      </section>
    </div>
  )
}