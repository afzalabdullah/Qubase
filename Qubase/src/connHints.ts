import type { ConnectionConfig } from '../shared/types'
import { driverFor } from '../shared/drivers'

/** A plain-language hint for a failed connection, or '' when the error is not recognised. */
export function connectionHint(message: string, cfg: ConnectionConfig): string {
  const m = message.toLowerCase()
  const d = driverFor(cfg.kind)
  const where = `${cfg.host ?? 'the host'}:${cfg.port ?? d.defaultPort ?? ''}`
  const viaSsh = cfg.ssh?.enabled
  if (/ssh|handshake|all configured authentication methods failed/.test(m) && viaSsh)
    return 'The SSH server refused the sign-in. Check the SSH user, password or private key and passphrase.'
  if (/econnrefused|connection refused|actively refused/.test(m))
    return `Nothing answered at ${where}. Is the ${d.label} server running, and is it listening on port ${cfg.port ?? d.defaultPort}?${viaSsh ? ' With SSH, the host is the database as seen from the SSH server (often localhost).' : ' If it is on another network, try an SSH tunnel (Advanced).'}`
  if (/enotfound|getaddrinfo|eai_again|name or service not known/.test(m))
    return `The host name "${cfg.host}" could not be found. Check for typos, or whether you need a VPN.`
  if (/etimedout|timed? ?out|ehostunreach|enetunreach/.test(m))
    return `No reply from ${where}. A firewall may be blocking the port, the server may only allow some IP addresses, or you may need a VPN or SSH tunnel.`
  if (/password authentication failed|access denied|login failed|invalid username|authentication failed|ora-01017|wrongpass|auth/.test(m))
    return 'The server refused the user name or password. Check both, and that this user may connect from your machine.'
  if (/does not exist|unknown database|cannot open database|ora-12514|no such database/.test(m))
    return `The ${d.databaseLabel?.toLowerCase() ?? 'database'} "${cfg.database}" was not found. Leave it empty to use the default, or check the spelling.`
  if (/ssl|tls|certificate|self[- ]signed|no pg_hba\.conf entry.*no encryption|requires secure/.test(m))
    return cfg.ssl
      ? 'The secure connection failed. Try "Trust server certificate" (SQL Server) or add the CA certificate under Advanced → SSL certificates.'
      : 'The server needs an encrypted connection. Tick "Enable SSL / TLS" and try again.'
  if (/pg_hba\.conf/.test(m))
    return 'The PostgreSQL server does not allow connections from your machine for this user. An admin has to add it to pg_hba.conf.'
  if (/econnreset|socket hang up|closed the connection/.test(m))
    return 'The server closed the connection. This often means the wrong port (e.g. a different database type) or that SSL / TLS must be turned on.'
  if (/sqlite_cantopen|unable to open database file|enoent/.test(m))
    return 'The database file could not be opened. Check that the path is right and that the folder exists.'
  return ''
}
