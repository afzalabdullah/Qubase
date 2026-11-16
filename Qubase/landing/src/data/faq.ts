import { DATABASE_COUNT } from './databases'

export const FAQ: { q: string; a: string }[] = [
  { q: 'Which databases does it support?', a: `${DATABASE_COUNT} in total: relational ones like PostgreSQL, MySQL, SQL Server and Oracle, document and key-value stores like MongoDB and Redis, and warehouses like Snowflake and BigQuery, plus Supabase, Neon, PlanetScale, Elasticsearch and OpenSearch.` },
  { q: 'Do I have to pay for the AI?', a: 'No. Use a free model through Ollama, or add a key for Claude, ChatGPT, Gemini, Groq, Kimi or OpenRouter if you already have one.' },
  { q: 'Does the AI see my data?', a: 'It sees table and column names and the query you are working on. Rows are only sent when you ask it about a result, or when you turn on Explore mode and it reads the first rows of its own read-only queries.' },
  { q: 'Where are my passwords kept?', a: 'On your computer, encrypted with your operating system’s secure storage. Nothing is sent to a Qubase server.' },
  { q: 'Which systems does it run on?', a: 'Windows 10 and 11 today. macOS and Linux builds are on the way.' },
  { q: 'Windows says “Unknown publisher” or “Windows protected your PC”. Is it safe?', a: 'Yes. The installer is not code-signed yet, so Windows cannot show a publisher name. Click More info, then Run anyway. Signed installers are coming.' },
  { q: 'How do I get new versions?', a: 'Qubase checks for updates by itself and asks before downloading. You can also check in Settings, under About.' },
  { q: 'Can it run reports without opening the window?', a: 'Yes. Qubase.exe --run report.sql --conn "Shop" --out report.xlsx runs a query against a saved connection and writes the file, so Task Scheduler or a script can run it.' },
]
