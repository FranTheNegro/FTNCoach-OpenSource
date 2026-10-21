/** Pantalla "Rivales": autos cercanos en pista, duelos y tráfico (solo iRacing publica a los rivales). */
import { Car as CarIcon, ChevronsDown, ChevronsUp, DoorOpen, TriangleAlert } from 'lucide-react'
import type { LiveFrame, RivalCar, SessionMeta } from '@shared/live'
import * as fmt from '@ui/format'
import { C, Chip, DASH, Ico, Lbl, type ChipTone } from './kit'
import type { DashTracker, RivalTrend } from './tracker'

const CLOSE_S = 2

function gapText(g: number): string {
  return g === 0 ? 'Vos' : `${g > 0 ? '−' : '+'}${Math.abs(g).toFixed(1)} s`
}

function Duel({ side, trend }: { side: 'ahead' | 'behind'; trend: RivalTrend }) {
  const car = trend.car
  if (!car) {
    return (
      <div className="d2-rowline" style={{ gap: 12 }}>
        <span style={{ fontSize: 14, color: C.niebla }}>{side === 'ahead' ? 'Nadie adelante a la vista' : 'Nadie atrás a la vista'}</span>
      </div>
    )
  }
  const chip: { text: string; tone: ChipTone } =
    trend.kind === 'flat' ? { text: 'Estable', tone: 'default' } : trend.kind === 'good' ? { text: side === 'ahead' ? 'Cerrando' : 'Te alejás', tone: 'record' } : { text: side === 'ahead' ? 'Se aleja' : 'Se acerca', tone: side === 'ahead' ? 'error' : 'alert' }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '4px 12px', alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--ftn-grafito)' }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>
        #{car.num} {car.name}
      </span>
      <span className="d2-mono" style={{ fontWeight: 700, fontSize: 18 }}>{side === 'ahead' ? '−' : '+'}{(trend.gapS ?? 0).toFixed(1)} s</span>
      <span style={{ fontSize: 13, color: C.plata }}>{side === 'ahead' ? 'Adelante' : 'Atrás'}{car.cls ? ` · ${car.cls}` : ''}</span>
      <Chip tone={chip.tone}>{chip.text}</Chip>
    </div>
  )
}

