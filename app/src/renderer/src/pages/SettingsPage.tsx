import { useEffect, useState, type ReactNode } from 'react'
import { COACH_PROVIDERS, type CoachCost, type CoachKeyId, type CoachProviderInfo } from '@shared/analysis'
import type { AcAppStatus, DeepPartial, Settings } from '@shared/api'
import { Button, Card, Label, PageHeader, Toggle } from '../components/ui'
import { useSettings } from '../hooks'
import type { SettingsSection } from '../nav'

function Field({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-4 border-b border-grafito last:border-0">
      <div className="min-w-0">
        <div className="font-semibold">{title}</div>
        {hint && <div className="text-niebla text-[13px] mt-1 leading-relaxed">{hint}</div>}
      </div>
      <div className="shrink-0 flex items-center gap-3">{children}</div>
    </div>
  )
}

function NumberInput({ value, onCommit, min, max }: { value: number; onCommit: (v: number) => void; min: number; max: number }) {
  const [draft, setDraft] = useState(String(value))
  const commit = () => {
    const n = Number(draft)
    if (Number.isFinite(n) && n >= min && n <= max) onCommit(n)
    else setDraft(String(value))
  }
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      className="data w-28 h-11 px-3 rounded-control bg-carbono border border-acero text-blanco text-right focus:border-azul outline-none"
    />
  )
}

const cleanError = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const COST_GROUPS: { cost: CoachCost; label: string }[] = [
  { cost: 'free', label: 'Gratis' },
  { cost: 'plan', label: 'Con tu suscripción' },
  { cost: 'paid', label: 'Pago por uso' },
]

/** Lo más barato que ofrece el proveedor. */
const providerCost = (p: CoachProviderInfo): CoachCost =>
  p.models.some((m) => m.cost === 'free') ? 'free' : p.models.some((m) => m.cost === 'plan') ? 'plan' : 'paid'

function ClaudeCodeStatus() {
  const [version, setVersion] = useState<string | null | undefined>(undefined)
  const check = () => {
    setVersion(undefined)
    void window.ftn.claudeCodeVersion().then(setVersion)
  }
  useEffect(check, [])
  return (
    <Field
      title="Claude Code"
      hint={
        version === undefined ? (
          'Buscando Claude Code en esta PC…'
        ) : version ? (
          `Instalado (v${version}). Si nunca lo usaste, abrí una terminal, corré «claude» y logueate con tu cuenta de Claude.`
        ) : (
          <>
            No está instalado. Bajalo de{' '}
            <button className="text-azul hover:underline" onClick={() => void window.ftn.openExternal('https://claude.com/code')}>
              claude.com/code
            </button>
            , logueate con tu cuenta Pro o Max corriendo «claude» en una terminal y volvé a revisar.
          </>
        )
      }
    >
      <Button disabled={version === undefined} onClick={check}>
        Revisar
      </Button>
    </Field>
  )
}

