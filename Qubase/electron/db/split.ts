/**
 * Split a script into statements on ";" outside quotes and comments.
 * Used by databases whose drivers run one statement per call.
 */
export function splitStatements(script: string): string[] {
  const out: string[] = []
  let start = 0, i = 0
  while (i < script.length) {
    const c = script[i]
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      // Doubled quotes ('it''s') stay inside the string
      while (j < script.length && !(script[j] === c && script[j + 1] !== c)) j += script[j] === c ? 2 : 1
      i = j + 1; continue
    }
    if (c === '-' && script[i + 1] === '-') { const e = script.indexOf('\n', i); i = e < 0 ? script.length : e; continue }
    if (c === '/' && script[i + 1] === '*') { const e = script.indexOf('*/', i + 2); i = e < 0 ? script.length : e + 2; continue }
    if (c === ';') { out.push(script.slice(start, i)); start = i + 1 }
    i++
  }
  out.push(script.slice(start))
  // Drop pieces that are only whitespace or comments
  return out.map((s) => s.trim()).filter((s) => s.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').trim())
}

/** Make driver values safe to send to the UI (big numbers, binary, special objects) */
export function plain(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString()
  if (v instanceof Date) return v
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return `0x${Buffer.from(v).toString('hex').slice(0, 2000)}`
  if (Array.isArray(v)) return v.map(plain)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown> & { toJSON?: () => unknown }
    // Wrapper types (BigQuery dates, Cassandra UUIDs and Longs, Big numbers) print themselves
    if (typeof o.value === 'string' && Object.keys(o).length === 1) return o.value
    const proto = Object.getPrototypeOf(o)
    if (proto && proto !== Object.prototype && typeof o.toString === 'function' && o.toString !== Object.prototype.toString) return o.toString()
    if (v instanceof Map) return Object.fromEntries([...v].map(([k, x]) => [String(k), plain(x)]))
    if (v instanceof Set) return [...v].map(plain)
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, plain(x)]))
  }
  return v
}
