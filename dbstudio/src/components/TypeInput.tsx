import { useRef, useState } from 'react'
import { IconChevron } from './Icons'

interface Props {
  value: string
  types: string[]
  disabled?: boolean
  onChange: (v: string) => void
}

/**
 * Data type box: type freely, or open the list to pick one.
 * The list shows every type when opened with the arrow, and filters as you type.
 */
export function TypeInput({ value, types, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [filtering, setFiltering] = useState(false)
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0 })
  const wrapRef = useRef<HTMLDivElement>(null)

  const q = value.trim().toLowerCase()
  const list = filtering && q ? types.filter((t) => t.toLowerCase().includes(q)) : types

  const show = (filter: boolean) => {
    const r = wrapRef.current!.getBoundingClientRect()
    // Fixed position so the list isn't cut off by the scrolling designer
    const below = window.innerHeight - r.bottom > 240
    setPos({ left: r.left, top: below ? r.bottom + 2 : Math.max(8, r.top - 242), width: Math.max(r.width, 180) })
    setFiltering(filter)
    setActive(Math.max(0, types.indexOf(value)))
    setOpen(true)
  }
  const pick = (t: string) => { onChange(t); setOpen(false) }

  return (
    <div className="type-input" ref={wrapRef}>
      <input
        value={value}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => { onChange(e.target.value); if (!open) show(true); else setFiltering(true); setActive(0) }}
        onFocus={() => {}}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) show(false); else setActive((a) => Math.min(list.length - 1, a + 1)) }
          else if (e.key === 'ArrowUp' && open) { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
          else if (e.key === 'Enter' && open && list[active]) { e.preventDefault(); pick(list[active]) }
          else if (e.key === 'Escape') setOpen(false)
        }}
      />
      <button type="button" className="type-arrow" tabIndex={-1} disabled={disabled}
        onMouseDown={(e) => { e.preventDefault(); if (open) setOpen(false); else { show(false); wrapRef.current?.querySelector('input')?.focus() } }}>
        <IconChevron width={12} height={12} />
      </button>
      {open && list.length > 0 && (
        <div className="type-list" style={{ left: pos.left, top: pos.top, width: pos.width }}>
          {list.map((t, i) => (
            <div key={t} className={`type-opt ${i === active ? 'active' : ''} ${t === value ? 'current' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); pick(t) }} onMouseEnter={() => setActive(i)}>
              {t}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
