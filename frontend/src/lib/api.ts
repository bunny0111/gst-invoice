/** Thin fetch wrapper: session cookie + CSRF header, JSON in/out, typed errors. */

export class ApiError extends Error {
  status: number
  code: string
  data: any
  constructor(status: number, data: any) {
    super(typeof data?.detail === 'string' ? data.detail : 'Something went wrong. Please try again.')
    this.status = status
    this.code = data?.code ?? 'error'
    this.data = data
  }
  /** DRF field errors -> { field: "message" } (first message per field). */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {}
    if (this.data && typeof this.data === 'object') {
      for (const [k, v] of Object.entries(this.data)) {
        if (k === 'detail' || k === 'code') continue
        out[k] = Array.isArray(v) ? String(v[0]) : typeof v === 'object' ? JSON.stringify(v) : String(v)
      }
    }
    return out
  }
  get isPlanLimit() { return this.code === 'plan_limit' }
}

function csrfToken(): string {
  const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

let csrfReady: Promise<unknown> | null = null
export function ensureCsrf() {
  if (!csrfToken() && !csrfReady) csrfReady = fetch('/api/csrf/', { credentials: 'same-origin' }).finally(() => (csrfReady = null))
  return csrfReady ?? Promise.resolve()
}

type Opts = { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal }

export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const method = opts.method ?? (opts.body || opts.form ? 'POST' : 'GET')
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (method !== 'GET') {
    await ensureCsrf()
    headers['X-CSRFToken'] = csrfToken()
  }
  let body: BodyInit | undefined
  if (opts.form) body = opts.form
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  let res: Response
  try {
    res = await fetch(path, { method, headers, body, credentials: 'same-origin', signal: opts.signal })
  } catch {
    throw new ApiError(0, { detail: 'Network problem - check your connection and try again.', code: 'network' })
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 || (res.status === 403 && data?.detail?.includes?.('Authentication credentials'))) {
      window.dispatchEvent(new Event('gst:unauthorized'))
    }
    throw new ApiError(res.status, data)
  }
  return data as T
}

export const get = <T = any>(path: string) => api<T>(path)
export const post = <T = any>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body })
export const patch = <T = any>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body })
export const put = <T = any>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body })
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' })

export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}
