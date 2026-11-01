import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toolSchema } from '../../lib/schemas'
import { fieldErrors } from '../../lib/api'
import { Button } from '../ui/Button'
import { Checkbox, Input, PasswordInput, Select, Textarea } from '../ui/Form'
import { Alert } from '../ui/Feedback'

const EMPTY_SCHEMA = { type: 'object', properties: {}, additionalProperties: false }
const toForm = (t) => t ? {
  name: t.name, description: t.description, method: t.method, url: t.url, auth_mode: t.auth_mode, auth_name: t.auth_name || '',
  headers_json: JSON.stringify(t.headers || {}, null, 2), input_schema_json: JSON.stringify(t.input_schema, null, 2),
  timeout_seconds: t.timeout_seconds, enabled: t.enabled, secret_value: '', clear_secret: false,
} : { name: '', description: '', method: 'GET', url: 'https://', auth_mode: 'none', auth_name: '', headers_json: '{}', input_schema_json: JSON.stringify(EMPTY_SCHEMA, null, 2), timeout_seconds: 10, enabled: true, secret_value: '', clear_secret: false }

export function ToolForm({ tool, onSubmit, onCancel }) {
  const editing = !!tool
  const [serverError, setServerError] = useState('')
  const { register, handleSubmit, watch, control, setError, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(toolSchema), defaultValues: toForm(tool) })
  const authMode = watch('auth_mode')
  const submit = async (v) => {
    setServerError('')
    const payload = {
      name: v.name, description: v.description, method: v.method, url: v.url, auth_mode: v.auth_mode,
      auth_name: ['header', 'query'].includes(v.auth_mode) ? v.auth_name : null, headers: JSON.parse(v.headers_json || '{}'),
      input_schema: JSON.parse(v.input_schema_json || '{}'), timeout_seconds: v.timeout_seconds, enabled: v.enabled,
    }
    if (v.secret_value) payload.secret_value = v.secret_value
    if (editing && v.clear_secret) payload.clear_secret = true
    try { await onSubmit(payload) } catch (e) {
      const fe = fieldErrors(e); Object.entries(fe).forEach(([k, m]) => setError(k === 'input_schema' ? 'input_schema_json' : k, { message: m }))
      setServerError(e.message)
    }
  }
  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="space-y-4" aria-label="Tool configuration">
      {serverError && <Alert tone="danger">{serverError}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Name" required hint="snake_case; this is the function name the model sees" error={errors.name?.message} {...register('name')} />
        <Controller control={control} name="method" render={({ field }) => (
          <Select label="HTTP method" name={field.name} value={field.value} onChange={field.onChange}>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m} value={m}>{m}</option>)}</Select>)} />
      </div>
      <Input label="Description" required hint="Tell the model when to use this tool" error={errors.description?.message} {...register('description')} />
      <Input label="Endpoint URL" required hint="Public HTTPS only. Private, loopback and cloud-metadata addresses are blocked." error={errors.url?.message} {...register('url')} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Controller control={control} name="auth_mode" render={({ field }) => (
          <Select label="Authentication" name={field.name} value={field.value} onChange={field.onChange}>
            <option value="none">None</option><option value="bearer">Bearer token</option><option value="header">Custom header</option><option value="query">Query parameter</option>
          </Select>)} />
        {['header', 'query'].includes(authMode) && <Input label={authMode === 'header' ? 'Header name' : 'Parameter name'} error={errors.auth_name?.message} {...register('auth_name')} />}
        <Input label="Timeout (s)" type="number" min="1" max="30" error={errors.timeout_seconds?.message} {...register('timeout_seconds')} />
      </div>
      {authMode !== 'none' && (
        <div className="space-y-2">
          <PasswordInput label={editing && tool.has_secret ? 'Replace secret' : 'Secret'} autoComplete="off" placeholder={editing && tool.has_secret ? '•••••••• (leave blank to keep)' : ''}
            hint="Stored encrypted and never shown again." error={errors.secret_value?.message} {...register('secret_value')} />
          {editing && tool.has_secret && <Checkbox label="Remove stored secret" {...register('clear_secret')} />}
        </div>)}
      <Textarea label="Static headers (JSON, non-secret)" rows={3} className="font-mono text-xs" error={errors.headers_json?.message} {...register('headers_json')} />
      <Textarea label="Input schema (JSON Schema, type: object)" rows={8} className="font-mono text-xs" hint="Arguments from the model are validated against this before any request is made." error={errors.input_schema_json?.message} {...register('input_schema_json')} />
      <Checkbox label="Enabled" {...register('enabled')} />
      <div className="flex justify-end gap-2 pt-2"><Button variant="secondary" onClick={onCancel}>Cancel</Button><Button type="submit" loading={isSubmitting}>{editing ? 'Save changes' : 'Create tool'}</Button></div>
    </form>
  )
}