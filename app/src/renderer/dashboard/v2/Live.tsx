/** Pantalla "En vivo": tiempos, conducción, rivales cercanos y estado del auto, con un layout por categoría. */
import { ChevronsDown, ChevronsUp, Radio, Target, Timer, Trophy } from 'lucide-react'
import type { LapRecord, LiveFrame, SessionMeta } from '@shared/live'
import type { Units } from '@shared/api'
import * as fmt from '@ui/format'
import type { History } from '@ui/live-client'
import { C, Chip, DASH, Ico, Lbl, clamp, signed, thousands, type ChipTone } from './kit'
import type { DashTracker, RivalTrend, SectorState } from './tracker'
import type { LayoutId } from './layouts'

interface Props {
  f: LiveFrame
  meta: SessionMeta | null
  laps: LapRecord[]
  units: Units
  tracker: DashTracker
  history: History
}

const SEGMENTS = 24
const DELTA_RANGE_S = 1

/** Color y etiqueta de la goma según su temperatura (°C). */
export function tyreBand(c: number): { color: string; tag: string } {
  if (c < 55) return { color: C.azul, tag: 'FRÍA' }
  if (c < 70) return { color: '#8fa4ff', tag: 'TIBIA' }
  if (c <= 100) return { color: C.blanco, tag: 'OK' }
  if (c <= 112) return { color: C.alerta, tag: 'CALIENTE' }
  return { color: C.error, tag: 'LÍMITE' }
}

export const TYRE_NAMES = ['DEL IZQ', 'DEL DER', 'TRAS IZQ', 'TRAS DER'] as const

// ── Luces de cambio ─────────────────────────────────────────────────────

/** Estado de las luces: apagado, encendiendo, en el cambio (todas parpadean) o pasado de vueltas (parpadeo rápido). */
export function shiftState(rpm: number, meta: SessionMeta | null, seenMax: number) {
  const top = meta?.maxRpm ?? Math.max(4000, seenMax)
  const shift = meta?.shiftRpm ?? top * 0.95
  const first = meta?.firstRpm ?? shift * 0.75
  const blink = meta?.blinkRpm ?? shift * 1.02
  const frac = clamp((rpm - first) / Math.max(1, shift - first), 0, 1)
  return { lit: Math.ceil(frac * SEGMENTS - 1e-6), flash: rpm >= shift, fast: rpm >= blink, top }
}

export function ShiftLights({ lit, flash, fast }: { lit: number; flash: boolean; fast: boolean }) {
  return (
    <div className={`d2-lights ${flash ? 'flash' : ''} ${fast ? 'fast' : ''}`} aria-hidden="true">
      {Array.from({ length: SEGMENTS }, (_, i) => {
        const tone = i >= lit ? '' : i < 10 ? 'b' : i < 16 ? 'w' : i < 21 ? 'y' : 'r'
        return <i key={i} className={tone} style={{ height: Math.round(16 + i * 1.2) }} />
      })}
    </div>
  )
}

// ── Pedales y traza ─────────────────────────────────────────────────────

function Pedal({ label, value, color, text }: { label: string; value: number; color: string; text: string }) {
  return (
    <div className="d2-pedal">
      <div>
        <i style={{ height: `${Math.round(value * 100)}%`, background: color }} />
      </div>
      <Lbl>{label}</Lbl>
      <span className="d2-mono" style={{ fontWeight: 700, fontSize: 14, color: text }}>
        {Math.round(value * 100)} %
      </span>
    </div>
  )
}

function pathOf(h: History, arr: Float32Array, scale: (v: number) => number): string {
  const n = h.count
  if (n < 2) return ''
  const step = n > 320 ? 2 : 1
  let d = ''
  for (let k = 0; k < n; k += step) {
    const x = ((k + (h.size - n)) / (h.size - 1)) * 600
    const y = 148 - clamp(scale(arr[h.at(k)]), 0, 1) * 146
    d += `${d ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)} `
  }
  return d
}

