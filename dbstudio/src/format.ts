import { format } from 'sql-formatter'
import { readSettings } from './settings'

const LANG: Record<string, string> = {
  mssql: 'transactsql', postgres: 'postgresql', mysql: 'mysql', sqlite: 'sqlite', oracle: 'plsql',
  clickhouse: 'sql', duckdb: 'duckdb', libsql: 'sqlite', snowflake: 'snowflake', bigquery: 'bigquery', trino: 'trino'
}

/** Format SQL with the user's keyword case and indent */
export function formatSqlText(text: string, engine: string): string {
  const s = readSettings()
  return format(text, { language: (LANG[engine] ?? 'sql') as 'sql', keywordCase: s.keywordCase, tabWidth: s.indentWidth })
}
