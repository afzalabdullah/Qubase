import { DATABASE_COUNT } from '../../data/databases'
import { AUTHOR, DOWNLOAD_URL, REPO_URL } from '../../data/site'
import { AppWindow } from '../mocks/AppWindow'
import { Button } from '../ui/Button'
import { DbLogo } from '../ui/DbLogo'
import { GitHubIcon, WindowsIcon } from '../ui/Icons'
import { TypewriterWords } from '../ui/TypewriterWords'

/** The first entry is what screen readers and reduced-motion visitors see. */
const HEADLINE_WORDS = ['Queried In One Place.', 'Designed By Dragging.', 'Mapped As Diagrams.', 'Turned Into Charts.', 'Reported On Schedule.', 'Explained By AI.']
const STRIP = ['PostgreSQL', 'MongoDB', 'Redis', 'Snowflake']

/** Centred hero: a small pill, the typed headline, one line of copy, two buttons, then the live demo. */
export function Hero() {
  return (
    <section id="top" className="mx-auto max-w-6xl px-4 pt-14 pb-20 sm:px-6 sm:pt-20 sm:pb-28">
      <div className="flex flex-col items-center text-center">
        <a href="#databases" className="inline-flex items-center gap-3 rounded-full border border-line bg-surface py-1.5 pr-4 pl-1.5 text-[13px] whitespace-nowrap text-muted sm:text-sm transition-colors hover:border-fg/30 hover:text-fg">
          <span className="flex -space-x-1.5">
            {STRIP.map((d) => <DbLogo key={d} name={d} className="size-7 rounded-full! ring-2! ring-surface!" />)}
          </span>
          {DATABASE_COUNT} databases supported →
        </a>

        <h1 className="mt-8 text-[2.75rem] leading-[1] font-extrabold tracking-[-0.035em] sm:text-[4rem] lg:text-[5rem]">
          Every Database,
          <br />
          <TypewriterWords words={HEADLINE_WORDS} className="inline-block min-h-[2em] text-ember-text sm:min-h-[1em] sm:whitespace-nowrap" />
        </h1>

        <p className="mt-7 max-w-[52ch] text-lg text-muted sm:text-xl">
          <strong className="font-semibold text-fg">Qubase</strong> connects to PostgreSQL, MySQL, MongoDB, Redis, Snowflake and {DATABASE_COUNT - 5} more. Write queries or build them by dragging tables, see your schema as a diagram, chart results and schedule reports, with an AI assistant built in.
        </p>
        <div className="mt-9 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
          <Button href={DOWNLOAD_URL} size="lg"><WindowsIcon />Download for Windows</Button>
          <Button href={REPO_URL} size="lg" variant="secondary" external><GitHubIcon className="size-4" />View on GitHub</Button>
        </div>
        <p className="mt-5 text-sm text-muted">No account needed · Passwords stay encrypted on your computer</p>
      </div>

      <div className="mt-16 sm:mt-20">
        <AppWindow />
        <p className="mt-4 text-center text-sm text-muted">Live demo. Pick a connection on the left to switch databases.</p>
      </div>
    </section>
  )
}
