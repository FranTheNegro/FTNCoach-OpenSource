import { useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardList, History, MapPin, MessageSquareText, Repeat, SlidersHorizontal, Target, ThumbsUp } from 'lucide-react'
import { BrakePedal, PhaseIcon, ThrottlePedal, Tyre } from '@ui/icons'
import { TrackMapSvg, type MapMarker } from '@ui/TrackMapSvg'
import type { CoachCorrection, CoachFollowUp, CoachState, FollowUpItem, FollowUpVerdict, SessionDetail } from '@shared/analysis'
import { COACH_MODELS, COACH_PROVIDERS } from '@shared/analysis'
import { wantsTechnical, type CoachStyle } from '@shared/coach-quiz'
import { CoachQuiz } from '../components/CoachQuiz'
import { Button, Card, Label } from '../components/ui'
import { GoLink } from '../nav'

const cleanError = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const VERDICT: Record<FollowUpVerdict, { label: string; color: string }> = {
  better: { label: 'Mejoró', color: 'text-record' },
  same: { label: 'Igual', color: 'text-plata' },
  worse: { label: 'Empeoró', color: 'text-alerta' },
  unknown: { label: 'Sin medir', color: 'text-niebla' },
}

/** El número detrás del veredicto, siempre medido entre las dos sesiones. */
function measuredText(i: FollowUpItem): string {
  if (i.medianGainS === null) return i.corner ? 'Hacen falta 3 vueltas limpias en cada sesión para medirla.' : 'No se pudo ubicar la curva en la telemetría.'
  const time = `Una vuelta normal tuya: ${Math.abs(i.medianGainS).toFixed(2).replace('.', ',')} s ${i.medianGainS >= 0 ? 'mejor' : 'peor'} acá`
  if (!i.minKmhDiff) return time
  return `${time}, pasando ${Math.abs(i.minKmhDiff)} km/h ${i.minKmhDiff > 0 ? 'más rápido' : 'más lento'}`
}

