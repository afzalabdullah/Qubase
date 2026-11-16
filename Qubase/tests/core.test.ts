import { describe, expect, it, beforeEach } from 'vitest'
import { splitStatements } from '../electron/db/split'
import { readOnlyCode } from '../src/readOnly'
import { maskCell, setMasking } from '../src/mask'
import { findShapes } from '../src/components/MapView'
import { migrationTool } from '../src/components/Migrations'
import { quote, tableRef, sqlLiteral } from '../shared/ddl'
import type { QueryResult } from '../shared/types'

describe('splitStatements', () => {
  it('splits on semicolons', () => {
    expect(splitStatements('SELECT 1; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2'])
  })
  it('keeps semicolons inside strings, identifiers and comments', () => {
    expect(splitStatements(`SELECT 'a;b'; SELECT "x;y" FROM t -- c;d\n; SELECT /* e;f */ 3`))
      .toEqual([`SELECT 'a;b'`, `SELECT "x;y" FROM t -- c;d`, 'SELECT /* e;f */ 3'])
  })
  it('handles doubled quotes', () => {
    expect(splitStatements(`SELECT 'it''s; fine'; SELECT 2`)).toEqual([`SELECT 'it''s; fine'`, 'SELECT 2'])
  })
  it('drops empty and comment-only pieces', () => {
    expect(splitStatements(';;\n-- only a comment\n; SELECT 1')).toEqual(['SELECT 1'])
  })
})

describe('readOnlyCode (AI Explore mode)', () => {
  it.each([
    'SELECT * FROM users',
    'with x as (select 1) select * from x',
    'EXPLAIN SELECT 1',
    'SELECT 1;',
    "SELECT 'drop table x' AS note",
    'db.users.find({ age: { $gt: 30 } })',
    'db.orders.aggregate([{ $group: { _id: "$city" } }])'
  ])('allows %s', (q) => expect(readOnlyCode(q)).toBe(true))

  it.each([
    'DELETE FROM users',
    'UPDATE users SET a = 1',
    'SELECT 1; DROP TABLE users',
    'WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d',
    'SELECT * INTO backup FROM users; ',
    'PRAGMA journal_mode = WAL',
    'db.users.deleteMany({})',
    'db.users.aggregate([{ $out: "copy" }])',
    'CALL do_things()',
    ''
  ])('blocks %s', (q) => expect(readOnlyCode(q)).toBe(false))
})

describe('maskCell', () => {
  beforeEach(() => setMasking(true))
  it('does nothing when masking is off', () => {
    setMasking(false)
    expect(maskCell('email', 'a@b.com')).toBe('a@b.com')
  })
  it('masks emails by value', () => expect(maskCell('contact', 'nora.khan@example.com')).toBe('n•••@example.com'))
  it('masks card-like numbers by value, keeping the last 4', () => expect(maskCell('x', '4111 1111 1111 1234')).toBe('•••• 1234'))
  it('masks sensitive column names', () => expect(maskCell('phone', '+92 300 1234567')).toBe('•••• 4567'))
  it('leaves ordinary values and NULL alone', () => {
    expect(maskCell('city', 'Lahore')).toBe('Lahore')
    expect(maskCell('email', 'NULL')).toBe('NULL')
  })
})

const result = (columns: string[], rows: Record<string, unknown>[]): QueryResult => ({ columns, rows, rowCount: rows.length, durationMs: 0 })
const all = (r: QueryResult) => r.rows.map((_, i) => i)

describe('findShapes (Map view)', () => {
  it('reads lat / lng columns', () => {
    const r = result(['city', 'lat', 'lng'], [{ city: 'Lahore', lat: 31.5, lng: 74.3 }])
    expect(findShapes(r, all(r))).toEqual([{ kind: 'point', coords: [[74.3, 31.5]], row: 0 }])
  })
  it('reads WKT points, lines and polygons', () => {
    const r = result(['g'], [{ g: 'POINT (1 2)' }, { g: 'LINESTRING (0 0, 1 1, 2 0)' }, { g: 'SRID=4326;POLYGON ((0 0, 1 0, 1 1, 0 0))' }])
    expect(findShapes(r, all(r)).map((s) => [s.kind, s.coords.length])).toEqual([['point', 1], ['line', 3], ['poly', 4]])
  })
  it('reads GeoJSON text and objects', () => {
    const r = result(['g'], [
      { g: JSON.stringify({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }) },
      { g: { type: 'Feature', geometry: { type: 'Point', coordinates: [5, 6] } } }
    ])
    expect(findShapes(r, all(r)).map((s) => s.kind)).toEqual(['poly', 'point'])
  })
  it('ignores ordinary text', () => {
    const r = result(['name'], [{ name: 'Point of sale' }, { name: 'hello world' }])
    expect(findShapes(r, all(r))).toEqual([])
  })
})

describe('migrationTool', () => {
  it.each([
    ['flyway_schema_history', 'Flyway'], ['_prisma_migrations', 'Prisma'], ['schema_migrations', 'Rails / Active Record'],
    ['alembic_version', 'Alembic (SQLAlchemy)'], ['__EFMigrationsHistory', 'Entity Framework'], ['DATABASECHANGELOG', 'Liquibase']
  ])('%s → %s', (t, tool) => expect(migrationTool(t)?.tool).toBe(tool))
  it('ignores other tables', () => expect(migrationTool('customers')).toBeUndefined())
})

describe('ddl helpers', () => {
  it('quotes identifiers per engine', () => {
    expect(quote('postgres', 'my"col')).toBe('"my""col"')
    expect(quote('mysql', 'a`b')).toBe('`a``b`')
    expect(quote('mssql', 'a]b')).toBe('[a]]b]')
  })
  it('builds table references', () => {
    expect(tableRef('postgres', { schema: 'public', name: 'users' })).toBe('"public"."users"')
    expect(tableRef('sqlite', { schema: 'main', name: 'users' })).toBe('"users"')
  })
  it('writes literals', () => {
    expect(sqlLiteral(null)).toBe('NULL')
    expect(sqlLiteral("O'Brien")).toBe("'O''Brien'")
    expect(sqlLiteral(42)).toBe('42')
  })
})
