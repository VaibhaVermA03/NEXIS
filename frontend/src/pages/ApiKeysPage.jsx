import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Ellipsis, Plus, RefreshCw, Trash2, TriangleAlert } from 'lucide-react'
import { keysApi } from '../services/endpoints'
import { apiKeySchema } from '../lib/schemas'
import { timeAgo, formatDate } from '../lib/utils'
import { PageHeader } from '../components/layout/AppShell'
import { Button } from '../components/ui/Button'
import { Checkbox, Input } from '../components/ui/Form'
import { Alert, Badge, CopyButton, EmptyState, ErrorState, TableSkeleton } from '../components/ui/Feedback'
import { Table, TD, TH, THead, TR } from '../components/ui/Data'
import { ConfirmDialog, Dialog, Dropdown, DropdownItem } from '../components/ui/Overlay'
import { useToast } from '../components/ui/Toast'

function CreateKeyDialog({ onClose, onCreated }) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(apiKeySchema), defaultValues: { name: '', read: true, write: true } })
  const [err, setErr] = useState('')
  const submit = async (v) => {
    try { onCreated(await keysApi.create({ name: v.name, scopes: [v.read && 'executions:read', v.write && 'executions:write'].filter(Boolean) })) } catch (e) { setErr(e.message) }
  }
  return (
    <Dialog open onClose={onClose} title="Create API key" description="Keys can call the execution API on your behalf."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={handleSubmit(submit)} loading={isSubmitting}>Create key</Button></>}>
      <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
        {err && <Alert tone="danger">{err}</Alert>}
        <Input label="Name" placeholder="e.g. CI pipeline" error={errors.name?.message} {...register('name')} />
        <fieldset className="space-y-2"><legend className="mb-1 text-sm font-medium">Permissions</legend>
          <Checkbox label="Read executions" description="List runs, read results and events" {...register('read')} />
          <Checkbox label="Start & cancel executions" {...register('write')} />
          {errors.read && <p role="alert" className="text-xs text-danger">{errors.read.message}</p>}</fieldset>
      </form>
    </Dialog>)
}

export function ApiKeysPage() {
  const qc = useQueryClient(); const toast = useToast()
  const [creating, setCreating] = useState(false); const [secret, setSecret] = useState(null); const [revoke, setRevoke] = useState(null); const [rotate, setRotate] = useState(null)
  const list = useQuery({ queryKey: ['api-keys'], queryFn: keysApi.list })
  const refresh = () => qc.invalidateQueries({ queryKey: ['api-keys'] })
  const doRevoke = useMutation({ mutationFn: (k) => keysApi.revoke(k.id), onSuccess: () => { toast.success('Key revoked'); setRevoke(null); refresh() }, onError: (e) => { toast.error(e.message); setRevoke(null) } })
  const doRotate = useMutation({ mutationFn: (k) => keysApi.rotate(k.id), onSuccess: (k) => { setRotate(null); setSecret(k); refresh() }, onError: (e) => { toast.error(e.message); setRotate(null) } })
  // One create button at a time: with no keys, the empty-state button is the only one.
  const showHeaderButton = list.isSuccess ? list.data.length > 0 : list.isError
  const origin = (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/$/, '')
  const curl = `curl -X POST ${origin}/api/v1/executions \\\n  -H "X-API-Key: $NEXIS_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"agent_id": "<AGENT_ID>", "task": "Summarize open support tickets"}'`

  return (
    <>
      <PageHeader title="API Keys" description="Let external systems start and read executions."
        actions={showHeaderButton ? <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Create key</Button> : undefined} />
      <div className="card">
        {list.isLoading ? <TableSkeleton rows={3} /> : list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> : list.data.length === 0 ? (
          <EmptyState icon={KeyRound} title="No API keys" description="Create a key to call the execution API from your own systems." action={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Create key</Button>} />
        ) : (
          <Table><THead><tr><TH>Name</TH><TH>Key</TH><TH>Permissions</TH><TH>Created</TH><TH>Last used</TH><TH><span className="sr-only">Actions</span></TH></tr></THead><tbody>
            {list.data.map((k) => (
              <TR key={k.id} className={k.revoked_at ? 'opacity-60' : ''}>
                <TD className="font-medium">{k.name}{k.revoked_at && <Badge tone="danger" className="ml-2">Revoked</Badge>}</TD>
                <TD className="font-mono text-xs">{k.prefix}_••••••••</TD>
                <TD><div className="flex flex-wrap gap-1">{k.scopes.map((s) => <Badge key={s}>{s}</Badge>)}</div></TD>
                <TD className="text-muted">{formatDate(k.created_at)}</TD><TD className="text-muted">{timeAgo(k.last_used_at)}</TD>
                <TD className="text-right">{!k.revoked_at && <Dropdown label={`Actions for ${k.name}`} trigger={<span className="flex h-8 w-8 items-center justify-center rounded text-muted hover:bg-surface-2"><Ellipsis className="h-4 w-4" /></span>}>
                  <DropdownItem icon={RefreshCw} onClick={() => setRotate(k)}>Rotate</DropdownItem><DropdownItem icon={Trash2} danger onClick={() => setRevoke(k)}>Revoke</DropdownItem></Dropdown>}</TD>
              </TR>))}
          </tbody></Table>)}
      </div>
      <section className="card mt-8 p-5" aria-label="Usage example">
        <h3 className="font-semibold">Calling the execution API</h3>
        <p className="mt-1 break-words text-sm text-muted">Send the key in the <code className="font-mono">X-API-Key</code> header (or <code className="font-mono">Authorization: Bearer nx_…</code>). Poll <code className="font-mono">GET /api/v1/executions/&#123;id&#125;</code> for the result. Sensitive actions still need approval from a signed-in user in the dashboard.</p>
        <pre className="mt-3 overflow-x-auto rounded bg-surface-2 p-3 font-mono text-xs">{curl}</pre>
        <div className="mt-2 flex items-center gap-3"><CopyButton value={curl} label="Copy command" /><a className="link text-sm" href={`${origin}/api/docs`} target="_blank" rel="noreferrer">OpenAPI docs</a></div>
      </section>
      {creating && <CreateKeyDialog onClose={() => setCreating(false)} onCreated={(k) => { setCreating(false); setSecret(k); refresh() }} />}
      <Dialog open={!!secret} onClose={() => setSecret(null)} dismissible={false} title="Copy your API key" description="This is the only time the full key is shown."
        footer={<Button onClick={() => setSecret(null)}>I have saved it</Button>}>
        {secret && (<div className="space-y-4">
          <Alert tone="warning"><TriangleAlert className="mr-1 inline h-4 w-4" />Store it in a secrets manager. NEXIS keeps only a hash and cannot show it again.</Alert>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center"><code data-testid="api-key-secret" className="min-w-0 flex-1 break-all rounded bg-surface-2 p-3 font-mono text-xs">{secret.key}</code><CopyButton value={secret.key} /></div></div>)}
      </Dialog>
      <ConfirmDialog open={!!revoke} onClose={() => setRevoke(null)} onConfirm={() => doRevoke.mutate(revoke)} loading={doRevoke.isPending} danger confirmLabel="Revoke key"
        title={`Revoke “${revoke?.name}”?`} message="Systems using this key will immediately lose access. This cannot be undone." />
      <ConfirmDialog open={!!rotate} onClose={() => setRotate(null)} onConfirm={() => doRotate.mutate(rotate)} loading={doRotate.isPending} confirmLabel="Rotate key"
        title={`Rotate “${rotate?.name}”?`} message="A new secret replaces the current one. The old key stops working immediately." />
    </>
  )
}