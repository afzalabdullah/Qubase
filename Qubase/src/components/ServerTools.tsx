import { useCallback, useEffect, useState } from 'react'
import type { QueryResult } from '../../shared/types'
import { ResultView } from './ResultView'
import { IconCopy, IconRefresh } from './Icons'
import { errMsg } from '../util'
import { allowRun } from '../safety'
import { useConn } from '../settings'

type Section = 'activity' | 'users' | 'jobs' | 'backup'

const ACTIVITY: Record<string, string> = {
  mssql: `SELECT s.session_id AS id, s.login_name AS [user], s.host_name AS host, DB_NAME(COALESCE(r.database_id, s.database_id)) AS [database],
  COALESCE(r.status, s.status) AS status, r.command, r.wait_type, r.total_elapsed_time / 1000 AS seconds, r.blocking_session_id AS blocked_by,
  SUBSTRING(t.text, 1, 4000) AS query
FROM sys.dm_exec_sessions s
LEFT JOIN sys.dm_exec_requests r ON r.session_id = s.session_id
OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t
WHERE s.is_user_process = 1
ORDER BY CASE WHEN r.session_id IS NULL THEN 1 ELSE 0 END, r.total_elapsed_time DESC`,
  postgres: `SELECT pid AS id, usename AS "user", client_addr::text AS host, datname AS database, state,
  wait_event_type || ':' || wait_event AS wait, EXTRACT(EPOCH FROM now() - query_start)::int AS seconds, query
FROM pg_stat_activity WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()
ORDER BY state, seconds DESC NULLS LAST`,
  mysql: 'SELECT ID AS id, USER AS user, HOST AS host, DB AS `database`, COMMAND AS command, TIME AS seconds, STATE AS state, INFO AS query FROM information_schema.PROCESSLIST WHERE ID <> CONNECTION_ID() ORDER BY TIME DESC',
  oracle: `SELECT sid || ',' || serial# AS id, username AS "user", machine AS host, status, sql_id, last_call_et AS seconds, program FROM v$session WHERE type = 'USER' ORDER BY status, last_call_et DESC`,
  clickhouse: 'SELECT query_id AS id, user, address AS host, round(elapsed) AS seconds, read_rows, formatReadableSize(memory_usage) AS memory, query FROM system.processes',
  snowflake: `SELECT query_id AS "id", user_name AS "user", warehouse_name AS "warehouse", execution_status AS "status",
  DATEDIFF('second', start_time, CURRENT_TIMESTAMP()) AS "seconds", query_text AS "query"
FROM TABLE(information_schema.query_history(RESULT_LIMIT => 200))
WHERE execution_status IN ('RUNNING', 'QUEUED', 'BLOCKED', 'RESUMING_WAREHOUSE') ORDER BY start_time`,
  trino: `SELECT query_id AS id, "user", source, state, date_diff('second', created, now()) AS seconds, query
FROM system.runtime.queries WHERE state NOT IN ('FINISHED', 'FAILED') ORDER BY created`
}

const KILL: Record<string, (id: string) => string> = {
  mssql: (id) => `KILL ${id}`,
  postgres: (id) => `SELECT pg_terminate_backend(${id})`,
  mysql: (id) => `KILL ${id}`,
  oracle: (id) => `ALTER SYSTEM KILL SESSION '${id}' IMMEDIATE`,
  clickhouse: (id) => `KILL QUERY WHERE query_id = '${id}'`,
  snowflake: (id) => `SELECT SYSTEM$CANCEL_QUERY('${id}')`,
  trino: (id) => `CALL system.runtime.kill_query(query_id => '${id}', message => 'Stopped from Qubase')`
}

