// "Copy as" formats for result rows (written in the UI, straight to the clipboard).
import { quote, sqlLiteral } from '../shared/ddl'
import { cellText } from './util'

type Row = Record<string, unknown>
export type CopyFormat = 'tsv' | 'csv' | 'markdown' | 'json' | 'insert' | 'in-list'

export const COPY_FORMATS: [CopyFormat, string][] = [
  ['tsv', 'Tab-separated (pastes into Excel)'],
  ['csv', 'CSV'],
  ['markdown', 'Markdown table'],
  ['json', 'JSON'],
  ['insert', 'INSERT statements'],
  ['in-list', 'IN (…) list of the first column']
]

const show = (v: unknown) => (v === null || v === undefined ? '' : cellText(v))
const csvField = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

export function formatRows(format: CopyFormat, columns: string[], rows: Row[], engine = '', table = 'my_table'): string {
  switch (format) {
    case 'tsv': return [columns.join('\t'), ...rows.map((r) => columns.map((c) => show(r[c]).replace(/[\t\r\n]+/g, ' ')).join('\t'))].join('\n')
    case 'csv': return [columns.map(csvField).join(','), ...rows.map((r) => columns.map((c) => csvField(show(r[c]))).join(','))].join('\r\n')
    case 'markdown': {
      const md = (v: unknown) => (v === null || v === undefined ? 'NULL' : cellText(v)).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
      return [`| ${columns.map(md).join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${columns.map((c) => md(r[c])).join(' | ')} |`)].join('\n')
    }
    case 'json': return JSON.stringify(rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null]))), (_k, x) => (typeof x === 'bigint' ? x.toString() : x), 2)
    case 'insert': {
      const cols = columns.map((c) => quote(engine, c)).join(', ')
      return rows.map((r) => `INSERT INTO ${quote(engine, table)} (${cols}) VALUES (${columns.map((c) => sqlLiteral(r[c])).join(', ')});`).join('\n')
    }
    case 'in-list': {
      const c = columns[0]
      const vals = [...new Set(rows.map((r) => r[c]).filter((v) => v !== null && v !== undefined))]
      return `(${vals.map((v) => (typeof v === 'number' ? String(v) : sqlLiteral(v))).join(', ')})`
    }
  }
}

/** Sum, average, min, max and count of the numbers in one column */
export function stats(values: unknown[]) {
  const nums = values.map((v) => (typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN)).filter((n) => Number.isFinite(n))
  if (!nums.length) return null
  const sum = nums.reduce((a, b) => a + b, 0)
  return { count: nums.length, sum, avg: sum / nums.length, min: Math.min(...nums), max: Math.max(...nums) }
}

export const fmtNum = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 4 }))
