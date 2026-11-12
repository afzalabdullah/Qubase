import { driverFor, DbKind } from '../../shared/drivers'
import { DB_LOGOS } from '../logos'
import mssql from '../assets/db/mssql.svg'
import azuresql from '../assets/db/azuresql.svg'
import oracle from '../assets/db/oracle.svg'
import dynamodb from '../assets/db/dynamodb.svg'
import yugabyte from '../assets/db/yugabyte.svg'
import redshift from '../assets/db/redshift.svg'

/** Full-colour logos (Devicon, MIT; AWS architecture icons) for brands Simple Icons doesn't carry. */
const LOGO_FILES: Partial<Record<DbKind, string>> = { mssql, azuresql, oracle, dynamodb, yugabyte, redshift }

/** Brightness 0–255 of a #rrggbb colour. */
function light(hex: string) {
  const h = hex.slice(1)
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  return (r * 299 + g * 587 + b * 114) / 1000
}

/** The database's logo in its brand colour on a neutral tile. Pale brand colours sit on a dark tile so they stay visible. */
export function DbBadge({ kind, size = 28 }: { kind: DbKind; size?: number }) {
  const d = driverFor(kind)
  const file = LOGO_FILES[kind]
  const logo = DB_LOGOS[kind]
  const color = logo?.color ?? d.color
  const pale = !file && light(color) > 185
  return (
    <span className={`db-badge${pale ? ' pale' : ''}`} style={{ width: size, height: size, fontSize: size * 0.38, color }} title={d.label}>
      {file
        ? <img src={file} width={size * 0.72} height={size * 0.72} alt="" draggable={false} />
        : logo
          ? <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="currentColor" aria-hidden="true"><path d={logo.path} /></svg>
          : <b>{d.abbr}</b>}
    </span>
  )
}
