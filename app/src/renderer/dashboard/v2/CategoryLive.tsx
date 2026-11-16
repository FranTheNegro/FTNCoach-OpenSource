/**
 * "En vivo" con una skin de categoría (TC, TN, TCR, TP, F1, WRC…). Cada bloque
 * lee del LiveFrame y de la clasificación; la skin solo decide cuáles se ven,
 * dónde (plantilla) y con qué colores y tipografías (variables CSS --sk-*).
 * Si el sim no da un dato, el bloque muestra "–" o se esconde según la skin.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { LapRecord, LiveFrame, SessionMeta, StandingCar, Standings } from '@shared/live'
import type { Units } from '@shared/api'
import { isReplica, type SkinField, type SkinManifest, type SkinTemplate } from '@shared/skin'
import type { StageMapData, StageNote } from '@shared/stage'
import * as fmt from '@ui/format'
import { TrackMapSvg, type MapMarker } from '@ui/TrackMapSvg'
import { C, DASH, clamp, signed, thousands } from './kit'
import { Sector, ShiftLights, shiftState, stageSectors } from './Live'
import { useTrackMap } from './MapPage'
import type { DashTracker } from './tracker'
import { AdDash } from './dash/AdDash'
import { WrcDash } from './dash/WrcDashes'

interface Props {
  skin: SkinManifest
  logoUrl: string | null
  f: LiveFrame
  meta: SessionMeta | null
  laps: LapRecord[]
  standings: Standings | null
  units: Units
  tracker: DashTracker
  /** Pantalla elegida entre las de la skin (si no, la principal). */
  template?: SkinTemplate
}

type Ctx = Props & { sh: ReturnType<typeof shiftState>; has: (k: SkinField) => boolean }

const comma = (x: number, d = 1) => x.toFixed(d).replace('.', ',')

// ── Bloque ──────────────────────────────────────────────────────────────

/**
 * Un dato con su etiqueta. `value` null = el sim no lo da: "–" o nada, según la
 * skin. El estilo de la etiqueta (subrayada, pestaña o simple) lo pone el CSS.
 */
function Field({ c, area, label, value, sub, tone, big = false }: { c: Ctx; area: string; label: string; value: ReactNode | null; sub?: ReactNode; tone?: string; big?: boolean }) {
  if (value === null && c.skin.missing === 'hide') return <div data-area={area} style={{ gridArea: area }} />
  return (
    <section className={`sk-field ${big ? 'big' : ''}`} data-area={area} style={{ gridArea: area }}>
      <span className="sk-lbl">{label}</span>
      <span className="sk-num" style={{ color: value === null ? C.niebla : tone }}>
        {value ?? DASH}
      </span>
      {sub !== undefined && <span className="sk-sub">{sub}</span>}
    </section>
  )
}

// ── Tacómetro en arco ───────────────────────────────────────────────────

const ARC_FROM = 135
const ARC_SWEEP = 270

function polar(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [200 + r * Math.cos(a), 200 + r * Math.sin(a)]
}

