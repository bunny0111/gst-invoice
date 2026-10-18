# GST Billing — Phase 1 (MVP)

Multi-tenant GST invoicing & billing SaaS by **Tech Cognixium**. Built from `TechCognixium_PRD_v1.0.docx`.

| Layer | Tech |
|---|---|
| API | Django 6 + Django REST Framework |
| Multi-tenancy | PostgreSQL schema per business (`django-tenants`), one subdomain each |
| Frontend | React 19 + TypeScript + Vite + Tailwind 4 (framer-motion, TanStack Query) |
| PDF | WeasyPrint (HTML → PDF) |
| Payments | Razorpay Subscriptions (real integration + safe demo mode) |

## Run it (Windows)

Prerequisites: Python 3.12+, Node 20+, PostgreSQL running, and — for PDFs on Windows — MSYS2 Pango:
`winget install MSYS2.MSYS2` then `C:\msys64\usr\bin\bash.exe -lc "pacman -S --noconfirm mingw-w64-x86_64-pango"`.

```powershell
# one-time
cd backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python manage.py migrate_schemas --shared
.\.venv\Scripts\python manage.py bootstrap_public       # creates the public (marketing/registration) tenant
cd ..\frontend; npm install; cd ..

# every time
.\start-dev.ps1                                         # Django :8000 + React :5173
```

Open **http://localhost:5173**. Register a business (e.g. "Sharma Electronics") → you get
`http://sharma-electronics.localhost:5173` — a private workspace. (`*.localhost` resolves to your machine in Chrome/Edge/Firefox.)
Settings come from the `.env` in this folder (see `.env.example`). Password-reset OTP emails print in the Django console until you add `RESEND_API_KEY`.

**Production-style single server:** `cd frontend && npm run build`, restart Django — it serves the built app itself on :8000.

## Verify it

```powershell
cd backend
.\.venv\Scripts\python manage.py test billing                        # 18 GST-engine unit tests (PRD worked examples)
.\.venv\Scripts\python scripts\e2e_check.py                          # 78 API checks: registration → invoices → payments → limits → isolation
.\.venv\Scripts\python scripts\nfr_check.py <slug> <email> <password> # performance / security / OTP (PRD §7)
cd ..\frontend; npx tsc --noEmit -p tsconfig.json                    # type-check
```
Measured on the dev machine: dashboard with 1,013 invoices **143 ms** (target < 2 s), PDF **~0.6 s** (< 5 s), CRUD ~110 ms (< 500 ms).

## Razorpay
`.env` ships with `dummy_for_now` keys → with `DEBUG=True` checkout runs in **demo mode** (simulated card form, plan activates for 30 days, receipts marked *Demo*). To go live: real keys → `python manage.py create_razorpay_plans` → paste the two plan IDs → add a webhook to
`https://<public-domain>/api/public/razorpay/webhook/` and set `RAZORPAY_WEBHOOK_SECRET`. Demo mode can never activate when `DEBUG=False`.
The live Razorpay path (order creation, signature check, webhook) is implemented but has **not** been run against Razorpay's servers yet.

## SEO

The product itself (invoices, dashboard, etc.) sits behind login on private tenant subdomains and is
deliberately **never indexed** — only the public marketing site (landing + register) is meant to rank.

- **Per-page title/description/OG/Twitter/canonical** on the marketing pages (`src/lib/seo.ts`,
  used by `Landing.tsx`, `Register.tsx`, `FindBusiness.tsx`), plus a generated `public/og-image.png`
  for link previews.
- **`robots.txt` / `sitemap.xml`** are served per-host from Django (`common/views.py`): the public
  domain allows crawling and lists `/` and `/register`; **every tenant subdomain returns
  `Disallow: /`** and an empty sitemap, unconditionally.
