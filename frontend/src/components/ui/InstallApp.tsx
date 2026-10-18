import { Download, MoreVertical, PlusSquare, Share } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useInstall } from '@/lib/pwa'
import { Button } from './Button'
import { Modal } from './Modal'

/** "Install app" - one tap on Android / desktop Chrome, step-by-step help on iPhone. Renders nothing when the app is
 *  already installed or the browser can't install it. `variant="dark"` is for the sidebar, `"inline"` for pages. */
export function InstallApp({ variant = 'inline', className }: { variant?: 'dark' | 'inline'; className?: string }) {
  const pwa = useInstall()
  const [help, setHelp] = useState(false)
  if (!pwa.available) return null

  const go = async () => {
    if (pwa.canPrompt) {
      const outcome = await pwa.install()
      if (outcome === 'accepted') toast.success('Installing — look for the GST Billing icon on your home screen')
    } else setHelp(true)
  }

  return (
    <>
      {variant === 'dark' ? (
        <button onClick={go} className={`flex w-full items-center gap-3 rounded-2xl bg-white/[0.07] p-3 text-left ring-1 ring-white/10 transition hover:bg-white/[0.11] hover:ring-white/20 ${className ?? ''}`}>
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/12"><Download className="size-[18px]" /></span>
          <span className="min-w-0">
            <span className="block text-[13px] font-bold">Install the app</span>
            <span className="block text-xs text-white/60">Open GST Billing from your home screen</span>
          </span>
        </button>
      ) : (
        <Button variant="secondary" size="lg" className={`w-full ${className ?? ''}`} onClick={go} icon={<Download className="size-[18px]" />}>Install the app</Button>
      )}

      <Modal open={help} onClose={() => setHelp(false)} title="Add GST Billing to your home screen" subtitle="Then open it like any other app — no browser, no typing the address."
        footer={<Button onClick={() => setHelp(false)}>Got it</Button>}>
        {pwa.needsManualSteps ? (
          <ol className="space-y-4 text-sm text-ink-2">
            <li className="flex gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-ink"><Share className="size-4" /></span><span>Open this page in <b>Safari</b> and tap the <b>Share</b> button (the square with an arrow, at the bottom of the screen).</span></li>
            <li className="flex gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-ink"><PlusSquare className="size-4" /></span><span>Scroll down and tap <b>Add to Home Screen</b>.</span></li>
            <li className="flex gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-ink"><Download className="size-4" /></span><span>Tap <b>Add</b>. The GST Billing icon now sits on your home screen.</span></li>
          </ol>
        ) : (
          <ol className="space-y-4 text-sm text-ink-2">
            <li className="flex gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-ink"><MoreVertical className="size-4" /></span><span>Open your browser's menu (the <b>⋮</b> or <b>⋯</b> icon).</span></li>
            <li className="flex gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-ink"><Download className="size-4" /></span><span>Tap <b>Install app</b> or <b>Add to Home screen</b>.</span></li>
          </ol>
        )}
      </Modal>
    </>
  )
}
