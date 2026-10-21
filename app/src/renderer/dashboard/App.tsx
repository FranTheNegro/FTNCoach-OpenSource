import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Ellipsis, FlaskConical, Flag as FlagIcon, Gauge, Map as MapIcon, Maximize, Plug, Timer, Unplug, Users, Wrench, Wifi, WifiOff, type LucideIcon } from 'lucide-react'
import { SIM_LABEL, type Flag } from '@shared/live'
import { LiveClient, useLive } from '@ui/live-client'
import { LogoHorizontal, Monogram } from '@ui/Logo'
import { usePrefs, type PageId } from './prefs'
import { FLAG_INFO, FlagFrame } from './widgets'
import { Inputs } from './v2/Inputs'
import { TrackMap } from './v2/MapPage'
import { Car } from './v2/Car'
import { Laps } from './v2/Laps'
import { Live } from './v2/Live'
import { Rivals } from './v2/Rivals'
import { C, Chip, Ico, Stage } from './v2/kit'
import { DashTracker } from './v2/tracker'

const PAGES: { id: PageId; label: string; icon: LucideIcon }[] = [
  { id: 'live', label: 'En vivo', icon: Gauge },
  { id: 'car', label: 'Auto', icon: Wrench },
  { id: 'laps', label: 'Vueltas', icon: Timer },
  { id: 'rivals', label: 'Rivales', icon: Users },
  { id: 'inputs', label: 'Inputs', icon: Activity },
  { id: 'map', label: 'Mapa', icon: MapIcon },
]

type WakeLockSentinelLike = { release(): Promise<void> }

function useWakeLock(on: boolean): boolean {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator
  useEffect(() => {
    if (!on || !supported) return
    let lock: WakeLockSentinelLike | null = null
    const request = async () => {
      try {
        lock = await (navigator as unknown as { wakeLock: { request(t: 'screen'): Promise<WakeLockSentinelLike> } }).wakeLock.request('screen')
      } catch {
        lock = null
      }
    }
    void request()
    // El navegador suelta el bloqueo al ocultar la pestaña: se pide de nuevo al volver
    const onVisible = () => document.visibilityState === 'visible' && void request()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release()
    }
  }, [on, supported])
  return supported
}

/** Bandera a mostrar abajo a la derecha: la más importante que no sea la verde de siempre. */
function flagLabel(flags: Flag[]): { label: string; color: string } | null {
  const flag = flags.find((x) => x !== 'green') ?? (flags.includes('green') ? 'green' : null)
  return flag ? { label: FLAG_INFO[flag].label, color: FLAG_INFO[flag].color } : null
}

