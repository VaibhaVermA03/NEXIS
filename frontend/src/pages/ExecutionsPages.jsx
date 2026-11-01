import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, SquareTerminal } from 'lucide-react'
import { agentsApi, executionsApi } from '../services/endpoints'
import { PageHeader } from '../components/layout/AppShell'
import { ExecutionTerminal } from '../components/executions/ExecutionTerminal'
import { ExecutionLive } from '../components/executions/ExecutionLive'
import { Badge, EmptyState, ErrorState, StatusIndicator, TableSkeleton } from '../components/ui/Feedback'
import { Pagination, Table, TD, TH, THead, TR } from '../components/ui/Data'
import { Select } from '../components/ui/Form'
import { formatDate, formatDuration } from '../lib/utils'

export function ExecutionsPage() {
  const [page, setPage] = useState(1); const [status, setStatus] = useState('')
  const agents = useQuery({ queryKey: ['agents', 'all'], queryFn: () => agentsApi.list({ page_size: 100 }) })
  const list = useQuery({ queryKey: ['executions', page, status], queryFn: () => executionsApi.list({ page, page_size: 10, status }), placeholderData: (p) => p })
  return (
    <>
      <PageHeader title="Executions" description="Run tasks interactively and review every past run." />
      <ExecutionTerminal agents={agents.data?.items || []} />
      <section className="card mt-8" aria-label="Execution history">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="font-semibold">History</h3>
          <div className="w-full sm:w-48"><Select aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
            <option value="">All statuses</option>{['completed', 'failed', 'cancelled', 'running', 'awaiting_approval', 'queued'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select></div>
        </div>
        {list.isLoading ? <TableSkeleton /> : list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> : list.data.items.length === 0 ? (
          <EmptyState icon={SquareTerminal} title="No executions yet" description="Run your first task above. Every run is recorded with its full event timeline." />
        ) : (
          <>
            <Table><THead><tr><TH>Task</TH><TH>Agent</TH><TH>Status</TH><TH>Duration</TH><TH>Started</TH></tr></THead><tbody>
              {list.data.items.map((e) => (
                <TR key={e.id}>
                  <TD><Link to={`/app/executions/${e.id}`} className="font-medium hover:text-accent">{e.task.slice(0, 90)}</Link>
                    {e.source === 'api' && <span className="ml-2"><Badge>API</Badge></span>}</TD>
                  <TD className="text-muted">{e.agent_name || (e.workflow_id ? 'Workflow' : '—')}</TD><TD><StatusIndicator status={e.status} /></TD>
                  <TD>{formatDuration(e.duration_ms)}</TD><TD className="text-muted">{formatDate(e.created_at)}</TD>
                </TR>))}
            </tbody></Table>
            <Pagination page={page} pageSize={10} total={list.data.total} onPage={setPage} />
          </>)}
      </section>
    </>
  )
}

export function ExecutionDetailPage() {
  const { executionId } = useParams()
  const q = useQuery({ queryKey: ['execution', executionId], queryFn: () => executionsApi.get(executionId) })
  return (
    <>
      <PageHeader title="Execution" description={q.data ? `${q.data.agent_name || 'Workflow run'} · started ${formatDate(q.data.created_at)}` : undefined}
        back={<Link to="/app/executions" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-text"><ArrowLeft className="h-4 w-4" />Executions</Link>} />
      {q.isError ? <ErrorState error={q.error} onRetry={q.refetch} title={q.error.status === 404 ? 'Execution not found' : undefined} /> : (
        <div className="max-w-4xl space-y-5">
          {q.data && <section className="card p-4"><h3 className="mb-1 text-sm font-semibold">Task</h3><p className="whitespace-pre-wrap text-sm text-muted">{q.data.task}</p></section>}
          <ExecutionLive executionId={executionId} showLink={false} />
        </div>)}
    </>
  )
}