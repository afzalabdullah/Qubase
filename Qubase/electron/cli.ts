// Command-line runner: runs a query against a saved connection and writes the result to a file, without a window.
// Usable from Windows Task Scheduler, cron or CI:
//   Qubase.exe --run report.sql --conn "Shop (prod)" --out report.xlsx [--format xlsx] [--database shop] [--max-rows 0]
//   Qubase.exe --run "SELECT count(*) FROM orders" --conn local --out -        (prints CSV to the console)
//   Qubase.exe --list-connections
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createClient } from './db'
import { exportRows } from './export'
import { openTunnel } from './tunnel'
import { listSaved } from './store'
import { sampleDatabase } from './sample'
import type { ConnectionConfig, ExportFormat } from '../shared/types'

const FORMATS: Record<string, ExportFormat> = { xlsx: 'excel', excel: 'excel', csv: 'csv', json: 'json', sql: 'sql', md: 'markdown', markdown: 'markdown', html: 'html' }

const HELP = `Qubase command line

  --run <file.sql | "SQL">   Query to run (a file path or the SQL itself)
  --conn <name | id>         Saved connection to use (see --list-connections)
  --out <file | ->           Where to write the result; "-" prints CSV to the console
  --format <xlsx|csv|json|sql|markdown|html>   Defaults to the --out file's extension
  --database <name>          Use another database on the same server
  --max-rows <n>             Row limit (0 = all, the default)
  --list-connections         Print the saved connections
  --help                     This text

Exit code 0 on success, 1 on error.`

/** The command-line arguments meant for the runner, or null when the app should start normally */
export function cliArgs(argv: string[]): Record<string, string> | null {
  const i = argv.findIndex((a) => a === '--run' || a === '--list-connections' || a === '--help' || a === '--cli-help')
  if (i < 0) return null
  const out: Record<string, string> = {}
  for (let k = i; k < argv.length; k++) {
    const a = argv[k]
    if (!a.startsWith('--')) continue
    const next = argv[k + 1]
    if (next !== undefined && !next.startsWith('--')) { out[a.slice(2)] = next; k++ } else out[a.slice(2)] = 'true'
  }
  return out
}

const say = (s: string) => process.stdout.write(s + os.EOL)
const fail = (s: string) => process.stderr.write(`Error: ${s}${os.EOL}`)

export async function runCli(args: Record<string, string>): Promise<number> {
  if (args.help || args['cli-help']) { say(HELP); return 0 }
  const saved = listSaved()
  if (args['list-connections']) {
    for (const c of saved) say(`${c.name}\t${c.config.kind}\t${c.config.host ?? c.config.file ?? c.config.url ?? ''}\t${c.id}`)
    return 0
  }
  if (!args.run || args.run === 'true') { fail('--run needs a SQL file or a query'); say(HELP); return 1 }
  if (!args.conn) { fail('--conn needs a saved connection name or id (see --list-connections)'); return 1 }
  if (!args.out) { fail('--out needs a file name, or - to print to the console'); return 1 }

  const want = args.conn.toLowerCase()
  const conn = saved.find((c) => c.id === args.conn) ?? saved.find((c) => c.name.toLowerCase() === want)
  if (!conn) { fail(`No saved connection called "${args.conn}"`); return 1 }
  const sql = fs.existsSync(args.run) && fs.statSync(args.run).isFile() ? fs.readFileSync(args.run, 'utf8') : args.run
  const ext = args.out === '-' ? 'csv' : path.extname(args.out).slice(1).toLowerCase()
  const format = FORMATS[(args.format ?? ext).toLowerCase()]
  if (!format) { fail(`Unknown format "${args.format ?? ext}". Use xlsx, csv, json, sql, markdown or html.`); return 1 }
  const maxRows = Number(args['max-rows'] ?? 0) || 0

  let tunnel: Awaited<ReturnType<typeof openTunnel>> | undefined
  const t0 = Date.now()
  try {
    if (conn.config.file && path.basename(conn.config.file) === 'sample-shop.db') sampleDatabase() // brings the sample up to date
    let config: ConnectionConfig = { ...conn.config, database: args.database || conn.config.database }
    if (config.ssh?.enabled) { tunnel = await openTunnel(config); config = tunnel.config }
    const client = createClient(config)
    await client.connect()
    try {
      const results = client.queryMulti ? await client.queryMulti(sql, maxRows) : [await client.query(sql)]
      const r = [...results].reverse().find((x) => x.columns.length) ?? results[results.length - 1]
      if (!r?.columns.length) { process.stderr.write(`Done in ${Date.now() - t0} ms (no rows returned)${os.EOL}`); return 0 }
      if (args.out === '-') {
        const tmp = path.join(os.tmpdir(), `qubase-cli-${process.pid}.csv`)
        await exportRows({ columns: r.columns, rows: r.rows }, 'csv', tmp)
        process.stdout.write(fs.readFileSync(tmp, 'utf8'))
        fs.rmSync(tmp, { force: true })
      } else {
        const out = path.resolve(args.out)
        fs.mkdirSync(path.dirname(out), { recursive: true })
        await exportRows({ columns: r.columns, rows: r.rows }, format, out, path.basename(out, path.extname(out)).replace(/\W+/g, '_'), undefined)
        process.stderr.write(`Wrote ${r.rows.length} rows to ${out} in ${Date.now() - t0} ms${os.EOL}`)
      }
      return 0
    } finally { await client.disconnect().catch(() => {}) }
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e))
    return 1
  } finally { tunnel?.close() }
}
