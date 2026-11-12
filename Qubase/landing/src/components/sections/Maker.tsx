import { AUTHOR } from '../../data/site'
import { GitHubIcon, LinkedInIcon } from '../ui/Icons'

export function Maker() {
  return (
    <section id="maker" className="mx-auto max-w-6xl scroll-mt-24 px-4 pb-20 sm:px-6 sm:pb-28">
      <div className="grid gap-8 border-t border-line pt-12 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-10">
        <div>
          <p className="text-[15px] text-muted">Made by</p>
          <h2 className="mt-1 text-[2rem] leading-tight font-bold tracking-[-0.02em]">{AUTHOR.name}</h2>
        </div>
        <div>
          <p className="max-w-[58ch] text-xl leading-relaxed">
            I built Qubase because I was tired of opening a different app for every database. If you have an idea or find a bug, I would like to hear about it.
          </p>
          <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-[15px] font-semibold">
            <a href={AUTHOR.linkedin} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-ember-text underline decoration-1 underline-offset-4 hover:decoration-2">
              <LinkedInIcon className="size-4" />Message me on LinkedIn
            </a>
            <a href={AUTHOR.github} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-ember-text underline decoration-1 underline-offset-4 hover:decoration-2">
              <GitHubIcon className="size-4" />Follow on GitHub
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
