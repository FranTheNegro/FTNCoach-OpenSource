/**
 * Todas las curvas de la vuelta analizada contra la referencia y contra lo
 * mejor que hiciste en la sesión: tiempo, velocidades, frenada, aceleración y
 * qué tan parejo pasás por cada una.
 */
import type { CornerPass, SessionDetail } from '@shared/analysis'
import * as fmt from '@ui/format'
import { Label } from '../components/ui'

const n0 = (v: number) => String(Math.round(v))

function signed(v: number, unit = ''): string {
  const r = Math.round(v)
  return r === 0 ? `±0${unit}` : `${r > 0 ? '+' : '−'}${Math.abs(r)}${unit}`
}

/** Mejor paso limpio de cada curva entre las vueltas válidas completas, y su desvío. */
function sessionStats(d: SessionDetail) {
  return d.corners.map((_, k) => {
    const clean = d.laps
      .filter((l) => l.kind === 'valid' && l.complete)
      .map((l) => d.passes[l.index][k])
      .filter((p): p is CornerPass => !!p && !p.offTrack)
    const best = clean.length ? clean.reduce((a, b) => (b.timeS < a.timeS ? b : a)) : null
    let sigma: number | null = null
    if (clean.length >= 3) {
      const m = clean.reduce((a, b) => a + b.timeS, 0) / clean.length
      sigma = Math.sqrt(clean.reduce((a, b) => a + (b.timeS - m) ** 2, 0) / (clean.length - 1))
    }
    return { best, sigma }
  })
}

