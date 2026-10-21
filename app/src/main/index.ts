import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import QRCode from 'qrcode'
import type { DeepPartial, LanState, LiveState, Settings } from '@shared/api'
import { LAP_KIND_LABEL, SIM_LABEL } from '@shared/live'
import { TelemetryEngine } from './telemetry/engine'
import createReader from './telemetry/reader-worker?nodeWorker'
import createAnalysis from './analysis/worker?nodeWorker'
import { AnalysisService } from './analysis/service'
import type { CornerTip } from './analysis/protocol'
import { Recorder } from './analysis/recording'
import { CoachService } from './coach/service'
import { claudeCodeVersion } from './coach/claude-code'
import { acAppStatus, installAcApp } from './ac-app'
import { LanServer } from './lan/server'
import { SettingsStore } from './settings'
import { StyleStore } from './style'
import { VIDEO_EXTS, VideoStore, registerVideoScheme } from './video'
import type { VideoCam } from '@shared/api'
import type { CoachKeyId } from '@shared/analysis'
import { localHistory } from '@shared/history'

const DEV_URL = process.env.ELECTRON_RENDERER_URL

const r3 = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 1000)
const RENDERER_DIR = join(__dirname, '../renderer')
const ICON = join(__dirname, '../../resources/icon.png')

if (!app.requestSingleInstanceLock()) app.quit()
registerVideoScheme()

let win: BrowserWindow | null = null
let tray: Tray | null = null
let settings: SettingsStore
let quitting = false
let trayHintShown = false
/** Arrancó con Windows: queda en la bandeja sin abrir la ventana. */
const startHidden = process.argv.includes('--hidden')
const engine = new TelemetryEngine()
const analysis = new AnalysisService()
const recorder = new Recorder(() => settings.get().paths.recordings)
const videos = new VideoStore()
const style = new StyleStore()
const coach = new CoachService(
  () => {
    const c = settings.get().coach
    return { provider: c.provider, model: c.models[c.provider] }
  },
  async (id, lap) => {
    const data = await analysis.request({ type: 'coachData', sessionId: id, lap })
    // Contexto real del piloto: su perfil y su historial en este auto y pista
    const p = settings.get().profile
    const profile = {
      name: p.name || null,
      years_experience: p.experienceYears || null,
      discipline: p.discipline || null,
      about: p.about || null,
      goals: p.goals || null,
    }
    const summary = analysis.state.sessions.find((x) => x.id === id)
    const local = summary ? localHistory(analysis.state.sessions, summary) : null
    const driverStyle = style.coachContext()
    return {
      ...data,
      ...(Object.values(profile).some((v) => v !== null) ? { driver_profile: profile } : {}),
      ...(driverStyle ? { driver_style: driverStyle } : {}),
      ...(local?.sessionsBefore
        ? {
            driver_history: {
              previous_sessions: local.sessionsBefore,
              previous_pb_s: r3(local.pbBeforeS),
              historical_ideal_s: r3(local.idealS),
            },
          }
        : {}),
    }
  },
)
const lan = new LanServer(engine, {
  trackMap: (trackId, slug) => analysis.request({ type: 'liveMap', trackId, slug }),
  ingame: () => ingameState(),
})
let finishingRecording = false

/** Consejos por curva para la app de AC, por trazado y auto (se recalculan al cambiar la biblioteca). */
const tipsCache = new Map<string, Promise<CornerTip[]>>()

function tipsFor(trackId: string, car: string): Promise<CornerTip[]> {
  const key = `${trackId}|${car}`
  let p = tipsCache.get(key)
  if (!p) {
    p = analysis.request({ type: 'tips', trackId, car }).catch(() => [])
    tipsCache.set(key, p)
  }
  return p
}

