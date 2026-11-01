/** Tailwind CSS v3.4 (classic JS config). All brand tokens live in src/styles/index.css as CSS variables. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: v('bg'), surface: v('surface'), 'surface-2': v('surface-2'), border: v('border'),
        text: v('text'), muted: v('muted'), faint: v('faint'), accent: v('accent'), 'accent-fg': v('accent-fg'),
        danger: v('danger'), success: v('success'), warning: v('warning'), info: v('info'),
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        brand: ['Garne', '"Inter Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: { DEFAULT: 'var(--radius)', lg: 'calc(var(--radius) + 2px)', xl: 'calc(var(--radius) + 6px)', '2xl': 'calc(var(--radius) + 12px)' },
      boxShadow: { card: 'var(--shadow-card)', pop: 'var(--shadow-pop)' },
      transitionTimingFunction: { smooth: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    },
  },
  plugins: [],
}