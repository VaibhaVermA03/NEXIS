import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, ShieldCheck, ShieldQuestion, Workflow, Zap } from 'lucide-react'
import { useAuth } from '../app/AuthContext'
import { apiUrl, fieldErrors } from '../lib/api'
import { forgotSchema, loginSchema, resetSchema, signupSchema } from '../lib/schemas'
import { authApi } from '../services/endpoints'
import { Logo } from '../components/ui/Logo'
import { Button, ButtonLink } from '../components/ui/Button'
import { Input, PasswordInput } from '../components/ui/Form'
import { Alert } from '../components/ui/Feedback'

export const OAUTH_ERRORS = {
  google_not_configured: 'Google sign-in is not configured on this server. Use email and password, or ask the administrator to set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
  consent_cancelled: 'Google sign-in was cancelled. You can try again or use your email and password.',
  account_exists: 'An account with this email already exists. Sign in with your password instead.',
  oauth_state_mismatch: 'The sign-in attempt could not be verified. Please try again.',
  oauth_state_missing: 'The sign-in session expired or cookies are blocked. Please try again.',
  oauth_state_expired: 'The sign-in session expired. Please try again.',
  oauth_invalid_token: 'Google returned an invalid response. Please try again.',
  oauth_email_unverified: 'Your Google account email is not verified, so it cannot be used to sign in.',
  oauth_code_rejected: 'Google rejected the sign-in request. Please try again.',
  oauth_unreachable: 'Could not reach Google. Check your connection and try again.',
  account_disabled: 'This account has been disabled.',
  oauth_error: 'Google sign-in failed. Please try again.',
}

const safeNext = (n) => (n && n.startsWith('/app') ? n : '/app/dashboard')

const FEATURES = [
  [Zap, 'Bounded, observable runs', 'Every step is streamed and recorded'],
  [ShieldCheck, 'Permissions & approvals', 'Agents only use tools you authorize'],
  [Workflow, 'Chain agents into workflows', 'Repeatable multi-step automation'],
]

/** Purely decorative illustration (not real data): an animated example of what a run looks like. */
function ExampleRun() {
  const steps = [
    { icon: CheckCircle2, tone: 'text-success', text: 'http_request', note: 'fetched 42 records' },
    { icon: CheckCircle2, tone: 'text-success', text: 'generate_report', note: 'summary ready' },
    { icon: ShieldQuestion, tone: 'text-warning', text: 'create_ticket', note: 'awaiting your approval' },
  ]
  return (
    <div aria-hidden="true" className="animate-float relative max-w-md rounded-2xl border border-border bg-surface/90 shadow-pop backdrop-blur">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="flex gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-faint/60" /><i className="h-2.5 w-2.5 rounded-full bg-faint/60" /><i className="h-2.5 w-2.5 rounded-full bg-faint/60" /></span>
        <span className="ml-2 font-mono text-xs text-muted">example run</span>
        <span className="ml-auto rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent">Illustration</span>
      </div>
      <div className="space-y-3 p-4">
        <p className="font-mono text-xs text-muted"><span className="text-accent">›</span> Summarize this week&apos;s support tickets</p>
        {steps.map((st, i) => (
          <div key={st.text} className="run-step flex items-center gap-2.5 text-sm" style={{ '--i': i }}>
            <st.icon className={`h-4 w-4 shrink-0 ${st.tone}`} />
            <span className="font-mono text-[13px] font-medium text-text">{st.text}</span>
            <span className="truncate text-xs text-muted">{st.note}</span>
          </div>))}
        <p className="run-step font-mono text-xs text-muted" style={{ '--i': 3 }}>Waiting for approval<span className="caret ml-0.5 text-accent">▍</span></p>
      </div>
    </div>
  )
}

