import type { ReactNode } from 'react'

type Props = { id?: string; title: ReactNode; lead?: ReactNode; children: ReactNode; className?: string }

/** A page section with a left-aligned heading. The heading sits in a narrow column so lines stay short. */
export function Section({ id, title, lead, children, className = '' }: Props) {
  return (
    <section id={id} className={`mx-auto max-w-6xl scroll-mt-24 px-4 py-20 sm:px-6 sm:py-28 ${className}`}>
      <div className="max-w-2xl">
        <h2 className="text-[2.25rem] leading-[1.05] font-bold tracking-[-0.02em] text-balance sm:text-[3rem]">{title}</h2>
        {lead && <p className="mt-4 max-w-[60ch] text-lg text-muted">{lead}</p>}
      </div>
      {children}
    </section>
  )
}
