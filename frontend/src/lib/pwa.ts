import { useEffect, useState } from 'react'

/** Chrome / Edge / Samsung Internet fire this when the app can be installed; Safari (iOS) never does. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((fn) => fn())

if (typeof window !== 'undefined') {
  // Registered at import time (before React mounts) so the one-shot event is never missed.
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BeforeInstallPromptEvent; notify() })
  window.addEventListener('appinstalled', () => { deferred = null; notify() })
}

export const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

/** Registers the service worker (production only - in dev it would fight Vite's hot reload). */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* installability is a bonus, never a blocker */ }) })
}

export function useInstall() {
  const [, force] = useState(0)
  useEffect(() => {
    const fn = () => force((n) => n + 1)
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])

  const installed = isStandalone()
  const ios = isIos()
  return {
    installed,
    /** one tap installs (Android / desktop Chrome) */
    canPrompt: !!deferred && !installed,
    /** iPhone / iPad: the only way is Share -> Add to Home Screen, so we show the steps */
    needsManualSteps: ios && !installed,
    available: !installed && (!!deferred || ios),
    async install() {
      if (!deferred) return 'unavailable' as const
      await deferred.prompt()
      const { outcome } = await deferred.userChoice
      deferred = null
      notify()
      return outcome
    },
  }
}
