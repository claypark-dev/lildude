import { Header } from './components/Header'
import { Hero } from './components/Hero'
import { Stats } from './components/Stats'
import { Features } from './components/Features'
import { Architecture } from './components/Architecture'
import { Channels } from './components/Channels'
import { Providers } from './components/Providers'
import { Security } from './components/Security'
import { TokenEfficiency } from './components/TokenEfficiency'
import { QuickStart } from './components/QuickStart'
import { CallToAction } from './components/CallToAction'
import { Footer } from './components/Footer'
import { ScrollToTop } from './components/ScrollToTop'

export function App() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Stats />
        <Features />
        <Architecture />
        <Channels />
        <Providers />
        <Security />
        <TokenEfficiency />
        <QuickStart />
        <CallToAction />
      </main>
      <Footer />
      <ScrollToTop />
    </>
  )
}
