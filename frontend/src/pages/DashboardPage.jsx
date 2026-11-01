import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Plus, Play, Sparkles, SquareTerminal, Wrench, XCircle } from 'lucide-react'
import { dashboardApi } from '../services/endpoints'
import { PageHeader } from '../components/layout/AppShell'
import { ButtonLink } from '../components/ui/Button'
import { Select } from '../components/ui/Form'
import { EmptyState, ErrorState, Skeleton, StatusIndicator } from '../components/ui/Feedback'
import { DurationChart, RunsChart, UsageChart } from '../components/charts'
import { formatDuration, timeAgo } from '../lib/utils'

const TILE = { accent: 'bg-accent/10 text-accent', success: 'bg-success/10 text-success', danger: 'bg-danger/10 text-danger' }
export const Stat = ({ label, value, sub, icon: Icon, tone = 'accent' }) => (
  <div className="card p-4 sm:p-5">
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-muted">{label}</p>
      {Icon && <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TILE[tone] || TILE.accent}`}><Icon className="h-[18px] w-[18px]" aria-hidden="true" /></span>}
    </div>
    <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>{sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
  </div>
)

export default function DashboardPage() {
  const [days, setDays] = useState(7)
  const q = useQuery({ queryKey: ['dashboard', 'summary', days], queryFn: () => dashboardApi.summary(days), placeholderData: (prev) => prev })  // keep the page (and this dropdown) mounted while a new period loads
  const actions = (
    <><div className="w-full sm:w-44"><Select aria-label="Time period" value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></Select></div></>
  )
  if (q.isLoading) return (<><PageHeader title="Dashboard" /><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div><Skeleton className="mt-6 h-72" /></>)
  if (q.isError) return <><PageHeader title="Dashboard" /><div className="card"><ErrorState error={q.error} onRetry={q.refetch} /></div></>
  const d = q.data
  const fresh = d.total_agents === 0 && d.executions_in_period === 0
  return (
    <>
      <PageHeader title="Dashboard" description="Live data from your agents and executions." actions={actions} />
      <div className="mb-6 grid gap-3 sm:grid-cols-3" role="group" aria-label="Quick actions">
        <ButtonLink to="/app/agents/new" variant="secondary" className="justify-start"><Plus className="h-4 w-4" />Create agent</ButtonLink>
        <ButtonLink to="/app/executions" variant="secondary" className="justify-start"><Play className="h-4 w-4" />Run task</ButtonLink>
        <ButtonLink to="/app/tools" variant="secondary" className="justify-start"><Wrench className="h-4 w-4" />Add tool</ButtonLink>
      </div>
      {fresh ? (
        <div className="card"><EmptyState icon={Sparkles} title="Welcome to NEXIS" description="You have no agents or executions yet. Create an agent, choose its tools, and run your first task."
          action={<ButtonLink to="/app/agents/new"><Plus className="h-4 w-4" />Create your first agent</ButtonLink>} /></div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Total agents" value={d.total_agents} icon={Sparkles} sub={`${d.active_agents} active`} />
            <Stat label={`Executions (${days}d)`} value={d.executions_in_period} icon={SquareTerminal} sub={d.in_progress ? `${d.in_progress} in progress` : undefined} />
            <Stat label="Successful" value={d.completed} icon={CheckCircle2} tone="success" />
            <Stat label="Failed" value={d.failed} icon={XCircle} tone="danger" sub={d.cancelled ? `${d.cancelled} cancelled` : undefined} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="card min-w-0 overflow-hidden p-4 sm:p-5" aria-label="Executions per day"><h3 className="mb-3 text-sm font-semibold">Executions per day</h3><RunsChart data={d.daily} /></section>
            <section className="card min-w-0 overflow-hidden p-4 sm:p-5" aria-label="Duration"><h3 className="mb-3 text-sm font-semibold">Average duration</h3><DurationChart data={d.daily} /></section>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="card min-w-0 overflow-hidden p-4 sm:p-5" aria-label="Agent usage"><h3 className="mb-3 text-sm font-semibold">Agent usage</h3>
              {d.agent_usage.length ? <UsageChart data={d.agent_usage} /> : <p className="py-10 text-center text-sm text-muted">No agent activity in this period.</p>}</section>
            <section className="card min-w-0 overflow-hidden" aria-label="Recent executions"><div className="flex items-center justify-between border-b border-border px-4 py-3"><h3 className="text-sm font-semibold">Recent executions</h3><Link className="link text-sm" to="/app/executions">View all</Link></div>
              {d.recent_executions.length === 0 ? <p className="py-10 text-center text-sm text-muted">No executions yet.</p> : (
                <ul className="divide-y divide-border">{d.recent_executions.map((e) => (
                  <li key={e.id}><Link to={`/app/executions/${e.id}`} className="flex flex-col items-start gap-2 px-4 py-3 transition-colors hover:bg-surface-2/60 sm:flex-row sm:items-center sm:gap-3">
                    <div className="w-full min-w-0 flex-1 sm:w-auto"><p className="truncate text-sm font-medium">{e.task}</p><p className="mt-0.5 break-words text-xs text-muted">{e.agent_name || 'Workflow'} · {timeAgo(e.created_at)} · {formatDuration(e.duration_ms)}</p></div>
                    <span className="shrink-0"><StatusIndicator status={e.status} /></span></Link></li>))}</ul>)}</section>
          </div>
        </div>)}
    </>
  )
}