const USERS: Record<string, string> = {
  mssql: `SELECT dp.name, dp.type_desc AS type, dp.default_schema_name AS default_schema, dp.create_date,
  STRING_AGG(r.name, ', ') AS roles
FROM sys.database_principals dp
LEFT JOIN sys.database_role_members m ON m.member_principal_id = dp.principal_id
LEFT JOIN sys.database_principals r ON r.principal_id = m.role_principal_id
WHERE dp.type IN ('S', 'U', 'G', 'E', 'X', 'R') AND dp.name NOT LIKE '##%'
GROUP BY dp.name, dp.type_desc, dp.default_schema_name, dp.create_date ORDER BY dp.type_desc, dp.name`,
  postgres: `SELECT r.rolname AS name, r.rolsuper AS superuser, r.rolcanlogin AS can_login, r.rolcreatedb AS create_db, r.rolcreaterole AS create_role,
  r.rolconnlimit AS conn_limit, r.rolvaliduntil AS valid_until,
  ARRAY(SELECT b.rolname FROM pg_auth_members m JOIN pg_roles b ON m.roleid = b.oid WHERE m.member = r.oid)::text AS member_of
FROM pg_roles r WHERE r.rolname NOT LIKE 'pg\\_%' ORDER BY 1`,
  mysql: 'SELECT User AS name, Host AS host, account_locked, password_expired, plugin FROM mysql.user ORDER BY 1, 2',
  oracle: 'SELECT username AS name, account_status, default_tablespace, created FROM dba_users ORDER BY 1',
  clickhouse: 'SELECT name, storage, auth_type, host_ip, default_roles_list FROM system.users ORDER BY name',
  snowflake: 'SHOW USERS',
  cassandra: 'SELECT role, can_login, is_superuser, member_of FROM system_auth.roles'
}
const USERS_FALLBACK: Record<string, string> = { oracle: 'SELECT username AS name, created FROM all_users ORDER BY 1' }

const JOBS = `SELECT j.name, CASE j.enabled WHEN 1 THEN 'Yes' ELSE 'No' END AS enabled, c.name AS category,
  CASE h.run_status WHEN 0 THEN 'Failed' WHEN 1 THEN 'Succeeded' WHEN 2 THEN 'Retry' WHEN 3 THEN 'Cancelled' WHEN 4 THEN 'Running' END AS last_outcome,
  msdb.dbo.agent_datetime(h.run_date, h.run_time) AS last_run,
  STUFF(STUFF(RIGHT('000000' + CAST(h.run_duration AS varchar(6)), 6), 3, 0, ':'), 6, 0, ':') AS last_duration,
  CASE WHEN a.start_execution_date IS NOT NULL AND a.stop_execution_date IS NULL THEN 'Running' ELSE '' END AS now
FROM msdb.dbo.sysjobs j
LEFT JOIN msdb.dbo.syscategories c ON c.category_id = j.category_id
OUTER APPLY (SELECT TOP 1 * FROM msdb.dbo.sysjobhistory x WHERE x.job_id = j.job_id AND x.step_id = 0 ORDER BY x.instance_id DESC) h
OUTER APPLY (SELECT TOP 1 * FROM msdb.dbo.sysjobactivity y WHERE y.job_id = j.job_id ORDER BY y.session_id DESC) a
ORDER BY j.name`

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')

