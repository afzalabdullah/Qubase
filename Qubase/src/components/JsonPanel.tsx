import { useMemo, useState } from 'react'
import { IconCheck, IconCopy, IconX } from './Icons'

function toJson(v: unknown) {
  return JSON.stringify(
    v,
    (_k, x) => (typeof x === 'bigint' ? x.toString() : x instanceof Uint8Array ? '0x' + Array.from(x, (b) => b.toString(16).padStart(2, '0')).join('') : x),
    2
  )
}

/** Escape HTML, then colour keys, strings, numbers, booleans and null. */
function highlight(json: string) {
  const esc = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc.replace(
    /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (m) => {
      const cls = /^"/.test(m) ? (/:$/.test(m) ? 'j-key' : 'j-str') : /true|false/.test(m) ? 'j-bool' : /null/.test(m) ? 'j-null' : 'j-num'
      return `<span class="${cls}">${m}</span>`
    }
  )
}

// Colouring very large JSON is slow; past this size it is shown as plain text (still complete)
const HIGHLIGHT_LIMIT = 2_000_000

function readWidth() {
  try { return Math.max(260, Number(localStorage.getItem('jsonPanelWidth')) || 380) } catch { return 380 }
}

/** Right-hand panel showing the selected row, or all selected rows, as formatted JSON. */
export function JsonPanel({ value, onClose }: { value: Record<string, unknown> | Record<string, unknown>[] | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const [width, setWidth] = useState(readWidth)
  const json = useMemo(() => (value ? toJson(value) : ''), [value])
  const html = useMemo(() => (json && json.length <= HIGHLIGHT_LIMIT ? highlight(json) : null), [json])
  const count = Array.isArray(value) ? value.length : value ? 1 : 0

  const copy = async () => {
    await navigator.clipboard?.writeText(json)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  // Drag the left edge to resize
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX, startW = width
    let w = startW
    const move = (ev: MouseEvent) => { w = Math.min(Math.max(260, startW + startX - ev.clientX), window.innerWidth * 0.7); setWidth(w) }
    const up = () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up)
      try { localStorage.setItem('jsonPanelWidth', String(Math.round(w))) } catch { /* ignore */ }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <aside className="json-panel" style={{ width }}>
      <div className="json-resize" onMouseDown={startDrag} title="Drag to resize" />
      <div className="json-head">
        <strong>{count > 1 ? `${count.toLocaleString()} rows as JSON` : 'Row as JSON'}</strong>
        {json && <span className="muted small-text">· {json.length > 1024 * 1024 ? `${(json.length / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(json.length / 1024)} KB`}</span>}
        <div className="spacer" />
        {value && <button className="icon-btn" onClick={copy} title="Copy JSON">{copied ? <IconCheck /> : <IconCopy />}</button>}
        <button className="icon-btn" onClick={onClose} title="Close"><IconX /></button>
      </div>
      {value
        ? html !== null
          ? <pre className="json-body" dangerouslySetInnerHTML={{ __html: html }} />
          : <pre className="json-body">{json}</pre>
        : <div className="placeholder">Click a row to see it as JSON.<br />Ctrl+A or the top-left corner selects all rows.</div>}
    </aside>
  )
}
