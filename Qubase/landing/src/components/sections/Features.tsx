import type { ReactNode } from 'react'
import { HIGHLIGHTS, MORE_FEATURES, type Feature } from '../../data/features'
import { Section } from '../ui/Section'

function Stage({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex w-full min-w-0 items-center justify-center overflow-hidden rounded-2xl border border-line bg-surface-2 ${className}`}>
      {children}
    </div>
  )
}

/** A large row: words on one side, picture on the other. Every second row swaps sides. */
function Highlight({ feature, flip }: { feature: Feature; flip: boolean }) {
  return (
    <article className="grid grid-cols-[minmax(0,1fr)] items-center gap-8 lg:grid-cols-2 lg:gap-16">
      <div className={flip ? 'lg:order-2' : ''}>
        <h3 className="text-[1.75rem] leading-[1.1] font-bold tracking-[-0.015em] sm:text-[2.125rem]">{feature.title}</h3>
        <p className="mt-3 max-w-[48ch] text-lg text-muted">{feature.text}</p>
        {feature.points && (
          <ul className="mt-6 space-y-2.5">
            {feature.points.map((p) => (
              <li key={p} className="flex gap-3">
                <svg viewBox="0 0 20 20" className="mt-1 size-4 shrink-0 text-ember" fill="currentColor" aria-hidden="true"><path d="M8 13.6 4.4 10l-1.4 1.4L8 16.4l9-9L15.6 6z" /></svg>
                {p}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Stage className={`min-h-[340px] p-6 sm:p-10 ${flip ? 'lg:order-1' : ''}`}>{feature.preview}</Stage>
    </article>
  )
}

export function Features() {
  return (
    <Section id="features" title="Everything you need in one window" lead="The tools you would normally spread across three or four apps, working together on the same connection.">
      <div className="mt-16 space-y-20 sm:space-y-28">
        {HIGHLIGHTS.map((f, i) => <Highlight key={f.id} feature={f} flip={i % 2 === 1} />)}
      </div>

      <div className="mt-24 border-t border-line pt-12 sm:mt-32">
        <h3 className="text-[1.75rem] font-bold tracking-[-0.015em]">And everyday tools</h3>
        <div className="mt-8 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {MORE_FEATURES.map((f) => (
            <div key={f.id}>
              <Stage className="h-44 p-5 [&>*]:origin-center [&>*]:scale-[0.85]">{f.preview}</Stage>
              <h4 className="mt-4 font-display text-lg font-bold tracking-tight">{f.title}</h4>
              <p className="mt-1 text-[15px] text-muted">{f.text}</p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  )
}
