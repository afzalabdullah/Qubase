// Test data generator: INSERT statements with plausible values for each column.
import type { ColumnInfo, TableInfo } from '../shared/types'
import { quote, tableRef } from '../shared/ddl'

const FIRST = ['Ava', 'Liam', 'Noah', 'Emma', 'Omar', 'Sara', 'Ali', 'Mia', 'Lucas', 'Zara', 'Ethan', 'Aisha', 'Hassan', 'Chloe', 'Leo', 'Fatima']
const LAST = ['Smith', 'Khan', 'Garcia', 'Chen', 'Ahmed', 'Brown', 'Patel', 'Miller', 'Lopez', 'Wilson', 'Malik', 'Taylor']
const CITY = ['London', 'Karachi', 'New York', 'Lahore', 'Berlin', 'Toronto', 'Dubai', 'Sydney', 'Paris', 'Madrid']
const WORDS = ['alpha', 'bravo', 'delta', 'echo', 'lima', 'nova', 'orbit', 'pixel', 'quartz', 'river', 'solar', 'terra']

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
const int = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1))
const pad = (n: number) => String(n).padStart(2, '0')

/** Random date in the last 3 years */
function date(withTime: boolean) {
  const d = new Date(Date.now() - Math.random() * 3 * 365 * 864e5)
  const s = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return withTime ? `${s} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : s
}

/** Maximum text length from a type like varchar(40), or a default */
function maxLen(type: string) {
  const m = /\((\d+)\)/.exec(type)
  return m ? Number(m[1]) : 50
}

/** How to fill one column. 'auto' guesses from the type and name. */
export type RuleKind = 'auto' | 'skip' | 'firstName' | 'lastName' | 'fullName' | 'email' | 'phone' | 'city' | 'country' | 'company' | 'lorem'
  | 'int' | 'decimal' | 'date' | 'datetime' | 'bool' | 'uuid' | 'list' | 'constant' | 'null' | 'sequence'
export interface ColumnRule { kind: RuleKind; min?: number; max?: number; from?: string; to?: string; list?: string; value?: string; nullPct?: number }

export const RULE_LABELS: [RuleKind, string][] = [
  ['auto', 'Auto (guess)'], ['skip', 'Leave out (use default)'], ['firstName', 'First name'], ['lastName', 'Last name'], ['fullName', 'Full name'],
  ['email', 'Email'], ['phone', 'Phone'], ['city', 'City'], ['country', 'Country'], ['company', 'Company'], ['lorem', 'Words (lorem)'],
  ['int', 'Whole number range'], ['decimal', 'Decimal range'], ['date', 'Date range'], ['datetime', 'Date + time range'], ['bool', 'True / false'],
  ['uuid', 'UUID'], ['list', 'Pick from list'], ['constant', 'Same value'], ['null', 'Always NULL'], ['sequence', 'Sequence (start, step)']
]

const COMPANY = ['Acme', 'Globex', 'Initech', 'Umbrella', 'Hooli', 'Vandelay', 'Stark', 'Wayne', 'Wonka', 'Soylent']
const COUNTRY = ['UK', 'Pakistan', 'USA', 'Germany', 'Canada', 'UAE', 'France', 'Spain', 'India', 'Australia']

function rangeDate(from: string | undefined, to: string | undefined, withTime: boolean) {
  const a = Date.parse(from || '') || Date.now() - 3 * 365 * 864e5
  const b = Date.parse(to || '') || Date.now()
  const d = new Date(a + Math.random() * Math.max(0, b - a))
  const s = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return withTime ? `${s} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : s
}

/** A value for one column following the user's rule */
function ruleValue(engine: string, c: ColumnInfo, row: number, r: ColumnRule): string {
  const t = c.dataType.toLowerCase()
  const str = (s: string) => `'${s.slice(0, maxLen(t)).replace(/'/g, "''")}'`
  if (r.kind === 'auto') return value(engine, c, row)
  if (r.kind === 'null') return 'NULL'
  if (r.nullPct && Math.random() * 100 < r.nullPct) return 'NULL'
  const lo = r.min ?? 1, hi = r.max ?? 1000
  const num = (v: string) => (/char|text|string|clob/.test(t) ? str(v) : v)
  switch (r.kind) {
    case 'firstName': return str(pick(FIRST))
    case 'lastName': return str(pick(LAST))
    case 'fullName': return str(`${pick(FIRST)} ${pick(LAST)}`)
    case 'email': return str(`${pick(FIRST)}.${pick(LAST)}${int(1, 999)}@example.com`.toLowerCase())
    case 'phone': return str(`+1-555-${int(100, 999)}-${int(1000, 9999)}`)
    case 'city': return str(pick(CITY))
    case 'country': return str(pick(COUNTRY))
    case 'company': return str(`${pick(COMPANY)} ${pick(['Ltd', 'Inc', 'Group', 'LLC'])}`)
    case 'lorem': return str(Array.from({ length: int(2, 6) }, () => pick(WORDS)).join(' '))
    case 'int': return num(String(int(Math.ceil(lo), Math.floor(hi))))
    case 'decimal': return num((lo + Math.random() * (hi - lo)).toFixed(2))
    case 'date': return str(rangeDate(r.from, r.to, false))
    case 'datetime': return str(rangeDate(r.from, r.to, true))
    case 'bool': return engine === 'postgres' || engine === 'duckdb' ? pick(['true', 'false']) : String(int(0, 1))
    case 'uuid': return str(crypto.randomUUID())
    case 'list': { const items = (r.list ?? '').split(',').map((x) => x.trim()).filter(Boolean); return items.length ? num(pick(items)) : 'NULL' }
    case 'constant': return r.value === undefined || r.value === '' ? 'NULL' : /^-?\d+(\.\d+)?$/.test(r.value) && !/char|text/.test(t) ? r.value : str(r.value)
    case 'sequence': return num(String((r.min ?? 1) + row * (r.max ?? 1)))
    default: return value(engine, c, row)
  }
}

