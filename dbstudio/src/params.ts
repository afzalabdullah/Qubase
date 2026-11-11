// Query parameters: write :name (or {{name}}) in SQL and the app asks for the value on Run.
// Values are written into the SQL as literals: numbers as they are, other text quoted.

export interface ParamValue { value: string; raw: boolean }

/** Names used in the SQL, in order, skipping strings, comments, "::" casts and "a:b" times */
export function findParams(sql: string): string[] {
  const out: string[] = []
  scan(sql, (name) => { if (!out.includes(name)) out.push(name) })
  return out
}

/** Calls `hit` for every parameter and returns the SQL with each one replaced by `value(name)` */
function scan(sql: string, hit: (name: string) => void, value?: (name: string) => string): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    // Skip quoted text, quoted names and comments
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c
      let j = i + 1
      while (j < sql.length && !(sql[j] === close && sql[j + 1] !== close)) j += sql[j] === close ? 2 : 1
      out += sql.slice(i, j + 1); i = j + 1; continue
    }
    if (c === '-' && sql[i + 1] === '-') { const e = sql.indexOf('\n', i); const end = e < 0 ? sql.length : e; out += sql.slice(i, end); i = end; continue }
    if (c === '/' && sql[i + 1] === '*') { const e = sql.indexOf('*/', i + 2); const end = e < 0 ? sql.length : e + 2; out += sql.slice(i, end); i = end; continue }
    // {{name}}
    if (c === '{' && sql[i + 1] === '{') {
      const m = /^\{\{\s*([A-Za-z_]\w*)\s*\}\}/.exec(sql.slice(i))
      if (m) { hit(m[1]); out += value ? value(m[1]) : m[0]; i += m[0].length; continue }
    }
    // :name, but not ::cast, a:b (e.g. 10:30) or := assignment
    if (c === ':' && sql[i + 1] !== ':' && sql[i - 1] !== ':' && !/[\w)\]]/.test(sql[i - 1] ?? '')) {
      const m = /^:([A-Za-z_]\w*)/.exec(sql.slice(i))
      if (m) { hit(m[1]); out += value ? value(m[1]) : m[0]; i += m[0].length; continue }
    }
    out += c; i++
  }
  return out
}

/** A typed value as an SQL literal */
function literal(p: ParamValue): string {
  const v = p.value
  if (p.raw) return v
  if (/^null$/i.test(v.trim())) return 'NULL'
  if (/^-?\d+(\.\d+)?$/.test(v.trim())) return v.trim()
  return `'${v.replace(/'/g, "''")}'`
}

export function fillParams(sql: string, values: Record<string, ParamValue>): string {
  return scan(sql, () => {}, (name) => literal(values[name] ?? { value: '', raw: false }))
}

const KEY = 'paramValues'
export function readParamValues(): Record<string, ParamValue> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} }
}
export function writeParamValues(v: Record<string, ParamValue>) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...readParamValues(), ...v })) } catch { /* ignore */ }
}
