// Editor colour themes. "Match app" uses CodeMirror's own light / dark look.
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'

interface Palette {
  dark: boolean
  bg: string; fg: string; gutter: string; gutterFg: string; selection: string; line: string; cursor: string
  keyword: string; string: string; number: string; comment: string; type: string; fn: string; op: string; name: string
}

const PALETTES: Record<string, Palette> = {
  'github-light': { dark: false, bg: '#ffffff', fg: '#24292f', gutter: '#ffffff', gutterFg: '#8c959f', selection: '#c8e1ff', line: '#f6f8fa', cursor: '#24292f',
    keyword: '#cf222e', string: '#0a3069', number: '#0550ae', comment: '#6e7781', type: '#8250df', fn: '#8250df', op: '#24292f', name: '#953800' },
  'github-dark': { dark: true, bg: '#0d1117', fg: '#c9d1d9', gutter: '#0d1117', gutterFg: '#6e7681', selection: '#264f78', line: '#161b22', cursor: '#c9d1d9',
    keyword: '#ff7b72', string: '#a5d6ff', number: '#79c0ff', comment: '#8b949e', type: '#d2a8ff', fn: '#d2a8ff', op: '#c9d1d9', name: '#ffa657' },
  dracula: { dark: true, bg: '#282a36', fg: '#f8f8f2', gutter: '#282a36', gutterFg: '#6272a4', selection: '#44475a', line: '#2e3040', cursor: '#f8f8f2',
    keyword: '#ff79c6', string: '#f1fa8c', number: '#bd93f9', comment: '#6272a4', type: '#8be9fd', fn: '#50fa7b', op: '#ff79c6', name: '#ffb86c' },
  nord: { dark: true, bg: '#2e3440', fg: '#d8dee9', gutter: '#2e3440', gutterFg: '#616e88', selection: '#434c5e', line: '#3b4252', cursor: '#d8dee9',
    keyword: '#81a1c1', string: '#a3be8c', number: '#b48ead', comment: '#616e88', type: '#8fbcbb', fn: '#88c0d0', op: '#81a1c1', name: '#d08770' },
  monokai: { dark: true, bg: '#272822', fg: '#f8f8f2', gutter: '#272822', gutterFg: '#75715e', selection: '#49483e', line: '#3e3d32', cursor: '#f8f8f0',
    keyword: '#f92672', string: '#e6db74', number: '#ae81ff', comment: '#75715e', type: '#66d9ef', fn: '#a6e22e', op: '#f92672', name: '#fd971f' },
  'solarized-light': { dark: false, bg: '#fdf6e3', fg: '#657b83', gutter: '#eee8d5', gutterFg: '#93a1a1', selection: '#e4dcc4', line: '#f5efdc', cursor: '#586e75',
    keyword: '#859900', string: '#2aa198', number: '#d33682', comment: '#93a1a1', type: '#b58900', fn: '#268bd2', op: '#859900', name: '#cb4b16' }
}

export const EDITOR_THEMES: [string, string][] = [
  ['auto', 'Match app (light / dark)'],
  ['github-light', 'GitHub Light'],
  ['github-dark', 'GitHub Dark'],
  ['dracula', 'Dracula'],
  ['nord', 'Nord'],
  ['monokai', 'Monokai'],
  ['solarized-light', 'Solarized Light']
]

const cache = new Map<string, Extension>()

function build(p: Palette): Extension {
  const view = EditorView.theme({
    '&': { color: p.fg, backgroundColor: p.bg },
    '.cm-content': { caretColor: p.cursor },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: p.cursor },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: p.selection },
    '.cm-activeLine': { backgroundColor: p.line },
    '.cm-gutters': { backgroundColor: p.gutter, color: p.gutterFg, border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: p.line }
  }, { dark: p.dark })
  const style = HighlightStyle.define([
    { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword], color: p.keyword, fontWeight: '600' },
    { tag: [t.string, t.special(t.string)], color: p.string },
    { tag: [t.number, t.bool, t.null], color: p.number },
    { tag: [t.comment, t.lineComment, t.blockComment], color: p.comment, fontStyle: 'italic' },
    { tag: [t.typeName, t.className, t.standard(t.name)], color: p.type },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: p.fn },
    { tag: [t.operator, t.punctuation], color: p.op },
    { tag: [t.special(t.name), t.propertyName, t.labelName], color: p.name }
  ])
  return [view, syntaxHighlighting(style)]
}

/** Theme value for the CodeMirror `theme` prop */
export function editorTheme(name: string, appDark: boolean): Extension | 'light' | 'dark' {
  const p = PALETTES[name]
  if (!p) return appDark ? 'dark' : 'light'
  if (!cache.has(name)) cache.set(name, build(p))
  return cache.get(name)!
}
