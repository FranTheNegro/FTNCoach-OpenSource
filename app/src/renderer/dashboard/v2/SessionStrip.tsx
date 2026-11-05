/** Franja fija del encabezado: tipo de sesión, cuánto queda, hora real y temperaturas. */
import { useEffect, useState } from 'react'
import { sessionLabel, type LiveFrame, type SessionMeta } from '@shared/live'
import type { Units } from '@shared/api'
import * as fmt from '@ui/format'
import { DASH, Lbl } from './kit'

const timeNow = () => new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })

function useClock(): string {
  const [now, setNow] = useState(timeNow)
  useEffect(() => {
    const id = setInterval(() => setNow(timeNow()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

/** Lo que queda de la sesión o, si no tiene final, cuánto va. */
function remainingOf(f: LiveFrame): { label: string; value: string } {
  if (f.timeRemainingS) return { label: 'Resta', value: fmt.clock(f.timeRemainingS) }
  if (f.lapsRemaining !== null) return { label: 'Restan', value: `${f.lapsRemaining} v` }
  return { label: 'Transcurrido', value: f.sessionTimeS ? fmt.clock(f.sessionTimeS) : DASH }
}

function Cell({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className="d2-session-cell">
      <Lbl>{label}</Lbl>
      <span className={`d2-mono ${wide ? 'wide' : ''}`}>{value}</span>
    </div>
  )
}

export function SessionStrip({ f, meta, units }: { f: LiveFrame | null; meta: SessionMeta | null; units: Units }) {
  const now = useClock()
  const temp = (c: number | null | undefined) => (c === null || c === undefined ? DASH : `${Math.round(fmt.temp(c, units))}°`)
  const left = f ? remainingOf(f) : null
  return (
    <div className="d2-session" aria-label="Sesión">
      {meta && <Cell label="Sesión" value={sessionLabel(meta.sessionType)} />}
      {left && <Cell label={left.label} value={left.value} wide />}
      <Cell label="Hora" value={now} wide />
      {f && <Cell label="Pista" value={temp(f.trackTempC)} />}
      {f && <Cell label="Aire" value={temp(f.airTempC)} />}
    </div>
  )
}