function Trace({ history }: { history: History }) {
  return (
    <div className="d2-trace">
      <svg viewBox="0 0 600 150" preserveAspectRatio="none" role="img" aria-label="Historial de acelerador, freno y velocidad de los últimos segundos">
        {[1, 75, 149].map((y) => (
          <line key={y} x1="0" y1={y} x2="600" y2={y} stroke="#2C313A" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        {[120, 240, 360, 480].map((x) => (
          <line key={x} x1={x} y1="0" x2={x} y2="150" stroke="#3A404B" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={pathOf(history, history.speed, (v) => v / 300)} fill="none" stroke="#8E96A3" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <path d={pathOf(history, history.throttle, (v) => v)} fill="none" stroke="#5B7BFF" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <path d={pathOf(history, history.brake, (v) => v)} fill="none" stroke="#F0F3FA" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  )
}

// ── Rivales ─────────────────────────────────────────────────────────────

const TREND_RGB: Record<RivalTrend['kind'], string> = {
  good: '52,211,153',
  bad: '255,92,92',
  flat: '195,200,210',
  none: '195,200,210',
}
const TREND_COLOR: Record<RivalTrend['kind'], string> = {
  good: C.record,
  bad: C.error,
  flat: C.plata,
  none: C.niebla,
}

function RivalCard({ side, trend, hasRivals }: { side: 'ahead' | 'behind'; trend: RivalTrend; hasRivals: boolean }) {
  const words = side === 'ahead' ? { good: 'Lo alcanzás', flat: 'Estable', bad: 'Se aleja' } : { good: 'Te alejás', flat: 'Estable', bad: 'Se acerca' }
  const alpha = trend.kind === 'none' ? 0 : trend.kind === 'flat' ? 0.08 : 0.1 + 0.14 * trend.strength
  const word = trend.kind === 'none' ? (hasRivals ? 'Pista libre' : 'Sin datos del sim') : words[trend.kind]
  const title = (side === 'ahead' ? 'ADELANTE' : 'ATRÁS') + (trend.car?.num ? ` #${trend.car.num}` : '')
  const color = TREND_COLOR[trend.kind]
  return (
    <div className="d2-rival" style={{ background: `linear-gradient(90deg, rgba(${TREND_RGB[trend.kind]},${alpha}) 0%, rgba(${TREND_RGB[trend.kind]},0) 75%), var(--ftn-carbono-2)` }}>
      <Ico icon={side === 'ahead' ? ChevronsUp : ChevronsDown} size={30} color={color} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
        <Lbl>{title}</Lbl>
        <span style={{ fontSize: 14, fontWeight: 600, color, whiteSpace: 'nowrap' }}>{word}</span>
      </div>
      <span className="d2-mono" style={{ fontWeight: 700, fontSize: 28, lineHeight: 1, whiteSpace: 'nowrap' }}>
        {trend.gapS === null ? DASH : `${side === 'ahead' ? '−' : '+'}${trend.gapS.toFixed(1)}`}
        {trend.gapS !== null && <span style={{ fontSize: 13, fontWeight: 500, color: C.niebla }}> s</span>}
      </span>
    </div>
  )
}

// ── Consejo del momento ─────────────────────────────────────────────────

interface Advice {
  tag: string
  text: string
  chip: string
  tone: ChipTone
}

function adviceOf(f: LiveFrame, units: Units): Advice {
  const fuelU = fmt.unitLabel.fuel(units)
  if (f.lapsRemaining !== null && f.fuelLapsLeft !== null && f.fuelPerLapL !== null && f.fuelLapsLeft < f.lapsRemaining) {
    const missing = (f.lapsRemaining - f.fuelLapsLeft) * f.fuelPerLapL
    return {
      tag: 'COMBUSTIBLE',
      text: `Con este consumo no llegás al final: te faltan ${fmt.fuel(missing, units).toFixed(1)} ${fuelU}. Ahorrá o planeá una parada.`,
      chip: `−${fmt.fuel(missing, units).toFixed(1)} ${fuelU}`,
      tone: 'alert',
    }
  }
  const hot = f.tyreTempC ? f.tyreTempC.findIndex((t) => t > 112) : -1
  if (hot >= 0 && f.tyreTempC) {
    return { tag: 'NEUMÁTICOS', text: `${TYRE_NAMES[hot]} pasada de temperatura (${Math.round(fmt.temp(f.tyreTempC[hot], units))}${fmt.unitLabel.temp(units)}). Suavizá las entradas.`, chip: 'Atención', tone: 'error' }
  }
  const hotBrake = f.brakeTempC ? f.brakeTempC.findIndex((t) => t > 800) : -1
  if (hotBrake >= 0) {
    return { tag: 'FRENOS', text: `Frenos ${TYRE_NAMES[hotBrake]} muy calientes. Dejalos respirar en la próxima recta.`, chip: 'Atención', tone: 'alert' }
  }
  if (f.fuelLapsLeft !== null && f.fuelLapsLeft < 3) {
    return { tag: 'COMBUSTIBLE', text: `Quedan ${f.fuelLapsLeft.toFixed(1).replace('.', ',')} vueltas de combustible.`, chip: 'Boxes pronto', tone: 'alert' }
  }
  if (f.deltaS !== null) {
    const d = f.deltaS
    return d <= 0
      ? { tag: 'RITMO', text: `Vas ${Math.abs(d).toFixed(2).replace('.', ',')} s más rápido que tu mejor vuelta. Mantené el ritmo.`, chip: 'En ritmo', tone: 'record' }
      : { tag: 'RITMO', text: `Vas ${d.toFixed(2).replace('.', ',')} s detrás de tu mejor vuelta.`, chip: 'Info', tone: 'default' }
  }
  return { tag: 'RITMO', text: 'Completá una vuelta para empezar a comparar contra tu mejor tiempo.', chip: 'Info', tone: 'default' }
}

// ── Sectores ────────────────────────────────────────────────────────────

const GRADE_COLOR = { best: C.mejor, close: C.blanco, slow: C.alerta } as const

function Sector({ s }: { s: SectorState }) {
  const color = s.state === 'live' ? C.azul : s.state === 'done' ? GRADE_COLOR[s.grade ?? 'close'] : C.niebla
  const tag = s.state === 'live' ? 'EN CURSO' : s.state === 'done' ? (s.grade === 'best' ? 'MEJOR' : s.diffS !== null ? signed(s.diffS, 2) : '') : ''
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div className="d2-lbl d2-mono" style={{ display: 'flex', justifyContent: 'space-between', letterSpacing: '0.08em' }}>
        <span>{s.name}</span>
        <span style={{ color }}>{tag}</span>
      </div>
      <div className="d2-mono" style={{ fontWeight: 700, fontSize: 18, lineHeight: 1.1, color }}>
        {s.timeS === null ? '—' : s.timeS.toFixed(3)}
      </div>
      <div className="d2-bar">
        <i style={{ width: `${Math.round(s.progress * 100)}%`, background: color }} />
      </div>
    </div>
  )
}

// ── Paneles ─────────────────────────────────────────────────────────────

/** Lo que comparten los paneles de una pantalla (se calcula una vez por frame). */
interface Ctx extends Props {
  sh: ReturnType<typeof shiftState>
  delta: number | null
  faster: boolean
  deltaColor: string
  remaining: string | null
}

function TimingPanel({ c, title = 'actual' }: { c: Ctx; title?: string }) {
  const { f, tracker, delta, faster, deltaColor, remaining } = c
  const w = delta === null ? 0 : (Math.min(Math.abs(delta), DELTA_RANGE_S) / DELTA_RANGE_S) * 50
  return (
    <section className="d2-panel" style={{ gap: 8 }}>
      <div className="d2-between">
        <Lbl>
          Vuelta {f.lap} · {title}
        </Lbl>
        {remaining && <span className="d2-mono" style={{ fontSize: 12, color: C.niebla }}>Resta {remaining}</span>}
      </div>
      <div className="d2-mono d2-clock">{fmt.lapTime(tracker.lapTime(f), 3)}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <span className="d2-mono" style={{ fontWeight: 700, fontSize: 34, lineHeight: 1.1, color: deltaColor }}>
          {delta === null ? DASH : signed(delta, 3)}
        </span>
        <span className="d2-mono" style={{ fontSize: 11, letterSpacing: '0.1em', color: C.niebla }}>
          {delta === null ? 'SIN DELTA' : `${faster ? 'ADELANTE' : 'ATRÁS'} VS MEJOR`}
        </span>
      </div>
      <div>
        <div className="d2-deltabar">
          {delta !== null && <b style={{ left: `${faster ? 50 - w : 50}%`, width: `${w}%`, background: deltaColor }} />}
          <span />
        </div>
        <div className="d2-mono" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, color: C.niebla }}>
          <span>−1.0 s</span>
          <span>0</span>
          <span>+1.0 s</span>
        </div>
      </div>
    </section>
  )
}

function SectorsPanel({ c, fill = false }: { c: Ctx; fill?: boolean }) {
  const sectors = c.tracker.sectors(c.f)
  return (
    <section className={`d2-panel ${fill ? 'fill' : ''}`} style={{ gap: 12 }}>
      <Lbl>Sectores</Lbl>
      {sectors.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${sectors.length}, minmax(0, 1fr))`, gap: 10 }}>
          {sectors.map((s) => (
            <Sector key={s.name} s={s} />
          ))}
        </div>
      ) : (
        <span style={{ fontSize: 13, color: C.niebla }}>Este circuito no informa sectores.</span>
      )}
    </section>
  )
}

function RefsPanel({ c }: { c: Ctx }) {
  const { f, laps, tracker } = c
  const best = f.bestLapS
  const lastIsBest = f.lastLapS !== null && best !== null && Math.abs(f.lastLapS - best) < 0.0005
  const lastDiff = f.lastLapS !== null && best !== null ? f.lastLapS - best : null
  const ideal = tracker.ideal()
  const bestLapNo = laps.find((l) => l.best)?.lap ?? null
  return (
    <section className="d2-panel fill" style={{ gap: 6 }}>
      <Lbl>Referencias</Lbl>
      <div className="d2-ref">
        <Ico icon={Timer} size={26} color={C.blanco} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 13, color: C.plata }}>Última vuelta</span>
          <span className="d2-mono" style={{ fontSize: 11, color: lastIsBest ? C.mejor : C.alerta }}>
            {f.lastLapS === null ? 'Todavía sin vueltas' : lastIsBest ? 'Mejor de la sesión' : `${signed(lastDiff, 3)} vs mejor`}
          </span>
        </div>
        <span className="d2-mono" style={{ fontWeight: 700, fontSize: 20 }}>{fmt.lapTime(f.lastLapS)}</span>
      </div>
      <div className="d2-ref">
        <Ico icon={Trophy} size={26} color={C.mejor} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 13, color: C.plata }}>Mejor vuelta</span>
          <span className="d2-mono" style={{ fontSize: 11, color: C.niebla }}>{bestLapNo !== null ? `Vuelta ${bestLapNo}` : 'De la sesión'}</span>
        </div>
        <span className="d2-mono" style={{ fontWeight: 700, fontSize: 20, color: C.mejor }}>{fmt.lapTime(best)}</span>
      </div>
      <div className="d2-ref">
        <Ico icon={Target} size={26} color={C.azul} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 13, color: C.plata }}>Ideal de la sesión</span>
          <span className="d2-mono" style={{ fontSize: 11, color: C.niebla }}>
            {ideal !== null && best !== null ? `${signed(ideal - best, 3)} s de potencial` : 'Completá los tres sectores'}
          </span>
        </div>
        <span className="d2-mono" style={{ fontWeight: 700, fontSize: 20, color: C.azul }}>{fmt.lapTime(ideal)}</span>
      </div>
    </section>
  )
}

function Hero({ c, pedals = true }: { c: Ctx; pedals?: boolean }) {
  const { f, meta, units, sh, history } = c
  return (
    <section className={`d2-hero ${sh.flash ? 'flash' : ''} ${sh.fast ? 'fast' : ''}`}>
      <ShiftLights lit={sh.lit} flash={sh.flash} fast={sh.fast} />

      <div className="d2-gearrow">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Lbl>RPM</Lbl>
          <span className="d2-mono" style={{ fontWeight: 700, fontSize: 38, lineHeight: 1 }}>{thousands(f.rpm)}</span>
          <span className="d2-mono" style={{ fontSize: 11, letterSpacing: '0.08em', color: C.niebla }}>
            {meta?.maxRpm ? `LÍMITE ${thousands(meta.maxRpm)}` : ''}
          </span>
        </div>
        <div className="d2-display d2-gear" style={{ color: f.pitLimiter ? C.alerta : C.blanco }}>{fmt.gear(f.gear)}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          <Lbl>{fmt.unitLabel.speed(units)}</Lbl>
          <span className="d2-mono" style={{ fontWeight: 700, fontSize: 76, lineHeight: 1 }}>{Math.round(fmt.speed(f.speedKmh, units))}</span>
        </div>
      </div>

      {pedals && (
        <>
          <div style={{ height: 1, background: C.grafito }} />
          <div className="d2-pedals">
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <Pedal label="ACEL" value={f.throttle} color={C.azul} text={C.azul} />
              <Pedal label="FRENO" value={f.brake} color={C.blanco} text={C.blanco} />
              <Pedal label="EMB" value={f.clutch} color={C.niebla} text={C.plata} />
            </div>
            <Trace history={history} />
          </div>
        </>
      )}
    </section>
  )
}

function RivalsPair({ c, big = false }: { c: Ctx; big?: boolean }) {
  const hasRivals = !!c.f.rivals
  return (
    <div className={`d2-rivals2 ${big ? 'big' : ''}`}>
      <RivalCard side="ahead" trend={c.tracker.trend('ahead')} hasRivals={hasRivals} />
      <RivalCard side="behind" trend={c.tracker.trend('behind')} hasRivals={hasRivals} />
    </div>
  )
}

function CoachBar({ c }: { c: Ctx }) {
  const advice = adviceOf(c.f, c.units)
  return (
    <section className="d2-coach">
      <Ico icon={Radio} size={24} color={C.azul} />
      <span className="d2-mono" style={{ fontSize: 12, letterSpacing: '0.1em', whiteSpace: 'nowrap' }}>{advice.tag}</span>
      <span style={{ fontSize: 14, color: C.plata, flex: 1, minWidth: 0 }}>{advice.text}</span>
      <Chip tone={advice.tone}>{advice.chip}</Chip>
    </section>
  )
}

function FuelPanel({ c }: { c: Ctx }) {
  const { f, meta, units } = c
  const fuelU = fmt.unitLabel.fuel(units)
  const fuelPct = f.fuelL !== null && meta?.fuelMaxL ? Math.round(clamp(f.fuelL / meta.fuelMaxL, 0, 1) * 100) : null
  return (
    <section className="d2-panel">
      <div className="d2-between">
        <Lbl>Combustible</Lbl>
        <span className="d2-mono" style={{ fontSize: 12, color: C.niebla }}>
          {f.fuelPerLapL !== null ? `${fmt.fuel(f.fuelPerLapL, units).toFixed(2).replace('.', ',')} ${fuelU}/vuelta` : 'Calculando consumo…'}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="d2-mono" style={{ fontWeight: 700, fontSize: 38, lineHeight: 1 }}>
          {f.fuelL !== null ? fmt.fuel(f.fuelL, units).toFixed(1).replace('.', ',') : DASH}
        </span>
        <span className="d2-mono" style={{ fontSize: 14, color: C.niebla }}>{fuelU}</span>
        <span className="d2-mono" style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 18, color: C.azul }}>
          {f.fuelLapsLeft !== null ? `${f.fuelLapsLeft.toFixed(1).replace('.', ',')} vueltas` : ''}
        </span>
      </div>
      <div className="d2-progress">
        <i style={{ width: `${fuelPct ?? 0}%` }} />
      </div>
    </section>
  )
}

function TyresPanel({ c, fill = false }: { c: Ctx; fill?: boolean }) {
  const { f, units } = c
  return (
    <section className={`d2-panel ${fill ? 'fill' : ''}`}>
      <Lbl>Neumáticos</Lbl>
      <div className="d2-grid2">
        {TYRE_NAMES.map((name, i) => {
          const t = f.tyreTempC?.[i]
          const ok = t !== undefined && t > 0
          const band = ok ? tyreBand(t) : { color: C.niebla, tag: '' }
          const press = f.tyrePressKpa?.[i]
          const wear = f.tyreWear?.[i]
          return (
            <div key={name} className="d2-tile" style={{ padding: '10px 12px', gap: 3 }}>
              <div className="d2-mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, letterSpacing: '0.08em', color: C.niebla }}>
                <span>{name}</span>
                <span style={{ color: band.color }}>{band.tag}</span>
              </div>
              <div className="d2-mono" style={{ fontWeight: 700, fontSize: 26, lineHeight: 1.1, color: band.color }}>
                {ok ? Math.round(fmt.temp(t, units)) : DASH}
                <span style={{ fontSize: 13, fontWeight: 500 }}> {fmt.unitLabel.temp(units)}</span>
              </div>
              <div className="d2-mono" style={{ fontSize: 12, color: C.plata }}>
                {press !== undefined && press > 0 ? `${fmt.press(press, units).toFixed(units === 'metric' ? 0 : 1)} ${fmt.unitLabel.press(units)}` : DASH}
              </div>
              <div className="d2-bar" style={{ height: 3 }}>
                <i style={{ width: `${wear !== undefined && wear !== null ? Math.round(clamp(wear, 0, 1) * 100) : 0}%`, background: band.color }} />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function AidsPanel({ c, fill = true }: { c: Ctx; fill?: boolean }) {
  const { f } = c
  const bias = f.brakeBias
  const biasD = bias === null ? 0 : clamp(bias - 50, -15, 15)
  const biasW = (Math.abs(biasD) / 15) * 50
  return (
    <section className={`d2-panel ${fill ? 'fill' : ''}`}>
      <Lbl>Ajustes en pista</Lbl>
      <div className="d2-grid2">
        <div className="d2-tile">
          <Lbl style={{ letterSpacing: '0.1em', fontSize: 10 }}>BB</Lbl>
          <span className="d2-mono" style={{ fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>
            {bias !== null ? `${bias.toFixed(1).replace('.', ',')} %` : DASH}
          </span>
          {bias !== null && (
            <div className="d2-bb">
              <b style={{ left: `${biasD >= 0 ? 50 : 50 - biasW}%`, width: `${biasW}%` }} />
              <span />
            </div>
          )}
        </div>
        <Setting k="TC" v={f.tc !== null ? String(Math.round(f.tc)) : DASH} />
        <Setting k="ABS" v={f.abs !== null ? String(Math.round(f.abs)) : DASH} />
        <Setting k="INCID." v={f.incidents !== null ? `${f.incidents}x` : DASH} />
      </div>
    </section>
  )
}

/** Óvalo: posición, vueltas que faltan y si el combustible llega. */
function RacePanel({ c }: { c: Ctx }) {
  const { f, units } = c
  const fuelU = fmt.unitLabel.fuel(units)
  const spare = f.fuelLapsLeft !== null && f.lapsRemaining !== null ? f.fuelLapsLeft - f.lapsRemaining : null
  return (
    <section className="d2-panel" style={{ gap: 12 }}>
      <div className="d2-between">
        <Lbl>Carrera</Lbl>
        <span className="d2-mono" style={{ fontSize: 12, color: C.niebla }}>{f.incidents !== null ? `Inc. ${f.incidents}x` : ''}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span className="d2-display" style={{ fontSize: 72, lineHeight: 0.95 }}>{f.position ? `P${f.position}` : DASH}</span>
        {f.carsInSession ? <span className="d2-mono" style={{ fontSize: 16, color: C.niebla }}>de {f.carsInSession}</span> : null}
      </div>
      <div className="d2-grid2">
        <Setting k="VUELTAS QUE FALTAN" v={f.lapsRemaining !== null ? String(f.lapsRemaining) : f.timeRemainingS !== null ? fmt.clock(f.timeRemainingS) : DASH} />
        <div className="d2-tile">
          <Lbl style={{ letterSpacing: '0.1em', fontSize: 10 }}>COMBUSTIBLE AL FINAL</Lbl>
          <span className="d2-mono" style={{ fontWeight: 700, fontSize: 22, lineHeight: 1.1, color: spare === null ? C.blanco : spare >= 0 ? C.record : C.error }}>
            {spare === null ? DASH : `${spare >= 0 ? '+' : '−'}${Math.abs(spare).toFixed(1).replace('.', ',')} v`}
          </span>
          <span className="d2-mono" style={{ fontSize: 11, color: C.niebla }}>
            {f.fuelL !== null ? `${fmt.fuel(f.fuelL, units).toFixed(1).replace('.', ',')} ${fuelU} en el tanque` : ''}
          </span>
        </div>
      </div>
    </section>
  )
}

/** Rally: tiempo del tramo, cuánto falta y los parciales. */
function StagePanel({ c }: { c: Ctx }) {
  const { f, meta, tracker, delta, deltaColor } = c
  const sectors = tracker.sectors(f)
  const pct = clamp(f.lapPct, 0, 1)
  const leftM = meta?.trackLengthM ? (1 - pct) * meta.trackLengthM : null
  return (
    <section className="d2-panel fill" style={{ gap: 14 }}>
      <Lbl>Tramo</Lbl>
      <div className="d2-mono d2-clock">{fmt.lapTime(tracker.lapTime(f), 1)}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span className="d2-mono" style={{ fontWeight: 700, fontSize: 30, lineHeight: 1.1, color: deltaColor }}>{delta === null ? DASH : signed(delta, 1)}</span>
        <span className="d2-mono" style={{ fontSize: 11, letterSpacing: '0.1em', color: C.niebla }}>{delta === null ? 'SIN REFERENCIA' : 'VS TU MEJOR PASADA'}</span>
      </div>
      <div>
        <div className="d2-progress">
          <i style={{ width: `${Math.round(pct * 100)}%` }} />
        </div>
        <div className="d2-mono" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 12, color: C.niebla }}>
          <span>{Math.round(pct * 100)} %</span>
          <span>{leftM !== null ? `Faltan ${leftM >= 1000 ? `${(leftM / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(leftM)} m`}` : ''}</span>
        </div>
      </div>
      {sectors.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${sectors.length}, minmax(0, 1fr))`, gap: 10 }}>
          {sectors.map((s) => (
            <Sector key={s.name} s={{ ...s, name: s.name.replace(/^S/, 'P') }} />
          ))}
        </div>
      )}
    </section>
  )
}

