import { forwardRef } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'

const base = 'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 select-none active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap'
const variants = {
  primary: 'bg-accent text-accent-fg font-semibold shadow-sm shadow-accent/25 hover:bg-accent/90',
  secondary: 'border border-border bg-surface hover:bg-surface-2 text-text',
  ghost: 'text-text hover:bg-surface-2',
  danger: 'bg-danger text-white hover:bg-danger/90',
  'danger-outline': 'border border-danger/40 text-danger hover:bg-danger/10',
}
const sizes = { sm: 'h-9 px-3 text-sm sm:h-8', md: 'h-10 px-4 text-sm', lg: 'h-11 px-5 text-base', icon: 'h-10 w-10 sm:h-9 sm:w-9' }

export const Spinner = ({ className }) => <Loader2 className={cn('h-4 w-4 animate-spin', className)} aria-hidden="true" />

export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, className, children, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined}
      className={cn(base, variants[variant], sizes[size], className)} {...rest}>
      {loading && <Spinner />}
      {children}
    </button>
  )
})

export function ButtonLink({ to, variant = 'primary', size = 'md', className, children, ...rest }) {
  return <Link to={to} className={cn(base, variants[variant], sizes[size], className)} {...rest}>{children}</Link>
}