function arc(r: number, from: number, to: number): string {
  if (to - from < 0.01) return ''
  const [x0, y0] = polar(r, from)
  const [x1, y1] = polar(r, to)
  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`
}

function ArcTach({ c }: { c: Ctx }) {
  const { f, meta, sh, units } = c
  const top = Math.max(1000, Math.ceil(sh.top / 1000) * 1000)
  const shift = meta?.shiftRpm ?? sh.top * 0.95
  const at = (rpm: number) => ARC_FROM + ARC_SWEEP * clamp(rpm / top, 0, 1)
  const ticks = useMemo(() => Array.from({ length: top / 1000 + 1 }, (_, k) => k), [top])
  const over = f.rpm >= shift
  return (
    <section className={`sk-tach ${sh.flash ? 'flash' : ''} ${sh.fast ? 'fast' : ''}`} style={{ gridArea: 'tach' }}>
      <svg viewBox="0 0 400 400" className="sk-tach-svg" aria-hidden="true">
        <path d={arc(170, ARC_FROM, ARC_FROM + ARC_SWEEP)} className="sk-tach-track" />
        <path d={arc(170, at(shift), ARC_FROM + ARC_SWEEP)} className="sk-tach-red" />
        <path d={arc(170, ARC_FROM, at(f.rpm))} className={`sk-tach-val ${over ? 'over' : ''}`} />
        {ticks.map((k) => {
          const deg = at(k * 1000)
          const [x0, y0] = polar(150, deg)
          const [x1, y1] = polar(136, deg)
          const [tx, ty] = polar(116, deg)
          return (
            <g key={k}>
              <line x1={x0} y1={y0} x2={x1} y2={y1} className="sk-tach-tick" />
              <text x={tx} y={ty} className="sk-tach-n" textAnchor="middle" dominantBaseline="central">
                {k}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="sk-tach-center">
        {c.has('gear') && (
          <span className="sk-gear" style={{ color: f.pitLimiter ? C.alerta : undefined }}>
            {fmt.gear(f.gear)}
          </span>
        )}
        {c.has('speed') && (
          <span className="sk-speed">
            {Math.round(fmt.speed(f.speedKmh, units))}
            <small>{fmt.unitLabel.speed(units)}</small>
          </span>
        )}
      </div>
      {c.has('rpm') && (
        <span className="sk-rpm">
          {thousands(f.rpm)}
          <small>RPM</small>
        </span>
      )}
    </section>
  )
}

// ── Marcha grande (plantillas barra y tramo) ────────────────────────────

function GearBlock({ c }: { c: Ctx }) {
  const { f, units } = c
  return (
    <section className={`sk-gearblock ${c.sh.flash ? 'flash' : ''}`} style={{ gridArea: 'gear' }}>
      {c.has('rpm') && (
        <span className="sk-side">
          <span className="sk-lbl">RPM</span>
          <span className="sk-num">{thousands(f.rpm)}</span>
        </span>
      )}
      <span className="sk-gear" style={{ color: f.pitLimiter ? C.alerta : undefined }}>
        {fmt.gear(f.gear)}
      </span>
      {c.has('speed') && (
        <span className="sk-side right">
          <span className="sk-lbl">{fmt.unitLabel.speed(c.units)}</span>
          <span className="sk-num">{Math.round(fmt.speed(f.speedKmh, units))}</span>
        </span>
      )}
    </section>
  )
}

function Lights({ c }: { c: Ctx }) {
  if (!c.has('rpm')) return <div style={{ gridArea: 'lights' }} />
  return (
    <div className="sk-lights" style={{ gridArea: 'lights' }}>
      <ShiftLights lit={c.sh.lit} flash={c.sh.flash} fast={c.sh.fast} />
    </div>
  )
}

// ── Datos de circuito ───────────────────────────────────────────────────

function me(s: Standings | null): StandingCar | null {
  return s?.cars.find((x) => x.me) ?? null
}

function CircuitFields({ c }: { c: Ctx }) {
  const { f, tracker, units, standings } = c
  const delta = f.deltaS
  const mine = me(standings)
  // Gap con el de adelante: la clasificación si la hay; si no, los rivales en pista (iRacing)
  const gap = mine && mine.position > 1 ? mine.intervalS : (f.rivals?.ahead?.gapS ?? null)
  const leader = (mine?.position ?? f.position) === 1
  const fuelU = fmt.unitLabel.fuel(units)
  const lapsLeft = f.lapsRemaining
  return (
    <>
      {c.has('lap') && <Field c={c} area="lap" label="T. Vuelta" value={fmt.lapTime(tracker.lapTime(f), 3)} sub={f.lastLapS !== null ? `Última ${fmt.lapTime(f.lastLapS)}` : undefined} />}
      {c.has('best') && (
        <Field
          c={c}
          area="best"
          label="V. Rápida"
          value={f.bestLapS !== null ? fmt.lapTime(f.bestLapS) : null}
          tone={C.mejor}
          sub={<span style={{ color: delta === null ? C.niebla : delta < 0 ? C.record : C.alerta }}>{delta === null ? 'Sin delta' : `${signed(delta, 2)} delta`}</span>}
        />
      )}
      {c.has('position') && (
        <Field c={c} area="position" label="Posición" value={f.position ? String(f.position) : mine ? String(mine.position) : null} sub={f.carsInSession ? `de ${f.carsInSession}` : undefined} big />
      )}
      {c.has('laps') && (
        <Field
          c={c}
          area="laps"
          label="Vueltas"
          value={f.lapsTotal ? `${Math.min(f.lap, f.lapsTotal)}/${f.lapsTotal}` : String(f.lap)}
          sub={lapsLeft !== null ? `Faltan ${lapsLeft}` : f.timeRemainingS !== null ? `Quedan ${fmt.clock(f.timeRemainingS)}` : undefined}
        />
      )}
      {c.has('gap') && (
        <Field
          c={c}
          area="gap"
          label="Gap"
          value={leader && standings?.race ? 'Líder' : gap !== null ? (mine && mine.lapsDown > 0 ? `+${mine.lapsDown}V` : `+${comma(gap, 3)}`) : null}
          sub={f.rivals?.behind ? `Atrás ${comma(Math.abs(f.rivals.behind.gapS), 1)}` : undefined}
        />
      )}
      {c.has('fuel') && (
        <Field
          c={c}
          area="fuel"
          label="Nafta"
          value={f.fuelL !== null ? comma(fmt.fuel(f.fuelL, units)) : null}
          sub={f.fuelLapsLeft !== null ? `${comma(f.fuelLapsLeft)} vueltas` : `${fuelU}`}
          tone={f.fuelLapsLeft !== null && lapsLeft !== null && f.fuelLapsLeft < lapsLeft ? C.error : undefined}
        />
      )}
    </>
  )
}

// ── Minimapa ────────────────────────────────────────────────────────────

function MiniMap({ c }: { c: Ctx }) {
  const { f, meta, standings } = c
  const res = useTrackMap(meta)
  const map = res?.map ?? null
  const line = map?.pctLine ?? null
  const at = (pct: number) => (line ? line[Math.max(0, Math.min(line.length - 1, Math.round(pct * (line.length - 1))))] : null)
  const markers: MapMarker[] = []
  for (const car of standings?.cars ?? []) {
    if (car.me || car.inPit || car.lapPct === null) continue
    const p = at(car.lapPct)
    if (p) markers.push({ x: p[0], y: p[1], color: C.plata, size: 0.8 })
  }
  let mine: { x: number; y: number } | null = null
  if (f.pos && map?.source === 'ac') mine = { x: f.pos[0], y: f.pos[1] }
  else {
    const p = at(f.lapPct)
    if (p) mine = { x: p[0], y: p[1] }
  }
  if (mine) markers.push({ ...mine, color: 'var(--sk-accent)', size: 1.4 })
  if (!map) return <Field c={c} area="map" label="Circuito" value={null} sub={res ? res.note : undefined} />
  return (
    <section className="sk-map" data-area="map" style={{ gridArea: 'map' }}>
      <TrackMapSvg map={map} markers={markers} showLabels={false} className="sk-map-svg" />
    </section>
  )
}

/** Rally: la línea del tramo con el auto según la distancia recorrida. */
function StageMini({ c }: { c: Ctx }) {
  const st = c.f.stage
  const id = st?.stageId ?? null
  const [data, setData] = useState<StageMapData | null>(null)
  useEffect(() => {
    setData(null)
    if (!id) return
    let alive = true
    fetch(`/api/stage-map?${new URLSearchParams({ id })}`)
      .then((r) => r.json())
      .then((d: StageMapData) => alive && setData(d))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [id])
  const geo = useMemo(() => {
    const pts = data?.line ?? []
    if (pts.length < 2) return null
    // Coordenadas del juego: x = norte, z = este → en pantalla, este a la derecha y norte arriba
    const xs = pts.map((p) => p.z)
    const ys = pts.map((p) => -p.x)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const pad = Math.max(maxX - minX, maxY - minY) * 0.06
    const step = Math.max(1, Math.floor(pts.length / 800))
    let d = ''
    for (let i = 0; i < pts.length; i += step) d += `${i ? 'L' : 'M'}${xs[i].toFixed(1)} ${ys[i].toFixed(1)}`
    return { d, pts, box: `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`, w: Math.max(maxX - minX, maxY - minY) }
  }, [data])
  if (!st) return <MiniMap c={c} />
  if (!geo) return <Field c={c} area="map" label="Tramo" value={null} sub="El mapa aparece después de la primera pasada." />
  let k = 0
  while (k < geo.pts.length - 1 && geo.pts[k].d < st.distM) k++
  const car = geo.pts[k]
  return (
    <section className="sk-map" data-area="map" style={{ gridArea: 'map' }}>
      <svg viewBox={geo.box} className="sk-map-svg" preserveAspectRatio="xMidYMid meet">
        <path d={geo.d} fill="none" stroke="var(--ftn-acero)" strokeWidth={geo.w / 90} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={car.z} cy={-car.x} r={geo.w / 45} fill="var(--sk-accent)" stroke="var(--ftn-carbono)" strokeWidth={geo.w / 220} />
      </svg>
    </section>
  )
}

// ── Mini tabla de posiciones ────────────────────────────────────────────

const ROWS = 9

/** "Juan Pérez" → "J. PÉREZ". */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length < 2) return name.toUpperCase()
  return `${parts[0][0]}. ${parts[parts.length - 1]}`.toUpperCase()
}

/** El líder y los autos alrededor tuyo (o del enfocado). */
export function windowAround(cars: StandingCar[], focus: number | null, rows: number): StandingCar[] {
  if (cars.length <= rows) return cars
  const at = Math.max(0, cars.findIndex((x) => (focus !== null ? x.idx === focus : x.me)))
  const from = clamp(at - Math.floor((rows - 1) / 2), 1, cars.length - (rows - 1))
  return [cars[0], ...cars.slice(from, from + rows - 1)]
}

function gapText(car: StandingCar, race: boolean): string {
  if (car.position === 1) return race ? 'Líder' : fmt.lapTime(car.bestLapS)
  if (race && car.lapsDown > 0) return `+${car.lapsDown}V`
  const v = race ? car.intervalS : car.gapS
  return v === null ? DASH : `+${comma(v, race ? 1 : 3)}`
}

function MiniStandings({ c }: { c: Ctx }) {
  const s = c.standings
  if (!s || s.cars.length === 0) {
    return (
      <Field
        c={c}
        area="standings"
        label="Posiciones"
        value={null}
        sub={c.f.sim === 'ac' ? 'Activá la app FTN Coach dentro de AC para ver a los demás autos.' : 'Este simulador no informa a los demás autos.'}
      />
    )
  }
  const rows = windowAround(s.cars, null, ROWS)
  const best = Math.min(...s.cars.map((x) => x.bestLapS ?? Infinity))
  return (
    <section className="sk-standings" data-area="standings" style={{ gridArea: 'standings' }}>
      <span className="sk-lbl">Posiciones</span>
      <ol>
        {rows.map((car, i) => (
          <li key={car.idx} className={`${car.me ? 'me' : ''} ${i > 0 && rows[i - 1].position !== car.position - 1 ? 'jump' : ''}`}>
            <span className="pos">{car.position}</span>
            <span className="num">{car.num ?? ''}</span>
            <span className="name">{shortName(car.name)}</span>
            {car.inPit ? <span className="pit">BOX</span> : <span className="gap" style={{ color: car.bestLapS === best && !s.race ? C.mejor : undefined }}>{gapText(car, s.race)}</span>}
          </li>
        ))}
      </ol>
    </section>
  )
}

// ── Rally ───────────────────────────────────────────────────────────────

const NOTE_LABEL: Record<StageNote['kind'], string> = { peligro: 'Peligro', consejo: 'Consejo', nota: 'Nota' }
/** Distancia (m) con la que se anuncia lo que viene. */
const AHEAD_M = 400

function useStageNotes(stageId: string | null): StageNote[] {
  const [notes, setNotes] = useState<StageNote[]>([])
  useEffect(() => {
    setNotes([])
    if (!stageId) return
    let alive = true
    fetch(`/api/stage-notes?${new URLSearchParams({ id: stageId })}`)
      .then((r) => r.json())
      .then((n: StageNote[]) => alive && Array.isArray(n) && setNotes(n))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [stageId])
  return notes
}

function StageFields({ c }: { c: Ctx }) {
  const { f, meta, tracker, units } = c
  const st = f.stage ?? null
  const delta = f.deltaS
  const pct = clamp(f.lapPct, 0, 1)
  const lengthM = st?.lengthM ?? meta?.trackLengthM ?? null
  const doneM = st ? st.distM : lengthM ? pct * lengthM : null
  const sectors = stageSectors(f, tracker)
  const notes = useStageNotes(st?.stageId ?? null)
  const km = (m: number) => (m >= 1000 ? `${comma(m / 1000, 1)} km` : `${Math.round(m)} m`)

  // Avisos: solo datos reales (tus notas del tramo, despistes y golpes, combustible, limitador)
  const warnings: { text: string; tone: string }[] = []
  if (st && doneM !== null) {
    for (const n of notes) {
      const ahead = n.distM - doneM
      if (ahead >= 0 && ahead <= AHEAD_M) warnings.push({ text: `${NOTE_LABEL[n.kind]} en ${Math.round(ahead)} m · ${n.text}`, tone: n.kind === 'peligro' ? C.error : C.blanco })
    }
  }
  if (f.pitLimiter) warnings.push({ text: 'Limitador puesto', tone: C.alerta })
  if (f.fuelL !== null && meta?.fuelMaxL && f.fuelL / meta.fuelMaxL < 0.1) warnings.push({ text: `Nafta baja · ${comma(fmt.fuel(f.fuelL, units))} ${fmt.unitLabel.fuel(units)}`, tone: C.alerta })
  if (st && (st.resets > 0 || st.impacts.length > 0))
    warnings.push({ text: `${st.resets} ${st.resets === 1 ? 'despiste' : 'despistes'} · ${st.impacts.length} ${st.impacts.length === 1 ? 'golpe' : 'golpes'}`, tone: C.alerta })

  return (
    <>
      {c.has('stage') && (
        <Field
          c={c}
          area="stage"
          label="Tramo"
          value={fmt.lapTime(tracker.lapTime(f), 1)}
          big
          sub={<span style={{ color: delta === null ? C.niebla : delta < 0 ? C.record : C.alerta }}>{delta === null ? 'Sin referencia' : `${signed(delta, 1)} vs tu mejor pasada`}</span>}
        />
      )}
      {c.has('distance') && (
        <section className="sk-field" data-area="distance" style={{ gridArea: 'distance' }}>
          <span className="sk-lbl">Distancia</span>
          <span className="sk-num">{doneM !== null ? km(doneM) : DASH}</span>
          <div className="sk-progress">
            <i style={{ width: `${Math.round((lengthM && doneM !== null ? clamp(doneM / lengthM, 0, 1) : pct) * 100)}%` }} />
          </div>
          <span className="sk-sub">{lengthM !== null && doneM !== null ? `Faltan ${km(Math.max(0, lengthM - doneM))} de ${km(lengthM)}` : 'Largo del tramo: después de la primera pasada'}</span>
        </section>
      )}
      {c.has('warnings') && (
        <section className="sk-field sk-warnings" data-area="warnings" style={{ gridArea: 'warnings' }}>
          <span className="sk-lbl">Avisos</span>
          {warnings.length === 0 ? <span className="sk-sub">Sin avisos</span> : warnings.slice(0, 3).map((w, i) => <span key={i} className="sk-warn" style={{ color: w.tone }}>{w.text}</span>)}
        </section>
      )}
      {c.has('splits') && (
        <section className="sk-field sk-splits" data-area="splits" style={{ gridArea: 'splits' }}>
          <span className="sk-lbl">Parciales</span>
          {sectors.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(sectors.length, 6)}, minmax(0, 1fr))`, gap: 12 }}>
              {sectors.slice(0, 6).map((s) => (
                <Sector key={s.name} s={{ ...s, name: s.name.replace(/^S/, 'P') }} />
              ))}
            </div>
          ) : (
            <span className="sk-sub">El tramo no informa parciales.</span>
          )}
        </section>
      )}
      {c.has('fuel') && (
        <Field c={c} area="fuel" label="Nafta" value={f.fuelL !== null ? comma(fmt.fuel(f.fuelL, units)) : null} sub={fmt.unitLabel.fuel(units)} />
      )}
    </>
  )
}

