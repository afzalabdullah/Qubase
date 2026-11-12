import { DB_ICONS } from '../../data/dbIcons'

/** Relative luminance of a #rrggbb colour, 0 (black) to 1 (white). */
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** A database's logo on a small tile. Very light brand colours (DuckDB, ClickHouse) get a dark
 *  tile so they stay visible; everything else sits on white in both themes. */
export function DbLogo({ name, className = 'size-11' }: { name: string; className?: string }) {
  const icon = DB_ICONS[name]
  if (!icon) return null
  const darkTile = luminance(icon.hex) > 0.6
  const tile = `grid shrink-0 place-items-center rounded-xl ${darkTile ? 'bg-[#1b1e24]' : 'bg-white'} ring-1 ring-black/5 dark:ring-white/10 ${className}`

  if (icon.path) {
    return (
      <span className={tile}>
        <svg viewBox="0 0 24 24" className="size-[55%]" fill={icon.hex} role="img" aria-label={`${name} logo`}><path d={icon.path} /></svg>
      </span>
    )
  }
  return (
    <span className={tile} aria-hidden="true">
      <span className="grid size-[62%] place-items-center rounded-md text-[0.8rem] font-bold text-white" style={{ background: icon.hex }}>{icon.abbr}</span>
    </span>
  )
}
