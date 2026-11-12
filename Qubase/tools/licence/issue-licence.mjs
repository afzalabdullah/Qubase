// Issue a Qubase licence key. Keep keys/private.pem secret and out of any repo.
//
//   node tools/licence/issue-licence.mjs --name "Ada Lovelace" --email ada@example.com --plan pro --seats 1 --expires 2027-12-31
//   node tools/licence/issue-licence.mjs --new-keys     (makes a new key pair; then paste the public key into electron/product.ts)
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'keys')
const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map((a) => {
  const [k, ...v] = a.trim().split(' ')
  return [k, v.join(' ').replace(/^"|"$/g, '') || true]
}))

if (args['new-keys']) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }))
  console.log('New private key saved in tools/licence/keys/private.pem. Public key for electron/product.ts:\n')
  console.log(publicKey.export({ type: 'spki', format: 'pem' }))
  process.exit(0)
}

if (!args.name) { console.error('Give at least --name'); process.exit(1) }
const payload = { name: args.name, email: args.email || undefined, plan: args.plan || 'pro', seats: Number(args.seats) || 1, expires: args.expires || undefined, issued: new Date().toISOString().slice(0, 10) }
const key = fs.readFileSync(path.join(dir, 'private.pem'))
const body = Buffer.from(JSON.stringify(payload))
const sig = crypto.sign(null, body, key)
console.log(`${body.toString('base64url')}.${sig.toString('base64url')}`)