function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-[1.08fr_1fr]">
      <aside className="auth-hero relative hidden flex-col justify-between overflow-hidden p-12 lg:flex xl:p-16">
        <div className="auth-grid absolute inset-0" aria-hidden="true" />
        <div className="auth-orb -left-10 top-1/3 h-72 w-72" aria-hidden="true" />
        <div className="auth-orb -bottom-16 right-0 h-64 w-64" style={{ animationDelay: '-7s' }} aria-hidden="true" />
        <Logo size="lg" className="relative" />
        <div className="relative space-y-8">
          <div className="space-y-5">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 px-3 py-1 text-xs font-medium text-muted backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />Autonomous AI agents
            </span>
            <h2 className="max-w-lg text-5xl font-semibold leading-[1.05] tracking-tight xl:text-6xl">From Intent to <span className="text-gradient">Execution.</span></h2>
            <p className="max-w-md text-base leading-relaxed text-muted">Create agents, authorize their tools, run multi-step tasks and watch every step as it happens.</p>
          </div>
          <ExampleRun />
          <ul className="grid max-w-lg gap-3 text-sm">
            {FEATURES.map(([I, t, d]) => (
              <li key={t} className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"><I className="h-[18px] w-[18px]" /></span>
                <span><span className="font-medium text-text">{t}</span><span className="block text-xs text-muted">{d}</span></span>
              </li>))}
          </ul>
        </div>
        <p className="relative text-xs text-muted">© {new Date().getFullYear()} NEXIS</p>
      </aside>

      <main className="auth-mobile-glow relative flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="relative w-full max-w-md animate-fade-up">
          <Logo className="mb-8 lg:hidden" />
          <h1 className="text-3xl font-semibold tracking-tight sm:text-[2rem]">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-muted sm:text-base">{subtitle}</p>}
          <div className="mt-7 rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-7">{children}</div>
          <div className="mt-6 text-center text-sm text-muted">{footer}</div>
        </div>
      </main>
    </div>
  )
}

const GoogleMark = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.5 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.8V6.5H1.4a12 12 0 0 0 0 11l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.5l4 3.1C6.3 6.9 8.900 4.800 12 4.800z"/></svg>
)

export function GoogleButton({ label = 'Continue with Google' }) {
  const cfg = useQuery({ queryKey: ['auth-config'], queryFn: authApi.config, staleTime: 60_000 })
  const [going, setGoing] = useState(false)
  return (
    <div>
      <Button variant="secondary" className="w-full" loading={going} onClick={() => { setGoing(true); window.location.assign(apiUrl('/auth/google/login')) }}>
        {!going && <GoogleMark />}{label}
      </Button>
      {cfg.data && !cfg.data.google_enabled && <p className="mt-1.5 text-center text-xs text-muted">Google sign-in is not configured on this server.</p>}
    </div>
  )
}

const Divider = () => (
  <div className="my-5 flex items-center gap-3 text-xs font-medium tracking-wider text-faint" role="separator" aria-label="or"><span className="h-px flex-1 bg-border" />OR<span className="h-px flex-1 bg-border" /></div>
)

function useServerErrors(setError) {
  const [formError, setFormError] = useState('')
  const handle = (err) => {
    const fe = fieldErrors(err)
    Object.entries(fe).forEach(([k, m]) => setError(k, { message: m }))
    setFormError(Object.keys(fe).length ? '' : err.message)
  }
  return [formError, handle, setFormError]
}

export function LoginPage() {
  const { login } = useAuth(); const navigate = useNavigate(); const [sp] = useSearchParams()
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } })
  const [formError, handle] = useServerErrors(setError)
  const oauthErr = sp.get('error')
  const onSubmit = async (v) => { try { await login(v); navigate(safeNext(sp.get('next')), { replace: true }) } catch (e) { handle(e) } }
  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your NEXIS workspace."
      footer={<>New to NEXIS? <Link to="/signup" className="link">Create an account</Link></>}>
      {oauthErr && <Alert tone="danger" className="mb-4">{OAUTH_ERRORS[oauthErr] || OAUTH_ERRORS.oauth_error}</Alert>}
      <GoogleButton />
      <Divider />
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4" aria-label="Sign in">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Input label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <PasswordInput label="Password" autoComplete="current-password" error={errors.password?.message} {...register('password')} />
        <div className="flex justify-end -mt-2"><Link to="/forgot-password" className="text-xs link">Forgot password?</Link></div>
        <Button type="submit" className="w-full" loading={isSubmitting}>Sign in</Button>
      </form>
    </AuthLayout>
  )
}