// ── Pantalla ────────────────────────────────────────────────────────────

export function Live(props: Props & { layout: LayoutId }) {
  const { f, meta, tracker, layout } = props
  const delta = f.deltaS
  const faster = delta !== null && delta < 0
  const c: Ctx = {
    ...props,
    sh: shiftState(f.rpm, meta, tracker.seenMaxRpm),
    delta,
    faster,
    deltaColor: delta === null ? C.niebla : faster ? C.record : delta === 0 ? C.blanco : C.alerta,
    remaining: f.timeRemainingS !== null ? fmt.clock(f.timeRemainingS) : f.lapsRemaining !== null ? `${f.lapsRemaining} v` : null,
  }

  if (layout === 'formula')
    return (
      <main className="d2-body d2-live d2-formula">
        <div className="d2-colv">
          <TimingPanel c={c} />
          <SectorsPanel c={c} />
          <RefsPanel c={c} />
        </div>
        <div className="d2-colv">
          <Hero c={c} />
          <CoachBar c={c} />
        </div>
        <div className="d2-colv">
          <RivalsPair c={c} />
          <TyresPanel c={c} fill />
          <AidsPanel c={c} fill={false} />
        </div>
      </main>
    )

  if (layout === 'oval')
    return (
      <main className="d2-body d2-live d2-oval">
        <div className="d2-colv">
          <RacePanel c={c} />
          <TimingPanel c={c} />
          <FuelPanel c={c} />
        </div>
        <div className="d2-colv">
          <Hero c={c} pedals={false} />
          <RivalsPair c={c} big />
          <CoachBar c={c} />
        </div>
        <div className="d2-colv">
          <TyresPanel c={c} fill />
          <AidsPanel c={c} fill={false} />
        </div>
      </main>
    )

  if (layout === 'rally')
    return (
      <main className="d2-body d2-live d2-simple">
        <div className="d2-colv">
          <Hero c={c} />
          <CoachBar c={c} />
        </div>
        <div className="d2-colv">
          <StagePanel c={c} />
          <TyresPanel c={c} />
        </div>
      </main>
    )

  return (
    <main className="d2-body d2-live">
      {/* Columna izquierda: tiempos */}
      <div className="d2-colv">
        <TimingPanel c={c} />
        <SectorsPanel c={c} />
        <RefsPanel c={c} />
      </div>

      {/* Columna central: conducción */}
      <div className="d2-colv">
        <Hero c={c} />
        <RivalsPair c={c} />
        <CoachBar c={c} />
      </div>

      {/* Columna derecha: auto */}
      <div className="d2-colv">
        <FuelPanel c={c} />
        <TyresPanel c={c} />
        <AidsPanel c={c} />
      </div>
    </main>
  )
}

function Setting({ k, v }: { k: string; v: string }) {
  return (
    <div className="d2-tile">
      <Lbl style={{ letterSpacing: '0.1em', fontSize: 10 }}>{k}</Lbl>
      <span className="d2-mono" style={{ fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>{v}</span>
    </div>
  )
}
