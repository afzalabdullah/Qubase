import { useState } from 'react'
import type { AiRequest } from '../../shared/types'
import { IconSpark, IconX } from './Icons'
import { errMsg } from '../util'

interface Props {
  engine: string
  /** Builds the schema text (tables and columns) on demand */
  getSchema: () => Promise<string>
  getSql: () => string
  lastError: string
  onInsert: (sql: string) => void
  onClose: () => void
}

/** First fenced code block in the answer, if any */
function codeOf(text: string) {
  const m = /```[a-zA-Z]*\n([\s\S]*?)```/.exec(text)
  return m ? m[1].trim() : ''
}

/** AI assistant beside the editor: write SQL from a question, explain a query, or fix an error. */
export function AiPanel({ engine, getSchema, getSql, lastError, onInsert, onClose }: Props) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const ask = async (mode: AiRequest['mode']) => {
    if (mode === 'write' && !question.trim()) return
    setBusy(true); setError(''); setAnswer('')
    try {
      const schema = await getSchema()
      const text = await window.db.aiAsk({
        mode, engine, schema, question: question.trim(),
        sql: mode === 'write' ? undefined : getSql(),
        error: mode === 'fix' ? lastError : undefined
      })
      setAnswer(text)
    } catch (e) { setError(errMsg(e)) } finally { setBusy(false) }
  }

  const code = codeOf(answer)

  return (
    <aside className="ai-panel">
      <div className="json-head">
        <IconSpark width={14} height={14} /><strong>AI assistant</strong>
        <div className="spacer" />
        <button className="icon-btn" onClick={onClose} title="Close"><IconX /></button>
      </div>
      <div className="ai-body">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Describe the data you want, e.g. “top 10 customers by total order value this year”"
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ask('write') }}
          rows={4}
        />
        <div className="ai-actions">
          <button className="btn btn-primary btn-sm" disabled={busy || !question.trim()} onClick={() => ask('write')} title="Ctrl+Enter">Write SQL</button>
          <button className="btn btn-sm" disabled={busy} onClick={() => ask('explain')}>Explain query</button>
          <button className="btn btn-sm" disabled={busy || !lastError} onClick={() => ask('fix')} title={lastError ? 'Fix the last error' : 'Run a query that fails first'}>Fix error</button>
        </div>
        {busy && <div className="muted small-text">Thinking…</div>}
        {error && <div className="notice error">{error}</div>}
        {answer && (
          <div className="ai-answer">
            {code && (
              <div className="ai-code-actions">
                <button className="btn btn-sm btn-primary" onClick={() => onInsert(code)}>Insert into editor</button>
                <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(code)}>Copy SQL</button>
              </div>
            )}
            <pre>{answer}</pre>
          </div>
        )}
        <p className="muted small-text">Sends table and column names plus your query to Anthropic. Row data is never sent. Always review SQL before running it.</p>
      </div>
    </aside>
  )
}
