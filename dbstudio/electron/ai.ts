import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import type { AiRequest } from '../shared/types'

// AI SQL assistant. The API key is encrypted with the OS keychain and never
// leaves the main process; the UI only sends the question and schema.

const file = () => path.join(app.getPath('userData'), 'ai.json')
export const DEFAULT_MODEL = 'claude-opus-5-5'

interface Saved { key?: string; model?: string }

function read(): Saved {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')) } catch { return {} }
}

function apiKey(): string | undefined {
  const k = read().key
  if (!k) return process.env.ANTHROPIC_API_KEY
  return k.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(k.slice(4), 'base64')) : k
}

export const hasKey = () => !!apiKey()

/** Save the key (empty keeps the current one) and the model. */
export function setKey(key: string, model: string) {
  const cur = read()
  const enc = key ? (safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(key).toString('base64') : key) : cur.key
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file(), JSON.stringify({ key: enc, model: model || cur.model || DEFAULT_MODEL }))
}

const DIALECT: Record<string, string> = {
  mssql: 'Microsoft SQL Server (T-SQL)', postgres: 'PostgreSQL', mysql: 'MySQL / MariaDB', sqlite: 'SQLite', libsql: 'SQLite (libSQL)',
  oracle: 'Oracle (PL/SQL)', clickhouse: 'ClickHouse', duckdb: 'DuckDB', mongodb: 'MongoDB shell (mongosh)', redis: 'Redis commands'
}

const SYSTEM = `You are the SQL assistant inside Qubase, a desktop database client.
Write correct, efficient queries for the stated database dialect, using only the tables and columns in the schema provided.
If the schema does not contain what is needed, say so briefly instead of inventing names.
Prefer reading data over changing it. Never write DROP, TRUNCATE, or UPDATE / DELETE without WHERE unless the user explicitly asks for it.
Put any query in one fenced code block. Keep explanations short and plain.`

export async function ask(req: AiRequest): Promise<string> {
  const key = apiKey()
  if (!key) throw new Error('Add your Anthropic API key in Settings to use the AI assistant')
  const client = new Anthropic({ apiKey: key })
  const parts = [
    `Database: ${DIALECT[req.engine] ?? req.engine}`,
    `Schema (table: columns):\n${req.schema.slice(0, 60000) || '(not loaded)'}`
  ]
  if (req.sql) parts.push(`Current query:\n\`\`\`\n${req.sql.slice(0, 20000)}\n\`\`\``)
  if (req.error) parts.push(`Error from the database:\n${req.error}`)
  const task = req.mode === 'write'
    ? `Write a query for this request: ${req.question}`
    : req.mode === 'explain'
      ? `Explain what the current query does, step by step, and point out any performance or correctness risks.${req.question ? ` Also: ${req.question}` : ''}`
      : `Fix the current query so it runs without the error. Give the corrected query, then one or two sentences on what was wrong.${req.question ? ` Note: ${req.question}` : ''}`
  parts.push(task)

  try {
    const res = await client.beta.messages.create({
      model: read().model || DEFAULT_MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: 'user', content: parts.join('\n\n') }],
      // If a safety check declines the request, the API retries it on a fallback model
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default'
    })
    if (res.stop_reason === 'refusal') throw new Error('The assistant declined this request. Try rephrasing it.')
    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim()
    if (!text) throw new Error('The assistant returned no answer')
    return res.stop_reason === 'max_tokens' ? `${text}\n\n(Answer cut short)` : text
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('The Anthropic API key was rejected. Check it in Settings.')
    if (e instanceof Anthropic.RateLimitError) throw new Error('Rate limited by the Anthropic API. Try again in a moment.')
    if (e instanceof Anthropic.APIConnectionError) throw new Error('Could not reach the Anthropic API. Check your internet connection.')
    if (e instanceof Anthropic.APIError) throw new Error(`AI request failed (${e.status}): ${e.message}`)
    throw e
  }
}
