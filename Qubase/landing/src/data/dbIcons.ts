import {
  siAmazondynamodb, siAmazonredshift, siApachecassandra, siClickhouse, siCockroachlabs, siDuckdb,
  siGooglebigquery, siMariadb, siMongodb, siMysql, siOracle, siPostgresql, siRedis, siSnowflake,
  siSqlite, siTimescale, siTrino, siTurso,
} from 'simple-icons'

/** Official brand marks from Simple Icons, or a lettered tile in the brand colour when the
 *  brand isn't in the set (Microsoft asked for its logos to be removed; YugabyteDB and TiDB were never added).
 *  Fallback colours and letters match shared/drivers.ts. */
export type DbIcon = { hex: string; path?: string; abbr?: string }

const si = (i: { hex: string; path: string }): DbIcon => ({ hex: `#${i.hex}`, path: i.path })

export const DB_ICONS: Record<string, DbIcon> = {
  PostgreSQL: si(siPostgresql),
  MySQL: si(siMysql),
  'SQL Server': { hex: '#cc2927', abbr: 'Ms' },
  Oracle: si(siOracle),
  SQLite: si(siSqlite),
  MariaDB: si(siMariadb),
  'Azure SQL': { hex: '#0078d4', abbr: 'Az' },
  CockroachDB: si(siCockroachlabs),
  YugabyteDB: { hex: '#ff6e42', abbr: 'Yb' },
  TiDB: { hex: '#e30c34', abbr: 'Ti' },
  TimescaleDB: si(siTimescale),
  'LibSQL / Turso': si(siTurso),
  MongoDB: si(siMongodb),
  Redis: si(siRedis),
  DynamoDB: si(siAmazondynamodb),
  Cassandra: si(siApachecassandra),
  Snowflake: si(siSnowflake),
  BigQuery: si(siGooglebigquery),
  Redshift: si(siAmazonredshift),
  ClickHouse: si(siClickhouse),
  DuckDB: si(siDuckdb),
  'Trino / Presto': si(siTrino),
}
