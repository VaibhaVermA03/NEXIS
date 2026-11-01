import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowLeft, ArrowUp, Pencil, Plus, Trash2, Workflow } from 'lucide-react'
import { agentsApi, executionsApi, workflowsApi } from '../services/endpoints'
import { PageHeader } from '../components/layout/AppShell'
import { ExecutionTerminal } from '../components/executions/ExecutionTerminal'
import { Button } from '../components/ui/Button'
import { Input, Select, Switch, Textarea } from '../components/ui/Form'
import { Alert, Badge, EmptyState, ErrorState, StatusIndicator, TableSkeleton } from '../components/ui/Feedback'
import { Pagination, Table, TD, TH, THead, TR } from '../components/ui/Data'
import { ConfirmDialog, Dialog } from '../components/ui/Overlay'
import { useToast } from '../components/ui/Toast'
import { formatDate, formatDuration } from '../lib/utils'

function WorkflowDialog({ workflow, agents, onClose, onSaved }) {
  const [name, setName] = useState(workflow?.name || ''); const [description, setDescription] = useState(workflow?.description || '')
  const [enabled, setEnabled] = useState(workflow?.enabled ?? true)
  const [steps, setSteps] = useState(workflow?.steps.map((s) => ({ agent_id: s.agent_id, instruction: s.instruction })) || [{ agent_id: '', instruction: '{{input}}' }])
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const upd = (i, patch) => setSteps((xs) => xs.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const move = (i, d) => setSteps((xs) => { const ys = [...xs]; const j = i + d; if (j < 0 || j >= ys.length) return ys;[ys[i], ys[j]] = [ys[j], ys[i]]; return ys })
  const save = async () => {
    if (!name.trim()) return setErr('Name is required.')
    if (steps.some((s) => !s.agent_id || !s.instruction.trim())) return setErr('Every step needs an agent and an instruction.')
    setBusy(true); setErr('')
    try { const body = { name: name.trim(), description, enabled, steps }; onSaved(workflow ? await workflowsApi.update(workflow.id, body) : await workflowsApi.create(body)) } catch (e) { setErr(e.message); setBusy(false) }
  }
  return (
    <Dialog open onClose={onClose} dismissible={false} size="lg" title={workflow ? 'Edit workflow' : 'New workflow'} description="Steps run in order. Use {{input}} for the run input and {{previous}} for the prior step's output."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>{workflow ? 'Save changes' : 'Create workflow'}</Button></>}>
      <div className="space-y-4">
        {err && <Alert tone="danger">{err}</Alert>}
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required /><Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3"><span className="text-sm font-medium">Enabled</span><Switch checked={enabled} onChange={setEnabled} label="Workflow enabled" /></div>
        <div className="space-y-3">{steps.map((s, i) => (
          <fieldset key={i} className="rounded-lg border border-border p-3"><legend className="px-1 text-xs font-medium text-muted">Step {i + 1}</legend>
            <div className="space-y-3"><Select aria-label={`Agent for step ${i + 1}`} value={s.agent_id} onChange={(e) => upd(i, { agent_id: e.target.value })}><option value="">Select agent…</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
              <Textarea aria-label={`Instruction for step ${i + 1}`} rows={2} value={s.instruction} onChange={(e) => upd(i, { instruction: e.target.value })} />
              <div className="flex gap-1"><Button size="icon" variant="ghost" aria-label="Move step up" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" aria-label="Move step down" onClick={() => move(i, 1)} disabled={i === steps.length - 1}><ArrowDown className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" aria-label="Remove step" onClick={() => setSteps((xs) => xs.filter((_, j) => j !== i))} disabled={steps.length === 1}><Trash2 className="h-4 w-4" /></Button></div></div></fieldset>))}
          {steps.length < 10 && <Button variant="secondary" size="sm" onClick={() => setSteps((xs) => [...xs, { agent_id: '', instruction: '{{previous}}' }])}><Plus className="h-4 w-4" />Add step</Button>}</div>
      </div>
    </Dialog>)
}

