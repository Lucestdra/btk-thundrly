# Tartı — Project TODO

[![CI](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/ci.yml)

**Status:** All three projects at functional 100% for the hackathon scope — every data leg of the pipeline is real (no synthetic fallbacks unless the page truly has nothing to read). Backend has structured logging + readiness probe; extension has real reviews scraping, live session telemetry, persisted installId, branded icons; landing has full SEO + OG image + favicon. Pydantic is the single source of truth via OpenAPI typegen. **88/88 tests** across three suites.

**Working tree:** [`backend/`](backend/) (FastAPI + SQLAlchemy + LangGraph) · [`extension/`](extension/) (Manifest V3 + Vite) · [`landing/`](landing/) (Next.js 15) · [`shared/`](shared/) (TS types + demo fixtures)

---

## ✅ Done

### Backend
- [x] FastAPI app, CORS, lifespan, Alembic-managed schema (revisions 0001 + 0002)
- [x] 5 deterministic agents (review / price / budget / impulse / decision)
- [x] LangGraph orchestration: 4 parallel signal nodes fan in to decision_node
- [x] `POST /api/analyze-purchase` — single response
- [x] `POST /api/analyze-purchase/stream` — NDJSON, one event per node completion + final `verdict`
- [x] `POST /api/price-observation` — crowdsource ingest, 60/min/IP via slowapi
- [x] `GET` / `PUT /api/user-budget` — per (user_id, category)
- [x] `GET /api/health` (liveness) + **`GET /api/ready`** (readiness — asserts DB reachable)
- [x] `price_observations` table — URL normalization for Trendyol/Hepsiburada/N11, daily median collapse for poison resistance
- [x] `user_budgets` table — composite PK (user_id, category), permissive default when missing
- [x] **Gemini integration** (review_agent + decision_agent) with deterministic fallback when no `GEMINI_API_KEY`
- [x] **Gemini response cache** — in-memory TTL+LRU, model-name keyed (auto-invalidates on model swap)
- [x] **Decision color is always heuristic** — LLM only writes the prose around `_compute_decision`
- [x] **Structured JSON logging + per-request middleware** — `LOG_FORMAT=json` opt-in, `X-Request-ID` echo for correlation
- [x] Seed loader for canonical fixtures (idempotent per table)
- [x] OpenAPI dump script → `shared/openapi.json`
- [x] **43 pytest tests** (`backend/tests/`)

### Extension (Chrome MV3)
- [x] Background service worker — `analyze` and `priceObservation` message handlers + `analyze-stream` port
- [x] Content script — capture-phase click interception on "Sepete Ekle"
- [x] Shadow DOM panel mount
- [x] **SPA navigation re-observation** — wraps `pushState`/`replaceState`, listens to `popstate`/`hashchange`
- [x] Platform selector packs ([`platformSelectors.ts`](extension/src/utils/platformSelectors.ts)) for Trendyol/Hepsiburada/N11
- [x] **Turkish-aware `parsePrice`** — handles `"1.249,90 TL"`, `"₺1.249"`, `"1,249.90 USD"`, etc.
- [x] Product extractor priority chain: demo data-attrs → JSON-LD → microdata → platform → og:meta
- [x] **Real reviews scraping** — per-platform review widget selectors + demo-page data-attrs; falls back to fixture only when zero reviews matched
- [x] **Real session telemetry** — page-view timer (SPA-aware), click-speed via mousedown capture, `purchasesToday` from `chrome.storage.local`, `searchedBefore` from URL LRU
- [x] **Per-user installId** — random UUID in `chrome.storage.local`, falls back to `"demo-user"` outside the extension
- [x] **Streaming panel** with min-floor pacing (`STAGE_MIN_RUNNING_MS=280`, `MIN_TOTAL_MS=1800`)
- [x] Graceful fallback: streaming fails → legacy one-shot endpoint → fixture
- [x] **Manifest icons** at 16/32/48/128 — generated via `npm run icons:build` (pure-JS `pngjs`, no native deps)
- [x] **34 vitest tests** (`extension/test/`) — parsePrice, productExtractor, real-site DOM fixtures

### Landing (Next.js 15)
- [x] All sections: Hero, Problem, Solution, AgentSystem, LiveDemo, WhyUnique, Audience, VerdictShowcase, FinalCTA, Footer
- [x] **Streaming live demo** — `LiveDemoSection` consumes NDJSON via [`streamAnalyze.ts`](landing/lib/streamAnalyze.ts), falls back to simulator
- [x] Preloader, "Tartı" branding, cool-blue palette, verdict colors
- [x] **Favicon + Apple-touch icon** from generated PNGs
- [x] **OpenGraph + Twitter card image** rendered via `next/og` (`app/opengraph-image.tsx`)
- [x] **Full SEO metadata** — title template, canonical, keywords, robots, OG + Twitter
- [x] **`robots.ts` + `sitemap.ts`** — pointing at `NEXT_PUBLIC_SITE_URL`
- [x] **11 vitest tests** for `streamAnalyze` — chunk boundaries, partial lines, malformed JSON, error mid-stream, HTTP failures

### Shared / cross-cutting
- [x] **OpenAPI typegen** — Pydantic schemas → `shared/openapi.json` → `openapi.generated.ts` → re-exports under existing names. Drift impossible by construction.
- [x] Canonical demo fixtures (`red` hoodie / `yellow` headphones / `green` book) — same data drives extension fallback, landing demo, backend tests

### Total live verification
- [x] **88/88 tests across 3 suites**
- [x] Clean type-check (`tsc --noEmit`) on extension + landing
- [x] Clean extension build (`vite build`)

---

## 🟡 Active queue — Infrastructure (next focus)

- [x] **CI workflow (GitHub Actions)** — [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs four jobs on every push/PR: `backend` (pytest), `extension` (vitest + build), `landing` (vitest + typecheck), and `schema-drift` (regenerates openapi.json + TS types, fails on `git diff --exit-code`). Schema drift gate locally verified — fake field injection caught, restoration green.
- [ ] **Deploy backend** — Fly.io or Railway with managed Postgres, `DATABASE_URL` + `GEMINI_API_KEY` env vars, structured logs (`LOG_FORMAT=json`), `/api/ready` health probe. ~3 hours.
- [ ] **Deploy landing** — Vercel, point `NEXT_PUBLIC_TARTI_API_BASE` + `NEXT_PUBLIC_SITE_URL` at prod. ~30 min.
- [ ] **Chrome Web Store submission** — privacy policy + screenshots + 128px tile icon + listing copy. ~1 day with policy assets.

---

## 🔴 Backlog (longer-term, lower priority)

### Backend hardening
- [ ] Auth — proper user accounts beyond the anonymous installId (sign-up flow, email or OAuth). Today's installId is anonymous-stable, which is enough for budget personalization but not multi-device.
- [ ] Redis-backed Gemini cache + slowapi storage (multi-instance support)
- [ ] Metrics (Prometheus or OpenTelemetry) — structured logs are in; counters/histograms next
- [ ] Real external price-tracking source as a fallback for cold-start URLs (Akakce / cimri scraping or paid API)
- [ ] Per-platform "yasal 30 günün en düşük fiyatı" scraping — when crowdsource DB has no history, parse the legally-mandated text from the page

### Extension UX
- [ ] User settings page (popup or options page) — view budget, see analysis history, manage notifications
- [ ] `chrome.storage` history of verdicts (locally, optional sync)
- [ ] English locale (for international hackathon judges)
- [ ] Test coverage for background.ts port handling (mock `chrome.runtime.connect`)

### Landing
- [ ] Component tests beyond `streamAnalyze` (sections, panel, etc.)
- [ ] Lighthouse audit + perf budget
- [ ] Analytics (Plausible / Umami — privacy-conscious)
- [ ] Mobile pass — sections were built desktop-first, breakpoints exist but not exercised on real devices

### Infrastructure / ops
- [ ] Custom domain + HTTPS (Let's Encrypt or Caddy on the backend host)
- [ ] Privacy policy + terms (required for Chrome Web Store submission)
- [ ] Brand assets — Logo PNG/SVG at 16/48/128 for extension icons + favicon set
- [ ] Database backups for the Postgres prod store

### Nice-to-have
- [ ] Dark mode for the landing (currently fixed cool-blue light theme)
- [ ] i18n scaffold (next-i18next or similar)
- [ ] Accessibility audit (axe-core)
- [ ] WebSocket alternative to NDJSON streaming (bidirectional if needed for cancel)
- [ ] Replay mode — given a stored AnalyzeResponse, re-run the panel animation deterministically (useful for support / debugging)

---


## How to run everything locally

```bash
# 1. Backend (terminal A)
cd backend
.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 2. Demo page server (terminal B) — for testing the extension in Chrome
cd extension && npm run build
cd dist && python -m http.server 4173 --bind 127.0.0.1

# 3. Landing (terminal C)
cd landing && npm run dev

# 4. Load the extension in Chrome
#    chrome://extensions → Developer mode ON → Load unpacked → extension/dist/

# 5. Visit
#    http://127.0.0.1:4173/public/demo-product.html  (extension test page)
#    http://localhost:3000/                          (landing with live demo)
#    http://127.0.0.1:8000/docs                      (Swagger UI)
```

## How to run all tests

```bash
cd backend && .venv/Scripts/python.exe -m pytest            # 43 tests
cd extension && npm test                                    # 34 tests
cd landing && npm test                                      # 11 tests
```

## Regenerating types after a schema change

```bash
cd backend && .venv/Scripts/python.exe -m scripts.dump_openapi
cd ../extension && npm run types:gen
```

---

_Last updated: 2026-05-16. Edit this file directly when scope changes; it's the canonical roadmap._