/** Backup / restore script for the current database. SQL scripts can run in a query tab; the rest are command lines. */
function backupScript(engine: string, cfg: { host?: string; port?: number; user?: string; database?: string; file?: string }): { text: string; runnable: boolean } {
  const db = cfg.database || 'mydb'
  const host = cfg.host || 'localhost'
  const u = cfg.user ? ` -U ${cfg.user}` : ''
  switch (engine) {
    case 'mssql': return { runnable: true, text: `-- Full backup (the folder must exist on the SQL Server machine)
BACKUP DATABASE [${db}] TO DISK = N'C:\\Backups\\${db}_${stamp()}.bak'
  WITH COMPRESSION, CHECKSUM, STATS = 10;

-- Check the backup file can be read
RESTORE VERIFYONLY FROM DISK = N'C:\\Backups\\${db}_${stamp()}.bak';

-- Restore (uncomment; this replaces the database)
-- ALTER DATABASE [${db}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
-- RESTORE DATABASE [${db}] FROM DISK = N'C:\\Backups\\${db}_${stamp()}.bak' WITH REPLACE, STATS = 10;
-- ALTER DATABASE [${db}] SET MULTI_USER;` }
    case 'postgres': return { runnable: false, text: `# Run in a terminal (PostgreSQL client tools)
# Backup (custom format, compressed)
pg_dump -h ${host} -p ${cfg.port || 5432}${u} -Fc -f ${db}_${stamp()}.dump ${db}

# Restore into an existing, empty database
pg_restore -h ${host} -p ${cfg.port || 5432}${u} -d ${db} --clean --if-exists ${db}_${stamp()}.dump` }
    case 'mysql': return { runnable: false, text: `# Run in a terminal (MySQL client tools)
# Backup with routines, triggers and events, without locking InnoDB tables
mysqldump -h ${host} -P ${cfg.port || 3306} -u ${cfg.user || 'root'} -p --single-transaction --routines --triggers --events ${db} > ${db}_${stamp()}.sql

# Restore
mysql -h ${host} -P ${cfg.port || 3306} -u ${cfg.user || 'root'} -p ${db} < ${db}_${stamp()}.sql` }
    case 'sqlite': case 'libsql': return { runnable: true, text: `-- Consistent copy of the whole database file
VACUUM INTO '${(cfg.file || db).replace(/\.\w+$/, '')}_${stamp()}.db';` }
    case 'duckdb': return { runnable: true, text: `-- Export schema and data to a folder (Parquet files + load script)
EXPORT DATABASE '${db}_${stamp()}' (FORMAT PARQUET);

-- Restore into an empty database
-- IMPORT DATABASE '${db}_${stamp()}';` }
    case 'oracle': return { runnable: false, text: `# Run on the database server (Data Pump)
expdp ${cfg.user || 'system'}@${host}:${cfg.port || 1521}/${db} schemas=${cfg.user || 'APP'} directory=DATA_PUMP_DIR dumpfile=${db}_${stamp()}.dmp logfile=${db}_${stamp()}.log

# Restore
impdp ${cfg.user || 'system'}@${host}:${cfg.port || 1521}/${db} schemas=${cfg.user || 'APP'} directory=DATA_PUMP_DIR dumpfile=${db}_${stamp()}.dmp` }
    case 'mongodb': return { runnable: false, text: `# Run in a terminal (MongoDB Database Tools)
mongodump --uri "mongodb://${host}:${cfg.port || 27017}/${db}" --gzip --archive=${db}_${stamp()}.gz

# Restore
mongorestore --uri "mongodb://${host}:${cfg.port || 27017}" --gzip --archive=${db}_${stamp()}.gz` }
    case 'clickhouse': return { runnable: true, text: `-- Needs a backup disk configured on the server
BACKUP DATABASE ${db} TO Disk('backups', '${db}_${stamp()}.zip');

-- RESTORE DATABASE ${db} FROM Disk('backups', '${db}_${stamp()}.zip');` }
    case 'redis': return { runnable: true, text: `# Ask the server to write a snapshot (dump.rdb) in the background
BGSAVE` }
    case 'snowflake': return { runnable: true, text: `-- Snowflake keeps history automatically (Time Travel). A zero-copy clone is an instant backup:
CREATE DATABASE ${db}_backup_${stamp()} CLONE ${db};

-- Restore a dropped table or database within the retention period:
-- UNDROP TABLE my_table;
-- UNDROP DATABASE ${db};` }
    case 'bigquery': return { runnable: false, text: `# Copy a dataset with the bq command-line tool (Google Cloud SDK)
bq mk --dataset ${db}_backup
bq cp -r ${db}.my_table ${db}_backup.my_table

# Or export a table to Cloud Storage
bq extract --destination_format=AVRO ${db}.my_table gs://my-bucket/backup/my_table-*.avro

-- Tables can be read as they were up to 7 days ago:
-- SELECT * FROM ${db}.my_table FOR SYSTEM_TIME AS OF TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY);` }
    case 'cassandra': return { runnable: false, text: `# Run on each node (nodetool comes with Cassandra)
nodetool snapshot -t qubase_${stamp()} ${db}

# Snapshots are written under data/${db}/<table>/snapshots/. To restore, copy them back and run:
nodetool refresh ${db} <table>` }
    case 'dynamodb': return { runnable: false, text: `# On-demand backup with the AWS CLI
aws dynamodb create-backup --table-name MyTable --backup-name MyTable-${stamp()}

# Restore into a new table
aws dynamodb restore-table-from-backup --target-table-name MyTable-restored --backup-arn <arn from list-backups>

# Turn on point-in-time recovery (keeps 35 days)
aws dynamodb update-continuous-backups --table-name MyTable --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true` }
    default: return { runnable: false, text: 'No backup script for this database.' }
  }
}

