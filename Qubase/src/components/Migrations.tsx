import { useEffect, useState } from 'react'
import type { QueryResult, TableInfo } from '../../shared/types'
import { quote, tableRef } from '../../shared/ddl'
import { ResultView } from './ResultView'
import { errMsg } from '../util'
import { useConn } from '../settings'

// Finds the history table of common migration tools and shows what has been applied.

export const TOOLS: { tool: string; table: RegExp; order?: string }[] = [
  { tool: 'Flyway', table: /^flyway_schema_history$/i, order: 'installed_rank' },
  { tool: 'Liquibase', table: /^databasechangelog$/i, order: 'orderexecuted' },
  { tool: 'Prisma', table: /^_prisma_migrations$/i, order: 'started_at' },
  { tool: 'Rails / Active Record', table: /^schema_migrations$/i, order: 'version' },
  { tool: 'Alembic (SQLAlchemy)', table: /^alembic_version$/i },
  { tool: 'Django', table: /^django_migrations$/i, order: 'id' },
  { tool: 'Knex', table: /^knex_migrations$/i, order: 'id' },
  { tool: 'Sequelize', table: /^SequelizeMeta$/i },
  { tool: 'TypeORM', table: /^(typeorm_)?migrations$/i, order: 'id' },
  { tool: 'Entity Framework', table: /^__EFMigrationsHistory$/i },
  { tool: 'Laravel', table: /^migrations$/i, order: 'id' },
  { tool: 'Drizzle', table: /^__drizzle_migrations$/i, order: 'id' },
  { tool: 'golang-migrate / goose', table: /^(goose_db_version)$/i, order: 'id' }
]

/** The migration tool that owns a table, if any */
export const migrationTool = (table: string) => TOOLS.find((x) => x.table.test(table))

interface Found { tool: string; table: TableInfo; result?: QueryResult; error?: string }

export function Migrations({ onStatus }: { onStatus: (s: string) => void }) {
  const { connId, engine } = useConn()
  const [found, setFound] = useState<Found[] | null>(null)
  const [error, setError] = useState('')

  const load = async () => {
    setFound(null); setError('')
    try {
      const tables = await window.db.listTables(connId)
      const hits: Found[] = []
      for (const t of tables) {
        const tool = migrationTool(t.name)
        if (!tool || hits.some((h) => h.table.name === t.name && h.table.schema === t.schema)) continue
        const order = tool.order ? ` ORDER BY ${quote(engine, tool.order)} DESC` : ''
        const sql = `SELECT * FROM ${tableRef(engine, t)}${order}`
        let f: Found = { tool: tool.tool, table: t }
        try { f.result = await window.db.query(connId, sql) } catch (e) {
          // The order column may differ between versions of a tool: try without it
          try { f.result = await window.db.query(connId, `SELECT * FROM ${tableRef(engine, t)}`) } catch { f = { ...f, error: errMsg(e) } }
        }
        hits.push(f)
      }
      setFound(hits)
      onStatus(hits.length ? `Found ${hits.length} migration history table${hits.length > 1 ? 's' : ''}` : 'No migration history found')
    } catch (e) { setError(errMsg(e)); setFound([]) }
  }
  useEffect(() => { load() }, [connId]) // eslint-disable-line react-hooks/exhaustive-deps

  const failed = (r?: QueryResult) => {
    if (!r) return 0
    const col = r.columns.find((c) => /^(success|applied|exectype)$/i.test(c))
    return col ? r.rows.filter((x) => x[col] === false || x[col] === 0 || x[col] === 'FAILED').length : 0
  }

  return (
    <div className="tool-page migrations">
      <div className="tool-head">
        <h2>Migrations</h2>
        <p className="muted small-text">Applied migrations from Flyway, Liquibase, Prisma, Rails, Alembic, Django, Knex, Sequelize, TypeORM, Entity Framework, Laravel, Drizzle and goose, newest first. Compare them with the migration files in your project to see what is still pending.</p>
        <button className="btn btn-sm" onClick={load}>Refresh</button>
      </div>
      {error && <div className="notice error">{error}</div>}
      {found === null && <div className="empty pad">Looking for migration tables…</div>}
      {found?.length === 0 && !error && <div className="empty pad">No migration history table was found in this database.</div>}
      {found?.map((f) => (
        <section key={`${f.table.schema ?? ''}.${f.table.name}`} className="migrations-section">
          <h3>{f.tool} <span className="muted small-text">{f.table.schema ? `${f.table.schema}.` : ''}{f.table.name} · {f.result ? `${f.result.rowCount} applied` : 'unreadable'}{failed(f.result) ? ` · ${failed(f.result)} failed` : ''}</span></h3>
          {f.error && <div className="notice error">{f.error}</div>}
          {f.result && <div className="migrations-result"><ResultView result={f.result} name={f.table.name} /></div>}
        </section>
      ))}
    </div>
  )
}
