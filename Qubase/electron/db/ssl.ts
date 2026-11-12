import fs from 'node:fs'
import type { ConnectionConfig } from '../../shared/types'

/**
 * TLS options for drivers that take Node's TLS settings (pg, mysql2).
 * With a CA file the server certificate is checked; without one it is accepted as-is.
 */
export function sslOptions(c: ConnectionConfig) {
  if (!c.ssl && !c.sslCa) return undefined
  const read = (p?: string) => (p ? fs.readFileSync(p, 'utf8') : undefined)
  return { rejectUnauthorized: !!c.sslCa, ca: read(c.sslCa), cert: read(c.sslCert), key: read(c.sslKey) }
}
