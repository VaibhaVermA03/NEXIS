import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Guard: demo / mock / sample-order content must never creep back into the shipped frontend.
const FORBIDDEN = /demo|mock|sample[ _]?order|is_demo|order_lookup|shipping_status|send_email|ORD-\d{4}|by_mode/i
const ROOT = resolve(process.cwd(), 'src')

function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return n === 'test' ? [] : files(p)   // tests may mention what they assert is absent
    return /\.(jsx?|css)$/.test(n) ? [p] : []
  })
}

describe('no demo content in the frontend', () => {
  it('app source contains no demo / mock / sample-order references', () => {
    const hits = files(ROOT).flatMap((f) => readFileSync(f, 'utf8').split('\n').map((line, i) => [f, i + 1, line]).filter(([, , l]) => FORBIDDEN.test(l))
      .map(([file, n, l]) => `${file.replace(ROOT, 'src')}:${n}: ${l.trim().slice(0, 90)}`))
    expect(hits).toEqual([])
  })
  it('public assets and index.html mention no demo', () => {
    expect(readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')).not.toMatch(/demo|mock/i)
  })
})