- **`noindex`** is set on every tenant-domain page as a JS-level backstop (`useNoIndex()` in
  `App.tsx`'s `TenantRoutes`) — covers login, password reset and the whole logged-in app in one call.
- **Static prerendering** (`frontend/scripts/prerender.py`): this is a plain client-rendered SPA
  (Vite, no SSR), so crawlers that don't execute JavaScript (Bing, most link-preview bots) would
  otherwise see an empty shell. The script loads `/` and `/register` in a real browser against the
  running Django server, waits for them to settle (including the live `/api/plans/` fetch), and
  saves the rendered DOM — real text plus the correct per-page `<title>`/meta/OG tags — as static
  snapshots. `spa_index` (`common/views.py`) serves these in place of the generic shell, **only on
  the public domain**; a real visitor still gets the exact same bundle and the page is fully
  interactive once it loads. Re-run after every content change to the marketing pages:
  ```powershell
  cd frontend
  npm run build
  # with Django already running on :8000:
  ..\backend\.venv\Scripts\python scripts\prerender.py
  ```
- **Before going live:** the generated `og-image.png`/titles use placeholder copy — review them,
  and double-check `robots.txt`'s `Sitemap:` line and the OG `url`/`image` values resolve correctly
  against the real `techcognixium.com` domain (they're built from the request's own host, so this
  should already be correct once DNS points there — just verify once).

## Sharing, customer rules & payment details

- **Send to WhatsApp / Send to Email** sit above *Finalize invoice* in the editor (and on the invoice page for resending).
  Sending finalizes & locks the invoice first, then opens `wa.me` addressed to the customer's phone (a bare 10-digit number gets +91)
  or emails the PDF to the customer's email. Both messages carry a **signed, tenant-bound, 60-day link** to the PDF that opens without a login
  (`/share/invoice/<token>/`). Email goes through the configured SMTP (Resend); without `RESEND_API_KEY` it prints in the server console.
- **Customer rules:** phone mandatory for everyone; email optional; GST number mandatory for **B2B** customers, optional for **B2C**
  (explicit `customer_type`; migration `0002` marks existing customers with a GSTIN as B2B).
- **Payment details** (sidebar): every payment across all invoices, with **View details / Edit payment / Delete payment / Generate receipt**
  (receipt PDF `PR-xxxxx`). Undoing a payment always asks for confirmation first. Editing re-checks the invoice can't be over-paid and recomputes its status.
- Plan gating is **not** applied to sharing yet (the pricing table still lists it as Starter/Pro) - one line in `InvoiceViewSet.share/send_email` if you want it.

## Install as an app (PWA)

The site installs to a phone / desktop home screen and opens like an app (no browser bar, no typing the address).
- **Per business:** `/api/manifest.webmanifest` is served per host, so a workspace (`sharma.app.techcognixium.com`) installs as *its own* app
  with its own name and opens straight at its login / dashboard. The public site installs as a generic "GST Billing" opening the workspace finder.
- **Install button** (`components/ui/InstallApp.tsx`): one tap on Android / desktop Chrome (`beforeinstallprompt`); step-by-step help on iPhone (Safari has no prompt).
- **Service worker** (`public/sw.js`) is deliberately tiny: it makes the app installable and shows `offline.html` when there is no connection.
  It never caches API calls, PDFs, share links or page HTML (private, per-business data); only the hashed `/assets/*` build files are cached.
- **Staying signed in:** sessions last 1 day (sliding). The login form's **Keep me signed in** tick box makes it 30 days (also sliding) on that device; it is pre-ticked only inside the installed app. Changing the password signs every device out.
- Needs HTTPS (Render provides it) or `localhost`. Icons: `public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`.
- A Play-Store APK is **not** built: a Trusted Web Activity is tied to one origin, and every business here has its own subdomain.

## PRD coverage (Phase 1)

All of: US-01 registration/tenancy · US-02 profile · US-03 customers · US-04 catalogue · US-05 invoices · US-06 PDF · US-07 payments · US-08 dashboard · §6 plan limits · Razorpay subscriptions · §7 non-functional requirements. Plus login/logout and email-OTP password reset from the original roadmap doc, and subscription receipts.

**Deliberate deviations / decisions** (each is a one-line change if you disagree):

| PRD | What I did | Why |
|---|---|---|
| US-05 AC7 — number "auto-generated" | Number is assigned on **Finalize**, not on draft creation | GST needs a gapless series; deleting a draft must not leave a hole |
| §5.2 — payment date/mode on Invoice | Separate `Payment` table | Partial payments need a history of dates/modes; `amount_paid` is the sum |
| §5.2 — status includes `overdue` | Stored statuses: draft/sent/partial/paid/cancelled; **overdue is computed** (`due_date < today`) | A partly-paid invoice can be overdue too; no background job needed |
| "Sent" status | Finalizing sets *Sent* | Sharing is Phase 2, so *Sent* = issued |
| §5.2 `invoice_prefix` VARCHAR(10) | Validated to **1–4 chars** | GST invoice numbers may not exceed 16 characters (`SE/2026-27/001` = 14) |
| US-04 AC5 | + issued invoices snapshot the business profile & customer details | Editing a customer later must not rewrite an invoice already issued |
| Scenario table "Zero-rated / Export" | Invoice-level *Export / SEZ* toggle (zero tax) | Not derivable from customer state |
| Q1 FY format | `2026-27` | Open question — see `common/gst.py` / `billing/calc.py` |
| Q3/Q4/Q5/Q6 | Q5: finalized invoices are **locked** (cancel & re-issue). Q4: GSTIN validated by format only. Q6: `slug.{TENANT_BASE_DOMAIN}` | Still open in the PRD — defaults chosen so nothing blocks |
| GST slabs | 0/5/12/18/28 exactly as the PRD | ⚠ Verify against current GST Council notifications; the list is one constant in `common/gst.py` |

Limits: Free plan invoices count **drafts**; soft-deleted customers/products free their slot.

## Layout
```
backend/  config/ (settings, urls)  tenants/ (public schema: Business, Domain, plans, Razorpay, registration)
          accounts/ (profile, auth, OTP)  billing/ (customers, products, invoices, GST calc, PDF, dashboard)  common/  scripts/
frontend/ src/pages (public, auth, app)  src/components  src/lib (api, GST mirror, formatting)
```

## Known limits / next steps
- **Logos are stored in the database** (`accounts.LogoImage`, shrunk to <= 800x400 / ~250 KB on upload), so they survive redeploys on hosts with an ephemeral disk (Render free, Railway without a Volume). Each upload is a new immutable row, so a finalized invoice keeps the logo it was issued with. Nothing else is uploaded to disk today; invoice PDFs are generated on the fly from the stored invoice data.
- `nixpacks.toml` is a starting point for Railway and has not been deployed.
- Production subdomains need wildcard DNS + a wildcard TLS certificate for `*.app.techcognixium.com`.
- Phase 2 (sharing, reminders, GSTR-1, multi-user) is intentionally not built. Note `BusinessProfile` is one-per-user (per PRD AC7); multi-user will need it per-tenant.
