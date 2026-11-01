import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { cn } from '../../lib/utils'

const Ctx = createContext(null)
const icons = { success: CheckCircle2, error: AlertCircle, info: Info }
const tones = { success: 'text-success', error: 'text-danger', info: 'text-info' }

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const idRef = useRef(0)
  const dismiss = useCallback((id) => setItems((xs) => xs.filter((x) => x.id !== id)), [])
  const push = useCallback((kind, message, title) => {
    const id = ++idRef.current
    setItems((xs) => [...xs.slice(-3), { id, kind, message, title }])
    setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 4500)
  }, [dismiss])
  const api = useMemo(() => ({
    success: (m, t) => push('success', m, t), error: (m, t) => push('error', m, t), info: (m, t) => push('info', m, t),
  }), [push])
  return (
    <Ctx.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[70] flex flex-col gap-2 sm:left-auto sm:right-4 sm:w-96">
        {items.map((t) => {
          const Icon = icons[t.kind]
          return (
            <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'}
              className="animate-sheet pointer-events-auto flex items-start gap-3 rounded-xl border border-border bg-surface p-3 shadow-pop">
              <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', tones[t.kind])} aria-hidden="true" />
              <div className="min-w-0 flex-1 text-sm">{t.title && <p className="font-medium">{t.title}</p>}<p className="text-muted break-words">{t.message}</p></div>
              <button onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="rounded p-0.5 text-muted hover:text-text"><X className="h-4 w-4" /></button>
            </div>
          )
        })}
      </div>
    </Ctx.Provider>
  )
}

export const useToast = () => {
  const v = useContext(Ctx)
  if (!v) throw new Error('useToast must be used inside ToastProvider')
  return v
}