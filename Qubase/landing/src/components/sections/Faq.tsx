import { FAQ } from '../../data/faq'
import { Section } from '../ui/Section'

export function Faq() {
  return (
    <Section id="faq" title="Questions">
      <dl className="mt-10 border-t border-line">
        {FAQ.map(({ q, a }) => (
          <div key={q} className="grid gap-2 border-b border-line py-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-10">
            <dt className="font-display text-lg font-bold tracking-tight">{q}</dt>
            <dd className="max-w-[62ch] text-muted">{a}</dd>
          </div>
        ))}
      </dl>
    </Section>
  )
}
