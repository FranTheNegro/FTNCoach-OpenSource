/**
 * Claude con la suscripción del piloto: corre su propio Claude Code (`claude -p`),
 * logueado con su cuenta Pro o Max, sin tocar sus credenciales. Va en una carpeta
 * vacía y sin herramientas, MCP, ajustes ni skills: solo el prompt del coach.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { ClaudeMessage } from './claude'

const TIMEOUT_MS = 5 * 60_000
const NOT_FOUND = 'No encontramos Claude Code en esta PC. Instalalo desde claude.com/code, abrí una terminal, corré `claude` una vez para loguearte y volvé a probar.'

export interface ClaudeCodeRequest {
  model: string
  system: string[]
  messages: ClaudeMessage[]
  onText?: (chunk: string) => void
}

function dir(): string {
  const d = join(app.getPath('userData'), 'coach', 'claude-code')
  mkdirSync(d, { recursive: true })
  return d
}

/** En Windows el instalador deja `claude.exe`; con npm queda un `claude.cmd`, que solo corre con shell. */
function run(args: string[], cwd: string, shell: boolean): ChildProcess {
  if (!shell) return spawn('claude', args, { cwd, windowsHide: true })
  return spawn('claude', args.map((a) => `"${a}"`), { cwd, windowsHide: true, shell: true })
}

/** Versión de Claude Code instalada, o null si no está. */
export function claudeCodeVersion(): Promise<string | null> {
  const attempt = (shell: boolean) =>
    new Promise<string | null>((resolve) => {
      const p = run(['--version'], dir(), shell)
      let out = ''
      const t = setTimeout(() => p.kill(), 15_000)
      p.stdout?.on('data', (d) => (out += d))
      p.on('error', () => resolve(null))
      p.on('close', (code) => {
        clearTimeout(t)
        resolve(code === 0 ? (out.match(/\d+\.\d+\.\d+/)?.[0] ?? out.trim()) || null : null)
      })
    })
  return attempt(false).then((v) => v ?? (process.platform === 'win32' ? attempt(true) : null))
}

/** La conversación va como un solo mensaje: el CLI recibe un turno del piloto. */
function prompt(messages: ClaudeMessage[]): string {
  if (messages.length === 1) return messages[0].content
  const last = messages[messages.length - 1]
  const before = messages
    .slice(0, -1)
    .map((m) => `${m.role === 'user' ? 'PILOTO' : 'COACH'}: ${m.content}`)
    .join('\n\n')
  return `Conversación hasta ahora:\n\n${before}\n\nPregunta nueva del piloto (respondé solo esto):\n${last.content}`
}

function friendly(text: string): string {
  if (/log ?in|logged|authenticat|\/login/i.test(text)) return 'Claude Code no tiene una cuenta logueada. Abrí una terminal, corré `claude` y logueate con tu cuenta de Claude.'
  if (/usage limit|rate limit|limit reached|5-hour/i.test(text)) return 'Llegaste al límite de uso de tu plan de Claude. Probá de nuevo cuando se renueve.'
  if (/model/i.test(text) && /not|invalid|unknown/i.test(text)) return 'Tu plan de Claude no tiene ese modelo. Elegí otro en Ajustes → Coach.'
  return `Claude Code respondió con un error: ${text.slice(0, 300)}`
}

export function streamClaudeCode(req: ClaudeCodeRequest): Promise<string> {
  const cwd = dir()
  const systemFile = join(cwd, `system-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
  writeFileSync(systemFile, req.system.join('\n\n'))
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--model', req.model,
    '--system-prompt-file', systemFile,
    '--tools', '',
    '--strict-mcp-config',
    '--setting-sources', '',
    '--disable-slash-commands',
    '--no-session-persistence',
  ]
  const attempt = (shell: boolean) =>
    new Promise<string>((resolve, reject) => {
      const p = run(args, cwd, shell)
      let buf = ''
      let text = ''
      let result: { is_error?: boolean; result?: string; subtype?: string } | null = null
      let stderr = ''
      const t = setTimeout(() => {
        p.kill()
        reject(new Error('Claude Code tardó demasiado en responder. Probá de nuevo.'))
      }, TIMEOUT_MS)
      p.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(t)
        reject(err.code === 'ENOENT' ? Object.assign(new Error(NOT_FOUND), { code: 'ENOENT' }) : err)
      })
      p.stderr?.on('data', (d) => (stderr += d))
      p.stdout?.on('data', (d) => {
        buf += d
        let cut: number
        while ((cut = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, cut).trim()
          buf = buf.slice(cut + 1)
          if (!line) continue
          let ev: { type?: string; event?: { type?: string; delta?: { type?: string; text?: string } }; is_error?: boolean; result?: string; subtype?: string }
          try {
            ev = JSON.parse(line)
          } catch {
            continue
          }
          const delta = ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' ? ev.event.delta : undefined
          if (delta?.type === 'text_delta' && delta.text) {
            text += delta.text
            req.onText?.(delta.text)
          } else if (ev.type === 'result') result = ev
        }
      })
      p.on('close', (code) => {
        clearTimeout(t)
        if (result && !result.is_error) return resolve(result.result ?? text)
        const why = result?.result || stderr.trim() || `salió con código ${code}`
        // Con shell, "no se reconoce como comando" también es que no está instalado
        if (shell && !result && /not recognized|no se reconoce/i.test(stderr)) return reject(new Error(NOT_FOUND))
        reject(new Error(friendly(why)))
      })
      p.stdin?.on('error', () => undefined)
      p.stdin?.end(prompt(req.messages))
    })
  return attempt(false)
    .catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT' && process.platform === 'win32') return attempt(true)
      throw err
    })
    .finally(() => rmSync(systemFile, { force: true }))
}
