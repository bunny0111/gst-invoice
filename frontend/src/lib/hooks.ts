import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { ApiError, get } from './api'
import type { Me, Meta, Profile, Subscription, TenantInfo } from './types'

/** A sleeping server (free hosting) answers the first request slowly or with a 502/503 while it boots - that is not
 *  "logged out" and not "no such workspace". Keep retrying those for about a minute; give up at once on real answers. */
const isWakingUp = (e: unknown) => e instanceof ApiError && (e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 500)
export const wakeRetry = (count: number, e: unknown) => isWakingUp(e) && count < 8
export const wakeDelay = (attempt: number) => Math.min(1500 * 2 ** attempt, 10_000)

export const useTenantInfo = () =>
  useQuery({ queryKey: ['tenant'], queryFn: () => get<TenantInfo>('/api/tenant/'), staleTime: Infinity, retry: wakeRetry, retryDelay: wakeDelay })

const isSignedOut = (e: unknown) => e instanceof ApiError && (e.status === 401 || e.status === 403)

/** The logged-in user, or null when signed out (401/403 is not an error here). For someone who WAS signed in, a
 *  "not signed in" answer is asked again after a moment before they're sent to the login page: one stray reply must
 *  never log people out. A fresh visitor gets the login page at once. */
export function useMe(enabled = true) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: ['me'],
    enabled,
    queryFn: async () => {
      const wasSignedIn = !!qc.getQueryData<Me | null>(['me'])
      for (let attempt = 0; ; attempt++) {
        try {
          return await get<Me>('/api/auth/me/')
        } catch (e) {
          if (!isSignedOut(e)) throw e
          if (!wasSignedIn || attempt >= 1) return null
          await new Promise((r) => setTimeout(r, 800))
        }
      }
    },
    staleTime: 60_000,
    retry: wakeRetry,
    retryDelay: wakeDelay,
  })
}

export const useMeta = () => useQuery({ queryKey: ['meta'], queryFn: () => get<Meta>('/api/meta/'), staleTime: Infinity })
export const useProfile = () => useQuery({ queryKey: ['profile'], queryFn: () => get<Profile>('/api/profile/') })
export const useSubscription = () => useQuery({ queryKey: ['subscription'], queryFn: () => get<Subscription>('/api/subscription/') })

export function useDebounce<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Animated count-up for hero figures. Respects reduced-motion. */
export function useCountUp(target: number, ms = 900): number {
  const [val, setVal] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVal(target)
      return
    }
    const start = performance.now()
    const a = from.current
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms)
      setVal(a + (target - a) * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf = requestAnimationFrame(tick)
      else from.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return val
}

/** Refresh everything that depends on plan usage after a create/delete. */
export function useRefreshUsage() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['subscription'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }
}