/** Server tools: who is connected, users and roles, SQL Agent jobs, backup scripts. */
export function ServerTools({ onOpenQuery, onStatus, initial = 'activity' }: { onOpenQuery: (title: string, text: string) => void; onStatus: (s: string) => void; initial?: Section }) {
  const { conn, connId, engine } = useConn()
  const [section, setSection] = useState<Section>(initial)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [auto, setAuto] = useState(false)
  const [row, setRow] = useState<number | null>(null)
  const [nonce, setNonce] = useState(0)

  const sql = section === 'activity' ? ACTIVITY[engine] : section === 'users' ? USERS[engine] : section === 'jobs' ? (engine === 'mssql' ? JOBS : '') : ''

  const load = useCallback(async () => {
    if (!sql) { setResult(null); return }
    setLoading(true); setError('')
    try {
      const r = await window.db.query(connId, sql).catch((e) => {
        const fb = section === 'users' ? USERS_FALLBACK[engine] : undefined
        if (fb) return window.db.query(connId, fb)
        throw e
      })
      setResult(r); setNonce((n) => n + 1)
    } catch (e) { setError(errMsg(e)); setResult(null) } finally { setLoading(false) }
  }, [sql, connId, section, engine])

  useEffect(() => { setRow(null); load() }, [load])
  useEffect(() => {
    if (!auto || section !== 'activity') return
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [auto, section, load])

  const selected = result && row !== null ? result.rows[row] : null

  const kill = async () => {
    const id = String(selected?.id ?? '')
    if (!id || !/^[\w,.\-]+$/.test(id) || !KILL[engine]) return
    if (!allowRun(conn, { what: `end session ${id}` })) return
    if (!conn.production && !window.confirm(`End session ${id}? Its running query is stopped and open transactions are rolled back.`)) return
    try { await window.db.query(connId, KILL[engine](id)); onStatus(`Session ${id} ended`); load() } catch (e) { setError(errMsg(e)) }
  }

  const startJob = async () => {
    const name = String(selected?.name ?? '')
    if (!name) return
    if (!allowRun(conn, { what: `start SQL Agent job ${name}` })) return
    try { await window.db.query(connId, `EXEC msdb.dbo.sp_start_job @job_name = N'${name.replace(/'/g, "''")}'`); onStatus(`Job ${name} started`); setTimeout(load, 1500) } catch (e) { setError(errMsg(e)) }
  }

  const backup = backupScript(engine, conn.config)
  const sections: [Section, string][] = [['activity', 'Activity'], ['users', 'Users & roles'], ...(engine === 'mssql' ? [['jobs', 'SQL Agent jobs'] as [Section, string]] : []), ['backup', 'Backup & restore']]

  return (
    <div className="table-tab">
      <div className="subtabs">
        {sections.map(([k, label]) => <button key={k} className={section === k ? 'on' : ''} onClick={() => setSection(k)}>{label}</button>)}
      </div>
      {section === 'backup' ? (
        <div className="script-view">
          <div className="toolbar">
            <div className="crumb"><strong>{backup.runnable ? 'Backup script' : 'Backup commands'}</strong> <span className="muted">· {backup.runnable ? 'review the paths, then run it in a query tab' : 'run these in a terminal on a machine with the database tools'}</span></div>
            <div className="spacer" />
            <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(backup.text)}><IconCopy width={13} height={13} /> Copy</button>
            {backup.runnable && <button className="btn btn-sm btn-primary" onClick={() => onOpenQuery('Backup', backup.text)}>Open in editor</button>}
          </div>
          <pre className="plan-raw">{backup.text}</pre>
        </div>
      ) : (
        <div className="table-data">
          <div className="toolbar">
            <div className="crumb"><strong>{sections.find((s) => s[0] === section)?.[1]}</strong></div>
            {section === 'activity' && KILL[engine] && <button className="btn btn-sm" disabled={!selected} onClick={kill} title="End the selected session">End session</button>}
            {section === 'jobs' && <button className="btn btn-sm" disabled={!selected} onClick={startJob}>Start job</button>}
            <div className="spacer" />
            {section === 'activity' && <label className="check small-text"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Refresh every 5 s</label>}
            <button className={`icon-btn ${loading ? 'spin' : ''}`} title="Refresh" onClick={load}><IconRefresh /></button>
          </div>
          {error && <div className="notice error">{error}</div>}
          {!sql && <div className="placeholder">Not available for this database.</div>}
          <div className="results-pane">
            {result && <ResultView result={result} resetKey={nonce} name={section} onStatus={onStatus} onSelectionChange={(r) => setRow(r)} />}
          </div>
        </div>
      )}
    </div>
  )
}
