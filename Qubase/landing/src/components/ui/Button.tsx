import type { ReactNode } from 'react'

type Props = {
  href: string
  children: ReactNode
  variant?: 'primary' | 'secondary'
  size?: 'md' | 'lg'
  external?: boolean
  className?: string
}

const VARIANTS = {
  primary: 'bg-ember text-white hover:bg-[#d84f06] shadow-[0_1px_0_#ffffff40_inset]',
  secondary: 'border border-line bg-surface text-fg hover:border-fg/40',
}
const SIZES = { md: 'h-10 px-4 text-[15px]', lg: 'h-12 px-6 text-base' }

/** A link styled as a button. Every call to action on the page is a link. */
export function Button({ href, children, variant = 'primary', size = 'md', external, className = '' }: Props) {
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={`inline-flex items-center justify-center gap-2 rounded-[10px] font-semibold transition-colors ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {children}
    </a>
  )
}
