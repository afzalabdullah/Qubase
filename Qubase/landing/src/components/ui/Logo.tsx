export function Logo({ className = 'size-8' }: { className?: string }) {
  return <img src="/icon.png" alt="" className={className} />
}

/** Logo plus the product name, used in the navbar and footer. */
export function Wordmark({ iconClass = 'size-8' }: { iconClass?: string }) {
  return (
    <a href="#top" className="flex items-center gap-2.5 font-display text-xl font-bold tracking-tight">
      <Logo className={iconClass} />Qubase
    </a>
  )
}
