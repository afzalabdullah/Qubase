// First-run guided tour of the main screen (driver.js), themed with the app's own colours.
import { driver, type DriveStep } from 'driver.js'
import 'driver.js/dist/driver.css'

const DONE_KEY = 'tourDone'

export function tourSeen() { try { return localStorage.getItem(DONE_KEY) === '1' } catch { return true } }
function markSeen() { try { localStorage.setItem(DONE_KEY, '1') } catch { /* ignore */ } }

const visible = (sel: string) => { const el = document.querySelector(sel) as HTMLElement | null; return !!el && el.offsetParent !== null }

export function startTour(opts: { sqlLike: boolean; paletteKey?: string }) {
  const all: (DriveStep & { need?: string })[] = [
    { popover: { title: 'Welcome to Qubase 👋', description: 'A quick look around: about a minute. Use the arrow keys or the buttons, and press Esc to skip. You can take the tour again from the command palette.' } },
    { element: '.rail', popover: { title: 'Main tools', description: 'Everything starts here: tables, new queries, find, the query builder, notebooks, compare, ER diagram, schedules, dashboard and workspaces. Hover any icon to see its name and shortcut.', side: 'right' } },
    { element: '.sidebar-wrap', need: '.sidebar-wrap', popover: { title: 'Your database', description: 'Tables, views and more. Double-click a table to open its rows; right-click for actions like Edit structure, Export or Generate SQL.', side: 'right' } },
    { element: '.tabbar .tabs', popover: { title: 'Tabs', description: 'Every query, table and tool opens as a tab. Right-click a tab to pin it, split the view, or close others. A dot means unsaved changes.', side: 'bottom' } },
    { element: '.tabpanel.active .cm-editor', need: '.tabpanel.active .cm-editor', popover: { title: 'Write a query', description: 'Autocomplete knows your tables, columns, JOINs from foreign keys and even values. Ctrl+Enter runs it; Ctrl+S saves to a file.', side: 'bottom' } },
    { element: '[title^="Command palette"]', popover: { title: 'Command palette', description: `Press ${opts.paletteKey || 'Ctrl+Shift+P'} and type to do anything without hunting through menus.`, side: 'bottom' } },
    { element: '[title="Tools"]', popover: { title: 'More tools', description: opts.sqlLike ? 'Schema and data compare, import files into new tables, activity monitor, users and roles, backup and restore.' : 'Scheduled queries, backup and restore.', side: 'left' } },
    { element: '[aria-label="Dashboard"]', popover: { title: 'Dashboard', description: 'Pin any result chart here (Chart → 📌 Pin). It re-runs the queries on refresh or on a timer.', side: 'right' } },
    { element: '[aria-label="Workspaces"]', popover: { title: 'Workspaces', description: 'Save the tabs you have open under a name, and reopen the whole set later in one click.', side: 'right' } },
    { element: '[aria-label="Settings"]', popover: { title: 'Make it yours', description: 'Theme presets, your own colours and fonts, shortcuts, snippets, and export your settings to another computer.', side: 'right' } },
    { element: '.statusbar', popover: { title: 'Status bar', description: 'Which server and database you are on, row counts and timings. That’s it, have fun!', side: 'top' } }
  ]
  const steps = all.filter((s) => !s.element || visible(s.need ?? (s.element as string)))
  const d = driver({
    steps,
    showProgress: true,
    progressText: '{{current}} of {{total}}',
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Done',
    popoverClass: 'qb-tour',
    overlayOpacity: 0.55,
    stagePadding: 4,
    stageRadius: 8,
    onDestroyed: markSeen
  })
  d.drive()
}
