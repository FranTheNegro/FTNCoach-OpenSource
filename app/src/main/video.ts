/**
 * Videos de las sesiones (onboard y cámara exterior grabados con OBS, ShadowPlay…)
 * y su sincronización con la telemetría.
 *
 * El reproductor los pide por ftn-video://v/{sesión}/{cámara}: el protocolo solo
 * sirve el archivo que el piloto eligió para esa sesión, nunca una ruta arbitraria.
 * Soporta pedidos parciales (Range) para poder saltar a cualquier punto del video.
 */
import { app, protocol } from 'electron'
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { Readable } from 'node:stream'
import type { VideoCam, VideoConfig } from '@shared/api'

export const VIDEO_EXTS = ['mp4', 'webm', 'mkv', 'mov', 'm4v']
const SCHEME = 'ftn-video'
const MIME: Record<string, string> = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime' }

type Saved = Partial<Record<VideoCam, { path: string; anchor: { lap: number; videoS: number } | null }>>

/** Antes de app.whenReady: el esquema necesita streaming para el <video>. */
export function registerVideoScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }])
}

export class VideoStore {
  private dir = join(app.getPath('userData'), 'video')

  private file(id: string): string {
    return join(this.dir, `${id.replace(/[^a-z0-9]/gi, '')}.json`)
  }

  private load(id: string): Saved {
    try {
      return JSON.parse(readFileSync(this.file(id), 'utf8')) as Saved
    } catch {
      return {}
    }
  }

  private save(id: string, s: Saved): void {
    mkdirSync(this.dir, { recursive: true })
    const tmp = this.file(id) + '.tmp'
    writeFileSync(tmp, JSON.stringify(s, null, 2))
    renameSync(tmp, this.file(id))
  }

  config(id: string): VideoConfig {
    const s = this.load(id)
    const out: VideoConfig = {}
    for (const cam of ['onboard', 'top'] as VideoCam[]) {
      const v = s[cam]
      if (!v) continue
      // El ?v cambia con el archivo: el reproductor no reutiliza el anterior
      const stamp = existsSync(v.path) ? Math.round(statSync(v.path).mtimeMs) : 0
      out[cam] = { path: v.path, name: basename(v.path), url: `${SCHEME}://v/${id}/${cam}?v=${stamp}`, missing: !existsSync(v.path), anchor: v.anchor }
    }
    return out
  }

  setFile(id: string, cam: VideoCam, path: string): VideoConfig {
    const s = this.load(id)
    // Otro archivo: la sincronización anterior ya no vale
    s[cam] = { path, anchor: s[cam]?.path === path ? s[cam]!.anchor : null }
    this.save(id, s)
    return this.config(id)
  }

  setAnchor(id: string, cam: VideoCam, anchor: { lap: number; videoS: number } | null): VideoConfig {
    const s = this.load(id)
    if (s[cam]) s[cam]!.anchor = anchor
    this.save(id, s)
    return this.config(id)
  }

  remove(id: string, cam: VideoCam): VideoConfig {
    const s = this.load(id)
    delete s[cam]
    this.save(id, s)
    return this.config(id)
  }

  /** Atiende ftn-video:// (después de app.whenReady). */
  serve(): void {
    protocol.handle(SCHEME, (req) => {
      const m = /^ftn-video:\/\/v\/([a-z0-9]+)\/(onboard|top)/i.exec(req.url)
      const path = m ? this.load(m[1])[m[2] as VideoCam]?.path : undefined
      if (!path || !existsSync(path)) return new Response('Video no encontrado', { status: 404 })
      const size = statSync(path).size
      const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
      const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') ?? '')
      if (!range) {
        const body = Readable.toWeb(createReadStream(path)) as ReadableStream
        return new Response(body, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } })
      }
      let start = range[1] ? Number(range[1]) : size - Number(range[2])
      let end = range[1] && range[2] ? Number(range[2]) : size - 1
      start = Math.max(0, Math.min(start, size - 1))
      end = Math.max(start, Math.min(end, size - 1))
      const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
      return new Response(body, {
        status: 206,
        headers: {
          'Content-Type': type,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
        },
      })
    })
  }
}
