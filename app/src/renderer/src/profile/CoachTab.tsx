/**
 * Charla con el coach fuera de una sesión: sobre tu progreso, tus carreras, tu
 * plan y lo que quieras lograr. Lo que acuerden se puede pasar al plan.
 */
import { useEffect, useRef, useState } from 'react'
import { MessageSquareText, Sparkles } from 'lucide-react'
import type { PlanState } from '@shared/plan'
import { Button, Label } from '../components/ui'
import { INPUT } from './plan-data'

const IDEAS = [
  '¿Qué me conviene practicar esta semana?',
  '¿Cómo llego a mi próxima carrera?',
  '¿Qué me falta para correr en GT3?',
  'Armame una rutina de 30 minutos antes de correr',
]

export function CoachTab({ st, run, error, onApplied }: { st: PlanState; run: (p: Promise<PlanState>) => Promise<void>; error: string | null; onApplied: () => void }) {
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const busy = st.busy === 'assistant'
  const chat = st.assistant
  const last = chat.at(-1)
  useEffect(() => end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), [chat.length, st.streaming])
  const ask = (q: string) => {
    setText('')
    void run(window.ftn.planAsk(q))
  }

  return (
    <div className="bg-carbono-2 border border-grafito rounded-panel flex flex-col h-[calc(100vh-240px)] min-h-[480px]">
      <div className="px-5 py-4 border-b border-grafito flex items-center justify-between gap-4">
        <div>
          <Label icon={MessageSquareText}>Tu coach</Label>
          <p className="text-[13px] text-niebla mt-1">Conoce tus sesiones, tu progreso, tu calendario y tu plan.</p>
        </div>
        {chat.length > 0 && (
          <button className="text-[12px] text-niebla hover:text-blanco" disabled={busy} onClick={() => void run(window.ftn.planClearChat())}>
            Borrar la charla
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
        {!chat.length && (
          <div className="flex flex-wrap gap-2">
            {IDEAS.map((q) => (
              <button key={q} onClick={() => ask(q)} disabled={!!st.busy} className="text-[14px] text-plata border border-acero hover:border-plata hover:text-blanco rounded-control px-3 py-2 text-left">
                {q}
              </button>
            ))}
          </div>
        )}
        {chat.map((m, i) => (
          <div
            key={i}
            className={`text-[14px] leading-relaxed whitespace-pre-wrap rounded-control px-3.5 py-2.5 ${m.role === 'user' ? 'bg-ultramar self-end max-w-[75%]' : 'bg-carbono self-start max-w-[85%]'}`}
          >
            {m.text}
          </div>
        ))}
        {busy && last?.role === 'user' && (
          <div className="text-[14px] leading-relaxed whitespace-pre-wrap rounded-control px-3.5 py-2.5 bg-carbono self-start text-plata max-w-[85%]">{st.streaming || '…'}</div>
        )}
        {!st.busy && last?.role === 'assistant' && (
          <button
            className="self-start inline-flex items-center gap-2 text-[13px] text-azul font-semibold hover:underline"
            onClick={() => {
              void run(window.ftn.planGenerate(`Lo que hablamos con el coach: ${last.text}`))
              onApplied()
            }}
          >
            <Sparkles size={14} /> {st.plan ? 'Ajustar mi plan con esto' : 'Armar mi plan con esto'}
          </button>
        )}
        {(error || (st.error && !st.busy)) && <p className="text-alerta text-[14px]">{error ?? st.error}</p>}
        <div ref={end} />
      </div>
      <form
        className="p-3 border-t border-grafito flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          ask(text)
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} disabled={!!st.busy} placeholder="Preguntale lo que quieras sobre tu carrera" className={`${INPUT} h-11 flex-1 min-w-0`} />
        <Button variant="primary" type="submit" disabled={!!st.busy || !text.trim()}>
          Enviar
        </Button>
      </form>
    </div>
  )
}
