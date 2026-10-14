import { useEffect } from 'react'

/**
 * Per-page SEO: title, description, canonical, Open Graph / Twitter tags, and robots.
 *
 * No SSR framework here (plain Vite SPA), so this mutates <head> directly on mount/update.
 * - On the PUBLIC marketing domain this gives each page its own title/description/OG tags.
 * - On a TENANT subdomain (and on auth screens) callers pass `noindex: true` so private
 *   workspaces are never indexed, as a JS-level backstop to the host-level robots.txt
 *   (common/views.py `robots_txt`) which already blocks every tenant subdomain outright.
 *
 * Values set here are exactly what a prerendered snapshot captures (scripts/prerender.py) -
 * crawlers that don't run JS still see the real title/description/OG tags.
 */

const SITE_NAME = 'GST Billing by Tech Cognixium'
const DEFAULT_IMAGE = '/og-image.png'

interface SeoOptions {
  title: string
  description: string
  path?: string // defaults to the current path; pass explicitly for canonical on non-root mounts
  image?: string
  noindex?: boolean
}

function upsert(selector: string, make: () => HTMLElement): HTMLElement {
  let el = document.head.querySelector<HTMLElement>(selector)
  if (!el) {
    el = make()
    document.head.appendChild(el)
  }
  return el
}

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  const el = upsert(`meta[${attr}="${key}"]`, () => {
    const m = document.createElement('meta')
    m.setAttribute(attr, key)
    return m
  }) as HTMLMetaElement
  el.setAttribute('content', content)
}

export function useSEO({ title, description, path, image, noindex }: SeoOptions) {
  useEffect(() => {
    const fullTitle = title === SITE_NAME ? title : `${title} · ${SITE_NAME}`
    document.title = fullTitle

    setMeta('name', 'description', description)
    setMeta('name', 'robots', noindex ? 'noindex, nofollow' : 'index, follow')

    const url = `${window.location.origin}${path ?? window.location.pathname}`
    const canonical = upsert('link[rel="canonical"]', () => {
      const l = document.createElement('link')
      l.setAttribute('rel', 'canonical')
      return l
    }) as HTMLLinkElement
    canonical.setAttribute('href', url)

    const absImage = `${window.location.origin}${image ?? DEFAULT_IMAGE}`
    setMeta('property', 'og:site_name', SITE_NAME)
    setMeta('property', 'og:type', 'website')
    setMeta('property', 'og:title', fullTitle)
    setMeta('property', 'og:description', description)
    setMeta('property', 'og:url', url)
    setMeta('property', 'og:image', absImage)
    setMeta('name', 'twitter:card', 'summary_large_image')
    setMeta('name', 'twitter:title', fullTitle)
    setMeta('name', 'twitter:description', description)
    setMeta('name', 'twitter:image', absImage)
    // Deliberately not cleaned up on unmount: the next page's useSEO call overwrites every
    // value above on its own mount, and React Router never leaves <head> without a mounted page.
  }, [title, description, path, image, noindex])
}

/** One call covering every page on a tenant subdomain (private workspaces are never indexed). */
export function useNoIndex(title: string = SITE_NAME) {
  useSEO({ title, description: 'Private business workspace.', noindex: true })
}
