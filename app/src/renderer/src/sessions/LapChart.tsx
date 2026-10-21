/**
 * Evolución de la sesión: una barra por vuelta (todas, también las inválidas y
 * las cortadas) con la mejor y la mediana de referencia, y el ritmo resumido.
 */
import type { LapInfo, SessionDetail } from '@shared/analysis'
import { LAP_KIND_LABEL } from '@shared/live'
import * as fmt from '@ui/format'
import { useWidth } from '../hooks'

const H = 220
const TOP = 16
const BOTTOM = 26
const LEFT = 56

function color(d: SessionDetail, l: LapInfo): string {
  if (l.index === d.bestIndex) return 'var(--ftn-mejor)'
  if (!l.complete) return 'var(--ftn-acero)'
  if (l.kind === 'valid') return 'var(--ftn-azul)'
  if (l.kind === 'off_track') return 'var(--ftn-alerta)'
  if (l.kind === 'incident') return 'var(--ftn-error)'
  return 'var(--ftn-niebla)'
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-carbono rounded-control px-3.5 py-2.5 flex flex-col gap-0.5 min-w-0">
      <span className="data text-[11px] tracking-[0.1em] uppercase text-niebla">{label}</span>
      <span className="data text-[17px] font-medium">{value}</span>
      {sub && <span className="text-[12px] text-niebla truncate">{sub}</span>}
    </div>
  )
}

export function LapChart({ d, selected, onSelect }: { d: SessionDetail; selected: number; onSelect: (i: number) => void }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const valid = d.laps.filter((l) => l.kind === 'valid' && l.complete).map((l) => l.timeS)
  const sorted = [...valid].sort((a, b) => a - b)
  const median = sorted.length ? sorted[sorted.length >> 1] : null
  const mean = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null
  const best = d.bestIndex !== null ? d.laps[d.bestIndex].timeS : null
  // Ritmo: las válidas sin las muy lentas (tráfico, error grande)
  const pace = best !== null ? valid.filter((t) => t <= best * 1.03) : []
  const paceS = pace.length ? pace.reduce((a, b) => a + b, 0) / pace.length : null

  // Escala: de la mejor a un 12 % más; las vueltas más lentas (salida, cortadas) llegan al tope
  const complete = d.laps.filter((l) => l.complete).map((l) => l.timeS)
  const lo = (best ?? Math.min(...complete, Infinity)) * 0.985
  const hi = Math.min(Math.max(...complete, lo + 1), (best ?? lo) * 1.12)
  const plotW = Math.max(0, w - LEFT - 8)
  const n = d.laps.length
  const slot = n ? plotW / n : 0
  const barW = Math.max(3, Math.min(36, slot * 0.7))
  const y = (t: number) => TOP + (1 - Math.min(1, Math.max(0, (t - lo) / (hi - lo || 1)))) * (H - TOP - BOTTOM)
  const ticks = Number.isFinite(lo) ? [lo, (lo + hi) / 2, hi] : []

  return (
    <section className="bg-carbono-2 border border-grafito rounded-card px-5 py-4 flex flex-col gap-3">
      <div className="grid grid-cols-5 gap-2.5">
        <Stat label="Mejor" value={fmt.lapTime(best)} />
        <Stat label="Ritmo" value={fmt.lapTime(paceS)} sub={pace.length ? `${pace.length} vueltas a menos de 3 %` : undefined} />
        <Stat label="Mediana" value={fmt.lapTime(median)} />
        <Stat label="Promedio" value={fmt.lapTime(mean)} sub={`${valid.length} válidas de ${n}`} />
        <Stat label="Consistencia" value={d.consistencyS !== null ? `±${d.consistencyS.toFixed(2)} s` : fmt.DASH} />
      </div>
      <div ref={ref} className="w-full">
        {w > 0 && n > 0 && (
          <svg width={w} height={H} role="img" aria-label="Tiempo de cada vuelta de la sesión">
            {ticks.map((t, i) => (
              <g key={i}>
                <line x1={LEFT} x2={w - 8} y1={y(t)} y2={y(t)} stroke="var(--ftn-grafito)" />
                <text x={LEFT - 6} y={y(t)} fill="var(--ftn-niebla)" fontSize={11} textAnchor="end" dominantBaseline="middle" fontFamily="var(--ftn-font-data)">
                  {fmt.lapTime(t, 1)}
                </text>
              </g>
            ))}
            {median !== null && <line x1={LEFT} x2={w - 8} y1={y(median)} y2={y(median)} stroke="var(--ftn-plata)" strokeDasharray="4 4" opacity={0.6} />}
            {d.laps.map((l, k) => {
              const x = LEFT + k * slot + (slot - barW) / 2
              const top = l.complete ? y(l.timeS) : TOP
              const c = color(d, l)
              const title = `V${l.lap} · ${fmt.lapTime(l.timeS)}${l.kind !== 'valid' ? ` · ${LAP_KIND_LABEL[l.kind]}` : ''}${l.reason ? ` · ${l.reason}` : ''}`
              return (
                <g key={l.index} onClick={() => onSelect(l.index)} className="cursor-pointer">
                  <title>{title}</title>
                  <rect x={LEFT + k * slot} y={TOP} width={slot} height={H - TOP - BOTTOM} fill={l.index === selected ? 'var(--ftn-grafito)' : 'transparent'} />
                  <rect
                    x={x}
                    y={top}
                    width={barW}
                    height={H - BOTTOM - top}
                    fill={l.complete ? c : 'none'}
                    stroke={l.complete ? 'none' : 'var(--ftn-niebla)'}
                    strokeDasharray={l.complete ? undefined : '3 3'}
                  />
                  {l.complete && l.timeS > hi && <rect x={x} y={TOP - 4} width={barW} height={3} fill="var(--ftn-blanco)" />}
                  {(n <= 40 || k % Math.ceil(n / 40) === 0) && (
                    <text x={x + barW / 2} y={H - 8} fill="var(--ftn-niebla)" fontSize={11} textAnchor="middle" fontFamily="var(--ftn-font-data)">
                      {l.lap}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        )}
      </div>
      <div className="flex flex-wrap gap-4 data text-[12px] text-plata">
        {(
          [
            ['var(--ftn-mejor)', 'mejor'],
            ['var(--ftn-azul)', 'válida'],
            ['var(--ftn-alerta)', 'salida de pista'],
            ['var(--ftn-error)', 'incidente'],
            ['var(--ftn-niebla)', 'boxes'],
          ] as const
        ).map(([c, t]) => (
          <span key={t} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5" style={{ background: c }} />
            {t}
          </span>
        ))}
        <span className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 border border-dashed border-niebla" />
          cortada
        </span>
        <span className="text-niebla">línea punteada: mediana · tocá una barra para analizar esa vuelta</span>
      </div>
    </section>
  )
}