// ── Pantalla ────────────────────────────────────────────────────────────

/** Logo de la categoría (o su sigla). El monograma de FTN queda siempre en el encabezado. */
function Brand({ c }: { c: Ctx }) {
  return <div className="sk-brand">{c.logoUrl ? <img src={c.logoUrl} alt={c.skin.name} /> : <span className="sk-wordmark">{c.skin.short}</span>}</div>
}

export function CategoryLive(props: Props) {
  const { skin, f, meta, tracker } = props
  const t = props.template ?? skin.template
  if (isReplica(t)) {
    const p = { f, meta, standings: props.standings, units: props.units, tracker }
    return <main className="d2-body">{t.startsWith('ad-') ? <AdDash {...p} variant={t === 'ad-motor' ? 'motor' : 'carrera'} /> : <WrcDash {...p} template={t} />}</main>
  }
  const fields = new Set(skin.fields)
  const c: Ctx = { ...props, sh: shiftState(f.rpm, meta, tracker.seenMaxRpm), has: (k) => fields.has(k) }
  return (
    <main className={`d2-body sk-live sk-${t}`}>
      {/* En el arco el logo quedaba de fondo del tacómetro: ahí no va */}
      {t !== 'arco' && <Brand c={c} />}
      {t === 'arco' ? <ArcTach c={c} /> : <><Lights c={c} />{c.has('gear') && <GearBlock c={c} />}</>}
      {t === 'tramo' ? <StageFields c={c} /> : <CircuitFields c={c} />}
      {c.has('map') && (t === 'tramo' ? <StageMini c={c} /> : <MiniMap c={c} />)}
      {t !== 'tramo' && c.has('standings') && <MiniStandings c={c} />}
    </main>
  )
}
