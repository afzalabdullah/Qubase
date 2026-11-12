# Qubase

A desktop SQL client in the style of Beekeeper Studio: Electron + React + TypeScript.

## Run

```bash
npm install
npm run dev       # hot-reloading dev mode
npm start         # production build, then launch
npm run dist:win  # Windows installer → release/Qubase-Setup-<version>.exe
npm run dist:dir  # unpacked app folder only (faster, for testing)
```

## Supported databases

PostgreSQL, MySQL, MariaDB, SQL Server, Azure SQL, Oracle (thin mode, no client install), SQLite,
DuckDB, LibSQL / Turso, ClickHouse (read-only grid), CockroachDB, Redshift, TimescaleDB, YugabyteDB, TiDB,
MongoDB (shell-style queries, e.g. `db.users.find({ age: { $gt: 30 } })`), Redis (key browser + command console),
Snowflake, BigQuery (service-account key or gcloud sign-in; Plan shows a dry run), Cassandra / ScyllaDB (CQL),
DynamoDB (PartiQL; works with DynamoDB Local) and Trino / Presto. BigQuery, DynamoDB and Trino are read-only in the grid.

The list lives in `shared/drivers.ts`.

## Features

### Connecting
- SQL Server: SQL login or Windows / domain account (NTLM)
- SSH tunnel (password or private key) for every server database
- SSL certificate files (CA, client certificate and key) for PostgreSQL, MySQL and MongoDB
- Passwords, SSH passwords and key passphrases are encrypted with the OS keychain
- **Production** flag: red bar across the window, asks before every change
- **Read-only** flag: blocks INSERT, UPDATE, DELETE, CREATE, ALTER, DROP and other changes (queries, grid edits, designer, import)
- Asks before UPDATE or DELETE without WHERE (can be turned off in Settings)

### Database objects
- Sidebar sections per database: Tables, Views, Stored procedures, Functions, Triggers, Sequences, plus each engine's own:
  - SQL Server: procedures, functions, triggers, sequences, synonyms
  - PostgreSQL family: functions, procedures, triggers, sequences, materialized views, enum types
  - MySQL / MariaDB / TiDB: procedures, functions, triggers, events
  - Oracle: packages, procedures, functions, triggers, sequences, synonyms, materialized views, types
  - SQLite / LibSQL: triggers, indexes · DuckDB: macros, sequences, indexes, enum types · ClickHouse: dictionaries
- Double-click a procedure, function, trigger or view to open its script for editing (SQL Server opens it as `CREATE OR ALTER`, like SSMS "Modify")
- Right-click menu: Open data, Design table, Script as CREATE / SELECT / INSERT / UPDATE / DELETE, Execute, Copy name, Truncate, Drop.
  Destructive actions only open a script; nothing runs until you press Run.
- SQL Server scripts can use `GO` between batches

### Tables
- Table tab has Data, Structure and Script views
- Data view reads one page at a time; the WHERE box, column sorting and the row count run on the database, so they cover the whole table
- **Go to**: jump from a row to the row its foreign key points at (opens that table filtered)
- Add rows, delete rows, edit cells; all staged until Apply (one transaction)
- **Import** from CSV / TSV (separator detected), Excel (.xlsx) or JSON, with column mapping, in batches of 500
- **Generate test data**: 100 / 1,000 / 10,000 rows of plausible values (names, emails, dates, amounts) as an INSERT script to review
- Table designer: add, rename, retype, drop columns; NULL, default, identity; add and drop indexes; shows foreign keys and triggers.
  Every change is shown as SQL to review before it runs (or open it in the editor instead)
- New table designer (+ button in the sidebar)
- MongoDB: shows indexes; add and delete documents

### Queries and results
- Every query tab has its own connection, so queries in different tabs run in parallel (like SSMS)
- **Begin / Commit / Rollback** buttons; a "Transaction open" marker also follows BEGIN / COMMIT typed by hand
- **Plan** (Ctrl+L): estimated query plan without running the query, drawn as a tree with each step's share of the cost
  (SQL Server showplan, PostgreSQL and MySQL JSON plans; SQLite, DuckDB, Oracle and ClickHouse as text)
- Errors mark the failing line in the editor (SQL Server, PostgreSQL, MySQL)
- Row limit per query (default 10,000) and a Stop button. SQL Server, PostgreSQL (cursor) and MySQL (stream) stop reading at the limit;
  Stop cancels on the server (PostgreSQL `pg_cancel_backend`, MySQL `KILL QUERY`, SQL Server attention)
- Scripts with several statements show Result 1, Result 2… plus a Messages tab
- Export results to Excel, CSV, JSON, SQL INSERT statements, Markdown or HTML
- **Chart** button: bar, line or pie chart of the result
- JSON panel for the selected rows; Ctrl+A / Shift / Ctrl+click select rows, Ctrl+C copies them with headers
- SQL autocomplete for tables, views and columns
- **Saved queries** library and query history
- Optional: F5 runs only the statement under the cursor (Settings)
- **Format** (Shift+Alt+F) formats the selection or the whole query; keyword case and indent in Settings
- **Snippets**: type `sel`, `ins`, `upd`, `cte`… and press Enter; Tab jumps between the blanks. Add your own in Settings

### Notebooks
- SQL cells and Markdown notes in one document; run one cell (Ctrl+Enter) or all of them
- Saved as `.dhnb` files with the first 500 rows of each result

