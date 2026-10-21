/** Pantalla "Coche": gomas por zona, frenos, reparto de freno, motor y estrategia. */
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { LiveFrame, SessionMeta } from '@shared/live'
import type { Units } from '@shared/api'
import * as fmt from '@ui/format'
import { C, Chip, DASH, Ico, Lbl, clamp } from './kit'
import { TYRE_NAMES, tyreBand } from './Live'

const POS: { col: number; row: number }[] = [
  { col: 1, row: 1 },
  { col: 3, row: 1 },
  { col: 1, row: 2 },
  { col: 3, row: 2 },
]

const ZONE_NAMES = ['INT', 'CEN', 'EXT'] as const

function brakeColor(c: number): string {
  if (c < 250) return C.azul
  if (c <= 650) return C.blanco
  if (c <= 800) return C.alerta
  return C.error
}

/** Reparto de freno: escala 35–65 %, el centro (50 %) es la línea blanca. Arriba = frente. */
function BrakeBias({ bias }: { bias: number | null }) {
  const d = bias === null ? 0 : clamp(bias - 50, -15, 15)
  const h = (Math.abs(d) / 30) * 100
  const front = d >= 0
  const labels: [string, number, boolean][] = [
    ['65', 0, false],
    ['57,5', 25, false],
    ['50 %', 50, true],
    ['42,5', 75, false],
    ['35', 100, false],
  ]
  return (
    <div className="d2-carbody">
      <span className="d2-lbl" style={{ display: 'flex', alignItems: 'center', gap: 6, letterSpacing: '0.14em' }}>
        <Ico icon={ChevronUp} size={14} />
        FRENTE
      </span>
      <Lbl style={{ fontSize: 10, letterSpacing: '0.1em' }}>REPARTO FRENO</Lbl>
      <div style={{ flex: 1, minHeight: 0, width: '100%', display: 'flex', alignItems: 'stretch', justifyContent: 'center', gap: 10, padding: '0 10px', boxSizing: 'border-box' }}>
        <div className="d2-bbv">
          {bias !== null && <i style={{ top: `${front ? 50 - h : 50}%`, height: `${h}%` }} />}
          <u style={{ top: '25%' }} />
          <u style={{ top: '75%' }} />
          <b />
        </div>
        <div className="d2-mono" style={{ position: 'relative', width: 46, fontSize: 10, letterSpacing: '0.06em', color: C.niebla }}>
          {labels.map(([t, pct, strong]) => (
            <span
              key={t}
              style={{
                position: 'absolute',
                left: 0,
                top: pct === 100 ? undefined : `${pct}%`,
                bottom: pct === 100 ? 0 : undefined,
                marginTop: pct === 0 || pct === 100 ? 0 : -6,
                color: strong ? C.blanco : undefined,
                fontWeight: strong ? 700 : undefined,
              }}
            >
              {t}
            </span>
          ))}
        </div>
      </div>
      <span className="d2-mono" style={{ fontWeight: 700, fontSize: 26, lineHeight: 1 }}>
        {bias === null ? DASH : `${bias.toFixed(1).replace('.', ',')} %`}
      </span>
      <span className="d2-mono" style={{ fontSize: 11, letterSpacing: '0.06em', color: C.azul, textAlign: 'center' }}>
        {bias === null ? 'Sin dato del sim' : `${d >= 0 ? '+' : '−'}${Math.abs(bias - 50).toFixed(1).replace('.', ',')} hacia ${front ? 'el frente' : 'atrás'}`}
      </span>
      <span className="d2-lbl" style={{ display: 'flex', alignItems: 'center', gap: 6, letterSpacing: '0.14em' }}>
        ATRÁS
        <Ico icon={ChevronDown} size={14} />
      </span>
    </div>
  )
}

function Row({ k, v, color = C.blanco }: { k: string; v: string; color?: string }) {
  return (
    <div className="d2-rowline">
      <span style={{ fontSize: 13, color: C.plata }}>{k}</span>
      <span className="d2-mono" style={{ fontWeight: 700, fontSize: 15, color }}>{v}</span>
    </div>
  )
}

