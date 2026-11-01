import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { useAuth } from '../app/AuthContext'
import { usersApi, authApi } from '../services/endpoints'
import { changePasswordSchema } from '../lib/schemas'
import { fieldErrors } from '../lib/api'
import { PageHeader } from '../components/layout/AppShell'
import { Button } from '../components/ui/Button'
import { Input, PasswordInput } from '../components/ui/Form'
import { Alert, Badge, TableSkeleton } from '../components/ui/Feedback'
import { Tabs } from '../components/ui/Data'
import { ConfirmDialog } from '../components/ui/Overlay'
import { useToast } from '../components/ui/Toast'
import { formatDate } from '../lib/utils'

const nameSchema = z.object({ full_name: z.string().trim().min(2, 'Enter your full name').max(120) })

function ProfileTab() {
  const { user, setUser } = useAuth(); const toast = useToast()
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting, isDirty } } = useForm({ resolver: zodResolver(nameSchema), defaultValues: { full_name: user.full_name } })
  const submit = async (v) => {
    try { const u = await usersApi.update(v); setUser(u); reset({ full_name: u.full_name }); toast.success('Profile updated') } catch (e) { const fe = fieldErrors(e); if (fe.full_name) setError('full_name', { message: fe.full_name }); else toast.error(e.message) }
  }
  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="card max-w-xl space-y-4 p-5" aria-label="Profile">
      <Input label="Full name" error={errors.full_name?.message} {...register('full_name')} />
      <Input label="Email" value={user.email} readOnly disabled hint="Email cannot be changed in this version." />
      <div className="flex flex-wrap gap-2 text-xs"><Badge tone={user.email_verified ? 'success' : 'neutral'}>{user.email_verified ? 'Email verified' : 'Email not verified'}</Badge>
        {user.providers.map((p) => <Badge key={p} tone="info">Linked: {p}</Badge>)}{user.has_password && <Badge>Password sign-in</Badge>}</div>
      <div className="flex justify-end"><Button type="submit" loading={isSubmitting} disabled={!isDirty}>Save changes</Button></div>
    </form>)
}

function SecurityTab() {
  const { user } = useAuth(); const toast = useToast(); const qc = useQueryClient(); const navigate = useNavigate()
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(changePasswordSchema), defaultValues: { current_password: '', new_password: '', new_password_confirm: '' } })
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: usersApi.sessions })
  const cfg = useQuery({ queryKey: ['auth-config'], queryFn: authApi.config })
  const [confirm, setConfirm] = useState(false)
  const { logout } = useAuth()
  const revokeAll = useMutation({ mutationFn: usersApi.revokeSessions, onSuccess: async () => { toast.success('Signed out everywhere'); await logout().catch(() => {}); navigate('/login') }, onError: (e) => toast.error(e.message) })
  useEffect(() => { qc.invalidateQueries({ queryKey: ['sessions'] }) }, [qc])
  const submit = async (v) => {
    try { await authApi.changePassword(v); toast.success('Password changed. Other sessions were signed out.'); reset(); qc.invalidateQueries({ queryKey: ['sessions'] }) } catch (e) {
      const fe = fieldErrors(e); Object.entries(fe).forEach(([k, m]) => setError(k, { message: m })); if (!Object.keys(fe).length) setError('current_password', { message: e.message }) }
  }
  return (
    <div className="max-w-xl space-y-6">
      {user.has_password ? (
        <form onSubmit={handleSubmit(submit)} noValidate className="card space-y-4 p-5" aria-label="Change password"><h3 className="font-semibold">Change password</h3>
          <PasswordInput label="Current password" autoComplete="current-password" error={errors.current_password?.message} {...register('current_password')} />
          <PasswordInput label="New password" autoComplete="new-password" error={errors.new_password?.message} {...register('new_password')} />
          <PasswordInput label="Confirm new password" autoComplete="new-password" error={errors.new_password_confirm?.message} {...register('new_password_confirm')} />
          <div className="flex justify-end"><Button type="submit" loading={isSubmitting}>Update password</Button></div></form>
      ) : <Alert tone="info" title="No password set">You sign in with Google, so there is no password to change.</Alert>}
      <section className="card p-5" aria-label="Active sessions"><div className="flex items-center justify-between"><h3 className="font-semibold">Active sessions</h3><Button variant="danger-outline" size="sm" onClick={() => setConfirm(true)}>Sign out everywhere</Button></div>
        {sessions.isLoading ? <TableSkeleton rows={2} /> : (
          <ul className="mt-3 divide-y divide-border text-sm">{(sessions.data || []).map((s) => <li key={s.id} className="py-2.5"><p className="truncate">{s.user_agent || 'Unknown device'}</p><p className="text-xs text-muted">Signed in {formatDate(s.created_at)}</p></li>)}
            {!(sessions.data || []).length && <li className="py-3 text-muted">No active sessions.</li>}</ul>)}</section>
      <Alert tone="info" title="Email verification">{cfg.data && !cfg.data.email_delivery_enabled ? 'Email delivery is not configured on this server, so email verification and password-reset emails are unavailable.' : 'Email verification is not enabled.'}</Alert>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => revokeAll.mutate()} loading={revokeAll.isPending} danger confirmLabel="Sign out everywhere" title="Sign out of all sessions?" message="You will be signed out on this device too and will need to sign in again." />
    </div>)
}

export default function SettingsPage({ tab = 'profile' }) {
  const navigate = useNavigate()
  return (
    <>
      <PageHeader title="Settings" description="Manage your profile and account security." />
      <Tabs value={tab} onChange={(t) => navigate(`/app/settings/${t}`)} tabs={[{ value: 'profile', label: 'Profile' }, { value: 'security', label: 'Security' }]} />
      <div className="mt-6">{tab === 'security' ? <SecurityTab /> : <ProfileTab />}</div>
    </>)
}
