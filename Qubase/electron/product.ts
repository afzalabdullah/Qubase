// Product features: update check, offline licence keys and a shared team folder.
import { app } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { LicenceInfo, TeamData, UpdateInfo } from '../shared/types'

// ---------- Update check ----------
// Reads latest.yml (written by electron-builder) from the update URL and compares versions.
// It only tells the user; the download opens in their browser.

const newer = (a: string, b: string) => {
  const pa = a.split(/[.-]/).map((x) => Number(x) || 0), pb = b.split(/[.-]/).map((x) => Number(x) || 0)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  return false
}

export async function checkForUpdate(url: string): Promise<UpdateInfo> {
  const current = app.getVersion()
  if (!/^https:\/\//i.test(url)) throw new Error('The update address must start with https://')
  const base = url.replace(/\/+$/, '')
  const res = await fetch(`${base}/latest.yml`, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`The update server answered ${res.status}`)
  const yml = await res.text()
  const version = /^version:\s*['"]?([^'"\s]+)/m.exec(yml)?.[1]
  const file = /^path:\s*['"]?([^'"\n]+?)['"]?\s*$/m.exec(yml)?.[1]
  if (!version) throw new Error('latest.yml has no version')
  return { current, latest: version, available: newer(version, current), download: file ? `${base}/${encodeURI(file)}` : base }
}

// ---------- Licence keys ----------
// A key is base64url(JSON payload) + "." + base64url(Ed25519 signature).
// Only the public key is in the app; tools/licence/issue-licence.mjs signs new keys.

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAbA5FuBBhX4t6k1u1WVZ+ECiTXUn6SUVtySurBdDEQ4Q=
-----END PUBLIC KEY-----`

const licenceFile = () => path.join(app.getPath('userData'), 'licence.key')

export function verifyLicence(key: string): LicenceInfo {
  const [body, sig] = key.trim().split('.')
  if (!body || !sig) return { valid: false, error: 'This is not a Qubase licence key' }
  try {
    const ok = crypto.verify(null, Buffer.from(body, 'base64url'), PUBLIC_KEY, Buffer.from(sig, 'base64url'))
    if (!ok) return { valid: false, error: 'The licence key is not valid' }
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { name?: string; email?: string; plan?: string; seats?: number; expires?: string }
    if (p.expires && Date.parse(p.expires) < Date.now()) return { valid: false, error: `The licence expired on ${p.expires}`, ...p }
    return { valid: true, ...p }
  } catch {
    return { valid: false, error: 'The licence key is damaged' }
  }
}

export function getLicence(): LicenceInfo {
  try { return verifyLicence(fs.readFileSync(licenceFile(), 'utf8')) } catch { return { valid: false } }
}
export function setLicence(key: string): LicenceInfo {
  const info = verifyLicence(key)
  if (info.valid) fs.writeFileSync(licenceFile(), key.trim())
  return info
}
export function clearLicence() {
  try { fs.unlinkSync(licenceFile()) } catch { /* not there */ }
}

// ---------- Team folder ----------
// A shared folder (network drive, OneDrive, Dropbox…) with queries.json and connections.json.
// Connections are written without passwords.

function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

export function readTeam(folder: string): TeamData {
  if (!folder) return { queries: [], connections: [] }
  if (!fs.existsSync(folder)) throw new Error(`The team folder is not reachable: ${folder}`)
  return {
    queries: readJson(path.join(folder, 'queries.json'), []),
    connections: readJson(path.join(folder, 'connections.json'), [])
  }
}

/** Add or replace items (matched by name) in the team folder */
export function shareToTeam(folder: string, data: Partial<TeamData>): TeamData {
  if (!folder || !fs.existsSync(folder)) throw new Error('Choose a team folder in Settings first')
  const cur = readTeam(folder)
  const merge = <T extends { name: string }>(a: T[], b: T[] = []) => [...a.filter((x) => !b.some((y) => y.name.toLowerCase() === x.name.toLowerCase())), ...b]
  const clean = (data.connections ?? []).map((c) => {
    const config = { ...c.config, password: undefined, authToken: undefined }
    if (config.ssh) config.ssh = { ...config.ssh, password: undefined, passphrase: undefined }
    return { ...c, config }
  })
  const next: TeamData = { queries: merge(cur.queries, data.queries), connections: merge(cur.connections, clean) }
  if (data.queries) fs.writeFileSync(path.join(folder, 'queries.json'), JSON.stringify(next.queries, null, 2))
  if (data.connections) fs.writeFileSync(path.join(folder, 'connections.json'), JSON.stringify(next.connections, null, 2))
  return next
}