/** Lo que muestra la app de FTN Coach dentro de AC. */
async function ingameState(): Promise<unknown> {
  const f = engine.frame
  const m = engine.meta
  const laps = engine.tracker.laps
  const last = laps[laps.length - 1] ?? null
  // Lo que más hay que trabajar según tu estilo: la app lo muestra como foco de la sesión
  const focus = style.style()?.traits.find((t) => t.good === false) ?? null
  return {
    app: 'FTN Coach',
    connected: engine.status.state === 'connected',
    sim: engine.status.sim,
    units: settings.get().units,
    deltaS: f?.deltaS ?? null,
    bestLapS: f?.bestLapS ?? null,
    lastLap: last && { lap: last.lap, timeS: last.timeS, kind: last.kind, label: LAP_KIND_LABEL[last.kind], reason: last.reason },
    laps: laps.slice(-10).map((l) => ({ lap: l.lap, timeS: l.timeS, kind: l.kind, label: LAP_KIND_LABEL[l.kind], best: l.best, fuelUsedL: l.fuelUsedL })),
    fuelPerLapL: f?.fuelPerLapL ?? null,
    fuelLapsLeft: f?.fuelLapsLeft ?? null,
    tips: m?.trackId ? await tipsFor(m.trackId, m.car) : [],
    focus: focus && { title: focus.title, value: focus.value, text: focus.text },
  }
}

function scanLibrary(): void {
  const s = settings.get()
  void analysis
    .request({
      type: 'scan',
      dirs: [s.paths.iracingTelemetry, s.paths.recordings],
      exclude: recorder.current ? [recorder.current] : [],
    })
    .catch((err) => console.error('[library]', err))
}


function liveState(): LiveState {
  return { status: engine.status, meta: engine.meta, demo: engine.demo }
}

async function lanState(): Promise<LanState> {
  const info = lan.info()
  const url = info.urls[0]
  const qr = url
    ? await QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#12151A', light: '#F0F3FA' } })
    : null
  return { ...info, qr }
}

async function startLan(s: Settings): Promise<void> {
  const info = await lan.start({
    port: s.lan.port,
    exposed: s.lan.exposed,
    hz: s.lan.hz,
    staticDir: RENDERER_DIR,
    devUrl: DEV_URL,
    appVersion: app.getVersion(),
  })
  if (info.error) console.error('[lan]', info.error)
}

/** Carpeta de telemetría de iRacing, para abrir ahí el diálogo del demo. */
function telemetryDir(s: Settings): string | undefined {
  const dir = s.paths.iracingTelemetry
  return existsSync(dir) ? dir : undefined
}

function showWindow(): void {
  if (!win) createWindow()
  else {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

function trayStatus(): string {
  const st = engine.status
  return st.state === 'connected' && st.sim ? `Conectado a ${SIM_LABEL[st.sim]}` : 'Esperando el simulador'
}

function updateTray(): void {
  if (!tray) return
  const url = lan.info().urls[0]
  tray.setToolTip(`FTN Coach · ${trayStatus()}`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: trayStatus(), enabled: false },
      { type: 'separator' },
      { label: 'Abrir FTN Coach', click: showWindow },
      { label: 'Abrir el dashboard en el navegador', enabled: !!url, click: () => url && void shell.openExternal(url) },
      { type: 'separator' },
      { label: 'Salir', click: () => app.quit() },
    ]),
  )
}

function createTray(): void {
  const img = existsSync(ICON) ? nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }) : nativeImage.createEmpty()
  tray = new Tray(img)
  tray.on('double-click', showWindow)
  tray.on('click', showWindow)
  updateTray()
}

