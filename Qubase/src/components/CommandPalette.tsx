import { Keys } from './SettingsModal'
import { useEffect, useMemo, useRef, useState } from 'react'

export interface Command {
  id: string
  label: string
  /** Shown on the right, e.g. a shortcut or "table" */
  hint?: string
  run: () => void
}

/** Ctrl+Shift+P / Ctrl+K: type to find any command or table. */
export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    const scored = commands
      .map((c) => {
        const l = c.label.toLowerCase()
        if (!words.every((w) => l.includes(w))) return null
        // Exact name, then starts-with (of the label or of the name after "schema."), then contains
        const w = words.join(' ')
        const name = l.slice(Math.max(l.lastIndexOf('.'), l.lastIndexOf(': ') + 1) + 1)
        const score = !w ? 0 : name === w || l === w ? 0 : l.startsWith(w) || name.startsWith(w) ? 1 : 2
        return { c, score: score + (c.hint === 'saved' ? 0.3 : 0) }
      })
      .filter((x): x is { c: Command; score: number } => !!x)
    return scored.sort((a, b) => a.score - b.score).slice(0, 60).map((x) => x.c)
  }, [q, commands])

  useEffect(() => setI(0), [q])
  useEffect(() => { listRef.current?.children[i]?.scrollIntoView({ block: 'nearest' }) }, [i])

  const pick = (c?: Command) => { if (!c) return; onClose(); c.run() }

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Type a command or table name…"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(matches.length - 1, x + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)) }
            else if (e.key === 'Enter') { e.preventDefault(); pick(matches[i]) }
            else if (e.key === 'Escape') onClose()
          }}
        />
        <div className="palette-list" ref={listRef}>
          {matches.length === 0 && <div className="empty pad">No matches</div>}
          {matches.map((c, n) => (
            <button key={c.id} className={n === i ? 'on' : ''} onMouseMove={() => setI(n)} onClick={() => pick(c)}>
              <span>{c.label}</span>
              {c.hint && (/^(Ctrl|Alt|Shift|F\d)/.test(c.hint) ? <Keys combo={c.hint} /> : <span className="muted small-text">{c.hint}</span>)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
