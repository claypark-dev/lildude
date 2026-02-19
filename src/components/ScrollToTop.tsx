import { useState, useEffect, type FC } from 'react'

export const ScrollToTop: FC = () => {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setVisible(window.scrollY > 500)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <button
      onClick={scrollToTop}
      aria-label="Scroll to top"
      className="fixed bottom-6 right-6 z-40 w-12 h-12 flex items-center justify-center rounded-full text-lg font-bold cursor-pointer transition-all duration-300 hover:scale-110"
      style={{
        backgroundColor: '#3b82f6',
        color: '#fff',
        border: 'none',
        boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)',
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        transform: visible ? 'translateY(0)' : 'translateY(16px)',
      }}
    >
      &uarr;
    </button>
  )
}
