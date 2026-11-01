import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3 } from 'lucide-react'
import { dashboardApi } from '../services/endpoints'
import { PageHeader } from '../components/layout/AppShell'
import { Select } from '../components/ui/Form'
import { EmptyState, ErrorState, Skeleton } from '../components/ui/Feedback'
import { Table, TD, TH, THead, TR } from '../components/ui/Data'
import { DurationChart, RunsChart } from '../components/charts'
import { Stat } from './DashboardPage'
import { formatDuration } from '../lib/utils'

export default function AnalyticsPage() {
  const [days, setDays] = useState(30)
  const q = useQuery({ queryKey: ['dashboard', 'analytics', days], queryFn: () => dashboardApi.analytics(days), placeholderData: (prev) => prev })
  const picker = <div className="w-full sm:w-44"><Select aria-label="Time period" value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></Select></div>
  if (q.isLoading) return <><PageHeader title="Analytics" actions={picker} /><div className="grid gap-4 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div></>
  if (q.isError) return <><PageHeader title="Analytics" actions={picker} /><div className="card"><ErrorState error={q.error} onRetry={q.refetch} /></div></>
  const a = q.data
  return (
    <>
      <PageHeader title="Analytics" description="Computed from your persisted execution records." actions={picker} />
      {a.total === 0 ? <div className="card"><EmptyState icon={BarChart3} title="No executions in this period" description="Run a task and its metrics will appear here." /></div> : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Executions" value={a.total} />
            <Stat label="Success rate" value={a.success_rate === null ? '—' : `${a.success_rate}%`} sub="of finished runs" />
            <Stat label="Avg duration" value={formatDuration(a.avg_duration_ms)} sub="completed runs" />
            <Stat label="p95 duration" value={formatDuration(a.p95_duration_ms)} sub={`p50 ${formatDuration(a.p50_duration_ms)}`} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="card min-w-0 overflow-hidden p-4 sm:p-5" aria-label="Executions per day"><h3 className="mb-3 text-sm font-semibold">Executions per day</h3><RunsChart data={a.daily} /></section>
            <section className="card min-w-0 overflow-hidden p-4 sm:p-5" aria-label="Duration trend"><h3 className="mb-3 text-sm font-semibold">Average duration</h3><DurationChart data={a.daily} /></section>
          </div>
          <section className="card" aria-label="Tool usage"><h3 className="border-b border-border px-4 py-3 text-sm font-semibold">Tool usage</h3>
            {a.tool_usage.length === 0 ? <p className="py-8 text-center text-sm text-muted">No tool calls in this period.</p> : (
              <Table><THead><tr><TH>Tool</TH><TH>Succeeded</TH><TH>Failed</TH></tr></THead><tbody>{a.tool_usage.map((t) => <TR key={t.tool}><TD className="font-mono text-xs">{t.tool}</TD><TD>{t.completed}</TD><TD>{t.failed}</TD></TR>)}</tbody></Table>)}</section>
        </div>)}
    </>
  )
}