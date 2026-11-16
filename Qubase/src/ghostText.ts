// AI inline suggestions for CodeMirror: after a short pause in typing, grey "ghost" text shows what the AI
// would write next at the cursor. Tab accepts it, Esc (or any other typing) dismisses it.
import { Prec, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view'

type Ghost = { pos: number; text: string } | null
const setGhost = StateEffect.define<Ghost>()

class GhostWidget extends WidgetType {
  constructor(readonly text: string) { super() }
  eq(o: GhostWidget) { return o.text === this.text }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-ghost'
    s.textContent = this.text
    s.title = 'AI suggestion: Tab to accept, Esc to dismiss'
    return s
  }
  ignoreEvent() { return true }
}

const ghostField = StateField.define<Ghost>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setGhost)) return e.value
    // Any edit or cursor move clears the suggestion
    return tr.docChanged || tr.selection ? null : value
  },
  provide: (f) => EditorView.decorations.from(f, (g): DecorationSet =>
    g ? Decoration.set([Decoration.widget({ widget: new GhostWidget(g.text), side: 1 }).range(g.pos)]) : Decoration.none)
})

/** fetch(before, after) returns the text to insert at the cursor ('' for none) */
export function ghostText(fetch: (before: string, after: string) => Promise<string>, delayMs = 700): Extension {
  const plugin = ViewPlugin.fromClass(class {
    timer = 0
    seq = 0
    constructor(readonly view: EditorView) {}
    update(u: ViewUpdate) {
      if (!u.docChanged) return // only typing asks for a suggestion, not clicking around
      clearTimeout(this.timer)
      const id = ++this.seq
      this.timer = window.setTimeout(() => this.ask(id), delayMs)
    }
    async ask(id: number) {
      const { state } = this.view
      const sel = state.selection.main
      if (!sel.empty || !this.view.hasFocus) return
      const line = state.doc.lineAt(sel.head)
      // Only at the end of a line (or before spaces / closing brackets), so it never covers existing text
      if (!/^[\s)\]}]*$/.test(line.text.slice(sel.head - line.from))) return
      const before = state.sliceDoc(0, sel.head)
      if (!before.trim()) return
      let text = ''
      try { text = await fetch(before, state.sliceDoc(sel.head)) } catch { return }
      // Drop it when the user kept typing or moved meanwhile
      if (id !== this.seq || this.view.state.doc !== state.doc || this.view.state.selection.main.head !== sel.head || !text) return
      this.view.dispatch({ effects: setGhost.of({ pos: sel.head, text }) })
    }
    destroy() { clearTimeout(this.timer); this.seq++ }
  })

  const keys = Prec.highest(keymap.of([
    {
      key: 'Tab',
      run: (view) => {
        const g = view.state.field(ghostField, false)
        if (!g) return false
        view.dispatch({ changes: { from: g.pos, insert: g.text }, selection: { anchor: g.pos + g.text.length }, effects: setGhost.of(null), userEvent: 'input.complete' })
        return true
      }
    },
    {
      key: 'Escape',
      run: (view) => { if (!view.state.field(ghostField, false)) return false; view.dispatch({ effects: setGhost.of(null) }); return true }
    }
  ]))

  return [ghostField, plugin, keys, EditorView.baseTheme({ '.cm-ghost': { opacity: '0.45', fontStyle: 'italic', whiteSpace: 'pre' } })]
}
