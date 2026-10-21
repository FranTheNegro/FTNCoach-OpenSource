/**
 * Un solo punto de entrada para los proveedores del coach: Claude (API o el
 * Claude Code del piloto), Gemini, OpenRouter y OpenCode Zen/Go. Todos con
 * streaming, sin SDKs.
 */
import { app } from 'electron'
import { COACH_PROVIDERS, opencodeApi, type CoachProvider } from '@shared/analysis'
import { streamClaude, type ClaudeMessage } from './claude'
import { streamClaudeCode } from './claude-code'

export interface LlmRequest {
  provider: CoachProvider
  /** Vacía con Claude Code (usa la sesión del CLI). */
  apiKey: string
  model: string
  /** Identifica la conversación (OpenCode la pide estable por sesión). */
  conversation?: string
  /** Bloques del system prompt (Claude los cachea; el resto los junta). */
  system: string[]
  messages: ClaudeMessage[]
  maxTokens: number
  /** Pedir JSON puro (Gemini lo fuerza con responseMimeType). */
  json?: boolean
  onText?: (chunk: string) => void
}

/** Los modelos con "thinking" (Qwen y otros en OpenCode) mandan <think>…</think> antes de la respuesta. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trimStart()
}

function friendly(provider: string, status: number, message: string): string {
  if (/free.?tier/i.test(message) && /limit: ?0|not available|only be used/i.test(message))
    return `Ese modelo no tiene uso gratis en ${provider}. Elegí uno marcado «gratis» en Ajustes → Coach.`
  if (status === 402 || /insufficient|balance|credits?\b/i.test(message)) return `Tu cuenta de ${provider} no tiene crédito para ese modelo. Elegí uno gratis o cargá crédito.`
  if (status === 401 || status === 403) return `La API key de ${provider} no es válida o no tiene permiso para ese modelo. Revisala en Ajustes.`
  if (status === 404) return `${provider} no encuentra el modelo elegido. Revisalo en Ajustes.`
  if (status === 429) return `Se alcanzó el límite de uso de ${provider}. Probá de nuevo en un rato o cambiá de modelo.`
  if (status >= 500) return `${provider} está con problemas en este momento. Probá de nuevo en unos segundos.`
  return `${provider} respondió con un error (${status}): ${message}`
}

/** Lee un stream de server-sent events y llama a `onData` con cada `data:`. */
async function readSse(res: Response, onData: (data: string) => void): Promise<void> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    let cut: number
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const event = buf.slice(0, cut)
      buf = buf.slice(cut + 2)
      for (const line of event.split('\n')) if (line.startsWith('data:')) onData(line.slice(5).trim())
    }
  }
}

async function post(provider: string, url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  } catch {
    throw new Error(`No hay conexión con ${provider}.`)
  }
  if (!res.ok || !res.body) {
    let message = res.statusText
    try {
      const b = (await res.json()) as { error?: { message?: string } | string; message?: string }
      message = (typeof b.error === 'string' ? b.error : b.error?.message) ?? b.message ?? message
    } catch {
      // cuerpo vacío
    }
    throw new Error(friendly(provider, res.status, message))
  }
  return res
}

async function streamGemini(req: LlmRequest): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`
  const contents = req.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
  // Gemma no acepta instrucciones de sistema ni JSON forzado: el sistema va al principio del primer mensaje
  const gemma = req.model.startsWith('gemma-')
  if (gemma && contents[0]) contents[0].parts.unshift({ text: req.system.join('\n\n') })
  const res = await post('Gemini', url, { 'x-goog-api-key': req.apiKey }, {
    ...(gemma ? {} : { systemInstruction: { parts: [{ text: req.system.join('\n\n') }] } }),
    contents,
    generationConfig: { maxOutputTokens: req.maxTokens, ...(req.json && !gemma ? { responseMimeType: 'application/json' } : {}) },
  })
  let text = ''
  await readSse(res, (data) => {
    try {
      const j = JSON.parse(data) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] }
      for (const p of j.candidates?.[0]?.content?.parts ?? [])
        if (p.text && !p.thought) {
          text += p.text
          req.onText?.(p.text)
        }
    } catch {
      // línea incompleta
    }
  })
  return text
}

async function streamOpenAi(req: LlmRequest, url: string, provider: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await post(provider, url, { authorization: `Bearer ${req.apiKey}`, ...headers }, {
    model: req.model,
    stream: true,
    max_tokens: req.maxTokens,
    messages: [{ role: 'system', content: req.system.join('\n\n') }, ...req.messages],
  })
  let text = ''
  await readSse(res, (data) => {
    if (data === '[DONE]') return
    try {
      const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }
      const chunk = j.choices?.[0]?.delta?.content
      if (chunk) {
        text += chunk
        req.onText?.(chunk)
      }
    } catch {
      // línea incompleta
    }
  })
  return stripThinking(text)
}

export async function streamLlm(req: LlmRequest): Promise<string> {
  if (!req.model) throw new Error('Elegí el modelo del coach en Ajustes.')
  const p = COACH_PROVIDERS.find((x) => x.id === req.provider)!
  const name = p.label.split(' · ')[0]
  if (p.api === 'claude') return streamClaude(req)
  if (p.api === 'claude-code') return stripThinking(await streamClaudeCode(req))
  if (p.api === 'gemini') return streamGemini(req)
  if (p.api === 'opencode') {
    // OpenCode pide que las apps se identifiquen y mantengan la conversación
    const headers = { 'user-agent': `FTNCoach/${app.getVersion()}`, 'x-opencode-session': req.conversation ?? 'ftncoach' }
    if (opencodeApi(p, req.model) === 'messages')
      return streamClaude({ ...req, url: `${p.baseUrl}/anthropic/v1/messages`, provider: p.label, headers: { ...headers, authorization: `Bearer ${req.apiKey}` } })
    return streamOpenAi(req, `${p.baseUrl}/openai/v1/chat/completions`, p.label, headers)
  }
  return streamOpenAi(req, `${p.baseUrl}/chat/completions`, name, { 'HTTP-Referer': 'https://github.com/FranTheNegro/FTNCoach-OpenSource', 'X-Title': 'FTN Coach' })
}
