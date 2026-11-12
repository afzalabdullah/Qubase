import { DATABASE_COUNT, DB_GROUPS } from '../../data/databases'
import { DbLogo } from '../ui/DbLogo'
import { Section } from '../ui/Section'

/** One row per kind of database: the kind on the left, its logos on the right in a hairline grid. */
export function Databases() {
  return (
    <Section
      id="databases"
      title={`Connect to ${DATABASE_COUNT} databases`}
      lead="The same editor, results grid, AI assistant and exports, whichever one you open."
    >
      <div className="mt-14 border-t border-line">
        {DB_GROUPS.map((g) => (
          <div key={g.kind} className="grid gap-6 border-b border-line py-10 lg:grid-cols-12 lg:gap-10">
            <div className="lg:col-span-4">
              <h3 className="text-[1.5rem] leading-tight font-bold tracking-[-0.01em]">{g.kind}</h3>
              <p className="mt-1.5 text-[15px] text-muted">{g.note}</p>
            </div>
            <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3 lg:col-span-8 xl:grid-cols-4">
              {g.items.map((d) => (
                <li key={d} className="flex items-center gap-3 bg-bg px-4 py-4">
                  <DbLogo name={d} className="size-10" />
                  <span className="min-w-0 text-[15px] leading-tight font-medium">{d}</span>
                </li>
              ))}
              {/* fill the last row so the grid keeps clean edges */}
              {Array.from({ length: (4 - (g.items.length % 4)) % 4 }, (_, i) => <li key={`pad${i}`} aria-hidden="true" className="hidden bg-bg xl:block" />)}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  )
}
