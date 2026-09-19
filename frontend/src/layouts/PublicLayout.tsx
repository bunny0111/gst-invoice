import { AnimatePresence, motion } from 'framer-motion'
import { Menu, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { Logo, ThemeToggle } from '@/components/ui/Bits'
import { LinkButton } from '@/components/ui/Button'

const LINKS = [
  { href: '/#features', label: 'Features' },
  { href: '/#calculator', label: 'GST calculator' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/#faq', label: 'FAQ' },
]

function jump(e: React.MouseEvent, href: string, pathname: string) {
  if (pathname !== '/') return
  const id = href.split('#')[1]
  const el = id && document.getElementById(id)
  if (el) {
    e.preventDefault()
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    history.replaceState(null, '', `/#${id}`)
  }
}

export default function PublicLayout() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const { pathname } = useLocation()

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  useEffect(() => { setOpen(false); if (!location.hash) window.scrollTo({ top: 0 }) }, [pathname])

  return (
    <div className="min-h-screen">
      <header className={`sticky top-0 z-40 transition-all duration-300 ${scrolled ? 'border-b border-line bg-canvas/80 backdrop-blur-xl' : 'border-b border-transparent'}`}>
        <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link to="/" aria-label="GST Billing home"><Logo /></Link>
          <nav className="hidden items-center gap-1 md:flex">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} onClick={(e) => jump(e, l.href, pathname)} className="rounded-lg px-3.5 py-2 text-sm font-semibold text-ink-2 transition hover:bg-brand-soft hover:text-brand-ink">
                {l.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2.5">
            <ThemeToggle className="hidden sm:grid" />
            <LinkButton to="/login" variant="ghost" size="sm" className="hidden sm:inline-flex">Log in</LinkButton>
            <LinkButton to="/register" size="sm">Start free</LinkButton>
            <button onClick={() => setOpen((o) => !o)} aria-label="Menu" className="grid size-10 place-items-center rounded-xl border border-line bg-surface md:hidden">
              {open ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>
        <AnimatePresence>
          {open && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-line bg-canvas/95 backdrop-blur-xl md:hidden">
              <div className="space-y-1 px-5 py-4">
                {LINKS.map((l) => (
                  <a key={l.href} href={l.href} onClick={(e) => { jump(e, l.href, pathname); setOpen(false) }} className="block rounded-lg px-3 py-2.5 text-sm font-semibold text-ink-2 hover:bg-brand-soft">{l.label}</a>
                ))}
                <div className="flex gap-3 pt-2"><Link to="/login" className="flex-1 rounded-xl border border-line-strong py-2.5 text-center text-sm font-semibold">Log in</Link><ThemeToggle /></div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <Outlet />

      <footer className="mt-24 border-t border-line bg-surface">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">
              The simplest, most affordable, most India-specific GST billing platform for small businesses.
            </p>
          </div>
          <FooterCol title="Product" links={[['Features', '/#features'], ['GST calculator', '/#calculator'], ['Pricing', '/#pricing']]} />
          <FooterCol title="Get started" links={[['Create free account', '/register'], ['Log in', '/login'], ['FAQ', '/#faq']]} />
          <div>
            <h4 className="text-sm font-bold text-ink">Contact</h4>
            <ul className="mt-4 space-y-2.5 text-sm text-muted">
              <li>info@techcognixium.com</li>
              <li>techcognixium.com</li>
              <li>New Delhi, India</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-line">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-[13px] text-muted sm:px-8">
            <span>© {new Date().getFullYear()} Tech Cognixium. Made with care in India 🇮🇳</span>
            <span>Your data is stored in a private, isolated schema — never mixed with anyone else's.</span>
          </div>
        </div>
      </footer>
    </div>
  )
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h4 className="text-sm font-bold text-ink">{title}</h4>
      <ul className="mt-4 space-y-2.5 text-sm">
        {links.map(([l, h]) => (
          <li key={l}>{h.startsWith('/#') ? <a href={h} className="text-muted transition hover:text-brand-ink">{l}</a> : <Link to={h} className="text-muted transition hover:text-brand-ink">{l}</Link>}</li>
        ))}
      </ul>
    </div>
  )
}
