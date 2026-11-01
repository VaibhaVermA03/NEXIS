import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FlaskConical, Ellipsis, Pencil, Plus, Trash2, Wrench } from 'lucide-react'
import { toolsApi } from '../services/endpoints'
import { PageHeader } from '../components/layout/AppShell'
import { ToolForm } from '../components/tools/ToolForm'
import { Button } from '../components/ui/Button'
import { Checkbox, Switch, Textarea } from '../components/ui/Form'
import { Alert, Badge, EmptyState, ErrorState, TableSkeleton } from '../components/ui/Feedback'
import { Table, TD, TH, THead, TR } from '../components/ui/Data'
import { ConfirmDialog, Dialog, Dropdown, DropdownItem } from '../components/ui/Overlay'
import { useToast } from '../components/ui/Toast'

function TestDialog({ tool, onClose }) {
  const toast = useToast()
  const [args, setArgs] = useState('{}'); const [confirm, setConfirm] = useState(false); const [result, setResult] = useState(null); const [err, setErr] = useState('')
  const run = useMutation({
    mutationFn: () => toolsApi.test(tool.id, { arguments: JSON.parse(args || '{}'), confirm_side_effects: confirm }),
    onSuccess: (r) => { setResult(r); setErr('') }, onError: (e) => { setErr(e instanceof SyntaxError ? 'Arguments must be valid JSON.' : e.message); setResult(null); if (!(e instanceof SyntaxError)) toast.error(e.message) } })
  return (
    <Dialog open onClose={onClose} title={`Test ${tool.name}`} size="lg" description="Sends a REAL request through the SSRF-protected runner."
      footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button onClick={() => run.mutate()} loading={run.isPending}>Run test</Button></>}>
      <div className="space-y-4">
        <Textarea label="Arguments (JSON)" rows={4} className="font-mono text-xs" value={args} onChange={(e) => setArgs(e.target.value)} error={err} />
        {tool.method !== 'GET' && <Checkbox label={`I understand this ${tool.method} request may change data on the remote system`} checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />}
        {result && (result.ok ? <div><Alert tone="success" title={`Success in ${result.duration_ms} ms`}>HTTP {result.result?.status_code}</Alert>
          <pre className="mt-3 max-h-72 overflow-auto rounded bg-surface-2 p-3 font-mono text-xs">{JSON.stringify(result.result?.json ?? result.result?.text ?? result.result, null, 2)}</pre></div>
          : <Alert tone="danger" title="Test failed"><span className="font-mono">{result.error.code}</span>: {result.error.message}</Alert>)}
      </div>
    </Dialog>)
}

