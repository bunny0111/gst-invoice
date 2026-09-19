import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { ApiError, get } from './api'
import type { Me, Meta, Profile, Subscription, TenantInfo } from './types'

export const useTenantInfo = () =>
  useQuery({ queryKey: ['tenant'], queryFn: () => get<TenantInfo>('/api/tenant/'), staleTime: Infinity, retry: 1 })

/** The logged-in user, or null when signed out (401/403 is not an error here). */
export function useMe(enabled = true) {
  return useQuery({
    queryKey: ['me'],
    enabled,
    queryFn: async () => {
      try {
        return await get<Me>('/api/auth/me/')
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null
        throw e
      }
    },
    staleTime: 60_000,
    retry: false,
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
