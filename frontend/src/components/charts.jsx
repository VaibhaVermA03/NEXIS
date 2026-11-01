import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useTheme } from '../app/ThemeContext'

const FALLBACK = { accent: '47 126 218', success: '28 140 96', danger: '205 62 62', border: '198 209 215' }

/** Reads the active theme's CSS variables so charts always match the palette (light or dark). */
function useChartColors() {
  const theme = useTheme()
  return useMemo(() => {
    const css = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null
    const get = (n) => (css?.getPropertyValue(`--${n}`).trim() || FALLBACK[n])
    return { accent: `rgb(${get('accent')})`, ok: `rgb(${get('success')})`, bad: `rgb(${get('danger')})`, grid: `rgb(${get('border')} / 0.6)` }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme?.resolved])
}

const axis = { tick: { fontSize: 11, fill: 'currentColor' }, tickLine: false, axisLine: false }
const tip = { contentStyle: { background: 'rgb(var(--surface))', border: '1px solid rgb(var(--border))', borderRadius: 10, fontSize: 12, color: 'rgb(var(--text))' }, cursor: { fill: 'rgb(var(--accent) / 0.08)' } }
const short = (d) => d.slice(5)
const box = 'h-56 text-muted sm:h-64'

export function RunsChart({ data }) {
  const c = useChartColors()
  return (
    <div className={box} role="img" aria-label="Executions per day, completed versus failed">
      <ResponsiveContainer><BarChart data={data} margin={{ left: -20, right: 4 }}>
        <CartesianGrid stroke={c.grid} vertical={false} /><XAxis dataKey="date" tickFormatter={short} minTickGap={16} {...axis} /><YAxis allowDecimals={false} {...axis} />
        <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="completed" name="Completed" stackId="a" fill={c.ok} /><Bar dataKey="failed" name="Failed" stackId="a" fill={c.bad} radius={[4, 4, 0, 0]} />
      </BarChart></ResponsiveContainer>
    </div>)
}

export function DurationChart({ data }) {
  const c = useChartColors()
  return (
    <div className={box} role="img" aria-label="Average execution duration per day in milliseconds">
      <ResponsiveContainer><LineChart data={data} margin={{ left: -10, right: 8 }}>
        <CartesianGrid stroke={c.grid} vertical={false} /><XAxis dataKey="date" tickFormatter={short} minTickGap={16} {...axis} /><YAxis {...axis} width={52} />
        <Tooltip {...tip} /><Line type="monotone" dataKey="avg_duration_ms" name="Avg duration (ms)" stroke={c.accent} strokeWidth={2.2} dot={false} connectNulls />
      </LineChart></ResponsiveContainer>
    </div>)
}

export function UsageChart({ data }) {
  const c = useChartColors()
  return (
    <div className={box} role="img" aria-label="Executions per agent">
      <ResponsiveContainer><BarChart data={data} layout="vertical" margin={{ left: 0, right: 12 }}>
        <CartesianGrid stroke={c.grid} horizontal={false} /><XAxis type="number" allowDecimals={false} {...axis} />
        <YAxis type="category" dataKey="name" width={92} tickFormatter={(n) => (n.length > 13 ? `${n.slice(0, 12)}…` : n)} {...axis} />
        <Tooltip {...tip} /><Bar dataKey="executions" name="Executions" fill={c.accent} radius={[0, 4, 4, 0]} />
      </BarChart></ResponsiveContainer>
    </div>)
}