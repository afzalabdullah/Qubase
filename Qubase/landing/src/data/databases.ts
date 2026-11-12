export const DB_GROUPS: { kind: string; note: string; items: string[] }[] = [
  {
    kind: 'Relational',
    note: 'Tables, joins and SQL.',
    items: ['PostgreSQL', 'MySQL', 'SQL Server', 'Oracle', 'SQLite', 'MariaDB', 'Azure SQL', 'CockroachDB', 'YugabyteDB', 'TiDB', 'TimescaleDB', 'LibSQL / Turso'],
  },
  {
    kind: 'Document and key-value',
    note: 'Collections, keys and pipelines.',
    items: ['MongoDB', 'Redis', 'DynamoDB', 'Cassandra'],
  },
  {
    kind: 'Warehouse and analytics',
    note: 'Big scans and reporting.',
    items: ['Snowflake', 'BigQuery', 'Redshift', 'ClickHouse', 'DuckDB', 'Trino / Presto'],
  },
]

/** Mirrors DRIVERS in ../../../shared/drivers.ts. Keep the two in step. */
export const ALL_DATABASES = DB_GROUPS.flatMap((g) => g.items)
export const DATABASE_COUNT = ALL_DATABASES.length
