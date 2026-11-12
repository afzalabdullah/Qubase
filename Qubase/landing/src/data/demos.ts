/** The hero window plays one demo per kind of database, so the page never reads as SQL-only. */
export type Demo = {
  db: string
  dot: string
  file: string
  tree: string
  items: string[]
  ask: string
  reply: string
  lines: [keyword: string, rest: string][]
  cols: string[]
  rows: string[][]
  meta: string
}

export const DEMOS: Demo[] = [
  {
    db: 'PostgreSQL', dot: 'bg-sky-400', file: 'sales.sql', tree: 'Tables', items: ['customers', 'orders', 'products'],
    ask: 'Total spend per city, biggest first', reply: 'Joined 2 tables using your foreign keys.',
    lines: [['SELECT', ' c.city, SUM(o.total) AS spend'], ['FROM', ' customers c'], ['JOIN', ' orders o ON o.customer_id = c.id'], ['GROUP BY', ' c.city'], ['ORDER BY', ' spend DESC;']],
    cols: ['city', 'spend'], rows: [['Lahore', '48,210'], ['Karachi', '41,875'], ['Islamabad', '29,430']], meta: '3 rows in 38 ms',
  },
  {
    db: 'MongoDB', dot: 'bg-emerald-400', file: 'users.js', tree: 'Collections', items: ['users', 'sessions', 'events'],
    ask: 'Active users per country this month', reply: 'Built an aggregation pipeline.',
    lines: [['db.users', '.aggregate(['], ['  { $match', ': { active: true } },'], ['  { $group', ': { _id: "$country", n: { $sum: 1 } } },'], ['  { $sort', ': { n: -1 } }'], ['])', '']],
    cols: ['_id', 'n'], rows: [['PK', '12,480'], ['AE', '6,215'], ['GB', '3,902']], meta: '3 documents in 21 ms',
  },
  {
    db: 'Redis', dot: 'bg-rose-400', file: 'cache.redis', tree: 'Keys', items: ['session:*', 'rate:*', 'leaderboard'],
    ask: 'Top 3 on the leaderboard', reply: 'One command, scores included.',
    lines: [['ZREVRANGE', ' leaderboard 0 2 WITHSCORES']],
    cols: ['member', 'score'], rows: [['ayesha', '9,840'], ['bilal', '9,120'], ['sara', '8,775']], meta: '3 members in 2 ms',
  },
]
