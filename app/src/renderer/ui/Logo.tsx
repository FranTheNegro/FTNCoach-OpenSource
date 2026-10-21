// Logo FTN Coach — geometría del Anexo A del manual (grilla 512 × 512).
// Colores siempre sólidos. El cuadradito del dato nunca se inclina.

const TRAZA = 'M160 300 C200 300 236 270 290 266 C306 265 313 273 318 284 L336 332 C342 348 358 352 367 340 C380 320 400 305 424 302'
const TRAZA_SIMPLE = 'M160 300 C200 300 236 270 290 266 C306 265 313 273 318 284 L336 332 C342 348 358 352 367 340 C380 320 400 305 430 302'
const CINTA = 'M205 458 C170 452 152 430 150 395 L150 205 C150 140 188 100 248 100 C280 100 306 110 330 115 L450 141'

interface MonogramProps {
  size?: number | string
  /** Versión simplificada (≤ 48 px): sin divisor ni cuadradito, trazos más gruesos. */
  simplified?: boolean
  /** Color del fondo sobre el que va: el divisor de carriles se pinta con él. */
  background?: string
}

export function Monogram({ size = 40, simplified = typeof size === 'number' && size <= 48, background = '#12151A' }: MonogramProps) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} aria-hidden="true">
      <g transform="translate(20 -20) skewX(-10)">
        <path
          d={simplified ? TRAZA_SIMPLE : TRAZA}
          fill="none"
          stroke="#C3C8D2"
          strokeWidth={simplified ? 34 : 24.5}
          strokeLinejoin="round"
        />
        <path d={CINTA} fill="none" stroke="#1D2BE0" strokeWidth={simplified ? 66 : 56} />
        {!simplified && <path d={CINTA} fill="none" stroke={background} strokeWidth={7} />}
      </g>
      {!simplified && <rect x="398" y="268" width="24" height="24" fill="#C3C8D2" />}
    </svg>
  )
}

/** Logo horizontal: monograma + FTN grande y COACH debajo con tracking amplio. */
export function LogoHorizontal({ height = 32 }: { height?: number }) {
  const ftnSize = Math.round(height * 0.56)
  const display = { fontFamily: 'var(--ftn-font-display)', fontStretch: '125%', fontStyle: 'italic' } as const
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, userSelect: 'none' }} aria-label="FTN Coach">
      <Monogram size={height} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: Math.max(2, height * 0.08) }}>
        <span style={{ ...display, fontSize: ftnSize, fontWeight: 900, lineHeight: 0.9, color: 'var(--ftn-blanco)' }}>FTN</span>
        <span
          style={{
            ...display,
            fontSize: Math.max(7, ftnSize * 0.4),
            fontWeight: 500,
            lineHeight: 1,
            color: 'var(--ftn-plata)',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          {'COACH'.split('').map((c, i) => (
            <span key={i}>{c}</span>
          ))}
        </span>
      </div>
    </div>
  )
}
