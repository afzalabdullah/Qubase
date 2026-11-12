import fs from 'node:fs'
import net, { AddressInfo } from 'node:net'
import { Client } from 'ssh2'
import type { ConnectionConfig } from '../shared/types'

export interface Tunnel {
  /** The same config, pointed at the local end of the tunnel */
  config: ConnectionConfig
  close: () => void
}

/**
 * Open an SSH tunnel: a local port that forwards to the database host as seen
 * from the SSH server. The database driver then connects to 127.0.0.1:<port>.
 */
export async function openTunnel(config: ConnectionConfig): Promise<Tunnel> {
  const s = config.ssh!
  const ssh = new Client()
  await new Promise<void>((resolve, reject) => {
    ssh.once('ready', () => resolve())
    ssh.once('error', (e) => reject(new Error(`SSH: ${e.message}`)))
    ssh.connect({
      host: s.host,
      port: s.port || 22,
      username: s.user,
      password: s.password || undefined,
      privateKey: s.privateKeyPath ? fs.readFileSync(s.privateKeyPath) : undefined,
      passphrase: s.passphrase || undefined,
      readyTimeout: 15000,
      keepaliveInterval: 20000
    })
  })
  // Keep the app alive if the SSH link drops later; the next query reports the error.
  ssh.on('error', () => {})

  const dbHost = config.host || 'localhost'
  const dbPort = config.port || 0
  const server = net.createServer((sock) => {
    ssh.forwardOut('127.0.0.1', 0, dbHost, dbPort, (err, stream) => {
      if (err) { sock.destroy(); return }
      sock.pipe(stream).pipe(sock)
      stream.on('error', () => sock.destroy())
      sock.on('error', () => stream.end())
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as AddressInfo).port

  return {
    config: { ...config, host: '127.0.0.1', port, ssh: undefined },
    close: () => { server.close(); ssh.end() }
  }
}
