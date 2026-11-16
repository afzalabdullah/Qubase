// Decides whether a statement can only read data (used by the AI Explore mode before running anything by itself).

/** Explore mode only runs statements that cannot change data */
const WRITES = /\b(insert|update|delete|merge|upsert|drop|alter|create|truncate|grant|revoke|rename|replace|call|exec|execute|copy|vacuum|attach|detach|set)\b|\.(insert|update|delete|drop|replace|bulkWrite|create)\w*\s*\(/i
export function readOnlyCode(code: string): boolean {
  const c = code.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').trim()
  if (!c || /;\s*\S/.test(c)) return false // one statement only
  if (/^db\.\w+\.(find|findOne|aggregate|countDocuments|count|distinct)\s*\(/i.test(c)) return !/\$(out|merge)\b/.test(c)
  const bare = c.replace(/'(?:[^']|'')*'|"[^"]*"/g, "''") // string contents can't change anything
  if (/^pragma\b/i.test(bare) && /=/.test(bare)) return false // PRAGMA x = y changes a setting
  if (/^(select|with)\b[\s\S]*\binto\s+(?!@)\w/i.test(bare)) return false // SELECT … INTO new_table (T-SQL INTO @var is fine)
  return /^(select|with|show|describe|desc|explain|pragma|values|table)\b/i.test(c) && !WRITES.test(bare)
}
