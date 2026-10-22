/** Stints, plan de práctica y setup contra tiempo. */
import { useEffect, useMemo, useState } from 'react'
import { ClipboardCheck, Fuel, Layers, Target, TrendingDown, TrendingUp, Wrench } from 'lucide-react'
import { isLocal, type SessionDetail, type SessionSummary } from '@shared/analysis'
import { sameCombo } from '@shared/history'
import * as fmt from '@ui/format'
import { Button, Card, Label } from '../components/ui'
import { useLibrary } from '../hooks'
import { buildPlan, checkPlan, cornerChanges, loadPlan, savePlan, setupDiff, stintsOf, type PracticePlan } from './practiceData'

const cornerName = (label: string, name: string | null) => (name ? `${label} · ${name}` : label)

// ── Stints ────────────────────────────────────────────────────────────────

export function StintsPanel({ d }: { d: SessionDetail }) {
  const stints = useMemo(() => stintsOf(d.laps), [d.laps])
  if (!stints.some((s) => s.clean.length >= 2)) return null
  return (
    <Card>
      <Label icon={Layers}>Stints</Label>
      <p className="text-[13px] text-plata mt-2 mb-3">
        Cada entrada a boxes corta un stint. La tendencia es cuánto cambia tu tiempo por vuelta a lo largo del stint, sin contar las vueltas que se escapan
        (tráfico o un error).
      </p>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {stints.map((s) => {
          const trend = s.trendS
          const tone = trend === null ? 'text-niebla' : trend > 0.05 ? 'text-alerta' : trend < -0.05 ? 'text-record' : 'text-plata'
          return (
            <article key={s.n} className="bg-carbono border border-grafito rounded-card px-4 py-3 flex flex-col gap-1.5">
              <div className="flex justify-between items-baseline data text-[12px] text-niebla uppercase tracking-[0.08em]">
                <span>Stint {s.n}</span>
                <span>
                  V{s.laps[0].lap}–V{s.laps[s.laps.length - 1].lap} · {s.clean.length} válidas
                </span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="data text-[20px] font-bold">{fmt.lapTime(s.avgS)}</span>
                <span className="data text-[13px] text-mejor">mejor {fmt.lapTime(s.bestS)}</span>
              </div>
              <div className="flex justify-between items-center data text-[13px]">
                <span className={`flex items-center gap-1.5 ${tone}`}>
                  {trend !== null && (trend > 0 ? <TrendingDown size={15} aria-hidden="true" /> : <TrendingUp size={15} aria-hidden="true" />)}
                  {trend === null ? 'Pocas vueltas para la tendencia' : `${fmt.delta(trend, 2)} s por vuelta`}
                </span>
                {s.fuelPerLapL !== null && (
                  <span className="flex items-center gap-1.5 text-plata">
                    <Fuel size={14} aria-hidden="true" />
                    {s.fuelPerLapL.toFixed(2)} L/v
                  </span>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </Card>
  )
}

// ── Plan de práctica ───────────────────────────────────────────────────────

export function PracticePlanCard({ d, onZoom }: { d: SessionDetail; onZoom: (cornerId: number) => void }) {
  const s = d.summary
  const [plan, setPlan] = useState<PracticePlan | null>(() => loadPlan(s))
  useEffect(() => setPlan(loadPlan(s)), [s])
  const fresh = useMemo(() => buildPlan(d), [d])
  // El plan se controla en las sesiones que vinieron después de la que lo armó
  const checking = plan && plan.sessionId !== s.id && s.startedAt > plan.sessionStartedAt ? checkPlan(plan, d) : null
  const isThis = plan?.sessionId === s.id

  const make = () => {
    if (!fresh) return
    savePlan(s, fresh)
    setPlan(fresh)
  }

  return (
    <Card>
      <div className="flex justify-between items-center gap-4">
        <Label icon={Target}>Plan de práctica</Label>
        {fresh && !isThis && (
          <Button className="h-9 text-[13px]" onClick={make}>
            Armar el plan con esta sesión
          </Button>
        )}
      </div>

      {checking && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-[13px] text-plata m-0">
            <ClipboardCheck size={15} className="inline-block align-[-3px] mr-1.5 text-azul" aria-hidden="true" />
            El plan del {new Date(plan!.sessionStartedAt).toLocaleDateString('es-AR')}: así te fue en estas curvas (mediana de tus vueltas válidas).
          </p>
          {checking.map((c) => (
            <div key={c.plan.label + c.plan.apexPct} className="flex justify-between items-center gap-3 bg-carbono border border-grafito rounded-card px-4 py-2.5">
              <button className="text-left text-[14px] font-semibold hover:text-azul" onClick={() => c.now && onZoom(c.now.corner.id)}>
                {cornerName(c.plan.label, c.plan.name)}
              </button>
              <span className="data text-[13px] text-plata">
                {fmt.lapTime(c.plan.medianS, 2)} → {c.now ? fmt.lapTime(c.now.medianS, 2) : 'sin vueltas válidas'}
              </span>
              <span className={`data text-[14px] font-bold ${c.gainS === null ? 'text-niebla' : c.gainS > 0.02 ? 'text-record' : c.gainS < -0.02 ? 'text-alerta' : 'text-plata'}`}>
                {c.gainS === null ? '–' : c.gainS > 0.02 ? `−${c.gainS.toFixed(2)} s` : c.gainS < -0.02 ? `+${(-c.gainS).toFixed(2)} s` : 'igual'}
              </span>
            </div>
          ))}
        </div>
      )}

      {isThis && plan && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-[13px] text-plata m-0">
            Para la próxima sesión en este auto y pista. Cuando la abras, acá vas a ver si mejoraste en estas curvas.
          </p>
          {plan.corners.map((c) => (
            <div key={c.label + c.apexPct} className="flex justify-between items-center gap-3 bg-carbono border border-grafito rounded-card px-4 py-2.5">
              <span className="text-[14px] font-semibold">{cornerName(c.label, c.name)}</span>
              <span className="data text-[13px] text-plata">
                de {fmt.lapTime(c.medianS, 2)} a {fmt.lapTime(c.bestS, 2)}: ya lo hiciste una vez
              </span>
            </div>
          ))}
        </div>
      )}

      {!checking && !isThis && (
        <p className="text-[13px] text-plata mt-3 mb-0">
          {fresh
            ? 'Se arma con las 3 curvas donde más distancia hay entre lo que hacés casi siempre y tu mejor pasada. En la próxima sesión en este auto y pista te dice si mejoraste.'
            : 'Hacen falta al menos 3 vueltas válidas para armar el plan.'}
        </p>
      )}
    </Card>
  )
}

// ── Setup contra tiempo ───────────────────────────────────────────────────

export function SetupCompare({ d }: { d: SessionDetail }) {
  const lib = useLibrary()
  const s = d.summary
  const prev: SessionSummary | null = useMemo(() => {
    const before = (lib?.sessions ?? []).filter((x) => x.id !== s.id && isLocal(x) && sameCombo(x, s) && x.startedAt < s.startedAt)
    return before.sort((a, b) => b.startedAt - a.startedAt)[0] ?? null
  }, [lib, s])
  const [other, setOther] = useState<SessionDetail | null>(null)
  useEffect(() => {
    setOther(null)
    if (!prev || !d.setup) return
    let alive = true
    window.ftn
      .sessionDetail(prev.id)
      .then((x) => alive && setOther(x))
      .catch(() => alive && setOther(null))
    return () => {
      alive = false
    }
  }, [prev, d.setup])

  if (!d.setup || !prev) return null
  if (!other) return <Card className="text-plata text-[13px]">Comparando con tu sesión anterior en este auto y pista…</Card>
  if (!other.setup) return null

  const changes = setupDiff(other.setup, d.setup)
  const corners = cornerChanges(other, d)
    .filter((c) => Math.abs(c.gainS) >= 0.03)
    .sort((a, b) => b.gainS - a.gainS)
  const better = corners.filter((c) => c.gainS > 0).slice(0, 4)
  const worse = corners.filter((c) => c.gainS < 0).slice(-4).reverse()
  const bestGain = other.summary.bestLapS !== null && s.bestLapS !== null ? other.summary.bestLapS - s.bestLapS : null

  return (
    <Card>
      <Label icon={Wrench}>Setup contra tiempo</Label>
      <p className="text-[13px] text-plata mt-2 mb-4">
        Contra tu sesión del {new Date(prev.startedAt).toLocaleDateString('es-AR')} en este auto y pista. Las condiciones de pista también cuentan: tomalo como una
        pista, no como una prueba.
      </p>
      {changes.length === 0 ? (
        <p className="text-[14px] m-0">Mismo setup que en esa sesión.</p>
      ) : (
        <div className="grid grid-cols-[1fr_1fr] gap-5">
          <div>
            <h3 className="text-[14px] font-bold mb-2">Qué cambiaste ({changes.length})</h3>
            <div className="flex flex-col max-h-[280px] overflow-y-auto">
              {changes.map((c) => (
                <div key={c.where + c.name} className="flex justify-between gap-3 py-1.5 border-t border-grafito first:border-0 text-[13px]">
                  <span className="text-plata min-w-0">
                    <span className="text-niebla">{c.where} · </span>
                    {c.name}
                  </span>
                  <span className="data shrink-0 text-right">
                    <span className="text-niebla">{c.before ?? '–'}</span> → {c.after ?? '–'}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <h3 className="text-[14px] font-bold m-0">Qué pasó en pista</h3>
            <div className="data text-[14px]">
              Mejor vuelta: {fmt.lapTime(other.summary.bestLapS)} → {fmt.lapTime(s.bestLapS)}{' '}
              {bestGain !== null && <span className={bestGain > 0 ? 'text-record' : bestGain < 0 ? 'text-alerta' : 'text-plata'}>({fmt.delta(-bestGain, 3)} s)</span>}
            </div>
            {better.length > 0 && (
              <div>
                <span className="data text-[12px] text-record uppercase tracking-[0.08em]">Mejoraste en</span>
                <div className="flex flex-wrap gap-2 mt-1.5">
                  {better.map((c) => (
                    <span key={c.label} className="data text-[13px] bg-record/15 text-record rounded-chip px-2 py-1">
                      {c.label} −{c.gainS.toFixed(2)} s
                    </span>
                  ))}
                </div>
              </div>
            )}
            {worse.length > 0 && (
              <div>
                <span className="data text-[12px] text-alerta uppercase tracking-[0.08em]">Perdiste en</span>
                <div className="flex flex-wrap gap-2 mt-1.5">
                  {worse.map((c) => (
                    <span key={c.label} className="data text-[13px] bg-alerta/15 text-alerta rounded-chip px-2 py-1">
                      {c.label} +{(-c.gainS).toFixed(2)} s
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
