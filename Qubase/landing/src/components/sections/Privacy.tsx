const POINTS = [
  { title: 'Secrets are encrypted', text: 'Passwords and API keys are stored with your operating system’s secure storage.' },
  { title: 'Everything stays local', text: 'Connections, saved queries and settings live on your computer. There is no Qubase account or cloud.' },
  { title: 'The AI sees structure', text: 'It gets table and column names, not your rows, unless you ask it about a result.' },
]

export function Privacy() {
  return (
    <section className="border-y border-line bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <h2 className="max-w-2xl text-[2rem] leading-[1.1] font-bold tracking-[-0.02em] sm:text-[2.5rem]">Your data stays on your computer</h2>
        <div className="mt-10 grid gap-8 md:grid-cols-3 md:gap-0 md:divide-x md:divide-line">
          {POINTS.map((p, i) => (
            <div key={p.title} className={i ? 'md:pl-8' : 'md:pr-8'}>
              <h3 className="font-sans text-base font-semibold">{p.title}</h3>
              <p className="mt-1.5 text-muted">{p.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
