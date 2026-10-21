import { SIM_LABEL } from '@shared/live'
import { Button, Card, Label, PageHeader, Toggle } from '../components/ui'
import { useLanState, useLiveState } from '../hooks'
import { GoLink } from '../nav'

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

function SimStatus() {
  const live = useLiveState()
  const st = live?.status
  const connected = st?.state === 'connected'
  return (
    <Card className="flex items-center gap-5">
      <span className={`w-3 h-3 shrink-0 ${connected ? 'bg-record' : 'bg-alerta animate-pulse'}`} />
      <div className="min-w-0 flex-1">
        <div className="text-[18px] font-semibold">
          {connected && st?.sim ? `Conectado a ${SIM_LABEL[st.sim]}` : 'Esperando el simulador'}
        </div>
        <div className="text-plata mt-1 truncate">
          {connected
            ? [live?.meta?.car, live?.meta?.track, live?.meta?.sessionType].filter(Boolean).join(' · ') || 'Leyendo datos…'
            : 'Abrí iRacing o Assetto Corsa y subite al auto. FTN Coach lo detecta solo, no hay que configurar nada.'}
        </div>
      </div>
      {connected && (
        <div className="text-right shrink-0">
          <Label>Lectura</Label>
          <div className="data text-[18px] mt-1">{st?.hz ?? 0} Hz</div>
        </div>
      )}
    </Card>
  )
}

function TabletCard() {
  const [lan, refresh] = useLanState()
  const setExposed = async (exposed: boolean) => {
    await window.ftn.saveSettings({ lan: { exposed } })
    refresh()
  }
  const url = lan?.urls[0]
  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label>Dashboard en la tablet</Label>
          <p className="text-plata mt-2 leading-relaxed">
            Escaneá el código con la tablet o el celular conectados al mismo wifi que esta PC. Se abre en el navegador, sin
            instalar nada.
          </p>
        </div>
        <Toggle checked={!!lan?.exposed} onChange={(v) => void setExposed(v)} label="Permitir dispositivos de la red" />
      </div>

      {lan?.error && <p className="mt-4 text-error">{lan.error}.{' '}
          <GoLink to="settings" section="lan">
            Cambiá el puerto en Ajustes
          </GoLink>
        </p>}

      {lan?.exposed && url ? (
        <div className="mt-5">
          <Label>Dirección</Label>
          <div className="data text-[18px] mt-1 break-all">{url}</div>
          {lan.urls.length > 1 && (
            <div className="data text-niebla text-[12px] mt-1">También: {lan.urls.slice(1).join(' · ')}</div>
          )}
        </div>
      ) : null}

      {lan?.exposed && url ? (
        <div className="mt-4 flex gap-6 items-center">
          {lan.qr && <img src={lan.qr} alt={`Código QR de ${url}`} className="w-40 h-40 rounded-control shrink-0" />}
          <div className="min-w-0 space-y-3">
            <div className="text-plata">
              {lan.clients === 0
                ? 'Ningún dispositivo conectado.'
                : lan.clients === 1
                  ? '1 pantalla conectada (contando la vista previa).'
                  : `${lan.clients} pantallas conectadas (contando la vista previa).`}
            </div>
            <Button variant="secondary" onClick={() => void window.ftn.openExternal(url)}>
              Abrir en el navegador
            </Button>
          </div>
        </div>
      ) : lan?.exposed ? (
        <p className="mt-4 text-alerta">No se encontró una red local. Conectá la PC al wifi o por cable.</p>
      ) : (
        <p className="mt-4 text-niebla">Desactivado: el dashboard solo se ve en esta PC.</p>
      )}

      {lan?.exposed && url && (
        <p className="mt-5 text-[12px] text-niebla leading-relaxed">
          Si la tablet no conecta: la primera vez Windows pregunta si FTN Coach puede usar la red. Aceptá para redes privadas.
          Solo se publica telemetría; desde la red no se puede cambiar nada.
        </p>
      )}
    </Card>
  )
}

function DemoCard() {
  const live = useLiveState()
  const demo = live?.demo
  const playing = live?.status.sim === 'replay'
  return (
    <Card>
      <Label>Probar sin el simulador</Label>
      <p className="text-plata mt-2 leading-relaxed">
        Reproducí una sesión grabada de iRacing (.ibt) como si estuvieras en pista. Sirve para acomodar la tablet antes de
        correr. Si abrís el simulador, tiene prioridad.
      </p>
      <div className="mt-4 flex items-center gap-3">
        {demo ? (
          <>
            <Button variant="secondary" onClick={() => void window.ftn.stopDemo()}>
              Detener demo
            </Button>
            <span className="data text-[12px] text-niebla truncate">
              {playing ? 'Reproduciendo ' : 'En espera: '}
              {basename(demo)}
            </span>
          </>
        ) : (
          <Button variant="primary" onClick={() => void window.ftn.startDemo()}>
            Elegir sesión grabada
          </Button>
        )}
      </div>
    </Card>
  )
}

function Preview() {
  const [lan] = useLanState(5000)
  if (!lan?.running) return null
  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-5 pt-4 pb-3 flex items-center justify-between">
        <Label>Vista previa</Label>
        <span className="text-[12px] text-niebla">Lo mismo que ve la tablet</span>
      </div>
      <div className="aspect-[16/10] border-t border-grafito">
        <iframe title="Vista previa del dashboard" src={lan.localUrl} className="w-full h-full border-0 block" />
      </div>
    </Card>
  )
}

export function LivePage() {
  return (
    <div className="max-w-[1400px]">
      <PageHeader title="En vivo" />
      <div className="space-y-5">
        <SimStatus />
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-5 items-start">
          <div className="space-y-5">
            <TabletCard />
            <DemoCard />
          </div>
          <Preview />
        </div>
      </div>
    </div>
  )
}