export function WorkflowsPage() {
  const qc = useQueryClient(); const navigate = useNavigate()
  const [page, setPage] = useState(1); const [creating, setCreating] = useState(false)
  const list = useQuery({ queryKey: ['workflows', page], queryFn: () => workflowsApi.list({ page, page_size: 10 }) })
  const agents = useQuery({ queryKey: ['agents', 'all'], queryFn: () => agentsApi.list({ page_size: 100 }) })
  // One create button at a time: when there are no workflows the empty-state button below is the only one.
  const emptyCta = list.isSuccess && list.data.items.length === 0
  const showHeaderButton = list.isSuccess ? !emptyCta : list.isError
  return (
    <>
      <PageHeader title="Workflows" description="Chain agents into repeatable, ordered sequences."
        actions={showHeaderButton ? <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New workflow</Button> : undefined} />
      <Alert tone="info" className="mb-4">Workflows are ordered sequential steps (agent + instruction). A visual drag-and-drop graph editor is not part of this release.</Alert>
      <div className="card">{list.isLoading ? <TableSkeleton rows={3} /> : list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> : list.data.items.length === 0 ? (
        <EmptyState icon={Workflow} title="No workflows yet" description="Create a workflow to run several agents one after another." action={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Create workflow</Button>} />
      ) : (<>
        <Table><THead><tr><TH>Name</TH><TH>Steps</TH><TH>Runs</TH><TH>Status</TH></tr></THead><tbody>
          {list.data.items.map((w) => <TR key={w.id}><TD><Link to={`/app/workflows/${w.id}`} className="font-medium hover:text-accent">{w.name}</Link>{w.description && <p className="text-xs text-muted">{w.description}</p>}</TD><TD>{w.steps.length}</TD><TD>{w.run_count}</TD><TD><Badge tone={w.enabled ? 'success' : 'neutral'}>{w.enabled ? 'Enabled' : 'Disabled'}</Badge></TD></TR>)}
        </tbody></Table><Pagination page={page} pageSize={10} total={list.data.total} onPage={setPage} /></>)}</div>
      {creating && <WorkflowDialog agents={agents.data?.items || []} onClose={() => setCreating(false)} onSaved={(w) => { qc.invalidateQueries({ queryKey: ['workflows'] }); navigate(`/app/workflows/${w.id}`) }} />}
    </>
  )
}

export function WorkflowDetailPage() {
  const { workflowId } = useParams(); const qc = useQueryClient(); const toast = useToast(); const navigate = useNavigate()
  const [editing, setEditing] = useState(false); const [del, setDel] = useState(false)
  const q = useQuery({ queryKey: ['workflow', workflowId], queryFn: () => workflowsApi.get(workflowId) })
  const agents = useQuery({ queryKey: ['agents', 'all'], queryFn: () => agentsApi.list({ page_size: 100 }) })
  const hist = useQuery({ queryKey: ['executions', 'workflow', workflowId], queryFn: () => executionsApi.list({ workflow_id: workflowId, page_size: 10 }) })
  const remove = useMutation({ mutationFn: () => workflowsApi.remove(workflowId), onSuccess: () => { toast.success('Workflow deleted'); qc.invalidateQueries({ queryKey: ['workflows'] }); navigate('/app/workflows') }, onError: (e) => toast.error(e.message) })
  if (q.isLoading) return <TableSkeleton rows={4} />
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} title={q.error.status === 404 ? 'Workflow not found' : undefined} />
  const w = q.data
  return (
    <>
      <PageHeader title={w.name} description={w.description} back={<Link to="/app/workflows" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-text"><ArrowLeft className="h-4 w-4" />Workflows</Link>}
        actions={<><Button variant="secondary" size="sm" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" />Edit</Button><Button variant="danger-outline" size="sm" onClick={() => setDel(true)}><Trash2 className="h-3.5 w-3.5" />Delete</Button></>} />
      <ol className="mb-8 space-y-2" aria-label="Workflow steps">{w.steps.map((s) => (
        <li key={s.id} className="card flex gap-3 p-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">{s.position + 1}</span>
          <div className="min-w-0"><p className="text-sm font-medium">{s.agent_name || '(deleted agent)'}</p><p className="whitespace-pre-wrap text-sm text-muted">{s.instruction}</p></div></li>))}</ol>
      {w.enabled ? <ExecutionTerminal workflowId={w.id} onStarted={() => qc.invalidateQueries({ queryKey: ['workflow', workflowId] })} /> : <Alert tone="warning">This workflow is disabled. Edit it to enable running.</Alert>}
      <section className="card mt-8" aria-label="Workflow run history"><h3 className="border-b border-border px-4 py-3 text-sm font-semibold">Run history</h3>
        {hist.isLoading ? <TableSkeleton rows={3} /> : !hist.data?.items.length ? <p className="py-8 text-center text-sm text-muted">No runs yet.</p> : (
          <Table><THead><tr><TH>Input</TH><TH>Status</TH><TH>Duration</TH><TH>Started</TH></tr></THead><tbody>{hist.data.items.map((e) => <TR key={e.id}><TD><Link to={`/app/executions/${e.id}`} className="font-medium hover:text-accent">{e.task.slice(0, 80)}</Link></TD><TD><StatusIndicator status={e.status} /></TD><TD>{formatDuration(e.duration_ms)}</TD><TD className="text-muted">{formatDate(e.created_at)}</TD></TR>)}</tbody></Table>)}</section>
      {editing && <WorkflowDialog workflow={w} agents={agents.data?.items || []} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); toast.success('Workflow saved'); qc.invalidateQueries({ queryKey: ['workflow', workflowId] }); qc.invalidateQueries({ queryKey: ['workflows'] }) }} />}
      <ConfirmDialog open={del} onClose={() => setDel(false)} onConfirm={() => remove.mutate()} loading={remove.isPending} danger confirmLabel="Delete workflow" title={`Delete “${w.name}”?`} message="Run history is kept, but the workflow definition is removed." />
    </>
  )
}