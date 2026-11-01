import { Children, forwardRef, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Eye, EyeOff } from 'lucide-react'
import { cn } from '../../lib/utils'

const control = 'w-full rounded-lg border border-border bg-surface px-3 text-base sm:text-sm text-text placeholder:text-faint transition-colors hover:border-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60 disabled:cursor-not-allowed aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/20'

export function Field({ label, error, hint, htmlFor, required, children, className }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="block text-sm font-medium text-text">
          {label}{required && <span className="text-danger" aria-hidden="true"> *</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  )
}

export const Input = forwardRef(function Input({ label, error, hint, className, id, required, ...rest }, ref) {
  const auto = useId(); const iid = id || auto
  return (
    <Field label={label} error={error} hint={hint} htmlFor={iid} required={required}>
      <input ref={ref} id={iid} aria-invalid={!!error || undefined} aria-describedby={error ? `${iid}-err` : undefined}
        className={cn(control, 'h-11 sm:h-10', className)} {...rest} />
    </Field>
  )
})

export const Textarea = forwardRef(function Textarea({ label, error, hint, className, id, rows = 4, required, ...rest }, ref) {
  const auto = useId(); const iid = id || auto
  return (
    <Field label={label} error={error} hint={hint} htmlFor={iid} required={required}>
      <textarea ref={ref} id={iid} rows={rows} aria-invalid={!!error || undefined}
        className={cn(control, 'py-2 leading-relaxed', className)} {...rest} />
    </Field>
  )
})

export const PasswordInput = forwardRef(function PasswordInput({ label, error, hint, id, required, ...rest }, ref) {
  const auto = useId(); const iid = id || auto
  const [show, setShow] = useState(false)
  return (
    <Field label={label} error={error} hint={hint} htmlFor={iid} required={required}>
      <div className="relative">
        <input ref={ref} id={iid} type={show ? 'text' : 'password'} aria-invalid={!!error || undefined}
          className={cn(control, 'h-11 pr-10 sm:h-10')} {...rest} />
        <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}
          aria-pressed={show} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted hover:text-text">
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </Field>
  )
})

const textOf = (node) => Children.toArray(node).filter((c) => typeof c === 'string' || typeof c === 'number').join('')

/**
 * Custom select (listbox) — replaces the native <select> so the opened list can match the field exactly.
 *  - The trigger and the list read as ONE rounded container (shared border, square joined corners).
 *  - The list is exactly as wide as the trigger, on desktop and on phones.
 *  - The list is rendered in a portal (never clipped by dialogs/cards) and flips upward when there is no room below.
 * Same API as before: <Select value onChange={(e) => e.target.value}> with <option> children.
 */
