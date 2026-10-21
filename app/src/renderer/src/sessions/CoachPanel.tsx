import { useEffect, useRef, useState } from 'react'
import type { CoachState } from '@shared/analysis'
import { COACH_MODELS, COACH_PROVIDERS } from '@shared/analysis'
import { Button, Card, Label } from '../components/ui'
import { GoLink } from '../nav'

const cleanError = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function CoachPanel({ sessionId, lap, lapLabel }: { sessionId: string; lap: number; lapLabel: string }) {
  const [st, setSt] = useState<CoachState | null>(null)
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [provider, setProvider] = useState<string>('')
  const [question, setQuestion] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const chatEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.ftn.settings().then((cfg) => {
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
        <Label>Coach con IA</Label>
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
  if (!st) return null

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
              : 'El coach lee la sesión completa y la vuelta que estás analizando.'}
          </div>
          <Button variant="primary" disabled={st.busy} onClick={() => void run(window.ftn.coachAnalyze(sessionId, lap))}>
            {st.busy && !st.chat.length ? 'Analizando…' : r ? `Rehacer con la ${lapLabel}` : `Analizar sesión (${lapLabel})`}
          </Button>
        </div>
        {(st.error || err) && <p className="text-error">{st.error ?? err}</p>}
        {st.busy && st.streaming && !r && <p className="text-plata">{st.streaming}</p>}

        {r && (
          <>
            <Card>
              <Label>Briefing</Label>
              <p className="mt-3 text-[16px] leading-relaxed">{r.briefing}</p>
            </Card>
            <div className="grid grid-cols-3 gap-4">
              {r.corrections.map((c) => (
                <article key={c.rank} className="bg-carbono-2 border border-grafito rounded-card p-4 flex flex-col gap-2">
                  <div className="flex justify-between items-center data">
                    <span className="flex items-center gap-2 text-[12px] tracking-[0.08em] text-plata uppercase">
                      <span className="w-2 h-2 bg-alerta" />
                      {c.title}
                    </span>
                    <span className="text-azul font-bold text-[14px]">−{c.gainS.toFixed(2)} s</span>
                  </div>
                  <p className="text-[15px] leading-snug font-semibold">{c.solution}</p>
                  <div className="text-[13px] text-niebla leading-snug">
                    <div>Hoy: {c.current}</div>
                    <div>Objetivo: {c.target}</div>
                  </div>
                </article>
              ))}
            </div>
            {r.corners.length > 0 && (
              <Card>
                <Label>Curva por curva</Label>
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
              </Card>
            )}
            <div className="grid grid-cols-3 gap-4">
              {(
                [
                  ['Frenada', r.dynamics.braking],
                  ['Acelerador', r.dynamics.throttle],
                  ['Círculo de fricción', r.dynamics.frictionCircle],
                ] as const
              ).map(([t, v]) => (
                <Card key={t}>
                  <Label>{t}</Label>
                  <p className="mt-2 text-[14px] leading-snug">{v}</p>
                </Card>
              ))}
            </div>
            <Card className="border-ultramar">
              <Label color="var(--ftn-azul)">Para el próximo stint</Label>
              <p className="mt-2 text-[16px] leading-snug font-semibold">{r.drill.description}</p>
              <p className="mt-1 text-plata text-[14px]">Objetivo: {r.drill.kpi}</p>
            </Card>
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
          {!st.chat.length && <p className="text-niebla text-[14px]">“¿Por qué pierdo tiempo en la T4?” · “¿Dónde freno más tarde en la mejor vuelta?”</p>}
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
