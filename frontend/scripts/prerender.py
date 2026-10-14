"""Prerender the public marketing routes into static HTML snapshots (SEO item 4).

This is a plain client-rendered React app (Vite, no SSR framework). Most crawlers execute
JavaScript fine these days, but some (Bing, link-preview bots for Slack/WhatsApp/LinkedIn,
older/limited crawlers) do not - they only ever see the raw HTML Django returns. This script
closes that gap for the few pages that actually need to rank: it loads each marketing route in
a real browser *against the real Django server* (so its relative /api/... fetches, e.g. the
pricing plans, resolve exactly as they do for a real visitor), waits for it to settle, and saves
the resulting DOM - complete with the <title>/meta/OG tags src/lib/seo.ts already set at runtime -
as a static snapshot. The page's own <script> tag is left in place, so a real visitor still gets
the normal interactive SPA: the snapshot is just a faster, crawlable first paint.

common/views.py `spa_index` serves these snapshots in preference to the generic index.html, but
ONLY on the public marketing domain - tenant subdomains always get the plain SPA shell (and are
blocked from crawling entirely by robots.txt regardless).

Usage:
    cd frontend
    npm run build                               # produces dist/
    # ... start the Django server on :8000 (it serves dist/ itself - see README) ...
    python scripts/prerender.py                  # defaults to http://localhost:8000

Requires: pip install playwright   (uses the system Microsoft Edge via Playwright's `channel`
option - no extra ~300MB browser download; same approach backend/scripts/*.py use for screenshots).
"""
import argparse
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

FRONTEND = Path(__file__).resolve().parent.parent
DIST = FRONTEND / "dist"

# path -> output file under dist/. Root is captured LAST and deliberately overwrites dist/index.html
# itself - until then every other route's own navigation still falls back to the plain, unmodified
# SPA shell (Django only swaps in a snapshot once the matching file exists).
ROUTES = [
    ("register", "register/index.html"),
    ("", "index.html"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8000", help="Running server that already serves dist/ + the API (must be the PUBLIC domain)")
    args = ap.parse_args()
    base = args.base.rstrip("/")

    if not (DIST / "index.html").is_file():
        sys.exit(f"dist/index.html not found - run `npm run build` first (looked in {DIST})")

    print(f"Prerendering {len(ROUTES)} route(s) from {base} ...")
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        ok = True
        for route, out_rel in ROUTES:
            page = ctx.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            try:
                page.goto(f"{base}/{route}", wait_until="networkidle", timeout=30_000)
            except Exception as exc:
                print(f"  /{route:<10} -> FAILED to load: {exc}")
                ok = False
                page.close()
                continue
            page.wait_for_timeout(1200)  # let framer-motion / in-view reveals + the plans fetch settle
            title = page.title()
            html = "<!doctype html>\n" + page.content()
            out = DIST / out_rel
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(html, encoding="utf-8")
            status = "OK" if not errors else f"OK with {len(errors)} console error(s): {errors[0][:120]}"
            print(f"  /{route:<10} -> {out.relative_to(DIST)}   title={title!r}   [{status}]")
            page.close()
        browser.close()
    if not ok:
        sys.exit("One or more routes failed - is the Django server running on the given --base?")
    print("Done.")


if __name__ == "__main__":
    main()