/** A value (as SQL literal) for one column, guessed from its type and name. */
function value(engine: string, c: ColumnInfo, row: number): string {
  const t = c.dataType.toLowerCase()
  const n = c.name.toLowerCase()
  const str = (s: string) => `'${s.slice(0, maxLen(t)).replace(/'/g, "''")}'`
  if (c.nullable && !c.primaryKey && Math.random() < 0.05) return 'NULL'
  if (/uuid|uniqueidentifier/.test(t)) return str(crypto.randomUUID())
  if (/bool|bit/.test(t)) return engine === 'postgres' || engine === 'duckdb' ? pick(['true', 'false']) : String(int(0, 1))
  if (/int|serial/.test(t)) {
    if (c.primaryKey) return String(row + 1)
    if (/age/.test(n)) return String(int(18, 80))
    if (/year/.test(n)) return String(int(2000, 2026))
    return String(int(/tiny/.test(t) ? 0 : 1, /tiny/.test(t) ? 100 : /small/.test(t) ? 30000 : 10000))
  }
  if (/dec|numeric|money|real|float|double|number/.test(t)) {
    const v = /price|amount|total|cost|salary|balance/.test(n) ? Math.random() * 5000 : Math.random() * 1000
    return v.toFixed(2)
  }
  if (/timestamp|datetime|smalldatetime/.test(t)) return str(date(true))
  if (/date/.test(t)) return str(date(false))
  if (/^time/.test(t)) return str(`${pad(int(0, 23))}:${pad(int(0, 59))}:00`)
  if (/json/.test(t)) return str(JSON.stringify({ id: row + 1, tag: pick(WORDS) }))
  if (/blob|binary|bytea|image/.test(t)) return 'NULL'
  // Text: guess from the column name
  const first = pick(FIRST), last = pick(LAST)
  if (/email/.test(n)) return str(`${first}.${last}${int(1, 999)}@example.com`.toLowerCase())
  if (/first.?name/.test(n)) return str(first)
  if (/last.?name|surname/.test(n)) return str(last)
  if (/name/.test(n)) return str(`${first} ${last}`)
  if (/phone|mobile/.test(n)) return str(`+1-555-${int(100, 999)}-${int(1000, 9999)}`)
  if (/city/.test(n)) return str(pick(CITY))
  if (/country/.test(n)) return str(pick(['UK', 'Pakistan', 'USA', 'Germany', 'Canada', 'UAE']))
  if (/status/.test(n)) return str(pick(['active', 'pending', 'closed']))
  if (/url|website/.test(n)) return str(`https://example.com/${pick(WORDS)}`)
  if (/code|sku/.test(n)) return str(`${pick(WORDS).toUpperCase().slice(0, 3)}-${int(1000, 9999)}`)
  return str(`${pick(WORDS)} ${pick(WORDS)} ${row + 1}`)
}

/**
 * INSERT script for n rows. Identity / auto-increment columns are left out so
 * the database fills them; other primary keys get 1..n.
 */
/** True for columns the database fills itself (identity, serial, sequences) */
export const isAutoColumn = (c: ColumnInfo) => !!c.autoIncrement || /serial|identity/i.test(c.dataType) || (c.defaultValue ?? '').toLowerCase().includes('nextval')

export function testDataSql(engine: string, table: TableInfo, columns: ColumnInfo[], n: number, rules?: Record<string, ColumnRule>): string {
  const cols = columns.filter((c) => (rules?.[c.name] ? rules[c.name].kind !== 'skip' : !isAutoColumn(c)))
  if (!cols.length) throw new Error('Every column is filled automatically, so there is nothing to generate')
  const ref = tableRef(engine, table)
  const head = `INSERT INTO ${ref} (${cols.map((c) => quote(engine, c.name)).join(', ')})`
  const rows = Array.from({ length: n }, (_, i) => `(${cols.map((c) => (rules?.[c.name] ? ruleValue(engine, c, i, rules[c.name]) : value(engine, c, i))).join(', ')})`)
  // Multi-row VALUES in chunks (SQL Server allows 1000 rows per INSERT); Oracle needs one per row
  if (engine === 'oracle') return rows.map((r) => `${head} VALUES ${r};`).join('\n')
  const out: string[] = []
  for (let i = 0; i < rows.length; i += 500) out.push(`${head} VALUES\n  ${rows.slice(i, i + 500).join(',\n  ')};`)
  return out.join('\n\n')
}
