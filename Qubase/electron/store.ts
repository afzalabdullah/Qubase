import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { SavedConnection } from '../shared/types'

// Saved connections live in the user's app-data folder.
// Passwords and tokens are encrypted with the OS keychain (DPAPI on Windows).

const file = () => path.join(app.getPath('userData'), 'connections.json')
const SECRET_KEYS = ['password', 'authToken'] as const

function encrypt(v: string) {
  return safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(v).toString('base64') : v
}
function decrypt(v: string) {
  return v.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(v.slice(4), 'base64')) : v
}

function readRaw(): SavedConnection[] {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'))
  } catch {
    return []
  }
}

const SSH_SECRETS = ['password', 'passphrase'] as const

export function listSaved(): SavedConnection[] {
  return readRaw().map((c) => {
    const config = { ...c.config }
    for (const k of SECRET_KEYS) if (config[k]) config[k] = decrypt(config[k]!)
    if (config.ssh) {
      const ssh = { ...config.ssh }
      for (const k of SSH_SECRETS) if (ssh[k]) ssh[k] = decrypt(ssh[k]!)
      config.ssh = ssh
    }
    return { ...c, config }
  })
}

function write(list: SavedConnection[]) {
  const out = list.map((c) => {
    const config = { ...c.config }
    for (const k of SECRET_KEYS) if (config[k]) config[k] = encrypt(config[k]!)
    if (config.ssh) {
      const ssh = { ...config.ssh }
      for (const k of SSH_SECRETS) if (ssh[k]) ssh[k] = encrypt(ssh[k]!)
      config.ssh = ssh
    }
    return { ...c, config }
  })
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file(), JSON.stringify(out, null, 2))
}

export function saveConnection(conn: SavedConnection): SavedConnection[] {
  const list = listSaved()
  const i = list.findIndex((c) => c.id === conn.id)
  if (i >= 0) list[i] = conn
  else list.push(conn)
  write(list)
  return list
}

export function deleteSaved(id: string): SavedConnection[] {
  const list = listSaved().filter((c) => c.id !== id)
  write(list)
  return list
}
