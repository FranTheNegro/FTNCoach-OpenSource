/** Pantalla "Vueltas": resumen, tabla de las últimas vueltas y comparación contra la mejor. */
import { LAP_KIND_LABEL, type LapKind, type LapRecord, type LiveFrame, type SessionMeta } from '@shared/live'
import type { Units } from '@shared/api'
import * as fmt from '@ui/format'
import { BINS, type DashTracker, type LapTrace } from './tracker'
import { C, Chip, DASH, Lbl, clamp, signed, type ChipTone } from './kit'

const SHOWN = 8
const X0 = 34
const X1 = 426
const Y_TOP = 16
const Y_BOT = 164

const KIND_TONE: Record<LapKind, ChipTone> = {
  valid: 'record',
  out_lap: 'default',
  in_lap: 'default',
  partial: 'default',
  off_track: 'alert',
  incident: 'error',
}

function stats(laps: LapRecord[]) {
  const valid = laps.filter((l) => l.kind === 'valid').map((l) => l.timeS)
  if (!valid.length) return { median: null, sd: null }
  const sorted = [...valid].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  const avg = valid.reduce((a, b) => a + b, 0) / valid.length
  const sd = valid.length > 1 ? Math.sqrt(valid.reduce((a, b) => a + (b - avg) ** 2, 0) / (valid.length - 1)) : null
  return { median, sd }
}

