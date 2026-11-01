import { AlertTriangle, CheckCircle2, Circle, Clock, ShieldQuestion, XCircle } from 'lucide-react'
import { describe, tone } from '../../lib/executionModel'
import { cn } from '../../lib/utils'

const icon = { success: CheckCircle2, danger: XCircle, warning: ShieldQuestion, neutral: Circle, info: Clock }
const color = { success: 'text-success', danger: 'text-danger', warning: 'text-warning', neutral: 'text-muted', info: 'text-info' }

export function ExecutionTimeline({ timeline }) {
  if (!timeline.length) return <p className="text-sm text-muted">Waiting for the first event…</p>
  return (
    <ol aria-label="Execution event timeline" className="relative space-y-0">
      {timeline.map((ev, i) => {
        const t = tone(ev)
        const Icon = icon[t] || AlertTriangle
        return (
          <li key={ev.id} className="relative flex gap-3 pb-4 last:pb-0">
            {i < timeline.length - 1 && <span className="absolute left-[9px] top-5 h-full w-px bg-border" aria-hidden="true" />}
            <Icon className={cn('relative z-10 mt-0.5 h-[18px] w-[18px] shrink-0 bg-surface', color[t])} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm">{describe(ev)}</p>
              <time className="text-xs text-muted" dateTime={ev.timestamp}>{new Date(ev.timestamp).toLocaleTimeString()}</time>
            </div>
          </li>
        )
      })}
    </ol>
  )
}