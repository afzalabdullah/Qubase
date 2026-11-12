import { useLayoutEffect, useRef, useState } from 'react'

export type MenuItem = { label: string; onClick: () => void; danger?: boolean; hint?: string } | 'sep'

/** Right-click menu at the mouse position; closes on outside click or Escape. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // Keep the menu inside the window
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ left: Math.min(x, window.innerWidth - r.width - 8), top: Math.min(y, window.innerHeight - r.height - 8) })
  }, [x, y])

  return (
    <>
      <div className="menu-backdrop" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div className="menu context-menu" ref={ref} style={pos} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        {items.map((it, i) => it === 'sep'
          ? <div key={i} className="menu-sep" />
          : (
            <button key={i} className={it.danger ? 'danger' : ''} onClick={() => { onClose(); it.onClick() }}>
              <span>{it.label}</span>
              {it.hint && <span className="menu-hint">{it.hint}</span>}
            </button>
          ))}
      </div>
    </>
  )
}