export function Car({ f, meta, units }: { f: LiveFrame; meta: SessionMeta | null; units: Units }) {
  const zones = f.tyreZonesC ?? null
  const fuelU = fmt.unitLabel.fuel(units)
  const tU = fmt.unitLabel.temp(units)
  const fuelPct = f.fuelL !== null && meta?.fuelMaxL ? Math.round(clamp(f.fuelL / meta.fuelMaxL, 0, 1) * 100) : 0

  // Estrategia: todo se deriva de combustible, vueltas y desgaste
  const needL = f.lapsRemaining !== null && f.fuelPerLapL !== null && f.fuelL !== null ? f.lapsRemaining * f.fuelPerLapL - f.fuelL : null
  const wearIdx = f.tyreWear ? f.tyreWear.indexOf(Math.min(...f.tyreWear)) : -1
  const boxRows: { k: string; v: string; color: string }[] = [
    { k: 'Autonomía', v: f.fuelLapsLeft !== null ? `${f.fuelLapsLeft.toFixed(1).replace('.', ',')} vueltas` : DASH, color: C.blanco },
    {
      k: 'Para terminar',
      v: needL === null ? 'Sin vueltas fijas' : needL > 0 ? `Cargar ${fmt.fuel(needL, units).toFixed(1).replace('.', ',')} ${fuelU}` : 'Alcanza',
      color: needL === null ? C.niebla : needL > 0 ? C.alerta : C.record,
    },
    {
      k: 'Goma más gastada',
      v: f.tyreWear && wearIdx >= 0 ? `${TYRE_NAMES[wearIdx]} · ${Math.round(clamp(f.tyreWear[wearIdx], 0, 1) * 100)} %` : DASH,
      color: C.blanco,
    },
  ]

  const temp = (c: number | null | undefined) => (c === null || c === undefined || !Number.isFinite(c) ? DASH : `${Math.round(fmt.temp(c, units))} ${tU}`)

  // Posición e incidentes ya están en el encabezado
  const sessionRows: { k: string; v: string }[] = [
    { k: 'Aire', v: temp(f.airTempC) },
    { k: 'Pista', v: temp(f.trackTempC) },
  ]

  return (
    <main className="d2-body d2-car">
      <section className="d2-panel" style={{ borderRadius: 'var(--ftn-radius-panel)', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Lbl>Neumáticos y frenos</Lbl>
          <Chip>{zones ? 'Superficie · 3 zonas' : 'Promedio por goma'}</Chip>
        </div>

        <div className="d2-tyres">
          {TYRE_NAMES.map((name, i) => {
            const avg = f.tyreTempC?.[i]
            const ok = avg !== undefined && avg > 0
            const band = ok ? tyreBand(avg) : { color: C.niebla, tag: '' }
            const press = f.tyrePressKpa?.[i]
            const wear = f.tyreWear?.[i]
            const brake = f.brakeTempC?.[i]
            const brakeOk = brake !== undefined && brake > 0
            return (
              <div key={name} className="d2-tyre" style={{ gridColumn: POS[i].col, gridRow: POS[i].row }}>
                <div className="d2-lbl d2-mono" style={{ display: 'flex', justifyContent: 'space-between', letterSpacing: '0.1em' }}>
                  <span>{name}</span>
                  <span style={{ color: band.color }}>{band.tag}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <span className="d2-mono" style={{ fontWeight: 700, fontSize: 34, lineHeight: 1, color: band.color }}>
                    {ok ? Math.round(fmt.temp(avg, units)) : DASH}
                    <span style={{ fontSize: 14, fontWeight: 500 }}> {tU}</span>
                  </span>
                  <span className="d2-mono" style={{ marginLeft: 'auto', fontSize: 14, color: C.plata }}>
                    {press !== undefined && press > 0 ? `${fmt.press(press, units).toFixed(units === 'metric' ? 0 : 1)} ${fmt.unitLabel.press(units)}` : DASH}
                  </span>
                </div>
                {zones && (
                  <div className="d2-zones">
                    {ZONE_NAMES.map((z, k) => (
                      <div key={z}>
                        <Lbl style={{ fontSize: 10, letterSpacing: '0.1em' }}>{z}</Lbl>
                        <span className="d2-mono" style={{ fontWeight: 700, fontSize: 17, color: tyreBand(zones[i][k]).color }}>
                          {Math.round(fmt.temp(zones[i][k], units))}°
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div className="d2-mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.niebla }}>
                    <span>VIDA</span>
                    <span style={{ color: C.plata }}>{wear !== undefined && wear !== null ? `${Math.round(clamp(wear, 0, 1) * 100)} %` : DASH}</span>
                  </div>
                  <div className="d2-bar">
                    <i style={{ width: `${wear !== undefined && wear !== null ? Math.round(clamp(wear, 0, 1) * 100) : 0}%`, background: C.azul }} />
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div className="d2-mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.niebla }}>
                    <span>FRENO</span>
                    <span style={{ color: brakeOk ? brakeColor(brake) : C.niebla }}>{brakeOk ? temp(brake) : DASH}</span>
                  </div>
                  <div className="d2-bar">
                    <i style={{ width: `${brakeOk ? Math.min(100, Math.round((brake / 900) * 100)) : 0}%`, background: brakeOk ? brakeColor(brake) : C.niebla }} />
                  </div>
                </div>
              </div>
            )
          })}
          <BrakeBias bias={f.brakeBias} />
        </div>
      </section>

      <div className="d2-colv">
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
            <i style={{ width: `${fuelPct}%` }} />
          </div>
        </section>

        <section className="d2-panel">
          <Lbl>Motor</Lbl>
          <div className="d2-grid2">
            <div className="d2-tile">
              <Lbl style={{ fontSize: 10, letterSpacing: '0.1em' }}>AGUA</Lbl>
              <span className="d2-mono" style={{ fontWeight: 700, fontSize: 22 }}>{temp(f.waterTempC)}</span>
            </div>
            <div className="d2-tile">
              <Lbl style={{ fontSize: 10, letterSpacing: '0.1em' }}>ACEITE</Lbl>
              <span className="d2-mono" style={{ fontWeight: 700, fontSize: 22 }}>{temp(f.oilTempC)}</span>
            </div>
          </div>
        </section>

        <section className="d2-panel" style={{ gap: 6 }}>
          <Lbl>Estrategia de box</Lbl>
          {boxRows.map((r) => (
            <Row key={r.k} {...r} />
          ))}
        </section>

        <section className="d2-panel fill" style={{ gap: 6 }}>
          <Lbl>Sesión</Lbl>
          {sessionRows.map((r) => (
            <Row key={r.k} {...r} />
          ))}
        </section>
      </div>
    </main>
  )
}
