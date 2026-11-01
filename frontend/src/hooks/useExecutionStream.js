import { useEffect, useRef, useState } from 'react'
import { executionsApi } from '../services/endpoints'
import { streamSSE } from '../lib/sse'

/**
 * Streams persisted execution events. Reconnects with Last-Event-ID; the server replays everything after it,
 * so a page refresh recovers full state. After repeated stream failures it falls back to polling /events.
 */
export function useExecutionStream(executionId, { enabled = true } = {}) {
  const [events, setEvents] = useState([])
  const [connection, setConnection] = useState('idle') // idle|connecting|live|polling|closed
  const [error, setError] = useState(null)
  const lastId = useRef(0)

  useEffect(() => {
    setEvents([]); lastId.current = 0; setError(null)
    if (!executionId || !enabled) { setConnection('idle'); return undefined }
    const ctrl = new AbortController()
    let stopped = false
    const add = (ev) => {
      if (ev.id <= lastId.current) return  // dedupe replayed events
      lastId.current = ev.id
      setEvents((xs) => [...xs, ev])
    }
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

    async function poll() {
      setConnection('polling')
      while (!stopped) {
        try {
          const { events: evs } = await executionsApi.events(executionId, lastId.current)
          evs.forEach(add)
          const done = evs.some((e) => e.type.startsWith('execution.') && ['completed', 'failed', 'cancelled'].includes(e.type.split('.')[1]))
          if (done) { setConnection('closed'); return }
        } catch (e) { if (e.status === 404) { setError(e); setConnection('closed'); return } }
        await sleep(1500)
      }
    }

    async function run() {
      let failures = 0
      while (!stopped) {
        setConnection('connecting')
        try {
          let ended = false
          await streamSSE(`/executions/${executionId}/stream`, {
            lastEventId: lastId.current || undefined, signal: ctrl.signal,
            onMessage: (m) => {
              if (m.event === 'stream.end') { ended = true; return }
              if (m.event === 'heartbeat' || m.event === 'stream.timeout' || !m.id) return
              failures = 0; setConnection('live')
              try { add(JSON.parse(m.data)) } catch { /* ignore malformed frame */ }
            },
          })
          if (ended) { setConnection('closed'); return }
          failures += 1
        } catch (e) {
          if (stopped || e.name === 'AbortError') return
          if (e.status === 404 || e.status === 401 || e.status === 403) { setError(e); setConnection('closed'); return }
          failures += 1
        }
        if (failures >= 3) { await poll(); return }
        await sleep(Math.min(1000 * 2 ** failures, 8000))
      }
    }
    run()
    return () => { stopped = true; ctrl.abort() }
  }, [executionId, enabled])

  return { events, connection, error }
}
