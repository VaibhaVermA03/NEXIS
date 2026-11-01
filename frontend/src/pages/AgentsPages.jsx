import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Copy, Ellipsis, Plus, Search, Sparkles, Trash2 } from 'lucide-react'
import { agentsApi, executionsApi } from '../services/endpoints'
import { PageHeader } from '../components/layout/AppShell'
import { AgentForm } from '../components/agents/AgentForm'
import { ExecutionTerminal } from '../components/executions/ExecutionTerminal'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Form'
import { Badge, EmptyState, ErrorState, StatusIndicator, TableSkeleton } from '../components/ui/Feedback'
import { Table, TD, TH, THead, TR, Pagination, Tabs } from '../components/ui/Data'
import { ConfirmDialog, Dialog, Dropdown, DropdownItem } from '../components/ui/Overlay'
import { useToast } from '../components/ui/Toast'
import { formatDate, formatDuration } from '../lib/utils'

export function AgentsPage() {
  const qc = useQueryClient(); const toast = useToast(); const navigate = useNavigate()
  const { pathname } = useLocation()
  const creating = pathname === '/app/agents/new'   // URL-driven: quick actions and deep links open the popup too
  const [page, setPage] = useState(1); const [q, setQ] = useState(''); const [del, setDel] = useState(null)
  const list = useQuery({ queryKey: ['agents', page, q], queryFn: () => agentsApi.list({ page, page_size: 10, q }), placeholderData: (p) => p })
  const remove = useMutation({ mutationFn: (id) => agentsApi.remove(id),
    onSuccess: () => { toast.success('Agent deleted'); setDel(null); qc.invalidateQueries({ queryKey: ['agents'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }) },
    onError: (e) => { toast.error(e.message); setDel(null) } })
  const dup = useMutation({ mutationFn: (id) => agentsApi.duplicate(id),
    onSuccess: (a) => { toast.success(`Created “${a.name}”`); qc.invalidateQueries({ queryKey: ['agents'] }) }, onError: (e) => toast.error(e.message) })
  const toggle = useMutation({ mutationFn: (a) => agentsApi.update(a.id, { enabled: !a.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }), onError: (e) => toast.error(e.message) })

  const openCreate = () => navigate('/app/agents/new')
  const closeCreate = () => navigate('/app/agents')
  const create = async (values) => {
    const a = await agentsApi.create(values)
    qc.invalidateQueries({ queryKey: ['agents'] }); qc.invalidateQueries({ queryKey: ['dashboard'] })
    toast.success('Agent created'); navigate(`/app/agents/${a.id}`)
  }
  // One create button at a time: when the list is empty the empty-state button is the only one.
  const emptyCta = list.isSuccess && list.data.items.length === 0 && !q
  const showHeaderButton = list.isSuccess ? !emptyCta : list.isError

  return (
    <>
      <PageHeader title="Agents" description="Configure agents, grant tools, and run tasks."
        actions={showHeaderButton ? <Button onClick={openCreate}><Plus className="h-4 w-4" />New agent</Button> : undefined} />
      <div className="card">
        <div className="border-b border-border p-4"><div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted" aria-hidden="true" />
          <Input aria-label="Search agents" placeholder="Search agents…" className="pl-9" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} /></div></div>
        {list.isLoading ? <TableSkeleton /> : list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> :
          list.data.items.length === 0 ? (
            <EmptyState icon={Sparkles} title={q ? 'No agents match your search' : 'No agents yet'} description={q ? 'Try a different search term.' : 'Create your first agent, choose its tools, and run a task.'}
              action={!q && <Button onClick={openCreate}><Plus className="h-4 w-4" />Create agent</Button>} />
          ) : (
            <>
              <Table>
                <THead><tr><TH>Name</TH><TH>Model</TH><TH>Tools</TH><TH>Runs</TH><TH>Status</TH><TH><span className="sr-only">Actions</span></TH></tr></THead>
                <tbody>
                  {list.data.items.map((a) => (
                    <TR key={a.id}>
                      <TD><Link to={`/app/agents/${a.id}`} className="font-medium hover:text-accent">{a.name}</Link>
                        {a.description && <p className="max-w-md truncate text-xs text-muted">{a.description}</p>}</TD>
                      <TD className="font-mono text-xs">{a.model}</TD><TD>{a.tool_keys.length}</TD><TD>{a.execution_count}</TD>
                      <TD><button onClick={() => toggle.mutate(a)} className="rounded" aria-label={`${a.enabled ? 'Disable' : 'Enable'} ${a.name}`}><Badge tone={a.enabled ? 'success' : 'neutral'}>{a.enabled ? 'Enabled' : 'Disabled'}</Badge></button></TD>
                      <TD className="text-right">
                        <Dropdown label={`Actions for ${a.name}`} trigger={<span className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2"><Ellipsis className="h-4 w-4" /></span>}>
                          <DropdownItem icon={Sparkles} onClick={() => navigate(`/app/agents/${a.id}`)}>Open</DropdownItem>
                          <DropdownItem icon={Copy} onClick={() => dup.mutate(a.id)}>Duplicate</DropdownItem>
                          <DropdownItem icon={Trash2} danger onClick={() => setDel(a)}>Delete</DropdownItem>
                        </Dropdown>
                      </TD>
                    </TR>))}
                </tbody>
              </Table>
              <Pagination page={page} pageSize={10} total={list.data.total} onPage={setPage} />
            </>)}
      </div>
      <Dialog open={creating} onClose={closeCreate} dismissible={false} size="lg" title="New agent" description="Define behavior, model settings and permitted tools.">
        <AgentForm embedded onSubmit={create} onCancel={closeCreate} submitLabel="Create agent" />
      </Dialog>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => remove.mutate(del.id)} loading={remove.isPending} danger confirmLabel="Delete agent"
        title={`Delete “${del?.name}”?`} message="This permanently removes the agent and its tool permissions. Past executions are kept but will no longer be linked to an agent. Workflows using it will lose those steps." />
    </>
  )
}