function CoachKey({ info }: { info: CoachProviderInfo & { key: CoachKeyId; keyUrl: string } }) {
  const [has, setHas] = useState<boolean | null>(null)
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    setHas(null)
    setDraft('')
    void window.ftn.hasCoachKey(info.key).then(setHas)
  }, [info.key])
  const save = async (key: string | null) => {
    setErr(null)
    try {
      setHas(await window.ftn.setCoachKey(info.key, key))
      setDraft('')
    } catch (e) {
      setErr(cleanError(e))
    }
  }
  if (has === null) return null
  return (
    <Field
      title={`API key de ${info.label.split(' · ')[0]}`}
      hint={
        has ? (
          'Guardada y cifrada en esta PC. Solo se usa para hablar con el proveedor.'
        ) : (
          <>
            La creás en{' '}
            <button className="text-azul hover:underline" onClick={() => void window.ftn.openExternal(info.keyUrl)}>
              {info.keyUrl.replace(/^https:\/\//, '')}
            </button>
            . Se guarda cifrada en esta PC.
          </>
        )
      }
    >
      {err && <span className="text-error text-[13px]">{err}</span>}
      {has ? (
        <Button onClick={() => void save(null)}>Borrar</Button>
      ) : (
        <>
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={info.keyPlaceholder}
            className="data w-64 h-11 px-3 rounded-control bg-carbono border border-acero text-blanco focus:border-azul outline-none"
          />
          <Button variant="primary" disabled={draft.trim().length < 10} onClick={() => void save(draft)}>
            Guardar
          </Button>
        </>
      )}
    </Field>
  )
}

const OTHER_MODEL = '__otro__'

/** Modelo del proveedor: la lista agrupada por costo o un ID a mano (los proveedores suman modelos seguido). */
function ModelInput({ info, value, onCommit }: { info: CoachProviderInfo; value: string; onCommit: (v: string) => void }) {
  const listed = info.models.some((m) => m.id === value)
  const [custom, setCustom] = useState(!listed)
  const [draft, setDraft] = useState(value)
  useEffect(() => {
    setDraft(value)
    setCustom(!info.models.some((m) => m.id === value))
  }, [value, info])
  const commit = () => draft.trim() && draft.trim() !== value && onCommit(draft.trim())
  return (
    <div className="flex flex-wrap gap-2">
      <select
        value={custom ? OTHER_MODEL : value}
        onChange={(e) => (e.target.value === OTHER_MODEL ? setCustom(true) : onCommit(e.target.value))}
        className="w-72 h-11 px-3 rounded-control bg-carbono border border-acero text-blanco focus:border-azul outline-none"
      >
        {COST_GROUPS.filter((g) => info.models.some((m) => m.cost === g.cost)).map((g) => (
          <optgroup key={g.cost} label={g.label}>
            {info.models
              .filter((m) => m.cost === g.cost)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
          </optgroup>
        ))}
        <option value={OTHER_MODEL}>Otro modelo…</option>
      </select>
      {custom && (
        <input
          autoFocus={listed}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          placeholder="ID del modelo"
          className="data w-64 h-11 px-3 rounded-control bg-carbono border border-acero text-blanco placeholder:text-niebla focus:border-azul outline-none"
        />
      )}
    </div>
  )
}

function AcApp() {
  const [st, setSt] = useState<AcAppStatus | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    void window.ftn.acApp().then(setSt)
  }, [])
  if (!st) return null
  const install = async () => {
    setErr(null)
    try {
      setSt(await window.ftn.installAcApp())
    } catch (e) {
      setErr(cleanError(e))
    }
  }
  let hint: string
  if (!st.acFound) hint = 'No se encontró Assetto Corsa instalado con Steam.'
  else if (!st.csp) hint = 'La app necesita Custom Shaders Patch (CSP). Instalalo con Content Manager y volvé.'
  else if (st.installed && st.installed === st.bundled) hint = `Instalada (v${st.installed}). En el juego, cada overlay aparece en la barra de apps como “FTN Coach · …”.`
  else if (st.installed) hint = `Instalada la v${st.installed}; esta versión de FTN Coach trae la v${st.bundled}, con overlays nuevos.`
  else hint = 'Overlays en vivo dentro del juego con el diseño del dashboard: delta, tacómetro, inputs, tiempos, relative, neumáticos, auto, vueltas, mapa, radar y banderas, más el consejo de la próxima curva.'
  return (
    <Field title="App dentro del juego" hint={hint}>
      {err && <span className="text-error text-[13px]">{err}</span>}
      <Button variant={st.installed === st.bundled ? 'secondary' : 'primary'} disabled={!st.acFound || !st.csp} onClick={() => void install()}>
        {st.installed ? (st.installed === st.bundled ? 'Reinstalar' : 'Actualizar') : 'Instalar'}
      </Button>
    </Field>
  )
}