function FollowUpCard({ data, summary }: { data: CoachFollowUp; summary: string }) {
  const date = new Date(data.startedAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' })
  return (
    <Card>
      <Label icon={History}>{`Lo que te pedí en la sesión del ${date}`}</Label>
      {summary && <p className="mt-3 text-[15px] leading-relaxed">{summary}</p>}
      <div className="mt-3 divide-y divide-grafito">
        {data.items.map((i) => (
          <div key={i.title} className="py-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 items-baseline">
            <span className="text-[14px] leading-snug">
              <span className="data text-[12px] tracking-[0.08em] text-plata uppercase">{i.title}</span>
              <span className="block mt-1">{i.solution}</span>
            </span>
            <span className={`data font-bold text-[14px] ${VERDICT[i.verdict].color}`}>{VERDICT[i.verdict].label}</span>
            <span className="col-span-2 data text-[13px] text-niebla">{measuredText(i)}</span>
          </div>
        ))}
      </div>
      {data.drill && <p className="mt-2 text-[13px] text-niebla leading-snug">Ejercicio que te dejé: {data.drill.description}</p>}
    </Card>
  )
}

/** Muestra en el circuito dónde está la curva: se entiende de un vistazo. */
function CornerLocator({ d, cornerId }: { d: SessionDetail; cornerId: number }) {
  const map = d.map.map
  const c = d.corners.find((x) => x.id === cornerId)
  const markers = useMemo<MapMarker[]>(() => {
    const line = map?.pctLine
    if (!c || !line?.length) return []
    const p = line[Math.max(0, Math.min(line.length - 1, Math.round(c.apexPct * (line.length - 1))))]
    return [{ x: p[0], y: p[1], color: 'var(--ftn-azul)', size: 2.4 }]
  }, [c, map])
  if (!map || !markers.length) return null
  return <TrackMapSvg map={map} markers={markers} showLabels={false} className="w-full h-full" />
}

function CorrectionCard({ c, d, onZoom }: { c: CoachCorrection; d: SessionDetail; onZoom: (id: number) => void }) {
  const cornerId = c.cornerId ?? null
  return (
    <article className="bg-carbono-2 border border-grafito rounded-card p-5 grid grid-cols-[minmax(0,1fr)_auto] gap-5">
      <div className="min-w-0 flex flex-col gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="data flex items-center gap-2 text-[12px] tracking-[0.08em] text-plata uppercase">
            <PhaseIcon title={c.title} color="var(--ftn-alerta)" />
            {c.title}
          </span>
          {c.gainS > 0.005 && <span className="data text-azul font-bold text-[13px]">hasta {c.gainS.toFixed(2).replace('.', ',')} s por vuelta</span>}
        </div>
        {c.where && <p className="text-[14px] text-plata leading-snug">{c.where}</p>}
        <p className="text-[17px] leading-snug font-semibold">{c.solution}</p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[14px] leading-snug">
          <dt className="text-niebla">Hoy</dt>
          <dd>
            {c.current}
            {c.evidence && <span className="text-niebla"> ({c.evidence})</span>}
          </dd>
          <dt className="text-niebla">Tu mejor</dt>
          <dd>{c.target}</dd>
          {c.feel && (
            <>
              <dt className="text-niebla">Lo vas a notar</dt>
              <dd>{c.feel}</dd>
            </>
          )}
        </dl>
      </div>
      {cornerId !== null && (
        <div className="flex flex-col gap-2 w-[168px]">
          {d.map.map && (
            <div className="h-[120px]">
              <CornerLocator d={d} cornerId={cornerId} />
            </div>
          )}
          <Button className="w-full" onClick={() => onZoom(cornerId)}>
            <MapPin size={15} aria-hidden="true" />
            Ver en el análisis
          </Button>
        </div>
      )}
    </article>
  )
}

export function CoachPanel({ d, onZoom }: { d: SessionDetail; onZoom: (cornerId: number) => void }) {
  const sessionId = d.summary.id
  const [style, setStyle] = useState<CoachStyle | null>(null)
  const [quiz, setQuiz] = useState(false)
  const [st, setSt] = useState<CoachState | null>(null)
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [provider, setProvider] = useState<string>('')
  const [question, setQuestion] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const chatEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.ftn.settings().then((cfg) => {
      setStyle(cfg.coachStyle)
      const info = COACH_PROVIDERS.find((p) => p.id === cfg.coach.provider) ?? COACH_PROVIDERS[0]
      setProvider(info.label.split(' · ')[0])
      if (info.key) void window.ftn.hasCoachKey(info.key).then(setHasKey)
      else setHasKey(true)
    })
    void window.ftn.coachState(sessionId).then(setSt)
    return window.ftn.onCoach((s) => s.sessionId === sessionId && setSt(s))
  }, [sessionId])

  // Solo se baja al final cuando cambia la conversación (no al abrir la pestaña)
  const chatLen = (st?.chat.length ?? 0) + (st?.streaming ? 1 : 0)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    chatEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [chatLen])

  if (hasKey === false)
    return (
      <Card className="max-w-[720px]">
        <Label icon={MessageSquareText}>Coach con IA</Label>
        <p className="text-plata mt-3 leading-relaxed">
          El coach lee tu telemetría con IA y te dice qué cambiar en la próxima vuelta. Funciona gratis con Gemini u OpenRouter, con tu suscripción de
          Claude (vía Claude Code) o pagando por uso con Claude u OpenCode, siempre con tu propia cuenta. Falta la API key de {provider}: cargala en{' '}
          <GoLink to="settings" section="coach">
            Ajustes → Coach
          </GoLink>
          . Se guarda cifrada en esta PC.
        </p>
      </Card>
    )
  if (!st || !style) return null

  const saveStyle = async (coachStyle: CoachStyle) => {
    const next = await window.ftn.saveSettings({ coachStyle })
    setStyle(next.coachStyle)
    setQuiz(false)
  }
  if (quiz || (!style.completedAt && !style.skipped && !st.report))
    return (
      <div className="flex justify-center">
        <CoachQuiz
          value={style}
          onDone={saveStyle}
          onSkip={quiz ? undefined : () => void saveStyle({ ...style, skipped: true })}
          onCancel={quiz ? () => setQuiz(false) : undefined}
        />
      </div>
    )

  const run = async (p: Promise<CoachState>) => {
    setErr(null)
    try {
      setSt(await p)
    } catch (e) {
      setErr(cleanError(e))
    }
  }
  const r = st.report
  // Reportes viejos guardaban solo el ID del modelo de Claude
  const model = COACH_MODELS.find((m) => m.id === st.model)?.label.split(' · ')[0] ?? st.model

  return (
    <div className="flex gap-5 items-start">
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="text-plata text-[13px]">
            {r && st.createdAt
              ? `Reporte de ${new Date(st.createdAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })} · ${model}`
              : `Tu coach lee las ${d.laps.length} vueltas de la sesión y te dice qué se repite.`}
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setQuiz(true)}>
              <SlidersHorizontal size={15} aria-hidden="true" />
              {style.completedAt ? 'Editar tu coach' : 'Armá tu coach'}
            </Button>
            <Button variant="primary" disabled={st.busy} onClick={() => void run(window.ftn.coachAnalyze(sessionId))}>
              {st.busy && !st.chat.length ? 'Analizando…' : r ? 'Rehacer el análisis' : 'Analizar la sesión'}
            </Button>
          </div>
        </div>
        {(st.error || err) && <p className="text-error">{st.error ?? err}</p>}
        {st.busy && st.streaming && !r && <p className="text-plata">{st.streaming}</p>}

        {r && (
          <>
            <Card>
              <Label icon={ClipboardList}>La sesión</Label>
              {r.headline && <p className="mt-3 text-[20px] leading-snug font-bold">{r.headline}</p>}
              <p className="mt-3 text-[16px] leading-relaxed">{r.briefing}</p>
            </Card>
            {!!r.wins?.length && (
              <Card>
                <Label icon={ThumbsUp} color="var(--ftn-record)">Lo que ya hacés bien</Label>
                <ul className="mt-2 flex flex-col gap-1.5 text-[15px] leading-snug">
                  {r.wins.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </Card>
            )}
            {st.followUp && <FollowUpCard data={st.followUp} summary={r.followUp ?? ''} />}
            {r.recurring && (
              <Card>
                <Label icon={Repeat}>Se repite entre sesiones</Label>
                <p className="mt-2 text-[15px] leading-relaxed">{r.recurring}</p>
              </Card>
            )}
            <section className="flex flex-col gap-3" aria-label="Qué trabajar">
              {r.corrections.map((c) => (
                <CorrectionCard key={c.rank} c={c} d={d} onZoom={onZoom} />
              ))}
            </section>
            <Card className="border-ultramar">
              <Label icon={Target} color="var(--ftn-azul)">Para la próxima salida</Label>
              <p className="mt-2 text-[16px] leading-snug font-semibold">{r.drill.description}</p>
              <p className="mt-1 text-plata text-[14px]">Lo lograste si: {r.drill.kpi}</p>
            </Card>
            {(r.corners.length > 0 || r.dynamics.braking) && (
              <details className="bg-carbono-2 border border-grafito rounded-card p-5" open={wantsTechnical(style)}>
                <summary className="cursor-pointer font-semibold">Detalle técnico</summary>
                {r.corners.length > 0 && (
                  <div className="mt-3 divide-y divide-grafito">
                    {r.corners.map((c, i) => (
                      <div key={i} className="py-3 grid grid-cols-[180px_160px_1fr_70px] gap-4 items-baseline">
                        <span className="font-semibold">{c.corner}</span>
                        <span className="data text-[13px] text-plata">{c.speeds}</span>
                        <span className="text-[14px] leading-snug">{c.diagnosis}</span>
                        <span className="data text-alerta text-right">+{c.lossS.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-4 mt-4">
                  {(
                    [
                      ['Frenada', r.dynamics.braking, BrakePedal],
                      ['Acelerador', r.dynamics.throttle, ThrottlePedal],
                      ['Agarre', r.dynamics.frictionCircle, Tyre],
                    ] as const
                  ).map(([t, v, icon]) => (
                    <div key={t}>
                      <Label icon={icon}>{t}</Label>
                      <p className="mt-2 text-[14px] leading-snug">{v}</p>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </div>

      <aside className="w-[380px] shrink-0 bg-carbono-2 border border-grafito rounded-panel flex flex-col h-[640px]">
        <div className="px-5 py-4 border-b border-grafito flex items-center justify-between">
          <h2 className="text-[16px] font-bold">Preguntale al coach</h2>
          {st.chat.length > 0 && (
            <button className="text-[12px] text-niebla hover:text-blanco" onClick={() => void run(window.ftn.coachClear(sessionId))}>
              Borrar
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
          {!st.chat.length && <p className="text-niebla text-[14px]">“¿Por qué pierdo tiempo en la T4?” · “¿Qué hice distinto en mi mejor vuelta?”</p>}
          {st.chat.map((m, i) => (
            <div
              key={i}
              className={`text-[14px] leading-relaxed whitespace-pre-wrap rounded-control px-3.5 py-2.5 ${
                m.role === 'user' ? 'bg-ultramar self-end max-w-[85%]' : 'bg-carbono self-start'
              }`}
            >
              {m.text}
            </div>
          ))}
          {st.busy && st.chat.length > 0 && st.chat[st.chat.length - 1].role === 'user' && (
            <div className="text-[14px] leading-relaxed whitespace-pre-wrap rounded-control px-3.5 py-2.5 bg-carbono self-start text-plata">
              {st.streaming || '…'}
            </div>
          )}
          <div ref={chatEnd} />
        </div>
        <form
          className="p-3 border-t border-grafito flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const q = question
            setQuestion('')
            void run(window.ftn.coachAsk(sessionId, q))
          }}
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={st.busy}
            placeholder="Escribí tu pregunta"
            className="flex-1 min-w-0 h-11 px-3 rounded-control bg-carbono border border-acero text-blanco placeholder:text-niebla focus:border-azul outline-none"
          />
          <Button variant="primary" type="submit" disabled={st.busy || !question.trim()}>
            Enviar
          </Button>
        </form>
      </aside>
    </div>
  )
}