function applyLoginItem(s: Settings): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: s.app.startWithWindows, args: ['--hidden'] })
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#12151A',
    title: 'FTN Coach',
    icon: existsSync(ICON) ? ICON : undefined,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#12151A', symbolColor: '#C3C8D2', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
    },
  })
  win.once('ready-to-show', () => win?.show())
  // Desarrollo: captura de la ventana para revisar la UI sin abrirla a mano.
  // FTN_CAPTURE_JS se ejecuta antes (p. ej. para navegar) y la app se cierra al terminar.
  const capture = process.env.FTN_CAPTURE
  if (capture) {
    const delay = Number(process.env.FTN_CAPTURE_DELAY ?? 4000)
    const wait = () => new Promise((r) => setTimeout(r, delay))
    win.webContents.once('did-finish-load', async () => {
      await wait()
      if (process.env.FTN_CAPTURE_JS) {
        await win?.webContents.executeJavaScript(process.env.FTN_CAPTURE_JS).catch((e) => console.error(e))
        await wait()
      }
      const img = await win?.webContents.capturePage()
      if (img) writeFileSync(capture, img.toPNG())
      app.quit()
    })
  }
  // Enlaces externos al navegador del sistema, nunca dentro de la app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (DEV_URL) void win.loadURL(DEV_URL)
  else void win.loadFile(join(RENDERER_DIR, 'index.html'))
  win.on('closed', () => {
    // Sin ventana se libera la interfaz (lo que más memoria usa); la lectura del
    // sim y el servidor de la tablet siguen en el proceso principal
    win = null
    if (!quitting && settings.get().app.closeToTray && tray && !trayHintShown) {
      trayHintShown = true
      tray.displayBalloon({
        title: 'FTN Coach sigue abierto',
        content: 'La tablet sigue recibiendo datos. Para salir, clic derecho en el ícono de la bandeja.',
        iconType: 'info',
      })
    }
  })
}