export function App() {
  const client = useMemo(() => LiveClient.forPage(), [])
  const tracker = useMemo(() => new DashTracker(), [])
  const live = useLive(client)
  const [prefs, setPrefs] = usePrefs()
  const [menu, setMenu] = useState(false)
  const [keepAwake, setKeepAwake] = useState(true)
  const wakeSupported = useWakeLock(keepAwake)
  const swipe = useRef<{ x: number; y: number } | null>(null)

  const f = live.frame
  const status = live.status
  const connectedToSim = status?.state === 'connected'
  const pageIdx = PAGES.findIndex((p) => p.id === prefs.page)
  if (f) tracker.feed(f, live.meta)

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen?.().catch(() => {})
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const s = swipe.current
    swipe.current = null
    if (!s) return
    const dx = (e.clientX - s.x)
    const dy = (e.clientY - s.y)
    if (Math.abs(dx) < 70 || Math.abs(dy) > 50) return
    const next = Math.max(0, Math.min(PAGES.length - 1, pageIdx + (dx < 0 ? 1 : -1)))
    setPrefs({ page: PAGES[next].id })
  }

  let overlay: React.ReactNode = null
  if (live.outdated) {
    overlay = (
      <div className="overlay">
        <Monogram size={72} />
        <h1>Hay una versión nueva</h1>
        <p>FTN Coach se actualizó en la PC. Recargá esta página para seguir.</p>
      </div>
    )
  } else if (!live.connected) {
    overlay = (
      <div className="overlay">
        <div className="pulse">
          <Monogram size={72} />
        </div>
        <h1>Buscando FTN Coach…</h1>
        <p>Abrí FTN Coach en la PC. Esta pantalla se conecta sola cuando la app está abierta en la misma red.</p>
      </div>
    )
  } else if (!connectedToSim || !f) {
    overlay = (
      <div className="overlay">
        <div className="pulse">
          <Monogram size={72} />
        </div>
        <h1>Esperando el simulador</h1>
        <p>Abrí iRacing o Assetto Corsa y subite al auto. Los datos aparecen acá apenas salgas a pista.</p>
      </div>
    )
  }

  const meta = live.meta
  const flag = f ? flagLabel(f.flags) : null
  const simName = connectedToSim && status?.sim ? SIM_LABEL[status.sim] : live.connected ? 'Sin simulador' : 'Sin conexión'

  return (
    <Stage>
      <header className="d2-head">
        <LogoHorizontal height={44} />
        <div className="d2-sim" aria-label="Simulador">
          <Ico icon={connectedToSim ? Plug : Unplug} size={20} color={connectedToSim ? C.record : live.connected ? C.alerta : C.niebla} />
          {simName}
        </div>
        <div className="d2-chips">
          {connectedToSim && meta && (
            <>
              <Chip>{meta.car}</Chip>
              <Chip>{meta.track}</Chip>
              <Chip>{meta.sessionType}</Chip>
            </>
          )}
          {f?.position && <Chip tone="highlight">{`P${f.position}${f.carsInSession ? ` de ${f.carsInSession}` : ''}`}</Chip>}
          {f?.incidents ? <Chip tone="alert">{`Inc. ${f.incidents}x`}</Chip> : null}
        </div>
        <div className="d2-head-right">
          <span className="d2-note">
            {status?.sim === 'replay' ? (
              <>
                <Ico icon={FlaskConical} size={18} color={C.alerta} />
                Datos de demo
              </>
            ) : (
              <>
                <Ico icon={live.connected ? Wifi : WifiOff} size={18} color={live.connected ? C.record : C.niebla} />
                {connectedToSim && status ? `${status.hz} Hz` : 'Sin datos'}
              </>
            )}
          </span>
          <button className="d2-iconbtn" onClick={() => setMenu((m) => !m)} aria-label="Opciones">
            <Ico icon={Ellipsis} size={22} />
          </button>
          <button className="d2-iconbtn" onClick={toggleFullscreen} aria-label="Pantalla completa">
            <Ico icon={Maximize} size={20} />
          </button>
        </div>
      </header>

      <div
        style={{ position: 'relative', minHeight: 0, display: 'grid' }}
        onPointerDown={(e) => (swipe.current = { x: e.clientX, y: e.clientY })}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipe.current = null)}
      >
        {f && prefs.page === 'live' && <Live f={f} meta={meta} laps={live.laps} units={prefs.units} tracker={tracker} history={client.history} />}
        {f && prefs.page === 'car' && <Car f={f} meta={meta} units={prefs.units} />}
        {f && prefs.page === 'laps' && <Laps f={f} meta={meta} laps={live.laps} units={prefs.units} tracker={tracker} />}
        {f && prefs.page === 'rivals' && <Rivals f={f} meta={meta} tracker={tracker} />}
        {f && prefs.page === 'inputs' && (
          <Inputs f={f} history={client.history} units={prefs.units} />
        )}
        {f && prefs.page === 'map' && (
          <TrackMap f={f} meta={meta} units={prefs.units} tracker={tracker} />
        )}
        {overlay}
      </div>

      <nav className="d2-nav" aria-label="Pantallas">
        <div role="tablist" style={{ display: 'flex', gap: 10 }}>
          {PAGES.map((p) => (
            <button key={p.id} className="d2-tab" role="tab" aria-selected={p.id === prefs.page} onClick={() => setPrefs({ page: p.id })}>
              <Ico icon={p.icon} size={22} />
              {p.label}
            </button>
          ))}
        </div>
        <div className="d2-nav-right">
          {flag && (
            <span className="d2-flag">
              <Ico icon={FlagIcon} size={22} color={flag.color} />
              {flag.label}
            </span>
          )}
        </div>
      </nav>

      {menu && (
        <div className="menu" role="menu">
          <button onClick={() => setPrefs({ units: prefs.units === 'metric' ? 'imperial' : 'metric' })}>
            <span>Unidades</span>
            <span>{prefs.units === 'metric' ? 'km/h · °C · L' : 'mph · °F · gal'}</span>
          </button>
          <button onClick={() => setKeepAwake((k) => !k)} disabled={!wakeSupported}>
            <span>Pantalla siempre encendida</span>
            <span>{!wakeSupported ? 'Configurala en la tablet' : keepAwake ? 'Sí' : 'No'}</span>
          </button>
          <button onClick={() => setMenu(false)}>
            <span>Cerrar</span>
            <span />
          </button>
        </div>
      )}

      {f && <FlagFrame flags={f.flags} />}
    </Stage>
  )
}
