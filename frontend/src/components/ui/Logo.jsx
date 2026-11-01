import { useState } from 'react'
import { cn } from '../../lib/utils'

const SIZES = {
  sm: { img: 'h-6', text: 'text-lg', gap: 'gap-2' },
  md: { img: 'h-7', text: 'text-[1.4rem]', gap: 'gap-2.5' },
  lg: { img: 'h-10', text: 'text-4xl', gap: 'gap-3.5' },
}

/**
 * Logo mark (/brand/nexis-logo.svg) + "NEXIS" wordmark in your custom brand font (/fonts/GarneFont.otf).
 * - The mark is black artwork; `.logo-img` inverts it automatically in the dark theme (see index.css).
 * - If the SVG file is missing only the wordmark is shown (no placeholder logo is invented).
 */
export function Logo({ className, size = 'md', showWordmark = true }) {
  const [imgOk, setImgOk] = useState(true)
  const s = SIZES[size] || SIZES.md
  return (
    <span className={cn('inline-flex items-center', s.gap, className)}>
      {imgOk && (
        <img src="/brand/nexis-logo.svg" alt={showWordmark ? '' : 'NEXIS'} className={cn('logo-img w-auto select-none', s.img)}
          draggable="false" onError={() => setImgOk(false)} />
      )}
      {showWordmark && (
        <span className={cn('font-brand leading-none tracking-[0.12em] text-text', s.text)}>NEXIS</span>
      )}
    </span>
  )
}