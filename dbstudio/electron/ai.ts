import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import type { AiRequest } from '../shared/types'
import { AI_PROVIDERS, aiProvider, type AiConfigInput, type AiConfigView, type AiProvider } from '../shared/aiProviders'

// AI SQL assistant. Works with Anthropic or any OpenAI-compatible provider (OpenAI, Gemini, Kimi, Ollama…).
// API keys are encrypted with the OS keychain and never leave the main process;
// the UI only sends the question, the schema (names only) and the query.

const file = () => path.join(app.getPath('userData'), 'ai.json')
export const DEFAULT_MODEL = 'claude-opus-5-5'

interface ProviderSaved { key?: string; model?: string; baseUrl?: string }
interface Saved { provider?: AiProvider; providers?: Partial<Record<AiProvider, ProviderSaved>>; /** v1 file: Anthropic only */ key?: string; model?: string }

function read(): Saved {
  let s: Saved = {}
  try { s = JSON.parse(fs.readFileSync(file(), 'utf8')) } catch { /* none yet */ }
  // Older files held only an Anthropic key and model
  if (!s.providers) s = { provider: 'anthropic', providers: s.key || s.model ? { anthropic: { key: s.key, model: s.model } } : {} }
  return s
}
function write(s: Saved) {
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file(), JSON.stringify({ provider: s.provider, providers: s.providers }, null, 2))
}
const enc = (k: string) => (safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(k).toString('base64') : k)
const dec = (k?: string) => (!k ? undefined : k.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(k.slice(4), 'base64')) : k)

const ENV_KEYS: Partial<Record<AiProvider, string>> = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY', kimi: 'MOONSHOT_API_KEY', 'ollama-cloud': 'OLLAMA_API_KEY', groq: 'GROQ_API_KEY', openrouter: 'OPENROUTER_API_KEY' }
function keyFor(p: AiProvider, s = read()): string | undefined {
  return dec(s.providers?.[p]?.key) ?? (ENV_KEYS[p] ? process.env[ENV_KEYS[p]!] : undefined)
}
function settingsFor(p: AiProvider, s = read()) {
  const info = aiProvider(p)
  const saved = s.providers?.[p] ?? {}
  return { provider: p, key: keyFor(p, s), model: saved.model || info.defaultModel, baseUrl: (saved.baseUrl || info.baseUrl || '').replace(/\/+$/, '') }
}

/** True when the chosen provider can be used (has a key, or needs none) */
export function hasKey() {
  const s = read(), p = s.provider ?? 'anthropic'
  return !aiProvider(p).needsKey || !!keyFor(p, s)
}

export function getConfig(): AiConfigView {
  const s = read()
  const providers: AiConfigView['providers'] = {}
  for (const info of AI_PROVIDERS) {
    const c = settingsFor(info.id, s)
    providers[info.id] = { model: c.model, baseUrl: info.id === 'anthropic' ? undefined : c.baseUrl, hasKey: !!c.key }
  }
  return { provider: s.provider ?? 'anthropic', providers }
}

export function setConfig(c: AiConfigInput) {
  const s = read()
  const cur = s.providers?.[c.provider] ?? {}
  const next: ProviderSaved = { ...cur, model: c.model.trim() || cur.model, baseUrl: c.baseUrl?.trim() || undefined }
  if (c.key === null) delete next.key
  else if (c.key) next.key = enc(c.key.trim())
  write({ provider: c.provider, providers: { ...s.providers, [c.provider]: next } })
}

/** Old API (Anthropic key + model) kept for callers that still use it */
export function setKey(key: string, model: string) { setConfig({ provider: 'anthropic', model, key }) }

const DIALECT: Record<string, string> = {
  mssql: 'Microsoft SQL Server (T-SQL)', postgres: 'PostgreSQL', mysql: 'MySQL / MariaDB', sqlite: 'SQLite', libsql: 'SQLite (libSQL)',
  oracle: 'Oracle (PL/SQL)', clickhouse: 'ClickHouse', duckdb: 'DuckDB', mongodb: 'MongoDB shell (mongosh)', redis: 'Redis commands',
  snowflake: 'Snowflake', bigquery: 'Google BigQuery (GoogleSQL)', cassandra: 'Cassandra (CQL)', dynamodb: 'DynamoDB (PartiQL)', trino: 'Trino / Presto'
}

const SYSTEM = `You are the SQL assistant inside Qubase, a desktop database client.
Write correct, efficient queries for the stated database dialect, using only the tables and columns in the schema provided.
If the schema does not contain what is needed, say so briefly instead of inventing names.
Prefer reading data over changing it. Never write DROP, TRUNCATE, or UPDATE / DELETE without WHERE unless the user explicitly asks for it.
Put any query in one fenced code block. Keep explanations short and plain.`