export function CornersTable({
  d,
  lapA,
  refLap,
  labelA,
  refLabel,
  onZoom,
}: {
  d: SessionDetail
  lapA: number
  /** Vuelta de referencia de la sesión (null = la referencia es externa: se compara contra la mejor de la sesión). */
  refLap: number | null
  labelA: string
  refLabel: string
  onZoom: (cornerId: number) => void
}) {
  if (!d.corners.length) return <p className="text-plata">No se detectaron curvas: hace falta al menos una vuelta completa.</p>
  const stats = sessionStats(d)
  const passesA = d.passes[lapA] ?? []
  const passesR = refLap !== null ? d.passes[refLap] : stats.map((s) => s.best)
  const rLabel = refLap !== null ? refLabel : 'mejor de la sesión'
  const deltas = d.corners.map((_, k) => (passesA[k] && passesR[k] ? passesA[k]!.timeS - passesR[k]!.timeS : null))
  const maxAbs = Math.max(0.05, ...deltas.map((x) => Math.abs(x ?? 0)))
  const totalLoss = deltas.reduce<number>((a, x) => a + (x !== null && x > 0 ? x : 0), 0)
  const totalGain = deltas.reduce<number>((a, x) => a + (x !== null && x < 0 ? -x : 0), 0)
  const potential = d.corners.reduce((acc, _, k) => {
    const a = passesA[k]
    const b = stats[k].best
    return acc + (a && b && a.timeS > b.timeS ? a.timeS - b.timeS : 0)
  }, 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-carbono-2 border border-grafito rounded-card px-5 py-4">
          <Label>Perdés en curvas</Label>
          <div className="data text-[24px] font-bold text-alerta mt-1">{fmt.delta(totalLoss, 3)} s</div>
          <div className="text-[13px] text-plata">
            {labelA} contra {rLabel}
          </div>
        </div>
        <div className="bg-carbono-2 border border-grafito rounded-card px-5 py-4">
          <Label>Ganás en curvas</Label>
          <div className="data text-[24px] font-bold text-record mt-1">{fmt.delta(-totalGain, 3)} s</div>
          <div className="text-[13px] text-plata">donde {labelA} es mejor</div>
        </div>
        <div className="bg-carbono-2 border border-grafito rounded-card px-5 py-4">
          <Label>Si pasaras cada curva como tu mejor</Label>
          <div className="data text-[24px] font-bold text-azul mt-1">{fmt.delta(-potential, 3)} s</div>
          <div className="text-[13px] text-plata">mejor paso limpio de cada curva en la sesión</div>
        </div>
      </div>

      <div className="bg-carbono-2 border border-grafito rounded-card overflow-x-auto">
        <table className="w-full data text-[13px] whitespace-nowrap">
          <thead>
            <tr className="text-niebla text-[11px] tracking-[0.1em] uppercase text-left">
              <th className="px-4 h-10 font-normal">Curva</th>
              <th className="px-3 font-normal">Tiempo</th>
              <th className="px-3 font-normal w-[180px]">Δ {rLabel.length > 12 ? 'ref.' : rLabel}</th>
              <th className="px-3 font-normal">Mejor sesión</th>
              <th className="px-3 font-normal">Entrada</th>
              <th className="px-3 font-normal">Mínima</th>
              <th className="px-3 font-normal">Salida</th>
              <th className="px-3 font-normal">Frenada</th>
              <th className="px-3 font-normal">A fondo</th>
              <th className="px-3 font-normal" title="Desvío del tiempo en la curva entre tus vueltas válidas">
                Parejo
              </th>
            </tr>
          </thead>
          <tbody>
            {d.corners.map((c, k) => {
              const a = passesA[k]
              const r = passesR[k]
              const dt = deltas[k]
              const best = stats[k].best
              const sig = stats[k].sigma
              const cmpKmh = (x: number | undefined, y: number | undefined) =>
                x === undefined ? fmt.DASH : (
                  <>
                    {n0(x)}
                    {y !== undefined && <span className={`ml-1.5 text-[12px] ${x - y < -1 ? 'text-alerta' : x - y > 1 ? 'text-record' : 'text-niebla'}`}>{signed(x - y)}</span>}
                  </>
                )
              // Frenada: positivo = frenás más tarde que la referencia
              const brake = a?.brakeM != null && r?.brakeM != null ? a.brakeM - r.brakeM : null
              // A fondo: positivo = llegás a fondo después que la referencia
              const thr = a?.fullThrottleM != null && r?.fullThrottleM != null ? a.fullThrottleM - r.fullThrottleM : null
              return (
                <tr key={c.id} onClick={() => onZoom(c.id)} className="border-t border-grafito cursor-pointer hover:bg-grafito" title="Ver esta curva en el análisis">
                  <td className="px-4 h-11 font-ui">
                    <span className="data font-semibold">{c.label}</span>
                    {c.name && <span className="text-niebla text-[12px] ml-2">{c.name}</span>}
                    {a?.offTrack && <span className="text-alerta text-[12px] ml-2">fuera de pista</span>}
                  </td>
                  <td className="px-3">{a ? a.timeS.toFixed(2) : fmt.DASH}</td>
                  <td className="px-3">
                    {dt === null ? (
                      fmt.DASH
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className={`w-[64px] ${dt > 0.005 ? 'text-alerta' : 'text-record'}`}>{fmt.delta(dt, 3)}</span>
                        <span className="relative flex-1 h-2 bg-carbono rounded-sm">
                          <span className="absolute top-0 bottom-0 left-1/2 w-px bg-acero" />
                          <span
                            className={`absolute top-0 bottom-0 ${dt > 0 ? 'bg-alerta left-1/2' : 'bg-record right-1/2'}`}
                            style={{ width: `${(Math.abs(dt) / maxAbs) * 50}%` }}
                          />
                        </span>
                      </span>
                    )}
                  </td>
                  <td className="px-3 text-plata">
                    {best ? best.timeS.toFixed(2) : fmt.DASH}
                    {a && best && a.timeS - best.timeS > 0.005 && <span className="text-niebla text-[12px] ml-1.5">{fmt.delta(a.timeS - best.timeS, 2)}</span>}
                  </td>
                  <td className="px-3">{cmpKmh(a?.entryKmh, r?.entryKmh)}</td>
                  <td className="px-3">{cmpKmh(a?.minKmh, r?.minKmh)}</td>
                  <td className="px-3">{cmpKmh(a?.exitKmh, r?.exitKmh)}</td>
                  <td className={`px-3 ${brake === null ? 'text-niebla' : Math.abs(brake) < 3 ? 'text-plata' : brake < 0 ? 'text-alerta' : 'text-record'}`}>
                    {a?.brakeM == null ? 'sin frenar' : brake === null ? `${n0(a.brakeM)} m` : Math.abs(brake) < 3 ? 'igual' : `${n0(Math.abs(brake))} m ${brake < 0 ? 'antes' : 'después'}`}
                  </td>
                  <td className={`px-3 ${thr === null ? 'text-niebla' : Math.abs(thr) < 5 ? 'text-plata' : thr > 0 ? 'text-alerta' : 'text-record'}`}>
                    {a?.fullThrottleM == null ? 'no llega' : thr === null ? `${n0(a.fullThrottleM)} m` : Math.abs(thr) < 5 ? 'igual' : `${n0(Math.abs(thr))} m ${thr > 0 ? 'después' : 'antes'}`}
                  </td>
                  <td className={`px-3 ${sig === null ? 'text-niebla' : sig > 0.15 ? 'text-alerta' : 'text-plata'}`}>{sig === null ? fmt.DASH : `±${sig.toFixed(2)}`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="px-4 py-3 border-t border-grafito flex justify-between gap-4">
          <Label>Tocá una curva para verla en el análisis</Label>
          <span className="text-[12px] text-niebla">Velocidades en km/h · frenada y a fondo contra {rLabel}</span>
        </div>
      </div>
    </div>
  )
}
