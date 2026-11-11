import fs from 'node:fs/promises'
import ExcelJS from 'exceljs'

import type { ExportFormat } from '../shared/types'
export type { ExportFormat } from '../shared/types'

interface Data {
  columns: string[]
  rows: Record<string, unknown>[]
}

/** Text form of a cell for CSV (and Excel cells that aren't numbers/dates/booleans). */
function text(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'bigint') return v.toString()
  if (v instanceof Uint8Array) return '0x' + Buffer.from(v).toString('hex')
  if (typeof v === 'object') return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))
  return String(v)
}

function csvField(s: string): string {
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** SQL literal for INSERT scripts */
function sqlValue(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number' || typeof v === 'bigint') return String(v)
  if (typeof v === 'boolean') return v ? '1' : '0'
  return `'${text(v).replace(/'/g, "''")}'`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Quote a name the way the target database expects */
function ident(name: string, engine?: string) {
  if (engine === 'mysql' || engine === 'clickhouse') return '`' + name.replace(/`/g, '``') + '`'
  if (engine === 'mssql') return `[${name.replace(/]/g, ']]')}]`
  return `"${name.replace(/"/g, '""')}"`
}

export async function exportRows(data: Data, format: ExportFormat, file: string, table = 'my_table', engine?: string) {
  if (format === 'sql') {
    const cols = data.columns.map((c) => ident(c, engine)).join(', ')
    const lines = data.rows.map((r) => `INSERT INTO ${ident(table, engine)} (${cols}) VALUES (${data.columns.map((c) => sqlValue(r[c])).join(', ')});`)
    await fs.writeFile(file, lines.join('\n') + '\n', 'utf8')
    return
  }

  if (format === 'markdown') {
    const cellMd = (v: unknown) => (v === null || v === undefined ? 'NULL' : text(v)).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
    const lines = [
      `| ${data.columns.map(cellMd).join(' | ')} |`,
      `| ${data.columns.map(() => '---').join(' | ')} |`,
      ...data.rows.map((r) => `| ${data.columns.map((c) => cellMd(r[c])).join(' | ')} |`)
    ]
    await fs.writeFile(file, lines.join('\n') + '\n', 'utf8')
    return
  }

  if (format === 'html') {
    const head = data.columns.map((c) => `<th>${esc(c)}</th>`).join('')
    const body = data.rows.map((r) => `<tr>${data.columns.map((c) => (r[c] === null || r[c] === undefined ? '<td class="null">NULL</td>' : `<td>${esc(text(r[c]))}</td>`)).join('')}</tr>`).join('\n')
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(table)}</title>
<style>body{font:13px system-ui,sans-serif;margin:16px}table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px 8px;text-align:left;vertical-align:top}th{background:#f3f3f3;position:sticky;top:0}.null{color:#999;font-style:italic}</style>
</head><body><table><thead><tr>${head}</tr></thead><tbody>
${body}
</tbody></table></body></html>`
    await fs.writeFile(file, html, 'utf8')
    return
  }

  if (format === 'csv') {
    const lines = [data.columns.map(csvField).join(',')]
    for (const row of data.rows) lines.push(data.columns.map((c) => csvField(text(row[c]))).join(','))
    // BOM so Excel opens UTF-8 (Urdu, Arabic, emoji…) correctly
    await fs.writeFile(file, '﻿' + lines.join('\r\n'), 'utf8')
    return
  }

  if (format === 'json') {
    const out = data.rows.map((row) => Object.fromEntries(data.columns.map((c) => [c, row[c] ?? null])))
    await fs.writeFile(file, JSON.stringify(out, (_k, x) => (typeof x === 'bigint' ? x.toString() : x instanceof Uint8Array ? text(x) : x), 2), 'utf8')
    return
  }

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Qubase'
  const ws = wb.addWorksheet('Results', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = data.columns.map((c) => ({ header: c, key: c }))
  for (const row of data.rows) {
    ws.addRow(data.columns.map((c) => {
      const v = row[c]
      if (v === null || v === undefined) return null
      if (typeof v === 'number' || typeof v === 'boolean' || v instanceof Date) return v
      return text(v)
    }))
  }
  const header = ws.getRow(1)
  header.font = { bold: true }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5B80B' } }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, data.columns.length) } }
  // Fit column widths to content (sampling the first 200 rows)
  ws.columns.forEach((col, i) => {
    const name = data.columns[i]
    const longest = Math.max(name.length, ...data.rows.slice(0, 200).map((r) => text(r[name]).length))
    col.width = Math.min(60, Math.max(8, longest + 2))
  })
  await wb.xlsx.writeFile(file)
}
