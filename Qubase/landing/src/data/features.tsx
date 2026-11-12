import type { ReactNode } from 'react'
import {
  ChartPreview, ComparePreview, EditorPreview, ErPreview, ImportPreview, QueryBuilderPreview,
  SafetyPreview, SamplePreview, SchedulePreview, TeamPreview, UrlPreview,
} from '../components/mocks/FeaturePreviews'

export type Feature = { id: string; title: string; text: string; points?: string[]; preview: ReactNode }

/** Shown as large alternating rows, each with its own picture. */
export const HIGHLIGHTS: Feature[] = [
  {
    id: 'builder', title: 'Build queries by dragging tables',
    text: 'Drop tables on a canvas and the joins come from your foreign keys. Tick the columns you want and Qubase writes the query.',
    points: ['Filters, grouping and sorting without typing', 'The query updates live as you change the design', 'Save the design and the query together'],
    preview: <QueryBuilderPreview />,
  },
  {
    id: 'er', title: 'See how your tables connect',
    text: 'An ER diagram of any schema, drawn for you. Drag tables where you want them and Qubase remembers the layout.',
    points: ['Relationships drawn with crow’s-foot ends', 'Your layout is saved per database', 'Export the diagram as an image'],
    preview: <ErPreview />,
  },
  {
    id: 'schedule', title: 'Reports that run themselves',
    text: 'Pick a query, a time and a format. Qubase runs it on schedule and saves the file where you want it.',
    points: ['Excel, CSV, JSON or HTML', 'Every few minutes, every day or on weekdays', 'A notification when it is done'],
    preview: <SchedulePreview />,
  },
  {
    id: 'safety', title: 'Hard to break production',
    text: 'Mark a connection as production and Qubase slows you down at the right moments.',
    points: ['Read-only connections', 'A banner so you always know where you are', 'UPDATE or DELETE without WHERE is blocked'],
    preview: <SafetyPreview />,
  },
]

/** Shown as a compact list under the highlights. */
export const MORE_FEATURES: Feature[] = [
  { id: 'editor', title: 'Query editor', text: 'Autocomplete for tables, collections and fields, formatting, snippets and parameters.', preview: <EditorPreview /> },
  { id: 'charts', title: 'Charts and dashboards', text: 'Turn a result into a chart and pin it to a dashboard.', preview: <ChartPreview /> },
  { id: 'import', title: 'Import and export', text: 'Excel, CSV and JSON in and out, with a preview first.', preview: <ImportPreview /> },
  { id: 'compare', title: 'Schema and data compare', text: 'See what differs between two databases and get the sync script.', preview: <ComparePreview /> },
  { id: 'team', title: 'Team folder', text: 'Share queries and connections through a shared folder. Passwords stay private.', preview: <TeamPreview /> },
  { id: 'url', title: 'Paste a connection URL', text: 'The connection form fills itself, and errors explain the fix.', preview: <UrlPreview /> },
  { id: 'sample', title: 'Sample database', text: 'Try everything on a ready-made shop database.', preview: <SamplePreview /> },
]
