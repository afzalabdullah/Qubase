/** Strip Electron's IPC prefix (and the error-line marker) from error messages. */
export function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').replace(/\u0001\d+$/, '')
}

/** Script line the database reported for the error (1-based), if any. */
export function errLine(e: unknown): number | undefined {
  const m = /\u0001(\d+)$/.exec(e instanceof Error ? e.message : String(e))
  return m ? Number(m[1]) : undefined
}

/** Turn any cell value into display text. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'bigint') return v.toString()
  if (v instanceof Date) return v.toISOString().replace('T', ' ').replace('Z', '')
  if (v instanceof Uint8Array) return '0x' + Array.from(v.slice(0, 32), (b) => b.toString(16).padStart(2, '0')).join('') + (v.length > 32 ? '…' : '')
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))
    } catch {
      return String(v)
    }
  }
  return String(v)
}