function prompt(req: AiRequest) {
  const parts = [
    `Database: ${DIALECT[req.engine] ?? req.engine}`,
    `Schema (table: columns):\n${req.schema.slice(0, 60000) || '(not loaded)'}`
  ]
  if (req.sql) parts.push(`Current query:\n\`\`\`\n${req.sql.slice(0, 20000)}\n\`\`\``)
  if (req.error) parts.push(`Error from the database:\n${req.error}`)
  parts.push(req.mode === 'write'
    ? `Write a query for this request: ${req.question}`
    : req.mode === 'explain'
      ? `Explain what the current query does, step by step, and point out any performance or correctness risks.${req.question ? ` Also: ${req.question}` : ''}`
      : `Fix the current query so it runs without the error. Give the corrected query, then one or two sentences on what was wrong.${req.question ? ` Note: ${req.question}` : ''}`)
  return parts.join('\n\n')
}

type Conf = ReturnType<typeof settingsFor>

async function askAnthropic(c: Conf, user: string): Promise<string> {
  const client = new Anthropic({ apiKey: c.key })
  try {
    const res = await client.beta.messages.create({
      model: c.model || DEFAULT_MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: 'user', content: user }],
      // If a safety check declines the request, the API retries it on a fallback model
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default'
    })
    if (res.stop_reason === 'refusal') throw new Error('The assistant declined this request. Try rephrasing it.')
    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim()
    if (!text) throw new Error('The assistant returned no answer')
    return res.stop_reason === 'max_tokens' ? `${text}\n\n(Answer cut short)` : text
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('The Anthropic API key was rejected. Check it in Settings → AI assistant.')
    if (e instanceof Anthropic.RateLimitError) throw new Error('Rate limited by the Anthropic API. Try again in a moment.')
    if (e instanceof Anthropic.APIConnectionError) throw new Error('Could not reach the Anthropic API. Check your internet connection.')
    if (e instanceof Anthropic.APIError) throw new Error(`AI request failed (${e.status}): ${e.message}`)
    throw e
  }
}

/** OpenAI-style request (OpenAI, Gemini, Kimi, Ollama, OpenRouter, LM Studio…) with plain-language errors */
async function openAiFetch(c: Conf, pathPart: string, body?: unknown) {
  const label = aiProvider(c.provider).label
  if (!c.baseUrl) throw new Error(`Set the server address for ${label} in Settings → AI assistant.`)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (c.key) headers.authorization = `Bearer ${c.key}`
  if (c.provider === 'openrouter') { headers['HTTP-Referer'] = 'https://qubase.app'; headers['X-Title'] = 'Qubase' }
  let res: Response
  try {
    res = await fetch(`${c.baseUrl}${pathPart}`, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(180000) })
  } catch (e) {
    const local = /localhost|127\.0\.0\.1/.test(c.baseUrl)
    throw new Error(local
      ? `Could not reach ${label} at ${c.baseUrl}. Is it running?${c.provider === 'ollama' ? ' Start the Ollama app, or run "ollama serve".' : ''}`
      : `Could not reach ${label} (${e instanceof Error ? e.message : String(e)}). Check your internet connection and the server address.`)
  }
  const text = await res.text()
  let json: any
  try { json = JSON.parse(text) } catch { json = undefined }
  if (!res.ok) {
    const msg = json?.error?.message ?? json?.[0]?.error?.message ?? json?.message ?? text.slice(0, 300)
    if (res.status === 401 || res.status === 403) throw new Error(`${label} rejected the API key. Check it in Settings → AI assistant. (${msg})`)
    if (res.status === 404) throw new Error(`${label} does not know this model or address. Check the model name${c.provider === 'ollama' ? ` (run "ollama pull ${c.model}")` : c.provider === 'ollama-cloud' ? ' (see ollama.com/search?c=cloud)' : ''}. (${msg})`)
    if (res.status === 402) {
      const where = c.provider === 'ollama-cloud' || /ollama\.com/.test(c.baseUrl) ? ` Either “${c.model}” is not included in the free plan (premium models need credits or a plan) or your free usage limit is used up for now; it resets after a few hours. Try another cloud model (Load models lists them), wait, or use Ollama (local), which is unlimited.` : ''
      throw new Error(`${label} asks for payment for this request.${where} (${msg})`)
    }
    if (res.status === 429) throw new Error(`${label} is rate limiting or your quota is used up. Try again later. (${msg})`)
    throw new Error(`${label} request failed (${res.status}): ${msg}`)
  }
  return json
}