function registerIpc(): void {
  ipcMain.on('app:version', (e) => (e.returnValue = app.getVersion()))
  ipcMain.handle('live:state', () => liveState())
  ipcMain.handle('lan:state', () => lanState())
  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:save', async (_e, patch: DeepPartial<Settings>) => {
    const before = settings.get()
    const next = settings.update(patch)
    if (JSON.stringify(before.lan) !== JSON.stringify(next.lan)) await startLan(next)
    if (JSON.stringify(before.paths) !== JSON.stringify(next.paths)) scanLibrary()
    applyLoginItem(next)
    updateTray()
    return next
  })
  ipcMain.handle('demo:start', async () => {
    const res = await dialog.showOpenDialog(win!, {
      title: 'Elegí una sesión de iRacing para reproducir',
      defaultPath: telemetryDir(settings.get()),
      filters: [{ name: 'Telemetría de iRacing', extensions: ['ibt'] }],
      properties: ['openFile'],
    })
    const file = res.canceled ? null : res.filePaths[0]
    if (file) engine.setDemo(file)
    return file
  })
  ipcMain.handle('demo:stop', () => engine.setDemo(null))
  ipcMain.handle('dialog:folder', async (_e, current: string) => {
    const res = await dialog.showOpenDialog(win!, {
      defaultPath: existsSync(current) ? current : undefined,
      properties: ['openDirectory'],
    })
    return res.canceled ? null : res.filePaths[0]
  })
  ipcMain.handle('shell:open', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url)
  })
  ipcMain.handle('shell:showFile', (_e, path: string) => {
    if (existsSync(path)) shell.showItemInFolder(path)
  })

  ipcMain.handle('library:get', () => analysis.state)
  ipcMain.handle('library:rescan', () => scanLibrary())
  ipcMain.handle('session:detail', async (_e, id: string) => {
    const d = await analysis.request({ type: 'detail', sessionId: id })
    style.record(d.summary, d.style)
    return d
  })
  ipcMain.handle('profile:style', () => style.style())
  ipcMain.handle('session:compare', (_e, id: string, a: number, b: number) => analysis.request({ type: 'compare', sessionId: id, a, b }))
  ipcMain.handle('track:map', (_e, trackId: string, slug: string | null) => analysis.request({ type: 'liveMap', trackId, slug }))

  ipcMain.handle('coach:state', (_e, id: string) => coach.state(id))
  ipcMain.handle('coach:analyze', (_e, id: string, lap: number | null) => coach.analyze(id, lap))
  ipcMain.handle('coach:ask', (_e, id: string, q: string) => coach.ask(id, q))
  ipcMain.handle('coach:clear', (_e, id: string) => coach.clearChat(id))
  ipcMain.handle('coach:hasKey', (_e, k: CoachKeyId) => coach.hasKey(k))
  ipcMain.handle('coach:setKey', (_e, k: CoachKeyId, key: string | null) => coach.setKey(k, key))
  ipcMain.handle('coach:claudeCode', () => claudeCodeVersion())

  ipcMain.handle('ac:status', () => acAppStatus())
  ipcMain.handle('ac:install', () => installAcApp())

  ipcMain.handle('video:config', (_e, id: string) => videos.config(id))
  ipcMain.handle('video:pick', async (_e, id: string, cam: VideoCam) => {
    const cur = videos.config(id)[cam]?.path
    const res = await dialog.showOpenDialog(win!, {
      title: cam === 'onboard' ? 'Elegí el video onboard de esta sesión' : 'Elegí el video de la cámara exterior',
      defaultPath: cur && existsSync(cur) ? cur : app.getPath('videos'),
      filters: [{ name: 'Video', extensions: VIDEO_EXTS }],
      properties: ['openFile'],
    })
    return res.canceled || !res.filePaths[0] ? null : videos.setFile(id, cam, res.filePaths[0])
  })
  ipcMain.handle('video:sync', (_e, id: string, cam: VideoCam, anchor: { lap: number; videoS: number } | null) => videos.setAnchor(id, cam, anchor))
  ipcMain.handle('video:remove', (_e, id: string, cam: VideoCam) => videos.remove(id, cam))


  analysis.on('library', (st) => {
    tipsCache.clear()
    win?.webContents.send('library:changed', st)
  })
  coach.on('state', (st) => win?.webContents.send('coach:changed', st))

  const push = () => win?.webContents.send('live:changed', liveState())
  engine.on('status', push)
  engine.on('meta', push)
  engine.on('demo', push)
  engine.on('status', updateTray)

  // Grabación de las sesiones (AC siempre; iRacing solo si se pide: ya guarda sus .ibt)
  engine.on('sample', (smp) => {
    if (finishingRecording) return
    const rec = settings.get().recording
    if ((smp.sim === 'ac' && rec.ac) || (smp.sim === 'iracing' && rec.iracing)) recorder.sample(smp, engine.meta)
  })
  engine.on('status', (st) => {
    if (st.state === 'waiting' && recorder.current) void recorder.stop().then(scanLibrary)
  })
}

app.on('second-instance', () => showWindow())

app.whenReady().then(async () => {
  settings = new SettingsStore()
  videos.serve()
  registerIpc()
  engine.start(() => createReader({}))
  analysis.start(() =>
    createAnalysis({
      workerData: { cacheFile: join(app.getPath('userData'), 'library.json'), geoDir: join(app.getPath('userData'), 'track_geo') },
    }),
  )
  scanLibrary()
  // Sesiones nuevas (iRacing guarda el .ibt al salir del auto)
  setInterval(scanLibrary, 2 * 60 * 1000)
  // Desarrollo: arrancar directo en modo demo con un .ibt
  if (process.env.FTN_DEMO && existsSync(process.env.FTN_DEMO)) engine.setDemo(process.env.FTN_DEMO)
  await startLan(settings.get())
  createTray()
  applyLoginItem(settings.get())
  if (!startHidden) createWindow()
})

app.on('window-all-closed', () => {
  if (!settings.get().app.closeToTray) app.quit()
})

app.on('before-quit', (e) => {
  // Primero se cierra bien la grabación en curso
  if (recorder.current && !finishingRecording) {
    e.preventDefault()
    finishingRecording = true
    void recorder.stop().finally(() => app.quit())
    return
  }
  quitting = true
  engine.stop()
  analysis.stop()
  void lan.stop()
})
