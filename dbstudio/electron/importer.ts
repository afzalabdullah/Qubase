import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import type { ImportData } from '../shared/types'

/** Read a CSV / TSV, Excel (first sheet) or JSON array file into columns and rows. */
export async function readImportFile(file: string): Promise<ImportData> {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.xlsx') return readExcel(file)
  const text = (await fs.readFile(file, 'utf8')).replace(/^﻿/, '')
  if (ext === '.json') return readJson(text)
  return readCsv(text)
}

function readJson(text: string): ImportData {
  const data = JSON.parse(text)
  const list: unknown[] = Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : [data]
  const rows = list.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r))
  const columns: string[] = []
  const seen = new Set<string>()
  for (const r of rows.slice(0, 1000)) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); columns.push(k) }
  // Nested objects are stored as JSON text
  return { columns, rows: rows.map((r) => Object.fromEntries(columns.map((c) => [c, typeof r[c] === 'object' && r[c] !== null ? JSON.stringify(r[c]) : r[c] ?? null]))) }
}

/** CSV with quotes, embedded newlines and an auto-detected separator (, ; tab |). */
function readCsv(text: string): ImportData {
  const firstLine = text.slice(0, text.indexOf('\n') >= 0 ? text.indexOf('\n') : text.length)
  const sep = [',', ';', '\t', '|'].map((s) => [s, firstLine.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0]
  const records: string[][] = []
  let field = '', row: string[] = [], quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === sep) { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') records.push(row)
      row = []
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); records.push(row) }
  if (!records.length) return { columns: [], rows: [] }
  const columns = uniqueNames(records[0].map((c) => c.trim()))
  const rows = records.slice(1).map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] === undefined || r[i] === '' ? null : r[i]])))
  return { columns, rows }
}

async function readExcel(file: string): Promise<ImportData> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const ws = wb.worksheets[0]
  if (!ws) return { columns: [], rows: [] }
  const cell = (v: ExcelJS.CellValue): unknown => {
    if (v === null || v === undefined) return null
    if (v instanceof Date) return v.toISOString()
    if (typeof v === 'object') {
      if ('result' in v) return cell(v.result as ExcelJS.CellValue) // formula
      if ('text' in v) return v.text // hyperlink
      if ('richText' in v) return v.richText.map((t) => t.text).join('')
      return JSON.stringify(v)
    }
    return v
  }
  const header: string[] = []
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { header[i - 1] = String(cell(c.value) ?? `Column ${i}`).trim() })
  const columns = uniqueNames(header.map((h, i) => h || `Column ${i + 1}`))
  const rows: Record<string, unknown>[] = []
  ws.eachRow({ includeEmpty: false }, (r, n) => {
    if (n === 1) return
    rows.push(Object.fromEntries(columns.map((c, i) => [c, cell(r.getCell(i + 1).value)])))
  })
  return { columns, rows }
}

function uniqueNames(names: string[]) {
  const seen = new Map<string, number>()
  return names.map((n) => {
    const k = n || 'column'
    const c = seen.get(k) ?? 0
    seen.set(k, c + 1)
    return c ? `${k}_${c + 1}` : k
  })
}