export function AgentDetailPage() {
  const { agentId } = useParams(); const qc = useQueryClient(); const toast = useToast(); const navigate = useNavigate()
  const [tab, setTab] = useState('run'); const [confirmDel, setConfirmDel] = useState(false)
  const q = useQuery({ queryKey: ['agent', agentId], queryFn: () => agentsApi.get(agentId) })
  const hist = useQuery({ queryKey: ['executions', 'agent', agentId], queryFn: () => executionsApi.list({ agent_id: agentId, page_size: 20 }), enabled: tab === 'history' })
  const save = async (values) => { const a = await agentsApi.update(agentId, values); qc.setQueryData(['agent', agentId], a); qc.invalidateQueries({ queryKey: ['agents'] }); toast.success('Agent saved') }
  const remove = useMutation({ mutationFn: () => agentsApi.remove(agentId), onSuccess: () => { toast.success('Agent deleted'); qc.invalidateQueries({ queryKey: ['agents'] }); navigate('/app/agents') }, onError: (e) => toast.error(e.message) })
  const dup = useMutation({ mutationFn: () => agentsApi.duplicate(agentId), onSuccess: (a) => { toast.success('Agent duplicated'); qc.invalidateQueries({ queryKey: ['agents'] }); navigate(`/app/agents/${a.id}`) }, onError: (e) => toast.error(e.message) })

  if (q.isLoading) return <TableSkeleton rows={4} />
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} title={q.error.status === 404 ? 'Agent not found' : undefined} />
  const a = q.data
  return (
    <>
      <PageHeader title={<span className="flex flex-wrap items-center gap-2">{a.name}{!a.enabled && <Badge>Disabled</Badge>}</span>} description={a.description}
        back={<Link to="/app/agents" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-text"><ArrowLeft className="h-4 w-4" />Agents</Link>}
        actions={<><Button variant="secondary" size="sm" onClick={() => dup.mutate()} loading={dup.isPending}><Copy className="h-3.5 w-3.5" />Duplicate</Button>
          <Button variant="danger-outline" size="sm" onClick={() => setConfirmDel(true)}><Trash2 className="h-3.5 w-3.5" />Delete</Button></>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'run', label: 'Run task' }, { value: 'config', label: 'Configuration' }, { value: 'history', label: 'History' }]} />
      <div className="mt-6">
        {tab === 'run' && (a.enabled ? <ExecutionTerminal fixedAgentId={a.id} /> :
          <EmptyState icon={Sparkles} title="This agent is disabled" description="Enable it in the Configuration tab to run tasks." />)}
        {tab === 'config' && <div className="max-w-3xl"><AgentForm agent={a} onSubmit={save} /></div>}
        {tab === 'history' && (
          <div className="card">{hist.isLoading ? <TableSkeleton /> : hist.isError ? <ErrorState error={hist.error} onRetry={hist.refetch} /> : hist.data.items.length === 0 ?
            <EmptyState title="No executions yet" description="Run a task to see it here." /> : (
            <Table><THead><tr><TH>Task</TH><TH>Status</TH><TH>Duration</TH><TH>Started</TH></tr></THead><tbody>
              {hist.data.items.map((e) => <TR key={e.id}><TD><Link className="font-medium hover:text-accent" to={`/app/executions/${e.id}`}>{e.task.slice(0, 80)}</Link></TD>
                <TD><StatusIndicator status={e.status} /></TD><TD>{formatDuration(e.duration_ms)}</TD><TD className="text-muted">{formatDate(e.created_at)}</TD></TR>)}
            </tbody></Table>)}</div>)}
      </div>
      <ConfirmDialog open={confirmDel} onClose={() => setConfirmDel(false)} onConfirm={() => remove.mutate()} loading={remove.isPending} danger confirmLabel="Delete agent"
        title={`Delete “${a.name}”?`} message="This cannot be undone. Execution history is kept without the agent link." />
    </>
  )
}