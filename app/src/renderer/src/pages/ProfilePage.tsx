/**
 * Perfil del piloto: lo que el piloto cuenta de sí mismo (lo usa el coach como
 * contexto), su estilo de manejo medido, sus récords y dónde deja tiempo.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { DriverStyle } from '@shared/analysis'
import type { Settings } from '@shared/api'
import * as fmt from '@ui/format'
import { Button, Card, Label, PageHeader } from '../components/ui'
import { useSettings } from '../hooks'
import { hours, useProgress } from './ProgressPage'

const DISCIPLINES = ['GT y sport prototipos', 'Fórmula', 'Turismo', 'Óvalo', 'Tierra y rally', 'Varias']

const INPUT = 'w-full px-3 rounded-control bg-carbono border border-acero text-blanco placeholder:text-niebla focus:border-azul outline-none'

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-semibold">{label}</span>
      {children}
      {hint && <span className="text-[12px] text-niebla">{hint}</span>}
    </label>
  )
}

function ProfileForm({ value, onSave, onCancel }: { value: Settings['profile']; onSave: (p: Settings['profile']) => Promise<void>; onCancel?: () => void }) {
  const [p, setP] = useState(value)
  const [saving, setSaving] = useState(false)
  useEffect(() => setP(value), [value])
  const set = <K extends keyof Settings['profile']>(k: K, v: Settings['profile'][K]) => setP((x) => ({ ...x, [k]: v }))
  return (
    <Card className="flex flex-col gap-4">
      <Label>Sobre vos</Label>
      <div className="grid grid-cols-[1fr_160px_1fr] gap-4">
        <Field label="Nombre">
          <input value={p.name} onChange={(e) => set('name', e.target.value)} className={`${INPUT} h-11`} placeholder="Cómo te llama el coach" />
        </Field>
        <Field label="Años corriendo">
          <input
            type="number"
            min={0}
            max={80}
            value={p.experienceYears || ''}
            onChange={(e) => set('experienceYears', Number(e.target.value) || 0)}
            className={`${INPUT} h-11 data`}
          />
        </Field>
        <Field label="Disciplina principal">
          <select value={p.discipline} onChange={(e) => set('discipline', e.target.value)} className={`${INPUT} h-11`}>
            <option value="">Sin elegir</option>
            {DISCIPLINES.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Tu experiencia" hint="Simuladores, autos reales, karting, qué te cuesta. El coach lo usa como contexto.">
        <textarea value={p.about} onChange={(e) => set('about', e.target.value)} rows={3} className={`${INPUT} py-2.5 leading-relaxed resize-y`} />
      </Field>
      <Field label="Objetivo actual" hint="Por ejemplo: bajar de 1:02 en Tsukuba con el GR86, o llegar a licencia A.">
        <textarea value={p.goals} onChange={(e) => set('goals', e.target.value)} rows={2} className={`${INPUT} py-2.5 leading-relaxed resize-y`} />
      </Field>
      <div className="flex gap-3 justify-end">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button
          variant="primary"
          disabled={saving}
          onClick={async () => {
            setSaving(true)
            try {
              await onSave(p)
            } finally {
              setSaving(false)
            }
          }}
        >
          Guardar
        </Button>
      </div>
    </Card>
  )
}

function Row({ title, sub, value, color }: { title: string; sub: string; value: ReactNode; color: string }) {
  return (
    <div className="px-4 py-3 flex items-center gap-3">
      <span className="w-2 h-2 shrink-0" style={{ background: color }} />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold truncate">{title}</div>
        <div className="text-[13px] text-plata truncate">{sub}</div>
      </div>
      <div className="data text-[14px] shrink-0 text-right">{value}</div>
    </div>
  )
}

export function ProfilePage() {
  const [s, setS] = useSettings()
  const [editing, setEditing] = useState(false)
  const { combos, sessions } = useProgress()
  const [style, setStyle] = useState<DriverStyle | null>(null)
  useEffect(() => void window.ftn.driverStyle().then(setStyle), [])
  if (!s) return null
  const p = s.profile
  const empty = !p.name && !p.about && !p.goals && !p.experienceYears
  const save = async (profile: Settings['profile']) => {
    setS(await window.ftn.saveSettings({ profile }))
    setEditing(false)
  }

  // Cuánto te separa tu PB de tu vuelta ideal (tus mejores sectores) en cada combinación
  const gaps = combos
    .filter((c) => c.idealS && c.points.length)
    .map((c) => ({ c, pb: Math.min(...c.points.map((x) => x.bestS)), gap: Math.min(...c.points.map((x) => x.bestS)) - c.idealS! }))
    .filter((x) => x.gap >= 0)
  const strengths = [...gaps].sort((a, b) => a.gap - b.gap).slice(0, 5)
  const weaknesses = [...gaps].sort((a, b) => b.gap - a.gap).filter((x) => x.gap > 0.15).slice(0, 5)
  const records = [...combos].sort((a, b) => b.sessions - a.sessions).slice(0, 8)
  const laps = sessions.reduce((a, x) => a + x.laps, 0)
  const valid = sessions.reduce((a, x) => a + x.validLaps, 0)

  return (
    <div className="max-w-[1100px]">
      <PageHeader title={p.name || 'Tu perfil'}>
        {!empty && !editing && <Button onClick={() => setEditing(true)}>Editar perfil</Button>}
      </PageHeader>
      <div className="flex flex-col gap-5">
        {!empty && !editing && (
          <>
            <div className="data text-[12px] tracking-[0.12em] uppercase text-niebla -mt-3">
              {[p.experienceYears ? `${p.experienceYears} años corriendo` : null, p.discipline || null].filter(Boolean).join(' · ') || 'Piloto'}
            </div>
            {(p.about || p.goals) && (
              <div className="grid grid-cols-2 gap-4">
                {p.about && (
                  <Card>
                    <Label>Tu experiencia</Label>
                    <p className="mt-2 text-plata leading-relaxed whitespace-pre-wrap">{p.about}</p>
                  </Card>
                )}
                {p.goals && (
                  <Card className="border-ultramar">
                    <Label color="var(--ftn-azul)">Objetivo actual</Label>
                    <p className="mt-2 leading-relaxed whitespace-pre-wrap">{p.goals}</p>
                  </Card>
                )}
              </div>
            )}
          </>
        )}
        {(empty || editing) && <ProfileForm value={p} onSave={save} onCancel={editing ? () => setEditing(false) : undefined} />}


        <div className="grid grid-cols-4 gap-4">
          {(
            [
              ['Sesiones', String(sessions.length)],
              ['Vueltas', String(laps)],
              ['Válidas', laps ? `${Math.round((100 * valid) / laps)} %` : fmt.DASH],
              ['En pista', hours(sessions.reduce((a, x) => a + x.durationS, 0))],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="bg-carbono-2 border border-grafito rounded-card px-5 py-4">
              <div className="data text-[12px] tracking-[0.1em] text-niebla uppercase">{label}</div>
              <div className="data text-[26px] font-bold mt-1.5">{value}</div>
            </div>
          ))}
        </div>

        <section>
          <h2 className="text-[18px] font-bold mb-1">Tu estilo de manejo</h2>
          {style ? (
            <>
              <p className="text-[13px] text-niebla mb-3">
                Medido en {style.sessions === 1 ? 'la última sesión que abriste' : `las últimas ${style.sessions} sesiones que abriste`}
                {style.tentative ? ': todavía son pocos datos, tomalo como una tendencia.' : '.'}
              </p>
              <div className="bg-carbono-2 border border-grafito rounded-card divide-y divide-grafito">
                {style.traits.map((t) => (
                  <Row
                    key={t.id}
                    title={t.title}
                    sub={t.text}
                    color={t.good === true ? 'var(--ftn-record)' : t.good === false ? 'var(--ftn-alerta)' : 'var(--ftn-acero)'}
                    value={t.value}
                  />
                ))}
              </div>
            </>
          ) : (
            <p className="text-plata text-[14px] mt-2">Abrí una sesión con al menos dos vueltas válidas y acá aparece cómo frenás, acelerás y usás el grip.</p>
          )}
        </section>

        {gaps.length > 0 && (
          <div className="grid grid-cols-2 gap-5">
            <section>
              <h2 className="text-[18px] font-bold mb-1">Dónde ya sacás todo</h2>
              <p className="text-[13px] text-niebla mb-3">Tu PB está pegado a tu vuelta ideal (tus mejores sectores).</p>
              <div className="bg-carbono-2 border border-grafito rounded-card divide-y divide-grafito">
                {strengths.map(({ c, pb, gap }) => (
                  <Row key={c.key} title={c.track} sub={c.car} color="var(--ftn-record)" value={<>{fmt.lapTime(pb)}<div className="text-[12px] text-record">{fmt.delta(gap, 3)} a la ideal</div></>} />
                ))}
              </div>
            </section>
            <section>
              <h2 className="text-[18px] font-bold mb-1">Dónde dejás tiempo</h2>
              <p className="text-[13px] text-niebla mb-3">Ya hiciste cada sector más rápido: falta juntarlos en una vuelta.</p>
              {weaknesses.length ? (
                <div className="bg-carbono-2 border border-grafito rounded-card divide-y divide-grafito">
                  {weaknesses.map(({ c, pb, gap }) => (
                    <Row key={c.key} title={c.track} sub={c.car} color="var(--ftn-alerta)" value={<>{fmt.lapTime(pb)}<div className="text-[12px] text-alerta">{fmt.delta(gap, 3)} a la ideal</div></>} />
                  ))}
                </div>
              ) : (
                <p className="text-plata text-[14px]">En ninguna combinación dejás más de 0,15 s contra tu ideal.</p>
              )}
            </section>
          </div>
        )}

        {records.length > 0 && (
          <section>
            <h2 className="text-[18px] font-bold mb-3">Tus récords</h2>
            <div className="bg-carbono-2 border border-grafito rounded-card divide-y divide-grafito">
              {records.map((c) => (
                <Row
                  key={c.key}
                  title={c.track}
                  sub={`${c.car} · ${c.sim === 'ac' ? 'Assetto Corsa' : 'iRacing'}`}
                  color="var(--ftn-mejor)"
                  value={<span className="text-mejor">{fmt.lapTime(Math.min(...c.points.map((x) => x.bestS)))}</span>}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
