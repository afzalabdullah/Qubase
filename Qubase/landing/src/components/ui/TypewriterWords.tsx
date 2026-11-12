import { useEffect, useState } from 'react'

type Props = { words: string[]; typeMs?: number; holdMs?: number; className?: string }

/** Types each word, holds it, deletes it, then types the next one.
 *  Screen readers get the first word only; reduced motion shows it without animating. */
export function TypewriterWords({ words, typeMs = 70, holdMs = 1600, className = '' }: Props) {
  const [index, setIndex] = useState(0)
  const [len, setLen] = useState(words[0].length)
  const [deleting, setDeleting] = useState(false)
  const word = words[index]

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let t: number
    if (!deleting && len === word.length) t = window.setTimeout(() => setDeleting(true), holdMs)
    else if (deleting && len === 0) { setDeleting(false); setIndex((i) => (i + 1) % words.length) }
    else t = window.setTimeout(() => setLen((n) => n + (deleting ? -1 : 1)), deleting ? typeMs / 2 : typeMs)
    return () => window.clearTimeout(t)
  }, [len, deleting, word, words.length, typeMs, holdMs])

  return (
    <span className={className}>
      <span className="sr-only">{words[0]}</span>
      <span aria-hidden="true">
        {word.slice(0, len)}
        <span className="caret ml-1 inline-block w-[0.08em] translate-y-[0.08em] self-stretch bg-ember" style={{ height: '0.85em' }} />
      </span>
    </span>
  )
}
