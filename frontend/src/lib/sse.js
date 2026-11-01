// Minimal SSE client built on fetch streaming: cookies included, Last-Event-ID resume, explicit parsing.
import { apiUrl } from './api'

export function parseSSEChunk(buffer) {
  const messages = []
  const parts = buffer.split('\n\n')
  const rest = parts.pop()
  for (const block of parts) {
    const msg = { event: 'message', data: '', id: null }
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue
      const i = line.indexOf(':')
      const field = i === -1 ? line : line.slice(0, i)
      const value = i === -1 ? '' : line.slice(i + 1).replace(/^ /, '')
      if (field === 'event') msg.event = value
      else if (field === 'data') msg.data += (msg.data ? '\n' : '') + value
      else if (field === 'id') msg.id = value
    }
    if (msg.data || msg.event !== 'message') messages.push(msg)
  }
  return { messages, rest }
}

/** Resolves when the stream ends normally; rejects on connection/HTTP errors. */
export async function streamSSE(path, { lastEventId, signal, onMessage }) {
  const headers = { Accept: 'text/event-stream', 'X-Requested-With': 'nexis' }
  if (lastEventId) headers['Last-Event-ID'] = String(lastEventId)
  const res = await fetch(apiUrl(path), { headers, credentials: 'include', signal })
  if (!res.ok || !res.body) {
    const err = new Error(`Stream failed (${res.status})`)
    err.status = res.status
    throw err
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    const { messages, rest } = parseSSEChunk(buf)
    buf = rest
    for (const m of messages) onMessage(m)
  }
}
