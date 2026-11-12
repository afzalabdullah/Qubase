import { Footer } from './components/layout/Footer'
import { Navbar } from './components/layout/Navbar'
import { AiAssistant } from './components/sections/AiAssistant'
import { Databases } from './components/sections/Databases'
import { Faq } from './components/sections/Faq'
import { Features } from './components/sections/Features'
import { Hero } from './components/sections/Hero'
import { Maker } from './components/sections/Maker'
import { Privacy } from './components/sections/Privacy'
import { useTheme } from './hooks/useTheme'

export default function App() {
  const { theme, toggle } = useTheme()
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">Skip to content</a>
      <Navbar theme={theme} onToggleTheme={toggle} />
      <main id="main">
        <Hero />
        <AiAssistant />
        <Features />
        <Privacy />
        <Databases />
        <Faq />
        <Maker />
      </main>
      <Footer />
    </>
  )
}
