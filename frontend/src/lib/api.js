// Fetch-based API client. Auth lives in HttpOnly cookies; the CSRF token is kept in memory only.
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '') + '/api/v1'
export const apiUrl = (path) => BASE + path

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

let csrfToken = null
export const setCsrfToken = (t) => { csrfToken = t }
export const getCsrfToken = () => csrfToken

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const NO_REFRESH = ['/auth/login', '/auth/signup', '/auth/refresh', '/auth/forgot-password', '/auth/reset-password']
let refreshing = null

export function onUnauthorized(handler) {
  const fn = () => handler()
  window.addEventListener('nexis:unauthorized', fn)
  return () => window.removeEventListener('nexis:unauthorized', fn)
}

async function parse(res) {
  if (res.status === 204) return null
  const text = await res.text()
  try { return text ? JSON.parse(text) : null } catch { return null }
}

function toError(res, data) {
  const e = data && data.error
  return new ApiError(res.status, e?.code || 'http_error',
    e?.message || (res.status >= 500 ? 'Something went wrong on our side. Please try again.' : res.statusText || 'Request failed'),
    e?.details)
}

export async function refreshSession() {
  if (!refreshing) {
    refreshing = fetch(apiUrl('/auth/refresh'), {
      method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'nexis' },
    }).then(async (res) => {
      const data = await parse(res)
      if (!res.ok) throw toError(res, data)
      setCsrfToken(data.csrf_token)
      return data
    }).finally(() => { refreshing = null })  // single-flight: avoids rotating the same token twice
  }
  return refreshing
}

export async function request(method, path, { body, params, signal, _retried = false } = {}) {
  const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')) : ''
  const headers = { 'X-Requested-With': 'nexis' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (UNSAFE.has(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken
  let res
  try {
    res = await fetch(apiUrl(path) + qs, { method, headers, credentials: 'include', signal,
      body: body !== undefined ? JSON.stringify(body) : undefined })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new ApiError(0, 'network_error', 'Cannot reach the server. Check your connection and that the backend is running.')
  }
  const data = await parse(res)
  if (res.ok) return data
  const err = toError(res, data)
  if (!_retried) {
    if (res.status === 401 && !NO_REFRESH.includes(path)) {
      try { await refreshSession() } catch {
        window.dispatchEvent(new Event('nexis:unauthorized'))
        throw err
      }
      return request(method, path, { body, params, signal, _retried: true })
    }
    if (res.status === 403 && err.code === 'csrf_failed') {
      try { const me = await request('GET', '/auth/me', { _retried: true }); setCsrfToken(me.csrf_token) } catch { throw err }
      return request(method, path, { body, params, signal, _retried: true })
    }
  }
  throw err
}

export const api = {
  get: (p, o) => request('GET', p, o),
  post: (p, body, o) => request('POST', p, { ...o, body: body ?? {} }),
  patch: (p, body, o) => request('PATCH', p, { ...o, body }),
  del: (p, o) => request('DELETE', p, o),
}

export function fieldErrors(err) {
  const out = {}
  if (err instanceof ApiError && Array.isArray(err.details)) for (const d of err.details) if (d.field) out[d.field] = d.message
  return out
}