function Kpi({ label, value, color = C.blanco, sub }: { label: string; value: string; color?: string; sub: string }) {
  return (
    <div className="d2-kpi">
      <Lbl style={{ letterSpacing: '0.1em', fontSize: 12 }}>{label}</Lbl>
      <div className="d2-mono" style={{ fontWeight: 700, fontSize: 25, lineHeight: 1.2, color, whiteSpace: 'nowrap' }}>{value}</div>
      <div style={{ fontSize: 14, color: C.plata, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
    </div>
  )
}

/** Camino SVG que se corta donde falta el dato (NaN). */
function chartPath(values: ArrayLike<number>, y: (v: number) => number): string {
  let d = ''
  let pen = false
  for (let i = 0; i < BINS; i++) {
    const v = values[i]
    if (!Number.isFinite(v)) {
      pen = false
      continue
    }
    const x = X0 + (i / (BINS - 1)) * (X1 - X0)
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y(v).toFixed(1)} `
    pen = true
  }
  return d
}

function deltaSeries(last: LapTrace, best: LapTrace): Float32Array {
  const out = new Float32Array(BINS).fill(NaN)
  for (let i = 0; i < BINS; i++) {
    // t ya cuenta desde la línea de largada de cada vuelta
    const a = last.t[i]
    const b = best.t[i]
    if (Number.isFinite(a) && Number.isFinite(b)) out[i] = a - b
  }
  return out
}

function SectorMarks({ pcts }: { pcts: number[] | null }) {
  if (!pcts) return null
  return (
    <>
      {pcts.slice(1).map((p) => {
        const x = X0 + p * (X1 - X0)
        return <line key={p} x1={x} y1="6" x2={x} y2={Y_BOT} stroke="#3A404B" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      })}
    </>
  )
}

function SectorNames({ pcts, width }: { pcts: number[] | null; width: number }) {
  if (!pcts) return null
  // El SVG se estira al ancho de la tarjeta: las etiquetas se ubican en porcentaje
  return (
    <>
      {pcts.map((p, i) => (
        <span key={p} className="t" style={{ left: ((X0 + p * (X1 - X0)) / width) * 100 + '%', bottom: 0, marginLeft: 2, letterSpacing: '0.1em' }}>
          S{i + 1}
        </span>
      ))}
    </>
  )
}

export function Laps({
  f,
  meta,
  laps,
  units,
  tracker,
}: {
  f: LiveFrame
  meta: SessionMeta | null
  laps: LapRecord[]
  units: Units
  tracker: DashTracker
}) {
  const best = laps.find((l) => l.best) ?? null
  const { median, sd } = stats(laps)
  const ideal = tracker.ideal()
  const shown = [...laps].reverse().slice(0, SHOWN)
  const lastTrace = tracker.lastTrace
  const bestTrace = tracker.bestTrace
  const sameLap = !!lastTrace && !!bestTrace && lastTrace === bestTrace
  const compare = !!lastTrace && !!bestTrace && !sameLap
  const pcts = tracker.sectorsPct
  const W = 434

  const speedY = (v: number) => Y_BOT - clamp(v / 300, 0, 1) * (Y_BOT - Y_TOP)
  const delta = compare ? deltaSeries(lastTrace, bestTrace) : null
  let dMax = 0.5
  if (delta) for (let i = 0; i < BINS; i++) if (Number.isFinite(delta[i])) dMax = Math.max(dMax, Math.abs(delta[i]))
  const dRange = Math.ceil(dMax * 2) / 2
  const deltaY = (v: number) => (Y_TOP + Y_BOT) / 2 - (clamp(v / dRange, -1, 1) * (Y_BOT - Y_TOP)) / 2

  const sectorColor = (lap: number, i: number): { text: string; color: string } => {
    const t = tracker.lapSectors.get(lap)?.[i]
    if (t === null || t === undefined) return { text: DASH, color: C.niebla }
    const b = tracker.bestSec[i]
    const color = b !== null && b !== undefined && Math.abs(t - b) < 0.0005 ? C.mejor : b !== null && b !== undefined && t - b > 0.12 ? C.alerta : C.blanco
    return { text: t.toFixed(3), color }
  }
  const nSectors = pcts?.length ?? 3

  return (
    <main className="d2-body d2-laps">
      <div className="d2-colv">
        <div className="d2-kpis">
          <Kpi label="Mejor vuelta" value={fmt.lapTime(best?.timeS)} color={C.mejor} sub={best ? `Vuelta ${best.lap}` : 'Todavía sin vueltas'} />
          <Kpi label="Vuelta típica" value={fmt.lapTime(median)} sub="Mediana" />
          <Kpi label="Consistencia" value={sd !== null ? `±${sd.toFixed(2)} s` : DASH} sub="Dispersión" />
          <Kpi
            label="Potencial"
            value={ideal !== null && best ? `${signed(ideal - best.timeS, 2)} s` : DASH}
            color={C.azul}
            sub={ideal !== null ? `Ideal ${fmt.lapTime(ideal)}` : 'Faltan sectores'}
          />
        </div>

        <section className="d2-panel fill" style={{ gap: 8 }}>
          <Lbl>Últimas {SHOWN} vueltas</Lbl>
          <div className="d2-lapgrid d2-mono d2-lbl" style={{ padding: '6px 10px', letterSpacing: '0.1em' }}>
            <span>VUELTA</span>
            <span>TIEMPO</span>
            {Array.from({ length: Math.min(3, nSectors) }, (_, i) => (
              <span key={i}>S{i + 1}</span>
            ))}
            {nSectors < 3 && Array.from({ length: 3 - nSectors }, (_, i) => <span key={`x${i}`} />)}
            <span>Δ MEJOR</span>
            <span>ESTADO</span>
          </div>
          {shown.length === 0 && <span style={{ fontSize: 14, color: C.niebla, padding: '14px 10px' }}>Las vueltas aparecen acá a medida que las completás.</span>}
          {shown.map((l) => {
            const d = best && !l.best ? l.timeS - best.timeS : null
            const bad = !l.best && (l.kind === 'incident' || l.kind === 'off_track')
            return (
              <div key={`${l.lap}-${l.timeS}`} className="d2-lapgrid d2-laprow" style={{ background: l.best ? 'rgba(183,124,255,0.08)' : undefined }}>
                <span className="d2-mono" style={{ fontWeight: 700, fontSize: 15, color: C.plata }}>{l.lap}</span>
                <span className="d2-mono" style={{ fontWeight: 700, fontSize: 17, color: l.best ? C.mejor : bad ? C.alerta : C.blanco }}>
                  {fmt.lapTime(l.timeS)}
                </span>
                {[0, 1, 2].map((i) => {
                  const s = i < nSectors ? sectorColor(l.lap, i) : { text: '', color: C.niebla }
                  return (
                    <span key={i} className="d2-mono" style={{ fontSize: 15, color: s.color }}>
                      {s.text}
                    </span>
                  )
                })}
                <span className="d2-mono" style={{ fontSize: 15, color: d === null ? C.niebla : d > 0 ? C.alerta : C.record }}>{d === null ? (l.best ? '±0.000' : DASH) : signed(d, 3)}</span>
                <span>
                  <Chip tone={l.best ? 'best' : KIND_TONE[l.kind]} title={l.reason ?? undefined}>
                    {l.best ? 'Mejor' : LAP_KIND_LABEL[l.kind]}
                  </Chip>
                </span>
              </div>
            )
          })}
        </section>
      </div>

      <div className="d2-colv">
        <section className="d2-panel">
          <Lbl>Velocidad · {compare ? `V${lastTrace.lap} vs mejor` : sameLap ? `V${lastTrace.lap} (tu mejor)` : 'última vs mejor'}</Lbl>
          <div className="d2-chart">
            <svg viewBox={`0 0 ${W} 190`} preserveAspectRatio="none" role="img" aria-label="Velocidad por distancia de la última vuelta comparada con la mejor">
              {[Y_TOP, 90, Y_BOT].map((y) => (
                <line key={y} x1={X0} y1={y} x2={X1} y2={y} stroke="#2C313A" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              ))}
              <SectorMarks pcts={pcts} />
              {bestTrace && <path d={chartPath(bestTrace.speed, speedY)} fill="none" stroke="#B77CFF" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
              {compare && <path d={chartPath(lastTrace.speed, speedY)} fill="none" stroke="#5B7BFF" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
            </svg>
            <span className="t" style={{ left: 0, top: 8 }}>{Math.round(fmt.speed(300, units))}</span>
            <span className="t" style={{ left: 0, top: 82 }}>{Math.round(fmt.speed(150, units))}</span>
            <span className="t" style={{ left: 0, top: 156 }}>0</span>
            <SectorNames pcts={pcts} width={W} />
            {!bestTrace && !lastTrace && (
              <span style={{ position: 'absolute', left: 44, right: 10, top: 70, fontSize: 13, color: C.niebla, textAlign: 'center' }}>
                Completá una vuelta para ver la traza.
              </span>
            )}
          </div>
        </section>

        <section className="d2-panel fill">
          <Lbl>Delta acumulado · última vs mejor</Lbl>
          <div className="d2-chart" style={{ height: 190 }}>
            <svg viewBox={`0 0 ${W} 190`} preserveAspectRatio="none" role="img" aria-label="Diferencia de tiempo acumulada de la última vuelta contra la mejor">
              {[Y_TOP, Y_BOT].map((y) => (
                <line key={y} x1={X0} y1={y} x2={X1} y2={y} stroke="#2C313A" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              ))}
              <line x1={X0} y1={(Y_TOP + Y_BOT) / 2} x2={X1} y2={(Y_TOP + Y_BOT) / 2} stroke="#C3C8D2" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <SectorMarks pcts={pcts} />
              {delta && <path d={chartPath(delta, deltaY)} fill="none" stroke="#FFB020" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
            </svg>
            <span className="t" style={{ left: 0, top: 8 }}>+{dRange.toFixed(1)}</span>
            <span className="t" style={{ left: 0, top: 82 }}>0</span>
            <span className="t" style={{ left: 0, top: 156 }}>−{dRange.toFixed(1)}</span>
            <SectorNames pcts={pcts} width={W} />
            {!delta && (
              <span style={{ position: 'absolute', left: 44, right: 10, top: 70, fontSize: 13, color: C.niebla, textAlign: 'center' }}>
                {sameLap ? 'Tu última vuelta es tu mejor.' : 'Hacen falta dos vueltas completas.'}
              </span>
            )}
          </div>
          <span className="d2-mono" style={{ fontSize: 11, color: C.niebla }}>
            {meta?.track ?? ''}{f.lap ? ` · vuelta ${f.lap} en curso` : ''}
          </span>
        </section>
      </div>
    </main>
  )
}
