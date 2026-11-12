import { AUTHOR, NAV } from '../../data/site'
import { GitHubIcon, LinkedInIcon } from '../ui/Icons'
import { Wordmark } from '../ui/Logo'

const linkCls = 'text-[15px] text-muted transition-colors hover:text-fg'

/** Brand and short description on the left, link columns on the right, a thin bottom bar. */
export function Footer() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-12">
        <div className="md:col-span-5">
          <Wordmark />
          <p className="mt-4 max-w-[34ch] text-[15px] leading-relaxed text-muted">One app for querying, designing and exploring every database you use.</p>
          <div className="mt-6 flex gap-2">
            <a href={AUTHOR.linkedin} target="_blank" rel="noopener noreferrer" aria-label={`${AUTHOR.name} on LinkedIn`} className="grid size-10 place-items-center rounded-full border border-line text-muted transition-colors hover:border-fg/40 hover:text-fg"><LinkedInIcon className="size-4" /></a>
            <a href={AUTHOR.github} target="_blank" rel="noopener noreferrer" aria-label={`${AUTHOR.name} on GitHub`} className="grid size-10 place-items-center rounded-full border border-line text-muted transition-colors hover:border-fg/40 hover:text-fg"><GitHubIcon className="size-4" /></a>
          </div>
        </div>

        <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:col-span-7">
          <div>
            <h3 className="text-sm font-semibold">Product</h3>
            <ul className="mt-4 space-y-2.5">
              {NAV.map((n) => <li key={n.href}><a href={n.href} className={linkCls}>{n.label}</a></li>)}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Get started</h3>
            <ul className="mt-4 space-y-2.5">
              <li><a href="#databases" className={linkCls}>Supported databases</a></li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Maker</h3>
            <ul className="mt-4 space-y-2.5">
              <li><a href={AUTHOR.linkedin} target="_blank" rel="noopener noreferrer" className={linkCls}>LinkedIn</a></li>
              <li><a href={AUTHOR.github} target="_blank" rel="noopener noreferrer" className={linkCls}>GitHub</a></li>
            </ul>
          </div>
        </nav>
      </div>

      <div className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© {new Date().getFullYear()} {AUTHOR.name}. All rights reserved.</p>
          <a href="#main" className="transition-colors hover:text-fg">Back to top ↑</a>
        </div>
      </div>
    </footer>
  )
}
