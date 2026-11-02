import { useEffect, useRef } from 'react'
import { useBlocker } from 'react-router-dom'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { agentSchema } from '../../lib/schemas'
import { fieldErrors } from '../../lib/api'
import { toolsApi } from '../../services/endpoints'
import { Button } from '../ui/Button'
import { Checkbox, Input, Switch, Textarea } from '../ui/Form'
import { Alert, Badge, Skeleton } from '../ui/Feedback'
import { ConfirmDialog } from '../ui/Overlay'
import { cn } from '../../lib/utils'
import { useState } from 'react'

const DEFAULTS = { name: '', description: '', system_instructions: '', model: 'gpt-4o-mini', temperature: 0.2, max_steps: 6, enabled: true, tool_keys: [] }

export function AgentForm({ agent, onSubmit, submitLabel = 'Save agent', embedded = false, onCancel, formId }) {
  const [serverError, setServerError] = useState('')
  const tools = useQuery({ queryKey: ['tools'], queryFn: toolsApi.list })
  const { register, handleSubmit, control, reset, setError, formState: { errors, isSubmitting, isDirty, isSubmitSuccessful } } = useForm({
    resolver: zodResolver(agentSchema), defaultValues: agent ? { ...DEFAULTS, ...agent } : DEFAULTS })
  useEffect(() => { if (agent) reset({ ...DEFAULTS, ...agent }) }, [agent, reset])

  const saving = useRef(false)  // set while a save is in flight so our own post-save navigation is never blocked
  const blocker = useBlocker(({ currentLocation, nextLocation }) => isDirty && !isSubmitSuccessful && !saving.current && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    if (!isDirty) return undefined
    const fn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', fn)
    return () => window.removeEventListener('beforeunload', fn)
  }, [isDirty])

  const submit = async (values) => {
    setServerError('')
    saving.current = true
    try { await onSubmit(values); reset(values) } catch (e) {
      saving.current = false
      const fe = fieldErrors(e); Object.entries(fe).forEach(([k, m]) => setError(k, { message: m }))
      setServerError(Object.keys(fe).length ? 'Please fix the highlighted fields.' : e.message)
    }
  }
  const builtin = (tools.data || []).filter((t) => t.kind === 'builtin')
  const custom = (tools.data || []).filter((t) => t.kind === 'custom')

  return (
    <form id={formId} onSubmit={handleSubmit(submit)} noValidate className={embedded ? 'space-y-5' : 'space-y-6'} aria-label="Agent configuration">
      <div className={embedded ? 'min-h-0 flex-1 space-y-5 overflow-y-auto px-1 pb-5' : 'space-y-6'}>

      {serverError && <Alert tone="danger">{serverError}</Alert>}
      <section className={embedded ? 'space-y-4' : 'card space-y-4 p-5'}>
        <h3 className="font-semibold">General</h3>
        <Input label="Name" required error={errors.name?.message} {...register('name')} />
        <Input label="Description" hint="Shown in lists. Not sent to the model." error={errors.description?.message} {...register('description')} />
        <Textarea label="System instructions" rows={7} hint="Agent-specific guidance. Platform safety rules always take priority over these." error={errors.system_instructions?.message} {...register('system_instructions')} />
        <Controller control={control} name="enabled" render={({ field }) => (
          <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
            <div><p className="text-sm font-medium">Enabled</p><p className="text-xs text-muted">Disabled agents cannot run tasks.</p></div>
            <Switch checked={field.value} onChange={field.onChange} label="Agent enabled" />
          </div>)} />
      </section>
      <section className={embedded ? 'space-y-4 border-t border-border pt-5' : 'card space-y-4 p-5'}>
        <h3 className="font-semibold">Model configuration</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Model" error={errors.model?.message} {...register('model')} />
          <Input label="Temperature" type="number" step="0.1" min="0" max="2" error={errors.temperature?.message} {...register('temperature')} />
          <Input label="Max steps" type="number" min="1" max="10" hint="Hard cap on model/tool iterations." error={errors.max_steps?.message} {...register('max_steps')} />
        </div>
      </section>
      <section className={embedded ? 'space-y-3 border-t border-border pt-5' : 'card space-y-3 p-5'}>
        <div><h3 className="font-semibold">Tool permissions</h3><p className="text-xs text-muted">The backend only allows this agent to call tools checked here.</p></div>
        {tools.isLoading ? <Skeleton className="h-24" /> : (
          <Controller control={control} name="tool_keys" render={({ field }) => {
            const toggle = (k) => field.onChange(field.value.includes(k) ? field.value.filter((x) => x !== k) : [...field.value, k])
            const row = (t) => (
              <div key={t.key} className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                <Checkbox label={<span className="font-mono">{t.name}</span>} description={t.description} checked={field.value.includes(t.key)} disabled={!t.available && !field.value.includes(t.key)} onChange={() => toggle(t.key)} />
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  {t.requires_approval && <Badge tone="info">Needs approval</Badge>}
                  {!t.available && <Badge tone="danger">{t.unavailable_reason || 'Unavailable'}</Badge>}
                </div>
              </div>)
            return <div className="space-y-2">{builtin.map(row)}{custom.length > 0 && <p className="pt-2 text-xs font-medium text-muted">Custom tools</p>}{custom.map(row)}</div>
          }} />)}
      </section>
      </div>
      {!embedded && (
      <div className="flex items-center justify-end gap-3">
        {isDirty && <span className={cn('text-xs text-muted', embedded && 'sm:mr-auto')}>Unsaved changes</span>}
        {embedded && <Button variant="secondary" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" loading={isSubmitting}>{submitLabel}</Button>
      </div>
    )}
      <ConfirmDialog open={blocker.state === 'blocked'} onClose={() => blocker.reset?.()} onConfirm={() => blocker.proceed?.()}
        title="Discard unsaved changes?" message="You have unsaved changes to this agent. If you leave now they will be lost." confirmLabel="Discard changes" danger />
    </form>
  )
}