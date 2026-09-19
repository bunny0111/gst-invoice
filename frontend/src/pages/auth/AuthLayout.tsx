import { motion } from 'framer-motion'
import { CheckCircle2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Logo, ThemeToggle } from '@/components/ui/Bits'
import { useTenantInfo } from '@/lib/hooks'

export default function AuthLayout({ children }: { children: ReactNode }) {
  const tenant = useTenantInfo().data
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
      <aside className="relative hidden overflow-hidden bg-[linear-gradient(160deg,#2a1d78_0%,#4230c9_55%,#7a3fe0_100%)] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="animate-blob absolute -right-24 top-1/4 size-96 rounded-full bg-[#ff8a5c]/30 blur-3xl" />
        <div className="animate-blob absolute -left-24 bottom-0 size-80 rounded-full bg-[#22c98a]/25 blur-3xl [animation-delay:-6s]" />
        <div className="bg-grid-pattern absolute inset-0 opacity-30" />
        <div className="relative"><Logo light /></div>
        <div className="relative">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-white/60">Your workspace</p>
          <h2 className="mt-3 font-display text-5xl font-extrabold leading-[1.1]">{tenant?.name ?? 'Welcome back'}</h2>
          <ul className="mt-10 space-y-4 text-[15px] text-white/85">
            {['GST invoices with automatic CGST / SGST / IGST', 'Payment tracking — paid, partial, overdue', 'Private, isolated data just for your business'].map((t, i) => (
              <motion.li key={t} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 + i * 0.12 }} className="flex items-center gap-3"><CheckCircle2 className="size-5 text-[#7df0bd]" />{t}</motion.li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white/60">© {new Date().getFullYear()} Tech Cognixium</p>
      </aside>
      <main className="relative grid place-items-center px-5 py-12 sm:px-10">
        <ThemeToggle className="absolute right-5 top-5" />
        <div className="w-full max-w-md">
          <div className="mb-10 lg:hidden"><Logo /></div>
          {children}
        </div>
      </main>
    </div>
  )
}
