import { DATABASE_COUNT } from './databases'

export const FAQ: { q: string; a: string }[] = [
  { q: 'Which databases does it support?', a: `${DATABASE_COUNT} in total: relational ones like PostgreSQL, MySQL, SQL Server and Oracle, document and key-value stores like MongoDB and Redis, and warehouses like Snowflake and BigQuery.` },
  { q: 'Do I have to pay for the AI?', a: 'No. Use a free model through Ollama, or add a key for Claude, ChatGPT, Gemini, Groq, Kimi or OpenRouter if you already have one.' },
  { q: 'Does the AI see my data?', a: 'It sees table and column names and the query you are working on. Rows are only sent when you ask it about a result.' },
  { q: 'Where are my passwords kept?', a: 'On your computer, encrypted with your operating system’s secure storage. Nothing is sent to a Qubase server.' },
  { q: 'Which systems does it run on?', a: 'Windows today. macOS and Linux builds are on the way.' },
]
