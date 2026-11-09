/**
 * El quiz que arma el coach del piloto: una pregunta por pantalla, opciones para
 * elegir y siempre "Personalizado" con texto libre. Se guarda en los ajustes y
 * el coach lo recibe tal cual en cada análisis.
 */
import { useState } from 'react'
import { ArrowLeft, ArrowRight, Check, PenLine } from 'lucide-react'
import { COACH_QUIZ, defaultCoachStyle, type CoachStyle, type QuizAnswer, type QuizQuestion } from '@shared/coach-quiz'
import { Button, Card } from './ui'

const EMPTY: QuizAnswer = { options: [], custom: '' }

function Option({ label, hint, active, multi, icon, onClick }: { label: string; hint?: string; active: boolean; multi: boolean; icon?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role={multi ? 'checkbox' : 'radio'}
      aria-checked={active}
      onClick={onClick}
      className={`w-full min-h-[56px] px-4 py-3 rounded-control border text-left flex items-center gap-3 transition-colors ${
        active ? 'border-azul bg-ultramar/20' : 'border-acero hover:border-plata'
      }`}
    >
      <span
        className={`w-5 h-5 shrink-0 flex items-center justify-center border ${multi ? 'rounded-[4px]' : 'rounded-full'} ${active ? 'border-azul bg-ultramar' : 'border-acero'}`}
        aria-hidden="true"
      >
        {active && <Check size={13} strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-[15px]">{label}</span>
        {hint && <span className="block text-[13px] text-plata mt-0.5 leading-snug">{hint}</span>}
      </span>
      {icon && <PenLine size={16} className="text-niebla shrink-0" aria-hidden="true" />}
    </button>
  )
}

function Question({ q, value, onChange, customOpen, setCustomOpen }: { q: QuizQuestion; value: QuizAnswer; onChange: (a: QuizAnswer) => void; customOpen: boolean; setCustomOpen: (open: boolean) => void }) {
  const multi = !!q.multi
  const textOnly = !q.options.length
  const toggle = (id: string) => {
    if (multi) onChange({ ...value, options: value.options.includes(id) ? value.options.filter((x) => x !== id) : [...value.options, id] })
    else {
      // Una sola respuesta: elegir una opción reemplaza a lo personalizado
      onChange({ options: [id], custom: '' })
      setCustomOpen(false)
    }
  }
  const toggleCustom = () => {
    if (customOpen) {
      onChange({ ...value, custom: '' })
      setCustomOpen(false)
    } else {
      if (!multi) onChange({ options: [], custom: value.custom })
      setCustomOpen(true)
    }
  }
  const input = (
    <textarea
      autoFocus={!textOnly || undefined}
      value={value.custom}
      onChange={(e) => onChange({ ...value, custom: e.target.value })}
      rows={textOnly ? 5 : 3}
      maxLength={500}
      placeholder={q.placeholder}
      aria-label={q.title}
      className="w-full px-3 py-2.5 rounded-control bg-carbono border border-acero text-blanco placeholder:text-niebla focus:border-azul outline-none leading-relaxed resize-y"
    />
  )
  if (textOnly) return input
  return (
    <div className="flex flex-col gap-2" role={multi ? 'group' : 'radiogroup'} aria-label={q.title}>
      {q.options.map((o) => (
        <Option key={o.id} label={o.label} hint={o.hint} multi={multi} active={value.options.includes(o.id)} onClick={() => toggle(o.id)} />
      ))}
      <Option label="Personalizado" hint="Contámelo con tus palabras." multi={multi} icon active={customOpen} onClick={toggleCustom} />
      {customOpen && input}
    </div>
  )
}

export function CoachQuiz({ value, onDone, onSkip, onCancel }: { value: CoachStyle; onDone: (s: CoachStyle) => void | Promise<void>; onSkip?: () => void; onCancel?: () => void }) {
  const [answers, setAnswers] = useState<CoachStyle['answers']>(() => ({ ...defaultCoachStyle().answers, ...value.answers }))
  const [step, setStep] = useState(0)
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(COACH_QUIZ.map((q) => [q.id, !!answers[q.id]?.custom.trim()])))
  const [saving, setSaving] = useState(false)
  const q = COACH_QUIZ[step]
  const a = answers[q.id] ?? EMPTY
  const isOpen = !!open[q.id]
  const last = step === COACH_QUIZ.length - 1
  // "Personalizado" elegido pide texto; las preguntas sin opciones son opcionales
  const canGo = !q.options.length || (isOpen ? a.custom.trim().length > 0 : a.options.length > 0)

  const finish = async () => {
    setSaving(true)
    try {
      await onDone({ answers, completedAt: Date.now(), skipped: false })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="max-w-[720px] w-full flex flex-col gap-5">
      <div>
        <div className="flex items-center justify-between gap-4">
          <span className="data text-[11px] tracking-[0.12em] uppercase text-niebla">
            Armá tu coach · {step + 1} de {COACH_QUIZ.length}
          </span>
          {step === 0 && onSkip && (
            <button className="text-[13px] text-niebla hover:text-blanco" onClick={onSkip}>
              Seguir sin personalizar
            </button>
          )}
          {step === 0 && onCancel && (
            <button className="text-[13px] text-niebla hover:text-blanco" onClick={onCancel}>
              Cancelar
            </button>
          )}
        </div>
        <div className="mt-2 h-1 rounded-full bg-grafito overflow-hidden" role="progressbar" aria-valuemin={1} aria-valuemax={COACH_QUIZ.length} aria-valuenow={step + 1}>
          <div className="h-full bg-azul transition-[width]" style={{ width: `${((step + 1) / COACH_QUIZ.length) * 100}%` }} />
        </div>
      </div>
      <div>
        <h2 className="text-[20px] font-bold leading-snug">{q.title}</h2>
        {q.sub && <p className="text-plata text-[14px] mt-1">{q.sub}</p>}
      </div>
      <Question
        key={q.id}
        q={q}
        value={a}
        onChange={(v) => setAnswers((x) => ({ ...x, [q.id]: v }))}
        customOpen={isOpen}
        setCustomOpen={(v) => setOpen((x) => ({ ...x, [q.id]: v }))}
      />
      <div className="flex justify-between gap-3">
        <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
          <ArrowLeft size={16} aria-hidden="true" />
          Atrás
        </Button>
        {last ? (
          <Button variant="primary" disabled={saving || !canGo} onClick={() => void finish()}>
            Listo, este es mi coach
          </Button>
        ) : (
          <Button variant="primary" disabled={!canGo} onClick={() => setStep(step + 1)}>
            Siguiente
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
        )}
      </div>
    </Card>
  )
}
