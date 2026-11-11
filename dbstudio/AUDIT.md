# Qubase UI and function audit (11 Nov 2026)

How it was checked: every screen opened in the real app (hidden window, SQLite test databases) at 1400, 1100 and 900 px,
in light and dark mode, plus 37 automated UI checks that click through the features. No real servers were used.

## Fixed in this round

| Area | Problem found | Fix |
|---|---|---|
| Whole app | The hidden default Electron menu was active: **Ctrl+R reloaded the app** (unsaved tabs lost) and **Ctrl+W could close the window** | Menu removed; only Qubase's own shortcuts apply |
| Query tabs | Text reached the app 0.6 s after typing, so closing a tab right away lost the last edits (also for "reopen tabs after restart") | Text is tracked immediately; only the save to disk waits |
| Shortcuts | Only 10 could be changed; no way to turn one off; no list to look them up | 26 actions in 4 groups, each can be changed, reset or turned off; clashes are flagged and block saving; keys Windows needs (copy, paste, undo…) are refused; F1 shows the full list |
| Shortcuts | Turned-off editor keys produced an empty key binding | Empty keys are skipped |
| Settings | Long single dialog with no sections or search; only reachable after connecting | Full-screen page: section list, search, toggles, unsaved-changes bar (Ctrl+S / Esc); also on the connection screen |
| Layout | Tools hidden in one menu; settings/theme scattered in the tab bar | Activity bar on the left: Tables, New query, Find, Builder, Notebook, Compare, ER, Schedules, Server tools, Shortcuts, Theme, Settings (active screen highlighted) |
| Layout | Window scrolled sideways at 900 px; toolbars cut buttons off; sidebar fixed at 280 px | No sideways scroll; toolbars wrap; sidebar resizable and hideable (Ctrl+B) |
| Table grid | Column headers cut off the type ("id INTE…") | Column width includes the type label |
| Toolbars | "500 / page" and other selects were clipped | Fixed height for selects in toolbars |
| Query builder | With hundreds of tables the list items overlapped | Fixed row height; list scrolls |
| Data / schema compare | Target database and tables had to be typed | Searchable dropdowns filled from the connection |
| Command palette | Few commands showed their shortcut | Every command with a shortcut shows it as key caps; new commands: reopen tab, shortcuts list, change shortcuts, sidebar, refresh |

## Checked and working

Connection screen (groups, import/export) · query tab (run, parameters, format, plan, history, saved, AI panel) ·
results (filter, copy as, pivot, totals, chart, JSON, compare pinned result) · table tab (data, structure, script, import, test data) ·
new table designer · ER diagram · schema compare · data compare (match, sync script, run on target) · notebook (run cells) ·
query builder (joins from foreign keys, filters, run) · find in database · scheduled queries (save, run now, CSV written) ·
server tools (activity, users, backup script) · pinned tabs and split view · light and dark themes.

## Not covered (needs you or a real server)

- The 5 newer databases (Snowflake, BigQuery, Cassandra, DynamoDB, Trino) against real servers.
- Large SQL Server catalogues: dropdown and builder speed with thousands of tables.
- Save-file dialogs (notebook save, export) and editing a notebook note: the hidden test window can't drive them.

## Ideas for later

- Table screen: merge its three toolbars (actions, WHERE filter, results) into two.
- Distinct icons for the query builder and ER diagram in the activity bar (they look alike at small size).