async function askOpenAi(c: Conf, user: string): Promise<string> {
  if (!c.model) throw new Error(`Choose a model for ${aiProvider(c.provider).label} in Settings → AI assistant.`)
  const json = await openAiFetch(c, '/chat/completions', {
    model: c.model,
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }]
  })
  const choice = json?.choices?.[0]
  const content = choice?.message?.content
  const text = (Array.isArray(content) ? content.map((p: any) => p?.text ?? '').join('') : String(content ?? '')).trim()
  if (!text) throw new Error(choice?.message?.refusal || 'The assistant returned no answer')
  return choice?.finish_reason === 'length' ? `${text}\n\n(Answer cut short)` : text
}

function ensureUsable(c: Conf) {
  const info = aiProvider(c.provider)
  if (info.needsKey && !c.key) throw new Error(`Add your ${info.label} API key in Settings → AI assistant to use the assistant.`)
}

export async function ask(req: AiRequest): Promise<string> {
  const c = settingsFor(read().provider ?? 'anthropic')
  ensureUsable(c)
  return c.provider === 'anthropic' ? askAnthropic(c, prompt(req)) : askOpenAi(c, prompt(req))
}

/** Settings → Test: one tiny request with the values typed in (key may be empty = use the saved one) */
export async function test(input: AiConfigInput): Promise<string> {
  const saved = settingsFor(input.provider)
  const c: Conf = { ...saved, model: input.model.trim() || saved.model, baseUrl: (input.baseUrl?.trim() || saved.baseUrl).replace(/\/+$/, ''), key: input.key?.trim() || saved.key }
  ensureUsable(c)
  const user = 'Reply with the single word OK.'
  const t0 = Date.now()
  const answer = c.provider === 'anthropic' ? await askAnthropic(c, user) : await askOpenAi(c, user)
  return `${aiProvider(c.provider).label} answered in ${((Date.now() - t0) / 1000).toFixed(1)} s with ${c.model}: “${answer.slice(0, 40)}”`
}

