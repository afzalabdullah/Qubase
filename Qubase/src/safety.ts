// Safety checks run before SQL is sent: read-only connections, production
// confirmations, and UPDATE / DELETE without WHERE.
import type { SavedConnection } from '../shared/types'
import { readSettings } from './settings'

/** Remove comments and string literals so keywords inside them don't count. */
function strip(sql: string) {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
}

const WRITE_SQL = /^\s*(insert|update|delete|merge|upsert|replace|create|alter|drop|truncate|rename|grant|revoke|deny|exec|execute|call|backup|restore|dbcc|kill|vacuum|reindex|cluster|comment|lock|set\s+identity_insert|bulk|copy|load|import|attach|detach|optimize|refresh)\b/i
const WRITE_MONGO = /\.(insert\w*|update\w*|delete\w*|remove|replace\w*|drop\w*|create\w*|rename\w*|bulkWrite|findOneAnd\w+)\s*\(|dropDatabase|createCollection/i
const WRITE_REDIS = /^\s*(set\w*|mset\w*|del|unlink|expire\w*|persist|rename\w*|incr\w*|decr\w*|append|[lr]push\w*|[lr]pop|lset|lrem|ltrim|sadd|srem|spop|smove|zadd|zrem\w*|zincrby|hset\w*|hdel|hincr\w*|flushall|flushdb|move|copy|restore|xadd|xdel|xtrim|pfadd|geoadd|getdel|getex|eval\w*|function|config\s+set)\b/i

export interface SqlCheck {
  /** Statements that change data or schema (first words, for the message) */
  writes: string[]
  /** UPDATE / DELETE statements with no WHERE */
  noWhere: string[]
}

export function checkSql(code: string, language: 'sql' | 'mongo' | 'redis'): SqlCheck {
  if (language === 'mongo') return { writes: WRITE_MONGO.test(code) ? ['change'] : [], noWhere: [] }
  if (language === 'redis') {
    const lines = code.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'))
    return { writes: lines.filter((l) => WRITE_REDIS.test(l)).map((l) => l.trim().split(/\s+/)[0].toUpperCase()), noWhere: [] }
  }
  const statements = strip(code).split(/;|^\s*GO\s*$/gim).map((s) => s.trim()).filter(Boolean)
  const writes: string[] = []
  const noWhere: string[] = []
  for (const s of statements) {
    // A CTE can end in a write: WITH x AS (...) DELETE FROM ...
    const body = /^\s*with\b/i.test(s) ? s.replace(/^[\s\S]*?\)\s*(?=(insert|update|delete|merge)\b)/i, '') : s
    const m = body.match(WRITE_SQL)
    if (m) writes.push(m[1].toUpperCase())
    if (/^\s*(update|delete)\b/i.test(body) && !/\bwhere\b/i.test(body)) noWhere.push(body.replace(/\s+/g, ' ').slice(0, 80))
  }
  return { writes, noWhere }
}

/**
 * Ask before running. Returns false when the run must not happen.
 * `what` describes the change for grid edits and the designer (no SQL to inspect).
 */
export function allowRun(conn: SavedConnection, check: SqlCheck | { what: string }): boolean {
  const settings = readSettings()
  const isWrite = 'what' in check || check.writes.length > 0
  if (conn.readOnly && isWrite) {
    window.alert(`This connection is read-only.\n\nBlocked: ${'what' in check ? check.what : [...new Set(check.writes)].join(', ')}\n\nTurn off Read-only in the connection's Safety settings to make changes.`)
    return false
  }
  if (!('what' in check) && check.noWhere.length && settings.blockNoWhere) {
    if (!window.confirm(`UPDATE or DELETE without WHERE changes EVERY row:\n\n${check.noWhere.join('\n')}\n\nRun it anyway?`)) return false
  }
  if (conn.production && isWrite && settings.confirmProduction) {
    const desc = 'what' in check ? check.what : [...new Set(check.writes)].join(', ')
    if (!window.confirm(`PRODUCTION: ${conn.name || 'this connection'}\n\nThis will run: ${desc}\n\nContinue?`)) return false
  }
  return true
}
