import { Children, cloneElement, createContext, isValidElement, useContext, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './Button'
import { cn } from '../../lib/utils'

const LabelCtx = createContext([])

export const THead = ({ children }) => <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">{children}</thead>
export const TH = ({ children, className }) => <th scope="col" className={cn('px-4 py-3 font-medium', className)}>{children}</th>

// Reads the header labels so every cell can show its label when the table turns into cards on phones.
function headerLabels(children) {
  const out = []
  Children.forEach(children, (c) => {
    if (isValidElement(c) && c.type === THead) {
      Children.forEach(c.props.children, (tr) => {
        if (!isValidElement(tr)) return
        Children.forEach(tr.props.children, (th) => {
          const inner = isValidElement(th) ? th.props.children : null
          out.push(typeof inner === 'string' ? inner : '')
        })
      })
    }
  })
  return out
}

export function Table({ children, className }) {
  const labels = useMemo(() => headerLabels(children), [children])
  return (
    <LabelCtx.Provider value={labels}>
      <div className="overflow-x-auto"><table className={cn('table-stack w-full text-left text-sm', className)}>{children}</table></div>
    </LabelCtx.Provider>
  )
}

export function TR({ children, className, ...p }) {
  const labels = useContext(LabelCtx)
  return (
    <tr className={cn('border-b border-border transition-colors last:border-0 hover:bg-surface-2/60', className)} {...p}>
      {Children.map(children, (c, i) => (isValidElement(c) ? cloneElement(c, { label: labels[i] }) : c))}
    </tr>
  )
}

export const TD = ({ children, className, label }) => <td data-label={label || ''} className={cn('px-4 py-3 align-middle', className)}>{children}</td>

export function Pagination({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return null
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm">
      <span className="text-muted">Page {page} of {pages} · {total} total</span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" />Prev</Button>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">Next<ChevronRight className="h-4 w-4" /></Button>
      </div>
    </nav>
  )
}

export function Tabs({ tabs, value, onChange, label = 'Sections' }) {
  const onKey = (e, i) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    onChange(tabs[next].value)
    document.getElementById(`tab-${tabs[next].value}`)?.focus()
  }
  return (
    <div role="tablist" aria-label={label} className="no-scrollbar flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t, i) => (
        <button key={t.value} id={`tab-${t.value}`} role="tab" aria-selected={value === t.value} tabIndex={value === t.value ? 0 : -1}
          onClick={() => onChange(t.value)} onKeyDown={(e) => onKey(e, i)}
          className={cn('-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors sm:py-2.5',
            value === t.value ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-text')}>
          {t.label}
        </button>
      ))}
    </div>
  )
}