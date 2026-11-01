import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from './Button'
import { cn } from '../../lib/utils'

const dialogStack = []  // open dialogs, last = topmost
const FOCUSABLE = 'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])'

export function Dialog({ open, onClose, title, description, children, footer, size = 'md', dismissible = true }) {
  const ref = useRef(null)
  const titleId = useId()
  useEffect(() => {
    if (!open) return undefined
    const prev = document.activeElement
    const node = ref.current
    const token = {}
    dialogStack.push(token)
    node?.querySelector(FOCUSABLE)?.focus()
    const onKey = (e) => {
      if (dialogStack[dialogStack.length - 1] !== token) return   // a nested dialog is on top
      if (e.key === 'Escape' && dismissible) { e.stopPropagation(); onClose?.() }
      if (e.key === 'Tab' && node) {  // keep focus inside the dialog
        const items = [...node.querySelectorAll(FOCUSABLE)]
        if (!items.length) return
        const first = items[0], last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      dialogStack.splice(dialogStack.indexOf(token), 1)
      if (!dialogStack.length) document.body.style.overflow = ''
      prev?.focus?.()
    }
  }, [open, onClose, dismissible])
  if (!open) return null
  const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="animate-fade-in absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={dismissible ? onClose : undefined} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={cn('animate-sheet relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl border border-border bg-surface shadow-pop sm:rounded-2xl', widths[size])}>
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold">{title}</h2>
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          {dismissible && (
            <button onClick={onClose} aria-label="Close dialog" className="-mr-1 shrink-0 rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-text">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-end [&>button]:w-full sm:[&>button]:w-auto">
            {footer}
          </div>
        )}
      </div>
    </div>, document.body)
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', danger = false, loading = false }) {
  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} title={title} size="sm"
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
      </>}>
      <p className="text-sm text-muted">{message}</p>
    </Dialog>
  )
}

/**
 * Dropdown menu rendered in a PORTAL with fixed positioning.
 * Why: when the trigger sits inside a card/table with `overflow` set, an absolutely-positioned menu is clipped and
 * makes that container scroll. A portal escapes every overflow container. It also flips upward near the bottom of the
 * viewport, stays inside the screen horizontally, and closes on outside click / Escape / scroll / resize.
 */
export function Dropdown({ trigger, children, align = 'right', label }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  const close = useCallback((returnFocus = false) => { setOpen(false); setPos(null); if (returnFocus) btnRef.current?.focus() }, [])

  useLayoutEffect(() => {
    if (!open || !btnRef.current || !menuRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const mw = menuRef.current.offsetWidth, mh = menuRef.current.offsetHeight
    const vw = window.innerWidth, vh = window.innerHeight
    let left = align === 'right' ? r.right - mw : r.left
    left = Math.max(8, Math.min(left, vw - mw - 8))
    let top = r.bottom + 6
    if (top + mh > vh - 8 && r.top - mh - 6 > 8) top = r.top - mh - 6   // flip up when there is no room below
    setPos({ top, left, up: top < r.top })
  }, [open, align])

  useEffect(() => {
    if (!open) return undefined
    menuRef.current?.querySelector('[role="menuitem"]')?.focus()
    const onDown = (e) => { if (!btnRef.current?.contains(e.target) && !menuRef.current?.contains(e.target)) close() }
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(true); return }
      if (e.key === 'Tab') { close(); return }
      const items = [...(menuRef.current?.querySelectorAll('[role="menuitem"]') || [])]
      const i = items.indexOf(document.activeElement)
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus() }
      if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus() }
      if (e.key === 'Home') { e.preventDefault(); items[0]?.focus() }
      if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus() }
    }
    const onScroll = (e) => { if (!menuRef.current?.contains(e.target)) close() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', close)
    }
  }, [open, close])

  return (
    <>
      <button ref={btnRef} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label}
        onClick={() => (open ? close() : setOpen(true))} className="rounded-lg">{trigger}</button>
      {open && createPortal(
        <div ref={menuRef} role="menu" onClick={() => close()}
          style={{ position: 'fixed', top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }}
          className={cn('animate-pop z-[55] min-w-[12rem] max-w-[calc(100vw-1rem)] rounded-xl border border-border bg-surface p-1.5 shadow-pop', pos?.up && '[transform-origin:bottom_right]')}>
          {children}
        </div>, document.body)}
    </>
  )
}

export function DropdownItem({ onClick, icon: Icon, danger, children }) {
  return (
    <button role="menuitem" type="button" onClick={onClick}
      className={cn('flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-surface-2 focus:bg-surface-2 focus:outline-none sm:py-2', danger ? 'text-danger' : 'text-text')}>
      {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}{children}
    </button>
  )
}

export function Tooltip({ text, children }) {
  const id = useId()
  return (
    <span className="group relative inline-flex">
      <span aria-describedby={id}>{children}</span>
      <span id={id} role="tooltip"
        className="pointer-events-none absolute -top-9 left-1/2 z-40 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-text px-2 py-1 text-xs text-bg shadow-pop group-hover:block group-focus-within:block">
        {text}
      </span>
    </span>
  )
}