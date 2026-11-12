import { useEffect, useState } from 'react'
import { DOWNLOAD_URL, NAV, REPO_URL } from '../../data/site'
import type { Theme } from '../../hooks/useTheme'
import { Button } from '../ui/Button'
import { GitHubIcon, MenuIcon } from '../ui/Icons'
import { Wordmark } from '../ui/Logo'
import { ThemeToggle } from '../ui/ThemeToggle'

export function Navbar({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className={`sticky top-0 z-30 border-b bg-bg/85 backdrop-blur-md transition-colors ${scrolled || open ? 'border-line' : 'border-transparent'}`}>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Wordmark iconClass="size-11" />
        <nav aria-label="Main" className="hidden items-center gap-7 text-[15px] text-muted md:flex">
          {NAV.map((n) => <a key={n.href} href={n.href} className="transition-colors hover:text-fg">{n.label}</a>)}
        </nav>
        <div className="flex items-center gap-1.5">
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label="Qubase on GitHub" className="hidden size-10 place-items-center rounded-[10px] text-muted transition-colors hover:bg-surface-2 hover:text-fg sm:grid">
            <GitHubIcon className="size-[18px]" />
          </a>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <Button href={DOWNLOAD_URL} className="ml-1.5 hidden sm:inline-flex">Download</Button>
          <button aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen(!open)} className="grid size-10 place-items-center rounded-[10px] text-muted hover:bg-surface-2 hover:text-fg md:hidden">
            <MenuIcon open={open} />
          </button>
        </div>
      </div>
      {open && (
        <nav aria-label="Main" className="border-t border-line px-4 pt-2 pb-4 md:hidden">
          {NAV.map((n) => <a key={n.href} href={n.href} onClick={() => setOpen(false)} className="block border-b border-line py-3 text-lg">{n.label}</a>)}
          <Button href={DOWNLOAD_URL} size="lg" className="mt-4 w-full">Download for Windows</Button>
        </nav>
      )}
    </header>
  )
}
