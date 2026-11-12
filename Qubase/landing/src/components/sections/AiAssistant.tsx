import { AI_POINTS, AI_PROVIDERS } from '../../data/ai'
import { AiChat } from '../mocks/AiChat'

export function AiAssistant() {
  const providers = AI_PROVIDERS.slice(0, -1).join(', ') + ' or ' + AI_PROVIDERS.at(-1)
  return (
    <section id="ai" className="scroll-mt-24 border-y border-line bg-surface">
      <div className="mx-auto grid max-w-6xl gap-14 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-2 lg:items-center">
        <div>
          <h2 className="max-w-[16ch] text-[2.25rem] leading-[1.05] font-bold tracking-[-0.02em] sm:text-[3rem]">An AI that sees your editor and writes with you</h2>
          <p className="mt-4 max-w-[52ch] text-lg text-muted">No copying queries into a chat window. Ask in plain words and the answer is typed into your editor.</p>
          <dl className="mt-10 divide-y divide-line border-y border-line">
            {AI_POINTS.map((p) => (
              <div key={p.title} className="grid gap-1 py-4 sm:grid-cols-[14rem_1fr] sm:gap-6">
                <dt className="font-semibold">{p.title}</dt>
                <dd className="text-muted">{p.text}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 max-w-[56ch] text-[15px] text-muted">Use {providers}. Ollama runs free models on your own computer.</p>
        </div>
        <AiChat />
      </div>
    </section>
  )
}