export function SettingsPage({ focus }: { focus?: SettingsSection | null }) {
  const [s, setS] = useSettings()
  const loaded = !!s
  // Llegó desde un aviso ("cargá la clave en Ajustes"): directo a esa tarjeta
  useEffect(() => {
    if (loaded && focus) document.getElementById(`ajustes-${focus}`)?.scrollIntoView({ block: 'start' })
  }, [loaded, focus])
  if (!s) return null
  const save = async (patch: DeepPartial<Settings>) => setS(await window.ftn.saveSettings(patch))
  const coachInfo = COACH_PROVIDERS.find((p) => p.id === s.coach.provider) ?? COACH_PROVIDERS[0]
  const coachModelCost = coachInfo.models.find((m) => m.id === s.coach.models[coachInfo.id])?.cost ?? providerCost(coachInfo)

  return (
    <div className="max-w-[900px]">
      <PageHeader title="Ajustes" />
      <div className="space-y-5">
        <Card id="ajustes-lan">
          <Label>Red local</Label>
          <Field title="Dashboards en otros dispositivos" hint="Tablet o celular en el mismo wifi. Solo lectura.">
            <Toggle checked={s.lan.exposed} onChange={(v) => void save({ lan: { exposed: v } })} label="Dashboards en la red" />
          </Field>
          <Field title="Puerto" hint="Cambialo solo si otro programa ya usa el 8090.">
            <NumberInput value={s.lan.port} min={1024} max={65535} onCommit={(v) => void save({ lan: { port: v } })} />
          </Field>
          <Field
            title="Actualizaciones por segundo"
            hint="30 alcanza para cualquier tablet. Más consume más batería en el dispositivo."
          >
            <NumberInput value={s.lan.hz} min={5} max={60} onCommit={(v) => void save({ lan: { hz: v } })} />
          </Field>
        </Card>

        <Card>
          <Label>Aplicación</Label>
          <Field
            title="Al cerrar, seguir en la bandeja"
            hint="La ventana se cierra y libera memoria; la tablet sigue recibiendo datos. Para salir: clic derecho en el ícono."
          >
            <Toggle checked={s.app.closeToTray} onChange={(v) => void save({ app: { closeToTray: v } })} label="Seguir en la bandeja" />
          </Field>
          <Field title="Iniciar con Windows" hint="Arranca en la bandeja, listo para cuando abras el simulador.">
            <Toggle
              checked={s.app.startWithWindows}
              onChange={(v) => void save({ app: { startWithWindows: v } })}
              label="Iniciar con Windows"
            />
          </Field>
        </Card>

        <Card id="ajustes-coach">
          <Label>Coach</Label>
          <Field title="Proveedor de IA" hint={coachInfo.hint}>
            <select
              value={s.coach.provider}
              onChange={(e) => void save({ coach: { provider: e.target.value as Settings['coach']['provider'] } })}
              className="w-72 h-11 px-3 rounded-control bg-carbono border border-acero text-blanco focus:border-azul outline-none"
            >
              {COST_GROUPS.map((g) => (
                <optgroup key={g.cost} label={g.label}>
                  {COACH_PROVIDERS.filter((p) => providerCost(p) === g.cost).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          {coachInfo.key && coachInfo.keyUrl ? <CoachKey info={{ ...coachInfo, key: coachInfo.key, keyUrl: coachInfo.keyUrl }} /> : <ClaudeCodeStatus />}
          <Field
            title="Modelo"
            hint={
              coachModelCost === 'free'
                ? 'Gratis: no se te cobra nada.'
                : coachModelCost === 'plan'
                  ? 'Sale del límite de tu suscripción; los modelos más chicos lo hacen rendir más.'
                  : 'Se cobra por uso a tu cuenta del proveedor.'
            }
          >
            <ModelInput
              info={coachInfo}
              value={s.coach.models[coachInfo.id]}
              onCommit={(v) => void save({ coach: { models: { [coachInfo.id]: v } } })}
            />
          </Field>
        </Card>


        <Card>
          <Label>Grabación de sesiones</Label>
          <Field title="Grabar Assetto Corsa" hint="AC no guarda telemetría: FTN Coach graba cada sesión para analizarla después.">
            <Toggle checked={s.recording.ac} onChange={(v) => void save({ recording: { ac: v } })} label="Grabar Assetto Corsa" />
          </Field>
          <Field
            title="Grabar iRacing"
            hint="Normalmente no hace falta: iRacing guarda sus .ibt (con Alt+L). Activalo si no usás la telemetría de iRacing; sin GPS no hay mapa oficial."
          >
            <Toggle checked={s.recording.iracing} onChange={(v) => void save({ recording: { iracing: v } })} label="Grabar iRacing" />
          </Field>
        </Card>

        <Card>
          <Label>Assetto Corsa</Label>
          <AcApp />
        </Card>

        <Card>
          <Label>Carpetas</Label>
          <Field title="Telemetría de iRacing" hint={s.paths.iracingTelemetry}>
            <Button
              onClick={async () => {
                const dir = await window.ftn.pickFolder(s.paths.iracingTelemetry)
                if (dir) await save({ paths: { iracingTelemetry: dir } })
              }}
            >
              Cambiar
            </Button>
          </Field>
          <Field title="Sesiones grabadas" hint={s.paths.recordings}>
            <Button
              onClick={async () => {
                const dir = await window.ftn.pickFolder(s.paths.recordings)
                if (dir) await save({ paths: { recordings: dir } })
              }}
            >
              Cambiar
            </Button>
          </Field>
        </Card>
      </div>
    </div>
  )
}