export function Select({ label, error, hint, id, value, onChange, children, required, disabled, name, className, 'aria-label': ariaLabel }) {
  const auto = useId(); const iid = id || auto
  const listId = `${iid}-list`
  const triggerRef = useRef(null)
  const listRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [pos, setPos] = useState(null)

  const options = useMemo(() => Children.toArray(children).filter((c) => isValidElement(c) && c.type === 'option').map((c) => ({
    value: c.props.value !== undefined ? String(c.props.value) : textOf(c.props.children),
    label: c.props.children, disabled: !!c.props.disabled,
  })), [children])
  const selectedIndex = options.findIndex((o) => o.value === String(value ?? ''))
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null
  const isPlaceholder = !selected || (selected.value === '' && /^select/i.test(textOf(selected.label)))

  const step = (from, dir) => {
    for (let n = 1; n <= options.length; n += 1) {
      const i = (from + dir * n + options.length * 2) % options.length
      if (!options[i].disabled) return i
    }
    return from
  }
  const close = useCallback((refocus = false) => { setOpen(false); setPos(null); if (refocus) triggerRef.current?.focus() }, [])
  const openList = () => { if (disabled) return; setActive(selectedIndex >= 0 && !options[selectedIndex].disabled ? selectedIndex : step(-1, 1)); setOpen(true) }
  const choose = (i) => {
    const o = options[i]
    if (!o || o.disabled) return
    onChange?.({ target: { value: o.value, name } })
    close(true)
  }

  const place = useCallback(() => {
    const t = triggerRef.current, l = listRef.current
    if (!t || !l) return
    const r = t.getBoundingClientRect(); const vh = window.innerHeight
    if (r.bottom < 0 || r.top > vh) { close(); return }   // trigger scrolled out of view
    const below = vh - r.bottom - 8, above = r.top - 8
    const natural = Math.min(l.scrollHeight, 288)
    const up = below < Math.min(natural, 160) && above > below   // flip upward when there is no room below
    setPos({ left: r.left, width: r.width, up, top: r.bottom, bottom: vh - r.top, maxH: Math.max(96, Math.min(288, up ? above : below)) })
  }, [close])

  useLayoutEffect(() => { if (open) place() }, [open, place, options.length])

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (!triggerRef.current?.contains(e.target) && !listRef.current?.contains(e.target)) close() }
    const onScroll = (e) => { if (!listRef.current?.contains(e.target)) place() }
    document.addEventListener('mousedown', onDown); document.addEventListener('touchstart', onDown, { passive: true })
    window.addEventListener('scroll', onScroll, true); window.addEventListener('resize', place)
    return () => {
      document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown)
      window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', place)
    }
  }, [open, close, place])

  useEffect(() => { if (open && active >= 0) listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' }) }, [open, active])

  const onKeyDown = (e) => {
    if (disabled) return
    const k = e.key
    if (!open) { if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(k)) { e.preventDefault(); openList() } return }
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true) }   // closes only the list, never a parent dialog
    else if (k === 'Tab') close()
    else if (k === 'ArrowDown') { e.preventDefault(); setActive((a) => step(a, 1)) }
    else if (k === 'ArrowUp') { e.preventDefault(); setActive((a) => step(a, -1)) }
    else if (k === 'Home') { e.preventDefault(); setActive(step(-1, 1)) }
    else if (k === 'End') { e.preventDefault(); setActive(step(options.length, -1)) }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); choose(active) }
    else if (k.length === 1) {   // type-ahead
      const i = options.findIndex((o, idx) => idx !== active && !o.disabled && textOf(o.label).toLowerCase().startsWith(k.toLowerCase()))
      if (i >= 0) setActive(i)
    }
  }

  const joined = open ? (pos?.up ? 'rounded-t-none' : 'rounded-b-none') : ''
  return (
    <Field label={label} error={error} hint={hint} htmlFor={iid} required={required}>
      <button ref={triggerRef} id={iid} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open}
        aria-controls={open ? listId : undefined} aria-activedescendant={open && active >= 0 ? `${iid}-opt-${active}` : undefined}
        aria-label={label ? undefined : ariaLabel} aria-invalid={!!error || undefined} aria-required={required || undefined} disabled={disabled}
        onClick={() => (open ? close() : openList())} onKeyDown={onKeyDown}
        className={cn(control, 'flex h-11 items-center justify-between gap-2 text-left sm:h-10', open && 'border-accent', joined, className)}>
        <span className={cn('min-w-0 flex-1 truncate', isPlaceholder && 'text-faint')}>{selected ? selected.label : ''}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted transition-transform duration-200', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div ref={listRef} id={listId} role="listbox"
          style={{ position: 'fixed', left: pos?.left ?? 0, width: pos?.width ?? undefined, maxHeight: pos?.maxH ?? 288, visibility: pos ? 'visible' : 'hidden',
            ...(pos?.up ? { bottom: pos.bottom } : { top: pos?.top ?? 0 }) }}
          className={cn('z-[65] overflow-y-auto overscroll-contain border border-accent bg-surface py-1 shadow-pop', pos?.up ? 'rounded-t-lg border-b-0' : 'rounded-b-lg border-t-0')}>
          {options.map((o, i) => (
            <div key={`${o.value}-${i}`} id={`${iid}-opt-${i}`} role="option" data-index={i} aria-selected={i === selectedIndex} aria-disabled={o.disabled || undefined}
              onMouseDown={(e) => e.preventDefault()} onClick={() => choose(i)} onMouseEnter={() => !o.disabled && setActive(i)}
              className={cn('flex cursor-pointer select-none items-center gap-2 px-3 py-3 text-base transition-colors sm:py-2 sm:text-sm',
                i === active && 'bg-surface-2', i === selectedIndex ? 'font-medium text-accent' : 'text-text', o.disabled && 'cursor-not-allowed opacity-45')}>
              <span className="min-w-0 flex-1 break-words">{o.label}</span>
              {i === selectedIndex && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
            </div>))}
        </div>, document.body)}
    </Field>
  )
}

export const Checkbox = forwardRef(function Checkbox({ label, description, className, id, ...rest }, ref) {
  const auto = useId(); const iid = id || auto
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <input ref={ref} id={iid} type="checkbox" className="mt-0.5 h-[18px] w-[18px] rounded border-border accent-[rgb(var(--accent))] sm:h-4 sm:w-4" {...rest} />
      <label htmlFor={iid} className="text-sm leading-tight">
        <span className="font-medium text-text">{label}</span>
        {description && <span className="block text-xs text-muted mt-0.5">{description}</span>}
      </label>
    </div>
  )
})

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-border')}>
      <span className={cn('inline-block h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} />
    </button>
  )
}