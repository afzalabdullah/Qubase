import { useEffect, useState } from 'react'
import { DEMOS } from '../../data/demos'

const TICK_MS = 380
/** Ticks to wait after the results show, before moving on to the next demo. */
const HOLD = 9

/** The Qubase window, drawn in its own dark UI whatever the page theme. It types a query
 *  for one database, shows the result, then moves on to the next kind of database. */
export function AppWindow() {
  const [index, setIndex] = useState(0)
  const [step, setStep] = useState(0)
  const demo = DEMOS[index]
  const total = demo.lines.length

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setStep(total + 2); return }
    const t = setInterval(() => setStep((s) => {
      if (s >= total + HOLD) { setIndex((i) => (i + 1) % DEMOS.length); return 0 }
      return s + 1
    }), TICK_MS)
    return () => clearInterval(t)
  }, [total])

  const pick = (i: number) => { setIndex(i); setStep(0) }
  const shown = Math.min(step, total)
  const done = step > total + 1

  return (
    <div className="overflow-hidden rounded-[14px] border border-[#3a3f48] bg-[#16181d] text-left text-[#d6d9de] shadow-[0_30px_80px_-30px_rgba(16,18,22,.55)]">
      <div className="flex items-center gap-3 border-b border-[#2c3038] bg-[#1d2026] px-4 py-2.5">
        <div className="flex gap-1.5" aria-hidden="true"><span className="size-3 rounded-full bg-[#ff5f57]" /><span className="size-3 rounded-full bg-[#febc2e]" /><span className="size-3 rounded-full bg-[#28c840]" /></div>
        <div role="tablist" aria-label="Example queries" className="flex min-w-0 gap-1 overflow-x-auto text-xs [scrollbar-width:none]">
          {DEMOS.map((d, i) => (
            <button key={d.db} role="tab" aria-selected={i === index} onClick={() => pick(i)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 whitespace-nowrap transition-colors ${i === index ? 'bg-[#2a2e36] text-[#eceef1]' : 'text-[#8b9099] hover:text-[#eceef1]'}`}>
              <span className={`size-1.5 rounded-full ${d.dot}`} />{d.file}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[176px_minmax(0,1fr)] lg:grid-cols-[176px_minmax(0,1fr)_264px]">
        <aside className="hidden border-r border-[#2c3038] bg-[#1a1d22] p-3 text-xs text-[#aeb3bc] md:block">
          <p className="mb-1.5 px-2 text-[11px] text-[#6b7079]">Connections</p>
          {DEMOS.map((d, i) => (
            <button key={d.db} onClick={() => pick(i)} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${i === index ? 'bg-[#ee5a0a26] text-[#eceef1]' : 'hover:bg-[#ffffff0a]'}`}>
              <span className={`size-2 rounded-full ${d.dot}`} />{d.db}
            </button>
          ))}
          <p className="mt-5 mb-1.5 px-2 text-[11px] text-[#6b7079]">{demo.tree}</p>
          {demo.items.map((n) => <div key={n} className="px-2 py-1 font-mono text-[11px]">{n}</div>)}
        </aside>

        <div className="flex min-w-0 flex-col">
          <pre className="h-[176px] overflow-hidden p-5 font-mono text-[12.5px] leading-7 sm:text-[13px]" aria-label={`${demo.db} query`}>
            {demo.lines.slice(0, shown).map(([k, rest], i) => (
              <div key={`${index}-${i}`} className="whitespace-pre">
                <span className="mr-4 inline-block w-4 text-right text-[#ffffff38]">{i + 1}</span>
                <span className="font-semibold text-[#ff9a52]">{k}</span>{rest}
                {i === shown - 1 && !done && <span className="caret ml-0.5 inline-block h-4 w-2 translate-y-0.5 bg-[#ff9a52]" />}
              </div>
            ))}
            {shown === 0 && <span className="caret inline-block h-4 w-2 bg-[#ff9a52]" />}
          </pre>
          <div className="border-t border-[#2c3038]">
            <div className="flex items-center justify-between px-5 py-2 text-[11px] text-[#8b9099]">
              <span className="font-semibold text-[#eceef1]">Results</span>
              <span className={done ? '' : 'invisible'}>{demo.meta}</span>
            </div>
            <table className="w-full font-mono text-xs">
              <thead><tr className="bg-[#ffffff08] text-left text-[#8b9099]">{demo.cols.map((c, i) => <th key={c} className={`px-5 py-1.5 font-medium ${i ? 'text-right' : ''}`}>{c}</th>)}</tr></thead>
              <tbody>
                {demo.rows.map((r, ri) => (
                  <tr key={ri} className={`border-t border-[#ffffff0a] transition-opacity duration-500 ${done ? 'opacity-100' : 'opacity-0'}`} style={{ transitionDelay: `${ri * 90}ms` }}>
                    {r.map((v, i) => <td key={i} className={`px-5 py-1.5 ${i ? 'text-right tabular-nums' : ''}`}>{v}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="hidden flex-col gap-3 border-l border-[#2c3038] bg-[#1a1d22] p-4 text-sm lg:flex">
          <p className="text-[11px] text-[#6b7079]">AI assistant</p>
          <div key={`q${index}`} className="rise self-end rounded-xl rounded-br-sm bg-[#ee5a0a] px-3 py-2 font-medium text-white">{demo.ask}</div>
          <div className="rounded-xl rounded-bl-sm bg-[#ffffff0d] px-3 py-2 text-[#aeb3bc]">
            {shown < total ? 'Writing it in your editor…' : demo.reply}
          </div>
          {done && <p className="rise text-xs text-emerald-400">Ran: {demo.meta}</p>}
          <div className="mt-auto rounded-lg border border-[#2c3038] px-3 py-2 text-xs text-[#6b7079]">Ask about your data</div>
        </div>
      </div>
    </div>
  )
}
