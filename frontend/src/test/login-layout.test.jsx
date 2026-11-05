import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { anonymous, mockFetch, renderApp } from './utils'

const css = readFileSync(resolve(process.cwd(), 'src/styles/index.css'), 'utf8')
const realMatchMedia = window.matchMedia
const realHeight = window.innerHeight
const desktop = () => { window.matchMedia = (q) => ({ matches: q.includes('1024'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) }
const setOffsetHeight = (h) => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return h } })
afterEach(() => {
  window.matchMedia = realMatchMedia
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: realHeight })
  delete HTMLElement.prototype.offsetHeight
})

describe('login showcase', () => {
  it('no longer shows the three feature tags or the "Autonomous AI agents" capsule; the footer is just the copyright', async () => {
    mockFetch(anonymous())
    renderApp('/login')
    await screen.findByRole('heading', { name: /welcome back/i })
    for (const gone of ['Bounded, observable runs', 'Permissions & approvals', 'Chain agents into workflows', 'Autonomous AI agents',
      'Every step is streamed and recorded', 'Agents only use tools you authorize', 'Repeatable multi-step automation']) expect(screen.queryByText(gone)).toBeNull()
    expect(screen.getByText(`© ${new Date().getFullYear()} NEXIS`)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('From Intent to Execution.')   // headline + example card stay
    expect(screen.getByText('Illustration')).toBeInTheDocument()
  })

  it('desktop is one fixed, non-scrolling screen; the illustration is hidden on short windows; phones just scroll', async () => {
    mockFetch(anonymous())
    renderApp('/signup')
    await screen.findByRole('heading', { name: /create your account/i })
    const root = screen.getByTestId('auth-root')
    expect(root).toHaveClass('lg:h-[100dvh]', 'lg:overflow-hidden', 'lg:grid')          // desktop: exactly one viewport, no scrolling
    expect(root).toHaveClass('min-h-[100dvh]'); expect(root).not.toHaveClass('overflow-hidden')   // phones: min height only => can scroll
    expect(screen.getByText('Illustration').closest('.auth-hide-short')).not.toBeNull()
    expect(css).toMatch(/@media \(max-height: 700px\)\s*{\s*\.auth-hide-short\s*{\s*display:\s*none/)
    const main = screen.getByTestId('auth-fit').closest('main')
    expect(main).toHaveClass('flex', 'items-center', 'justify-center', 'lg:overflow-hidden')   // centred both ways on desktop
  })

  it('desktop: content that is taller than the window is scaled down so it still fits (never scrolls)', async () => {
    desktop(); setOffsetHeight(900); Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 })
    mockFetch(anonymous())
    renderApp('/signup')
    const fit = await screen.findByTestId('auth-fit')
    const s = Number(/scale\(([\d.]+)\)/.exec(fit.style.transform)?.[1])
    expect(s).toBeCloseTo((700 - 24) / 900, 2); expect(fit.style.transformOrigin).toBe('center')
  })

  it('desktop: content that already fits is left at full size; very tall content never shrinks below 62%', async () => {
    desktop(); setOffsetHeight(500); Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    mockFetch(anonymous())
    const first = renderApp('/login')
    expect((await screen.findByTestId('auth-fit')).style.transform).toBe('')
    first.unmount()
    setOffsetHeight(3000)
    renderApp('/login')
    expect(Number(/scale\(([\d.]+)\)/.exec((await screen.findByTestId('auth-fit')).style.transform)[1])).toBeCloseTo(0.62, 2)
  })

  it('phones/tablets: never scaled, even if tall (the page scrolls instead)', async () => {
    setOffsetHeight(2000); Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })   // matchMedia stub = not desktop
    mockFetch(anonymous())
    renderApp('/signup')
    expect((await screen.findByTestId('auth-fit')).style.transform).toBe('')
  })

  it('the login content is compact (tighter spacing and a smaller title than before)', async () => {
    mockFetch(anonymous())
    renderApp('/login')
    const h1 = await screen.findByRole('heading', { name: /welcome back/i })
    expect(h1).toHaveClass('text-2xl'); expect(h1.nextElementSibling).toHaveClass('mt-1.5')
    expect(screen.getByRole('form', { name: 'Sign in' })).toHaveClass('space-y-3')
  })
})