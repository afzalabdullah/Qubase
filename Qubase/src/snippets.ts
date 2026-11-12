// SQL snippets: type the trigger word, pick it from autocomplete, press Enter.
// ${name} marks a field; Tab jumps to the next one.
import { snippetCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'

export interface Snippet {
  id: string
  /** Word typed in the editor, e.g. "sel" */
  trigger: string
  description: string
  body: string
  /** Built-in snippets can be hidden but not edited */
  builtIn?: boolean
}

export const BUILT_IN_SNIPPETS: Snippet[] = [
  { id: 'b-sel', trigger: 'sel', description: 'SELECT * FROM table', body: 'SELECT *\nFROM ${table}\nWHERE ${condition};' },
  { id: 'b-selc', trigger: 'selc', description: 'SELECT COUNT(*)', body: 'SELECT COUNT(*) AS n\nFROM ${table};' },
  { id: 'b-selg', trigger: 'selg', description: 'SELECT … GROUP BY', body: 'SELECT ${column}, COUNT(*) AS n\nFROM ${table}\nGROUP BY ${column}\nORDER BY n DESC;' },
  { id: 'b-join', trigger: 'join', description: 'INNER JOIN … ON', body: 'INNER JOIN ${table} ${t2} ON ${t2}.${id} = ${t1}.${fk}' },
  { id: 'b-lj', trigger: 'lj', description: 'LEFT JOIN … ON', body: 'LEFT JOIN ${table} ${t2} ON ${t2}.${id} = ${t1}.${fk}' },
  { id: 'b-ins', trigger: 'ins', description: 'INSERT INTO … VALUES', body: 'INSERT INTO ${table} (${columns})\nVALUES (${values});' },
  { id: 'b-upd', trigger: 'upd', description: 'UPDATE … SET … WHERE', body: 'UPDATE ${table}\nSET ${column} = ${value}\nWHERE ${condition};' },
  { id: 'b-del', trigger: 'del', description: 'DELETE FROM … WHERE', body: 'DELETE FROM ${table}\nWHERE ${condition};' },
  { id: 'b-ct', trigger: 'ct', description: 'CREATE TABLE', body: 'CREATE TABLE ${name} (\n  id INT PRIMARY KEY,\n  ${column} ${type}\n);' },
  { id: 'b-ci', trigger: 'ci', description: 'CREATE INDEX', body: 'CREATE INDEX ${ix_name} ON ${table} (${columns});' },
  { id: 'b-cte', trigger: 'cte', description: 'WITH … AS (common table expression)', body: 'WITH ${name} AS (\n  SELECT ${columns}\n  FROM ${table}\n)\nSELECT *\nFROM ${name};' },
  { id: 'b-case', trigger: 'case', description: 'CASE WHEN … END', body: 'CASE\n  WHEN ${condition} THEN ${result}\n  ELSE ${other}\nEND' },
  { id: 'b-exists', trigger: 'exists', description: 'WHERE EXISTS (subquery)', body: 'WHERE EXISTS (\n  SELECT 1 FROM ${table} WHERE ${condition}\n)' },
  { id: 'b-tx', trigger: 'tx', description: 'Transaction block', body: 'BEGIN;\n\n${statements}\n\nCOMMIT;' },
  { id: 'b-dup', trigger: 'dups', description: 'Find duplicate values', body: 'SELECT ${column}, COUNT(*) AS n\nFROM ${table}\nGROUP BY ${column}\nHAVING COUNT(*) > 1;' }
].map((s) => ({ ...s, builtIn: true }))

const KEY = 'snippets'
const HIDDEN = 'snippets:hidden'

/** The user's own snippets */
export function readUserSnippets(): Snippet[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] }
}
export function writeUserSnippets(list: Snippet[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* storage unavailable */ }
}
export function readHiddenSnippets(): string[] {
  try { return JSON.parse(localStorage.getItem(HIDDEN) ?? '[]') } catch { return [] }
}
export function writeHiddenSnippets(ids: string[]) {
  try { localStorage.setItem(HIDDEN, JSON.stringify(ids)) } catch { /* storage unavailable */ }
}

/** Snippets that are switched on: the user's first, so they win over a built-in with the same trigger */
export function activeSnippets(): Snippet[] {
  const hidden = new Set(readHiddenSnippets())
  const user = readUserSnippets()
  const taken = new Set(user.map((s) => s.trigger.toLowerCase()))
  return [...user, ...BUILT_IN_SNIPPETS.filter((s) => !hidden.has(s.id) && !taken.has(s.trigger.toLowerCase()))]
}

/** Autocomplete source offering snippets whose trigger starts with the typed word */
export function snippetSource(ctx: CompletionContext): CompletionResult | null {
  const word = ctx.matchBefore(/\w+/)
  if (!word || (word.from === word.to && !ctx.explicit)) return null
  const typed = word.text.toLowerCase()
  const options: Completion[] = activeSnippets()
    .filter((s) => s.trigger.toLowerCase().startsWith(typed))
    .map((s) => snippetCompletion(s.body, { label: s.trigger, detail: s.description, type: 'text', boost: s.trigger.toLowerCase() === typed ? 20 : 8 }))
  return options.length ? { from: word.from, options, validFor: /^\w*$/ } : null
}
