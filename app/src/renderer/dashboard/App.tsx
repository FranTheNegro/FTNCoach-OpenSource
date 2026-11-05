import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Ellipsis, FlaskConical, Flag as FlagIcon, Gauge, Map as MapIcon, Maximize, Plug, Timer, Unplug, Users, Wrench, Wifi, WifiOff, type LucideIcon } from 'lucide-react'
import { SIM_LABEL } from '@shared/live'
import { LiveClient, useLive } from '@ui/live-client'
import { LogoHorizontal, Monogram } from '@ui/Logo'
import { usePrefs, type PageId } from './prefs'
import { FLAG_INFO, FlagFrame, useShownFlag } from './widgets'
import { Inputs } from './v2/Inputs'
import { TrackMap } from './v2/MapPage'
import { StageMap } from './v2/StageMap'
import { Car } from './v2/Car'
import { Laps } from './v2/Laps'
import { Live } from './v2/Live'
import { Rivals } from './v2/Rivals'
import { SessionStrip } from './v2/SessionStrip'
import { C, Chip, Ico, Stage } from './v2/kit'
import { applySkin, layoutFor, LAYOUT_IDS, LAYOUTS, SKIN_IDS, SKINS } from './v2/layouts'
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

export function App() {
  const client = useMemo(() => LiveClient.forPage(), [])
  const tracker = useMemo(() => new DashTracker(), [])
  const live = useLive(client)
  const [prefs, setPrefs] = usePrefs()
  const [menu, setMenu] = useState(false)
  const [keepAwake, setKeepAwake] = useState(true)
  const wakeSupported = useWakeLock(keepAwake)
  const swipe = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => applySkin(prefs.skin), [prefs.skin])

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
  const detected = layoutFor(meta?.category)
  const layout = prefs.layoutAuto ? detected : prefs.layout
  const shownFlag = useShownFlag(f?.flags ?? [])
  const flag = shownFlag ? FLAG_INFO[shownFlag] : null
  const simName = connectedToSim && status?.sim ? SIM_LABEL[status.sim] : live.connected ? 'Sin simulador' : 'Sin conexión'

  return (
    <Stage>
      <header className="d2-head">
        <span className="d2-logo">
          <LogoHorizontal height={44} />
        </span>
        <div className="d2-sim" role="img" aria-label={simName} title={simName}>
          <Ico icon={connectedToSim ? Plug : Unplug} size={20} color={connectedToSim ? C.record : live.connected ? C.alerta : C.niebla} />
        </div>
        <div className="d2-who">
          {connectedToSim && meta && (
            <>
              <span>{meta.car}</span>
              <span>{meta.track}</span>
            </>
          )}
        </div>
        <div className="d2-chips">
          {status?.sim === 'replay' && (
            <Chip tone="alert">
              <Ico icon={FlaskConical} size={14} />
              Demo
            </Chip>
          )}
          {f?.position && <Chip tone="highlight">{`P${f.position}${f.carsInSession ? ` de ${f.carsInSession}` : ''}`}</Chip>}
          {f?.incidents ? <Chip tone="alert">{`Inc. ${f.incidents}x`}</Chip> : null}
        </div>
        <SessionStrip f={connectedToSim ? f : null} meta={connectedToSim ? meta : null} units={prefs.units} />
        <div className="d2-head-right">
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
        {f && prefs.page === 'live' && <Live f={f} meta={meta} laps={live.laps} units={prefs.units} tracker={tracker} history={client.history} layout={layout} panels={prefs.panels} onPanel={(id, i) => setPrefs({ panels: { ...prefs.panels, [id]: i } })} />}
        {f && prefs.page === 'car' && <Car f={f} meta={meta} units={prefs.units} />}
        {f && prefs.page === 'laps' && <Laps f={f} meta={meta} laps={live.laps} units={prefs.units} tracker={tracker} />}
        {f && prefs.page === 'rivals' && <Rivals f={f} meta={meta} tracker={tracker} />}
        {f && prefs.page === 'inputs' && (
          <Inputs f={f} history={client.history} units={prefs.units} />
        )}
        {f && prefs.page === 'map' &&
          (meta?.sim === 'acr' ? <StageMap f={f} meta={meta} units={prefs.units} /> : <TrackMap f={f} meta={meta} units={prefs.units} tracker={tracker} />)}
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
            <span className="d2-flag" style={{ color: flag.color }}>
              <Ico icon={FlagIcon} size={24} color={flag.color} />
              {flag.label}
            </span>
          )}
        </div>
      </nav>

      {menu && (
        <div className="menu" role="menu">
          <div className="menu-info">
            <span>Conexión</span>
            <span>
              <Ico icon={live.connected ? Wifi : WifiOff} size={16} color={live.connected ? C.record : C.niebla} />
              {connectedToSim && status ? `${simName} · ${status.hz} Hz` : simName}
            </span>
          </div>
          <button onClick={() => setPrefs({ units: prefs.units === 'metric' ? 'imperial' : 'metric' })}>
            <span>Unidades</span>
            <span>{prefs.units === 'metric' ? 'km/h · °C · L' : 'mph · °F · gal'}</span>
          </button>
          <button onClick={() => setKeepAwake((k) => !k)} disabled={!wakeSupported}>
            <span>Pantalla siempre encendida</span>
            <span>{!wakeSupported ? 'Configurala en la tablet' : keepAwake ? 'Sí' : 'No'}</span>
          </button>
          <div className="menu-section">
            <span className="menu-title">Layout de En vivo</span>
            <button onClick={() => setPrefs({ layoutAuto: !prefs.layoutAuto, layout })}>
              <span>Automático según el auto</span>
              <span>{prefs.layoutAuto ? `Sí · ${LAYOUTS[detected].name}` : 'No'}</span>
            </button>
            <div className="menu-choices">
              {LAYOUT_IDS.map((id) => (
                <button key={id} aria-pressed={layout === id} onClick={() => setPrefs({ layoutAuto: false, layout: id })} title={LAYOUTS[id].hint}>
                  {LAYOUTS[id].name}
                </button>
              ))}
            </div>
          </div>
          <div className="menu-section">
            <span className="menu-title">Skin</span>
            <div className="menu-choices">
              {SKIN_IDS.map((id) => (
                <button key={id} aria-pressed={prefs.skin === id} onClick={() => setPrefs({ skin: id })}>
                  <i className="menu-swatch" style={{ background: SKINS[id].vars['--ftn-carbono-2'] ?? '#1e2229', borderColor: SKINS[id].vars['--ftn-acero'] ?? '#3a404b' }} />
                  {SKINS[id].name}
                </button>
              ))}
            </div>
          </div>
          <button onClick={() => setMenu(false)}>
            <span>Cerrar</span>
            <span />
          </button>
        </div>
      )}

      <FlagFrame flag={shownFlag} />
    </Stage>
  )
}