### Visual query builder
- Click tables, tick columns, pick SUM / COUNT / AVG…; joins are found from foreign keys
- Filters, sorting, DISTINCT and a limit; live SQL preview; Run, or open the SQL in a query tab

### Data compare
- Compares the rows of a table here with a table on another connection (or the same one), matched by primary key
- Shows changed cells, rows only in the source and rows only in the target
- Builds the INSERT / UPDATE / DELETE script that makes the target match (DELETE only when ticked), and can run it

### Power features

- **Query parameters**: `:name` or `{{name}}` in a query asks for values before running (remembered; tick “as SQL” to insert raw SQL)
- **Find in database** (Tools): search a value in every table; open any hit filtered
- **Result grid**: Copy as TSV / CSV / Markdown / JSON / INSERT / IN-list; Pivot table; Σ totals bar (sum, avg, min, max of the selection)
- **Compare results**: Pin a result, run another query, press Compare to see changed, new and removed rows
- **Scheduled queries** (Tools): run a query daily, on weekdays or every N minutes and save it as CSV / Excel / JSON… to a folder, with history and Windows notifications (runs while the app is open)
- **Test data**: Table → Generate test data… picks a generator per column (names, emails, ranges, dates, lists, sequences, NULL %)
- **Connection groups**: a Group field, collapsible groups, filter, Import / Export to JSON (passwords left out)
- **Tabs**: right-click a tab to pin it or open it to the side (split view)

### AI assistant
- **AI** button in a query tab: write SQL from a description, explain the current query, or fix the last error
- Uses the Anthropic API (Claude Opus 5.5 by default; Sonnet 5.5 or Haiku 5.5 in Settings).
  The key is entered in Settings and stored encrypted; only table and column names and the query are sent, never row data

### Server tools (toolbar → server icon, or Ctrl+K)
- **Activity monitor**: sessions and running queries, End session (SQL Server, PostgreSQL, MySQL, Oracle, ClickHouse), auto refresh
- **Users and roles**
- **SQL Agent jobs** (SQL Server): last outcome, last run, Start job
- **Backup and restore** script for the current database (SQL scripts run in a query tab; pg_dump, mysqldump, expdp and mongodump as commands)
- **ER diagram** drawn from the foreign keys: drag tables, scroll to zoom, double-click to open a table, copy as SVG
- **Schema compare** against another saved connection of the same type: lists new tables, column and index changes,
  and builds the script that makes the target match (DROP statements are left commented out)

### App
- **Command palette** (Ctrl+K or Ctrl+Shift+P): every command, table and saved query
- **Settings** (Ctrl+,): theme (light, dark or same as Windows), accent colour, editor colours (GitHub, Dracula, Nord, Monokai,
  Solarized), font size, formatting, snippets, keyboard shortcuts, row limits, safety checks, AI key and model
- **Keyboard shortcuts** can be changed in Settings (click a shortcut, press the new keys)
- Query tabs and their text come back after a restart
- Local error log (Settings → Open log folder); nothing is sent anywhere

## Layout

| Path | What it does |
|---|---|
| `electron/main.ts` | Main process: window, IPC handlers, open connections, SSH tunnels |
| `electron/preload.ts` | Exposes the safe `window.db` API to the UI |
| `electron/db/base.ts` | `DbClient` interface + shared logic (queries, paging, plans, edits in a transaction) |
| `electron/db/*.ts` | One adapter per database engine |
| `electron/tunnel.ts` | SSH tunnel (local port forwarded through the SSH server) |
| `electron/importer.ts` / `export.ts` | Read CSV / Excel / JSON; write all export formats |
| `electron/ai.ts` | AI assistant (Anthropic SDK; key kept in the main process) |
| `electron/log.ts` | Local crash and error log |
| `electron/store.ts` | Saved connections (passwords encrypted with the OS keychain) |
| `shared/types.ts` | Types shared by both sides |
| `shared/ddl.ts` | SQL generator for scripts, the designer and schema compare |
| `src/` | React UI |

## Adding a database

Create `electron/db/<name>.ts` extending `BaseClient`, implement `connect`, `disconnect`,
`run`, `transaction`, `listTables`, `listColumns`, `quoteIdent`, `placeholder`,
then add it to `createClient` in `electron/db/index.ts` and to `DRIVERS` in `shared/drivers.ts`.
Override `pageSql`, `explainSql` and `txSql` when the database's SQL differs from the defaults.

## Licence, updates and team folder

- **Licence keys** are signed offline with Ed25519. The app holds only the public key (`electron/product.ts`).
  Issue a key with `node tools/licence/issue-licence.mjs --name "Customer" --plan pro --seats 1 --expires 2027-12-31`.
  The private key is in `tools/licence/keys/private.pem`: keep it secret, back it up, never ship or commit it (it is git-ignored).
- **Updates**: set an update address in Settings (an https folder with the `latest.yml` and installer that `npm run dist:win` writes to `release/`). “Check for updates” compares versions and opens the download.
- **Team folder**: point Settings → Team folder at a shared folder (OneDrive, Dropbox, network drive). Team queries appear in the command palette; connections are shared without passwords.

## Code signing (Windows)

electron-builder signs automatically when these are set before `npm run dist:win`:

```
set CSC_LINK=C:\certs\qubase.pfx
set CSC_KEY_PASSWORD=your-pfx-password
```

An EV certificate removes the SmartScreen warning straight away; a standard OV certificate builds reputation over time. Without them the installer is unsigned.

## Not done yet

- Buying a code-signing certificate and hosting the update folder
- Plugins
