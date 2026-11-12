import type { ConnectionConfig } from '../../shared/types'
import { driverFor } from '../../shared/drivers'
import type { DbClient } from './base'

export type { DbClient } from './base'

/**
 * Pick the adapter for a database. Adapters are loaded lazily so a missing
 * or broken native driver only affects that one database type.
 */
export function createClient(config: ConnectionConfig): DbClient {
  switch (driverFor(config.kind).engine) {
    case 'postgres': return new (require('./postgres').PostgresClient)(config)
    case 'mysql': return new (require('./mysql').MysqlClient)(config)
    case 'sqlite': return new (require('./sqlite').SqliteClient)(config)
    case 'mssql': return new (require('./mssql').MssqlClient)(config)
    case 'oracle': return new (require('./oracle').OracleClient)(config)
    case 'clickhouse': return new (require('./clickhouse').ClickHouseClient)(config)
    case 'duckdb': return new (require('./duckdb').DuckDbClient)(config)
    case 'libsql': return new (require('./libsql').LibsqlClient)(config)
    case 'mongodb': return new (require('./mongodb').MongoDbClient)(config)
    case 'redis': return new (require('./redis').RedisClient)(config)
    case 'snowflake': return new (require('./snowflake').SnowflakeClient)(config)
    case 'bigquery': return new (require('./bigquery').BigQueryClient)(config)
    case 'cassandra': return new (require('./cassandra').CassandraClient)(config)
    case 'dynamodb': return new (require('./dynamodb').DynamoDbClient)(config)
    case 'trino': return new (require('./trino').TrinoClient)(config)
  }
}