export function SignupPage() {
  const { signup } = useAuth(); const navigate = useNavigate()
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(signupSchema), defaultValues: { full_name: '', email: '', password: '', password_confirm: '' } })
  const [formError, handle] = useServerErrors(setError)
  const onSubmit = async (v) => { try { await signup(v); navigate('/app/dashboard', { replace: true }) } catch (e) { handle(e) } }
  return (
    <AuthLayout title="Create your account" subtitle="Start building agents in minutes."
      footer={<>Already have an account? <Link to="/login" className="link">Sign in</Link></>}>
      <GoogleButton label="Sign up with Google" />
      <Divider />
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4" aria-label="Create account">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Input label="Full name" autoComplete="name" error={errors.full_name?.message} {...register('full_name')} />
        <Input label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <PasswordInput label="Password" autoComplete="new-password" hint="At least 10 characters with upper, lower case and a digit." error={errors.password?.message} {...register('password')} />
        <PasswordInput label="Confirm password" autoComplete="new-password" error={errors.password_confirm?.message} {...register('password_confirm')} />
        <Button type="submit" className="w-full" loading={isSubmitting}>Create account</Button>
      </form>
    </AuthLayout>
  )
}

export function ForgotPasswordPage() {
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(forgotSchema), defaultValues: { email: '' } })
  const [formError, handle] = useServerErrors(setError)
  const [result, setResult] = useState(null)
  const onSubmit = async (v) => { try { setResult(await authApi.forgot(v.email)) } catch (e) { handle(e) } }
  return (
    <AuthLayout title="Reset your password" subtitle="Enter your email and we'll issue a reset link."
      footer={<Link to="/login" className="link">Back to sign in</Link>}>
      {result ? (
        <div className="space-y-4">
          <Alert tone="success" title="Request received">{result.message}</Alert>
          {result.dev_reset_link ? (
            <Alert tone="warning" title="Development mode">No email provider is configured, so no email was sent. Use this one-time link: <a className="link break-all" href={result.dev_reset_link}>Reset password</a></Alert>
          ) : (
            <p className="text-xs text-muted">If email delivery is not configured on this server, no message is sent. Contact the administrator.</p>
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4" aria-label="Request password reset">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <Input label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
          <Button type="submit" className="w-full" loading={isSubmitting}>Send reset link</Button>
        </form>)}
    </AuthLayout>
  )
}

export function ResetPasswordPage() {
  const [sp] = useSearchParams(); const token = sp.get('token') || ''
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(resetSchema), defaultValues: { password: '', password_confirm: '' } })
  const [formError, handle] = useServerErrors(setError)
  const [done, setDone] = useState(false)
  const onSubmit = async (v) => { try { await authApi.reset({ token, ...v }); setDone(true) } catch (e) { handle(e) } }
  if (!token) return <AuthLayout title="Invalid link" footer={<Link to="/forgot-password" className="link">Request a new link</Link>}><Alert tone="danger">This reset link is missing its token.</Alert></AuthLayout>
  return (
    <AuthLayout title="Choose a new password" footer={<Link to="/login" className="link">Back to sign in</Link>}>
      {done ? (
        <div className="space-y-4"><Alert tone="success" title="Password updated"><CheckCircle2 className="mr-1 inline h-4 w-4" />All other sessions were signed out.</Alert><ButtonLink to="/login" className="w-full">Sign in</ButtonLink></div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4" aria-label="Reset password">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <PasswordInput label="New password" autoComplete="new-password" error={errors.password?.message} {...register('password')} />
          <PasswordInput label="Confirm new password" autoComplete="new-password" error={errors.password_confirm?.message} {...register('password_confirm')} />
          <Button type="submit" className="w-full" loading={isSubmitting}>Update password</Button>
        </form>)}
    </AuthLayout>
  )
}

export function AuthCallbackPage() {
  const [sp] = useSearchParams(); const navigate = useNavigate(); const { completeExternalLogin } = useAuth()
  const error = sp.get('error'); const ok = sp.get('status') === 'success'
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!ok) return
    completeExternalLogin().then(() => navigate('/app/dashboard', { replace: true })).catch(() => setFailed(true))
  }, [ok]) // eslint-disable-line react-hooks/exhaustive-deps
  if (error || failed || !ok) {
    return (
      <AuthLayout title="Sign-in failed" footer={<Link to="/login" className="link">Back to sign in</Link>}>
        <Alert tone="danger">{OAUTH_ERRORS[error] || (failed ? 'We could not start your session. Check that cookies are enabled and try again.' : OAUTH_ERRORS.oauth_error)}</Alert>
      </AuthLayout>)
  }
  return <div role="status" className="flex min-h-screen items-center justify-center text-sm text-muted">Completing sign-in…</div>
}