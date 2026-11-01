import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { vi } from 'vitest'
import { AuthProvider } from '../app/AuthContext'
import { ThemeProvider } from '../app/ThemeContext'
import { ToastProvider } from '../components/ui/Toast'
import { routes } from '../routes'

export const USER = { id: 'u1', email: 'alice@example.com', full_name: 'Alice Tester', email_verified: false, has_password: true, providers: [], created_at: '2026-01-01T00:00:00Z' }
export const CONFIG = { google_enabled: false, openai_enabled: false, email_delivery_enabled: false, environment: 'test' }

const json = (status, data) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
export const err = (status, code, message, details) => [status, { error: { code, message, details } }]

/** Installs a fetch mock. routes: { 'METHOD /path': data | [status, data] | (req) => ... | Response } */
export function mockFetch(routesMap = {}) {
  const calls = []
  const fn = vi.fn(async (url, init = {}) => {
    const u = new URL(url, 'http://localhost')
    const path = u.pathname.replace(/^\/api\/v1/, '')
    const method = (init.method || 'GET').toUpperCase()
    const body = init.body ? JSON.parse(init.body) : undefined
    const req = { method, path, body, query: u.searchParams, headers: init.headers || {} }
    calls.push(req)
    const h = fn.routes[`${method} ${path}`]
    if (h === undefined) return json(404, { error: { code: 'not_found', message: `No mock for ${method} ${path}` } })
    const out = typeof h === 'function' ? await h(req) : h
    if (out instanceof Response) return out
    if (Array.isArray(out) && typeof out[0] === 'number') return json(out[0], out[1])
    return json(200, out)
  })
  fn.routes = routesMap
  fn.calls = calls
  fn.to = (method, path) => calls.filter((c) => c.method === method && c.path === path)
  globalThis.fetch = fn
  return fn
}

export const authed = (extra = {}) => ({
  'GET /auth/me': { user: USER, csrf_token: 'csrf-1' },
  'GET /auth/config': CONFIG,
  ...extra,
})
export const anonymous = (extra = {}) => ({
  'GET /auth/me': err(401, 'unauthorized', 'Authentication required'),
  'POST /auth/refresh': err(401, 'no_refresh', 'No refresh token'),
  'GET /auth/config': CONFIG,
  ...extra,
})

export function renderApp(path = '/', { width } = {}) {
  if (width) { window.innerWidth = width }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const utils = render(
    <ThemeProvider><QueryClientProvider client={queryClient}><ToastProvider><AuthProvider><RouterProvider router={router} /></AuthProvider></ToastProvider></QueryClientProvider></ThemeProvider>)
  return { ...utils, router, queryClient }
}

export function renderWithProviders(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })
  const router = createMemoryRouter([{ path: '*', element: ui }], { initialEntries: ['/'] })
  return { ...render(<QueryClientProvider client={queryClient}><ToastProvider><RouterProvider router={router} /></ToastProvider></QueryClientProvider>), router }
}

export function sseResponse(frames) {
  const enc = new TextEncoder()
  const stream = new ReadableStream({ start(c) { frames.forEach((f) => c.enqueue(enc.encode(f))); c.close() } })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}
export const frame = (id, type, payload = {}, extra = {}) => `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify({ v: 1, id, execution_id: 'ex1', type, timestamp: '2026-10-24T10:00:0' + (id % 10) + 'Z', payload, ...extra })}\n\n`
export const endFrame = (status = 'completed') => `event: stream.end\ndata: ${JSON.stringify({ status })}\n\n`
