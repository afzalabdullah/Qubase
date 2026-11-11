// Catalog of every database the app can connect to.
// Several databases speak another's wire protocol, so they reuse its adapter ("engine").

export type Engine = 'postgres' | 'mysql' | 'sqlite' | 'mssql' | 'oracle' | 'clickhouse' | 'duckdb' | 'libsql' | 'mongodb' | 'redis'
  | 'snowflake' | 'bigquery' | 'cassandra' | 'dynamodb' | 'trino'

export type DbKind =
  | 'postgres' | 'cockroach' | 'redshift' | 'timescale' | 'yugabyte'
  | 'mysql' | 'mariadb' | 'tidb'
  | 'mssql' | 'azuresql'
  | 'oracle'
  | 'sqlite' | 'libsql' | 'duckdb'
  | 'clickhouse'
  | 'mongodb' | 'redis'
  | 'snowflake' | 'bigquery' | 'cassandra' | 'dynamodb' | 'trino'

/** SQL databases use the SQL editor; others get their own query language */
export function queryLanguage(kind: DbKind): 'sql' | 'mongo' | 'redis' {
  const e = driverFor(kind).engine
  return e === 'mongodb' ? 'mongo' : e === 'redis' ? 'redis' : 'sql'
}

/** cloud: signs in with an account or keys instead of host and port */
export type ConnectionMode = 'server' | 'file' | 'url' | 'cloud'

export interface DriverInfo {
  kind: DbKind
  label: string
  engine: Engine
  mode: ConnectionMode
  /** Badge colour and 2-letter abbreviation used as the logo */
  color: string
  abbr: string
  defaultPort?: number
  defaultUser?: string
  defaultDatabase?: string
  defaultSsl?: boolean
  databaseLabel?: string
}

export const DRIVERS: DriverInfo[] = [
  { kind: 'postgres', label: 'PostgreSQL', engine: 'postgres', mode: 'server', color: '#336791', abbr: 'Pg', defaultPort: 5432, defaultUser: 'postgres', defaultDatabase: 'postgres' },
  { kind: 'mysql', label: 'MySQL', engine: 'mysql', mode: 'server', color: '#00758f', abbr: 'My', defaultPort: 3306, defaultUser: 'root' },
  { kind: 'mariadb', label: 'MariaDB', engine: 'mysql', mode: 'server', color: '#c0765a', abbr: 'Ma', defaultPort: 3306, defaultUser: 'root' },
  { kind: 'mssql', label: 'SQL Server', engine: 'mssql', mode: 'server', color: '#cc2927', abbr: 'Ms', defaultPort: 1433, defaultUser: 'sa' },
  { kind: 'azuresql', label: 'Azure SQL', engine: 'mssql', mode: 'server', color: '#0078d4', abbr: 'Az', defaultPort: 1433, defaultSsl: true },
  { kind: 'oracle', label: 'Oracle', engine: 'oracle', mode: 'server', color: '#f80000', abbr: 'Or', defaultPort: 1521, defaultDatabase: 'FREEPDB1', databaseLabel: 'Service name' },
  { kind: 'sqlite', label: 'SQLite', engine: 'sqlite', mode: 'file', color: '#0f80cc', abbr: 'Sq' },
  { kind: 'duckdb', label: 'DuckDB', engine: 'duckdb', mode: 'file', color: '#d8b500', abbr: 'Dk' },
  { kind: 'libsql', label: 'LibSQL / Turso', engine: 'libsql', mode: 'url', color: '#4ff8d2', abbr: 'Ls' },
  { kind: 'clickhouse', label: 'ClickHouse', engine: 'clickhouse', mode: 'server', color: '#faff69', abbr: 'Ch', defaultPort: 8123, defaultUser: 'default', defaultDatabase: 'default' },
  { kind: 'mongodb', label: 'MongoDB', engine: 'mongodb', mode: 'server', color: '#13aa52', abbr: 'Mg', defaultPort: 27017, databaseLabel: 'Database' },
  { kind: 'redis', label: 'Redis', engine: 'redis', mode: 'server', color: '#dc382d', abbr: 'Rd', defaultPort: 6379, defaultDatabase: '0', databaseLabel: 'Database index' },
  { kind: 'cockroach', label: 'CockroachDB', engine: 'postgres', mode: 'server', color: '#6933ff', abbr: 'Cr', defaultPort: 26257, defaultUser: 'root', defaultDatabase: 'defaultdb' },
  { kind: 'redshift', label: 'Redshift', engine: 'postgres', mode: 'server', color: '#8c4fff', abbr: 'Rs', defaultPort: 5439, defaultDatabase: 'dev', defaultSsl: true },
  { kind: 'timescale', label: 'TimescaleDB', engine: 'postgres', mode: 'server', color: '#fdb515', abbr: 'Ts', defaultPort: 5432, defaultUser: 'postgres', defaultDatabase: 'postgres' },
  { kind: 'yugabyte', label: 'YugabyteDB', engine: 'postgres', mode: 'server', color: '#ff6e42', abbr: 'Yb', defaultPort: 5433, defaultUser: 'yugabyte', defaultDatabase: 'yugabyte' },
  { kind: 'tidb', label: 'TiDB', engine: 'mysql', mode: 'server', color: '#e30c34', abbr: 'Ti', defaultPort: 4000, defaultUser: 'root' },
  { kind: 'snowflake', label: 'Snowflake', engine: 'snowflake', mode: 'cloud', color: '#29b5e8', abbr: 'Sf', databaseLabel: 'Database' },
  { kind: 'bigquery', label: 'BigQuery', engine: 'bigquery', mode: 'cloud', color: '#669df6', abbr: 'Bq', databaseLabel: 'Default dataset' },
  { kind: 'cassandra', label: 'Cassandra', engine: 'cassandra', mode: 'server', color: '#1287b1', abbr: 'Ca', defaultPort: 9042, databaseLabel: 'Keyspace' },
  { kind: 'dynamodb', label: 'DynamoDB', engine: 'dynamodb', mode: 'cloud', color: '#4053d6', abbr: 'Dy' },
  { kind: 'trino', label: 'Trino / Presto', engine: 'trino', mode: 'server', color: '#dd00a1', abbr: 'Tr', defaultPort: 8080, defaultUser: 'trino', databaseLabel: 'Catalog' }
]

export function driverFor(kind: DbKind): DriverInfo {
  const d = DRIVERS.find((x) => x.kind === kind)
  if (!d) throw new Error(`Unknown database type: ${kind}`)
  return d
}