export function ToolsPage() {
  const qc = useQueryClient(); const toast = useToast()
  const [form, setForm] = useState(null); const [del, setDel] = useState(null); const [test, setTest] = useState(null)
  const list = useQuery({ queryKey: ['tools'], queryFn: toolsApi.list })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['tools'] }); qc.invalidateQueries({ queryKey: ['agents'] }) }
  const toggle = useMutation({ mutationFn: (t) => toolsApi.update(t.id, { enabled: !t.enabled }), onSuccess: refresh, onError: (e) => toast.error(e.message) })
  const remove = useMutation({ mutationFn: (t) => toolsApi.remove(t.id), onSuccess: () => { toast.success('Tool deleted'); setDel(null); refresh() }, onError: (e) => { toast.error(e.message); setDel(null) } })
  const save = async (payload) => {
    if (form === 'new') await toolsApi.create(payload); else await toolsApi.update(form.id, payload)
    toast.success(form === 'new' ? 'Tool created' : 'Tool saved'); setForm(null); refresh()
  }
  const builtin = (list.data || []).filter((t) => t.kind === 'builtin'); const custom = (list.data || []).filter((t) => t.kind === 'custom')
  // One create button at a time: with no custom tools, the empty-state button is the only one.
  const showHeaderButton = list.isSuccess ? custom.length > 0 : list.isError

  return (
    <>
      <PageHeader title="Tool Registry" description="Built-in tools and your custom REST API tools."
        actions={showHeaderButton ? <Button onClick={() => setForm('new')}><Plus className="h-4 w-4" />Custom REST tool</Button> : undefined} />
      {list.isLoading ? <div className="card"><TableSkeleton /></div> : list.isError ? <div className="card"><ErrorState error={list.error} onRetry={list.refetch} /></div> : (
        <div className="space-y-8">
          <section aria-label="Built-in tools"><h3 className="mb-3 text-sm font-semibold text-muted">Built-in tools</h3>
            <div className="card"><Table><THead><tr><TH>Tool</TH><TH>Description</TH><TH>Properties</TH></tr></THead><tbody>
              {builtin.map((t) => <TR key={t.key}><TD className="font-mono text-xs font-medium">{t.name}</TD><TD className="max-w-md text-muted">{t.description}</TD>
                <TD><div className="flex flex-wrap gap-1">{t.requires_approval && <Badge tone="info">Needs approval</Badge>}
                  {t.side_effect === 'external' && <Badge>External</Badge>}{!t.available && <Badge tone="danger">{t.unavailable_reason || 'Unavailable'}</Badge>}</div></TD></TR>)}
            </tbody></Table></div></section>
          <section aria-label="Custom tools"><h3 className="mb-3 text-sm font-semibold text-muted">Custom REST tools</h3>
            <div className="card">{custom.length === 0 ? (
              <EmptyState icon={Wrench} title="No custom tools yet" description="Connect your own HTTP API so agents can call it, with schema validation and encrypted credentials."
                action={<Button onClick={() => setForm('new')}><Plus className="h-4 w-4" />Add custom tool</Button>} />
            ) : (
              <Table><THead><tr><TH>Name</TH><TH>Endpoint</TH><TH>Auth</TH><TH>Enabled</TH><TH><span className="sr-only">Actions</span></TH></tr></THead><tbody>
                {custom.map((t) => <TR key={t.key}><TD><span className="font-mono text-xs font-medium">{t.name}</span><p className="text-xs text-muted">{t.description}</p></TD>
                  <TD className="max-w-xs truncate font-mono text-xs"><Badge className="mr-2">{t.method}</Badge>{t.url}</TD>
                  <TD>{t.auth_mode === 'none' ? <span className="text-muted">None</span> : <Badge tone={t.has_secret ? 'success' : 'danger'}>{t.auth_mode}{t.has_secret ? ' · secret set' : ' · missing'}</Badge>}</TD>
                  <TD><Switch checked={t.enabled} onChange={() => toggle.mutate(t)} label={`${t.enabled ? 'Disable' : 'Enable'} ${t.name}`} /></TD>
                  <TD className="text-right"><Dropdown label={`Actions for ${t.name}`} trigger={<span className="flex h-8 w-8 items-center justify-center rounded text-muted hover:bg-surface-2"><Ellipsis className="h-4 w-4" /></span>}>
                    <DropdownItem icon={FlaskConical} onClick={() => setTest(t)}>Test</DropdownItem><DropdownItem icon={Pencil} onClick={() => setForm(t)}>Edit</DropdownItem>
                    <DropdownItem icon={Trash2} danger onClick={() => setDel(t)}>Delete</DropdownItem></Dropdown></TD></TR>)}
              </tbody></Table>)}</div></section>
        </div>)}
      <Dialog open={!!form} onClose={() => setForm(null)} title={form === 'new' ? 'New custom REST tool' : `Edit ${form?.name}`} size="lg" dismissible={false}>
        {form && <ToolForm tool={form === 'new' ? null : form} onSubmit={save} onCancel={() => setForm(null)} />}
      </Dialog>
      {test && <TestDialog tool={test} onClose={() => setTest(null)} />}
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => remove.mutate(del)} loading={remove.isPending} danger confirmLabel="Delete tool"
        title={`Delete “${del?.name}”?`} message="The tool and its stored secret are permanently removed and it is revoked from every agent." />
    </>
  )
}