/** Model names the provider offers (OpenAI-compatible /models; Anthropic uses its SDK) */
export async function listModels(input: AiConfigInput): Promise<string[]> {
  const saved = settingsFor(input.provider)
  const c: Conf = { ...saved, baseUrl: (input.baseUrl?.trim() || saved.baseUrl).replace(/\/+$/, ''), key: input.key?.trim() || saved.key }
  ensureUsable(c)
  if (c.provider === 'anthropic') {
    const out: string[] = []
    for await (const m of new Anthropic({ apiKey: c.key }).models.list()) out.push(m.id)
    return out
  }
  const pick = (json: any): string[] => [...new Set<string>((json?.data ?? json?.models ?? []).map((m: any) => String(m.id ?? m.name ?? m.model ?? '').replace(/^models\//, '')).filter(Boolean))].sort()
  // Ollama (local and cloud) lists models natively at /api/tags; try that first, then the OpenAI-style /models
  if (c.provider === 'ollama' || c.provider === 'ollama-cloud' || /:11434|ollama\.com/.test(c.baseUrl)) {
    const root = c.baseUrl.replace(/\/v1$/, '').replace(/\/api$/, '')
    try {
      const ids = pick(await openAiFetch({ ...c, baseUrl: root }, '/api/tags'))
      if (ids.length) return ids
    } catch (e) {
      // Not reachable at all: say so now instead of a second, more confusing error
      if (e instanceof Error && /Could not reach/.test(e.message)) throw e
    }
  }
  return pick(await openAiFetch(c, '/models'))
}

// ---------- Chat with streaming ----------

export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface ChatRequest {
  engine: string
  schema: string
  /** What is in the query editor right now */
  editor: { text: string; selection?: string; cursorLine?: number; lineCount?: number }
  lastError?: string
  messages: ChatMessage[]
}

const CHAT_SYSTEM = `${SYSTEM}
You are chatting with the user beside their SQL editor. Each user turn comes with the current editor contents, the selected text and the cursor line; use them as context ("this query", "the selected part", "line 12").
When you write or change a query, give the complete query in exactly one \`\`\`sql code block, formatted with one clause per line, so it can be typed straight into the editor. Answer questions without code when no query is needed.`

function chatContext(r: ChatRequest) {
  const e = r.editor
  const parts = [`Database: ${DIALECT[r.engine] ?? r.engine}`, `Schema (table: columns):\n${r.schema.slice(0, 60000) || '(not loaded)'}`]
  parts.push(e.text.trim()
    ? `Query editor (${e.lineCount ?? e.text.split('\n').length} lines${e.cursorLine ? `, cursor on line ${e.cursorLine}` : ''}):\n\`\`\`sql\n${e.text.slice(0, 20000)}\n\`\`\``
    : 'Query editor: (empty)')
  if (e.selection?.trim()) parts.push(`Selected in the editor:\n\`\`\`sql\n${e.selection.slice(0, 8000)}\n\`\`\``)
  if (r.lastError) parts.push(`Last error from the database:\n${r.lastError}`)
  return parts.join('\n\n')
}

/** The editor context goes with the latest user message only, so it is always current. */
function chatMessages(r: ChatRequest): ChatMessage[] {
  const msgs = r.messages.slice(-20)
  const last = msgs[msgs.length - 1]
  return [...msgs.slice(0, -1), { role: 'user', content: `${chatContext(r)}\n\n---\n${last?.content ?? ''}` }]
}

const running = new Map<string, AbortController>()
export const stopChat = (id: string) => { running.get(id)?.abort(); running.delete(id) }

/** Streams the answer: onText gets each new piece of text. Resolves when done or stopped. */
export async function chat(id: string, r: ChatRequest, onText: (t: string) => void): Promise<void> {
  const c = settingsFor(read().provider ?? 'anthropic')
  ensureUsable(c)
  const ac = new AbortController()
  running.set(id, ac)
  try {
    if (c.provider === 'anthropic') await chatAnthropic(c, r, onText, ac.signal)
    else await chatOpenAi(c, r, onText, ac.signal)
  } catch (e) {
    if (ac.signal.aborted) return
    throw e
  } finally { running.delete(id) }
}

async function chatAnthropic(c: Conf, r: ChatRequest, onText: (t: string) => void, signal: AbortSignal) {
  const client = new Anthropic({ apiKey: c.key })
  try {
    const stream = client.messages.stream({ model: c.model || DEFAULT_MODEL, max_tokens: 16000, system: CHAT_SYSTEM, messages: chatMessages(r) }, { signal })
    stream.on('text', (t) => onText(t))
    const final = await stream.finalMessage()
    if (final.stop_reason === 'refusal') onText('\n\n(The assistant declined this request. Try rephrasing it.)')
    if (final.stop_reason === 'max_tokens') onText('\n\n(Answer cut short)')
  } catch (e) {
    if (signal.aborted) return
    if (e instanceof Anthropic.AuthenticationError) throw new Error('The Anthropic API key was rejected. Check it in Settings → AI assistant.')
    if (e instanceof Anthropic.RateLimitError) throw new Error('Rate limited by the Anthropic API. Try again in a moment.')
    if (e instanceof Anthropic.APIConnectionError) throw new Error('Could not reach the Anthropic API. Check your internet connection.')
    if (e instanceof Anthropic.APIError) throw new Error(`AI request failed (${e.status}): ${e.message}`)
    throw e
  }
}

/** OpenAI-style streaming (server-sent events), used by every non-Anthropic provider */
async function chatOpenAi(c: Conf, r: ChatRequest, onText: (t: string) => void, signal: AbortSignal) {
  const label = aiProvider(c.provider).label
  if (!c.model) throw new Error(`Choose a model for ${label} in Settings → AI assistant.`)
  if (!c.baseUrl) throw new Error(`Set the server address for ${label} in Settings → AI assistant.`)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (c.key) headers.authorization = `Bearer ${c.key}`
  if (c.provider === 'openrouter') { headers['HTTP-Referer'] = 'https://qubase.app'; headers['X-Title'] = 'Qubase' }
  const body = { model: c.model, stream: true, messages: [{ role: 'system', content: CHAT_SYSTEM }, ...chatMessages(r)] }
  let res: Response
  try {
    res = await fetch(`${c.baseUrl}/chat/completions`, { method: 'POST', headers, signal, body: JSON.stringify(body) })
  } catch (e) {
    if (signal.aborted) return
    const local = /localhost|127\.0\.0\.1/.test(c.baseUrl)
    throw new Error(local
      ? `Could not reach ${label} at ${c.baseUrl}. Is it running?${c.provider === 'ollama' ? ' Start the Ollama app, or run "ollama serve".' : ''}`
      : `Could not reach ${label}. Check your internet connection and the server address.`)
  }
  if (!res.ok || !res.body) {
    // Same plain-language errors as a normal request (wrong key, unknown model, payment, rate limit…)
    await openAiFetch(c, '/chat/completions', { model: c.model, messages: [{ role: 'user', content: 'ping' }] })
    throw new Error(`${label} request failed (${res.status})`)
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') return
      let j: any
      try { j = JSON.parse(data) } catch { continue }
      if (j.error) throw new Error(`${label}: ${j.error.message ?? JSON.stringify(j.error)}`)
      const t = j.choices?.[0]?.delta?.content
      if (t) onText(t)
      if (j.choices?.[0]?.finish_reason === 'length') onText('\n\n(Answer cut short)')
    }
  }
}
