/**
 * Cliente mínimo de la API de Claude (Messages, con streaming). Sin SDK: un
 * fetch y el parser de server-sent events alcanzan y no suman dependencias.
 */
const API_URL = 'https://api.anthropic.com/v1/messages'

export interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ClaudeRequest {
  /** Otro endpoint con la misma API (OpenCode). */
  url?: string
  /** Nombre del proveedor para los errores. */
  provider?: string
  headers?: Record<string, string>
  apiKey: string
  model: string
  /** Bloques del system prompt; los estables van primero para aprovechar la caché. */
  system: string[]
  messages: ClaudeMessage[]
  maxTokens: number
  onText?: (chunk: string) => void
  signal?: AbortSignal
}

export class ClaudeError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message)
  }
}

function friendly(provider: string, status: number, type: string | undefined, message: string): string {
  if (status === 401) return `La API key de ${provider} no es válida. Revisala en Ajustes.`
  if (status === 403) return 'Esta API key no tiene permiso para usar ese modelo.'
  if (status === 429) return 'Se alcanzó el límite de uso de la API key. Probá de nuevo en un rato.'
  if (status === 529 || type === 'overloaded_error') return `${provider} está saturado en este momento. Probá de nuevo en unos segundos.`
  if ((status === 400 || status === 402) && /credit|balance/i.test(message)) return 'La cuenta de la API key no tiene crédito disponible.'
  return `${provider} respondió con un error (${status}): ${message}`
}

export async function streamClaude(req: ClaudeRequest): Promise<string> {
  const provider = req.provider ?? 'Claude'
  let res: Response
  try {
    res = await fetch(req.url ?? API_URL, {
      method: 'POST',
      signal: req.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': req.apiKey,
        'anthropic-version': '2023-06-01',
        ...req.headers,
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens,
        stream: true,
        system: req.system.map((text, i) => ({
          type: 'text',
          text,
          ...(i === req.system.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
        })),
        messages: req.messages,
      }),
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new ClaudeError(`No hay conexión con ${provider}.`, null)
  }
  if (!res.ok || !res.body) {
    let type: string | undefined
    let message = res.statusText
    try {
      const body = (await res.json()) as { error?: { type?: string; message?: string } }
      type = body.error?.type
      message = body.error?.message ?? message
    } catch {
      // Cuerpo vacío
    }
    throw new ClaudeError(friendly(provider, res.status, type, message), res.status)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let cut: number
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const event = buf.slice(0, cut)
      buf = buf.slice(cut + 2)
      for (const line of event.split('\n')) {
        if (!line.startsWith('data:')) continue
        let data: { type?: string; delta?: { type?: string; text?: string }; error?: { type?: string; message?: string } }
        try {
          data = JSON.parse(line.slice(5).trim())
        } catch {
          continue
        }
        if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta' && data.delta.text) {
          text += data.delta.text
          req.onText?.(data.delta.text)
        } else if (data.type === 'error') {
          throw new ClaudeError(friendly(provider, 529, data.error?.type, data.error?.message ?? 'error'), null)
        }
      }
    }
  }
  return text
}
