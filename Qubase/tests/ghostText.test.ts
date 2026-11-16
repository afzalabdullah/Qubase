// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView, runScopeHandlers } from '@codemirror/view'
import { ghostText } from '../src/ghostText'

function editor(fetch: (b: string, a: string) => Promise<string>, doc = '') {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = new EditorView({ state: EditorState.create({ doc, extensions: [ghostText(fetch, 10)] }), parent })
  view.focus()
  Object.defineProperty(view, 'hasFocus', { get: () => true }) // jsdom has no real focus
  return view
}
const type = (view: EditorView, text: string) => {
  const at = view.state.selection.main.head
  view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length } })
}
const key = (view: EditorView, k: string) => runScopeHandlers(view, new KeyboardEvent('keydown', { key: k }), 'editor')
const ghost = (view: EditorView) => view.dom.querySelector('.cm-ghost')?.textContent ?? null

describe('ghostText', () => {
  it('shows a suggestion after typing and Tab accepts it', async () => {
    const fetch = vi.fn(async (before: string) => (before.endsWith('FROM ') ? 'customers' : ''))
    const view = editor(fetch)
    type(view, 'SELECT * FROM ')
    await vi.waitFor(() => expect(ghost(view)).toBe('customers'))
    expect(fetch).toHaveBeenCalledWith('SELECT * FROM ', '')
    expect(key(view, 'Tab')).toBe(true)
    expect(view.state.doc.toString()).toBe('SELECT * FROM customers')
    expect(ghost(view)).toBeNull()
  })

  it('Esc dismisses, and Tab then does nothing special', async () => {
    const view = editor(async () => 'x')
    type(view, 'SELECT ')
    await vi.waitFor(() => expect(ghost(view)).toBe('x'))
    expect(key(view, 'Escape')).toBe(true)
    expect(ghost(view)).toBeNull()
    expect(key(view, 'Tab')).toBe(false)
  })

  it('drops a late answer when the user kept typing', async () => {
    let release!: (s: string) => void
    const view = editor(() => new Promise<string>((r) => { release = r }))
    type(view, 'SELECT ')
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    type(view, 'id')
    release('name')
    await new Promise((r) => setTimeout(r, 30))
    expect(ghost(view)).toBeNull()
  })

  it('does not suggest in the middle of a line', async () => {
    const fetch = vi.fn(async () => 'zzz')
    const view = editor(fetch, 'SELECT  FROM t')
    view.dispatch({ selection: { anchor: 7 } })
    type(view, 'a')
    await new Promise((r) => setTimeout(r, 40))
    expect(fetch).not.toHaveBeenCalled()
  })
})
