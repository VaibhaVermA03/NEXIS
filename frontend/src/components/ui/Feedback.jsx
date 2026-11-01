import { useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, Clock, Copy, Info, PauseCircle, XCircle } from 'lucide-react'
import { Button, Spinner } from './Button'
import { cn } from '../../lib/utils'

export const Skeleton = ({ className }) => <div aria-hidden="true" className={cn('animate-pulse rounded bg-surface-2', className)} />

export function TableSkeleton({ rows = 5 }) {
  return <div role="status" aria-label="Loading" className="space-y-3 p-4">{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {Icon && <div className="mb-4 rounded-2xl bg-accent/10 p-3.5 text-accent"><Icon className="h-6 w-6" aria-hidden="true" /></div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry, title = 'Could not load this data' }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 rounded-2xl bg-danger/10 p-3.5 text-danger"><AlertTriangle className="h-6 w-6" aria-hidden="true" /></div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted">{error?.message || 'Please try again.'}</p>
      {onRetry && <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>Try again</Button>}
    </div>
  )
}

const tones = {
  neutral: 'bg-surface-2 text-muted', accent: 'bg-accent/10 text-accent', success: 'bg-success/10 text-success',
  danger: 'bg-danger/10 text-danger', warning: 'bg-warning/15 text-warning', info: 'bg-info/10 text-info',
}
export const Badge = ({ tone = 'neutral', className, children }) => (
  <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tones[tone], className)}>{children}</span>
)

const STATUS = {
  queued: { tone: 'neutral', icon: Clock, label: 'Queued' },
  running: { tone: 'info', icon: Spinner, label: 'Running' },
  awaiting_approval: { tone: 'warning', icon: PauseCircle, label: 'Needs approval' },
  completed: { tone: 'success', icon: CheckCircle2, label: 'Completed' },
  failed: { tone: 'danger', icon: XCircle, label: 'Failed' },
  cancelled: { tone: 'neutral', icon: XCircle, label: 'Cancelled' },
}
export function StatusIndicator({ status }) {
  const s = STATUS[status] || { tone: 'neutral', icon: Info, label: status }
  const Icon = s.icon
  return <Badge tone={s.tone}><Icon className="h-3 w-3" />{s.label}</Badge>
}

export function CopyButton({ value, label = 'Copy', className }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { setCopied(false) }
  }
  return (
    <Button variant="secondary" size="sm" onClick={copy} className={className} aria-live="polite">
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}{copied ? 'Copied' : label}
    </Button>
  )
}

const alertTones = { info: 'border-info/30 bg-info/5', warning: 'border-warning/40 bg-warning/10', danger: 'border-danger/30 bg-danger/5', success: 'border-success/30 bg-success/5' }
export function Alert({ tone = 'info', title, children, className }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('rounded-lg border px-4 py-3 text-sm', alertTones[tone], className)}>
      {title && <p className="font-medium">{title}</p>}
      <div className={cn(title && 'mt-0.5 text-muted')}>{children}</div>
    </div>
  )
}