export function Rivals({ f, meta, tracker }: { f: LiveFrame; meta: SessionMeta | null; tracker: DashTracker }) {
  const r = f.rivals
  if (!r) {
    return (
      <main className="d2-body" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
        <section className="d2-panel" style={{ justifyContent: 'center' }}>
          <div className="d2-empty">
            <strong>{meta?.sim === 'ac' ? 'Assetto Corsa no publica a los rivales' : 'Todavía no hay datos de rivales'}</strong>
            <span>Los autos cercanos, las diferencias y los duelos aparecen acá con iRacing.</span>
          </div>
        </section>
      </main>
    )
  }

  const ahead = tracker.trend('ahead')
  const behind = tracker.trend('behind')
  const me = r.cars.find((c) => c.me)
  const trafficRows: { icon: typeof DoorOpen; text: string; value: string; color: string }[] = []
  if (f.inPit) trafficRows.push({ icon: DoorOpen, text: 'Estás en boxes', value: f.pitLimiter ? 'LIMITADOR' : 'BOXES', color: C.alerta })
  const fastBehind = r.behind && r.behind.gapS > -CLOSE_S
  trafficRows.push({ icon: ChevronsDown, text: r.behind ? `Detrás: #${r.behind.num} ${r.behind.name}` : 'Nadie detrás a la vista', value: r.behind ? `${Math.abs(r.behind.gapS).toFixed(1)} s` : DASH, color: fastBehind ? C.alerta : C.blanco })
  const clearAhead = !r.ahead || r.ahead.gapS > CLOSE_S
  trafficRows.push({ icon: ChevronsUp, text: r.ahead ? `Adelante: #${r.ahead.num} ${r.ahead.name}` : 'Pista libre adelante', value: r.ahead ? `${r.ahead.gapS.toFixed(1)} s` : 'OK', color: clearAhead ? C.record : C.blanco })
  if (f.incidents !== null) trafficRows.push({ icon: TriangleAlert, text: 'Incidentes de la sesión', value: `${f.incidents}x`, color: f.incidents > 0 ? C.alerta : C.blanco })

  return (
    <main className="d2-body d2-riv">
      <section className="d2-panel" style={{ borderRadius: 'var(--ftn-radius-panel)', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 6 }}>
          <Lbl>Relative</Lbl>
          <Chip>Ordenados por posición en pista</Chip>
        </div>
        <div className="d2-rivgrid d2-lbl" style={{ padding: '6px 10px', letterSpacing: '0.1em' }}>
          <span>P</span>
          <span>Nº</span>
          <span>PILOTO</span>
          <span>CLASE</span>
          <span>IRATING</span>
          <span>RELATIVO</span>
          <span>ÚLTIMA</span>
        </div>
        {r.cars.map((c: RivalCar) => {
          const close = !c.me && Math.abs(c.gapS) <= CLOSE_S
          const color = c.me ? C.azul : close ? C.alerta : C.niebla
          return (
            <div key={c.idx} className="d2-rivgrid d2-rivrow" style={{ background: c.me ? 'rgba(29,43,224,0.18)' : undefined }}>
              <span className="d2-mono" style={{ fontWeight: 700, fontSize: 16, color: c.me ? C.azul : C.blanco }}>{c.position ? `P${c.position}` : DASH}</span>
              <span className="d2-mono" style={{ fontSize: 14, color: C.niebla }}>{c.num}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 16, fontWeight: 600, color: c.me ? C.blanco : C.plata, minWidth: 0 }}>
                <Ico icon={CarIcon} size={22} color={color} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.me ? 'Vos' : c.name}</span>
                {c.inPit && <Chip tone="alert">Boxes</Chip>}
              </span>
              <span className="d2-mono" style={{ fontSize: 12, letterSpacing: '0.08em', color: C.plata }}>{c.cls ?? DASH}</span>
              <span className="d2-mono" style={{ fontSize: 15, color: C.plata }}>{c.irating ?? DASH}</span>
              <span className="d2-mono" style={{ fontWeight: 700, fontSize: 16, color: c.me ? C.azul : close ? C.alerta : C.blanco }}>{gapText(c.gapS)}</span>
              <span className="d2-mono" style={{ fontSize: 15, color: c.lastLapS !== null && c.bestLapS !== null && Math.abs(c.lastLapS - c.bestLapS) < 0.0005 ? C.mejor : C.plata }}>{fmt.lapTime(c.lastLapS)}</span>
            </div>
          )
        })}
      </section>

      <div className="d2-colv">
        <section className="d2-panel" style={{ borderRadius: 'var(--ftn-radius-panel)', padding: '16px 20px', gap: 6 }}>
          <Lbl>Mi posición</Lbl>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
            <span className="d2-display" style={{ fontSize: 84, lineHeight: 1, display: 'inline-block' }}>{me?.position ? `P${me.position}` : f.position ? `P${f.position}` : DASH}</span>
            <span className="d2-mono" style={{ fontSize: 16, color: C.niebla }}>{f.carsInSession ? `de ${f.carsInSession}` : ''}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {me?.cls && <Chip tone="highlight">Clase {me.cls}</Chip>}
            {me?.irating && <Chip>iRating {me.irating}</Chip>}
          </div>
        </section>

        <section className="d2-panel" style={{ gap: 6 }}>
          <Lbl>Duelos</Lbl>
          <Duel side="ahead" trend={ahead} />
          <Duel side="behind" trend={behind} />
        </section>

        <section className="d2-panel fill" style={{ gap: 6 }}>
          <Lbl>Tráfico y pista</Lbl>
          {trafficRows.map((t) => (
            <div key={t.text} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--ftn-grafito)' }}>
              <Ico icon={t.icon} size={22} color={t.color} />
              <span style={{ fontSize: 13, color: C.plata, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.text}</span>
              <span className="d2-mono" style={{ fontWeight: 700, fontSize: 14, color: t.color }}>{t.value}</span>
            </div>
          ))}
        </section>
      </div>
    </main>
  )
}

