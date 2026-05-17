# Tartı — Deployment

Three services, three platforms. Backend on Fly.io, landing on Vercel,
extension on the Chrome Web Store. Each section is self-contained; you
can deploy in any order, but the landing needs the backend's public URL
to be useful, and the extension's `host_permissions` need that URL too.

| Service | Platform | Cost |
|---|---|---|
| Backend (FastAPI) | Fly.io | Free for 1 machine, scale-to-zero |
| Postgres | Neon | Free tier (0.5 GB) |
| Landing (Next.js) | Vercel | Free hobby tier |
| Extension | Chrome Web Store | $5 one-time developer fee |

---

## 1. Backend → Fly.io + Neon

### Prereqs

- [`flyctl`](https://fly.io/docs/flyctl/install/) installed and `flyctl auth login` done
- A free [Neon](https://neon.tech) account

### 1a. Provision Postgres on Neon

1. Sign in to Neon, create a project `tarti-prod`
2. Copy the connection string — looks like `postgresql://USER:PASS@HOST/DB?sslmode=require`
3. SQLAlchemy's psycopg2 dialect needs the `+psycopg2` prefix. Final shape:

```
postgresql+psycopg2://USER:PASS@HOST/DB?sslmode=require
```

Save this value — you'll set it as `DATABASE_URL` below.

### 1b. Launch the Fly app

From the repo root:

```bash
cd backend
flyctl launch --no-deploy --name tarti-backend --region fra
```

`--no-deploy` lets us set secrets first. The wizard reads
[`backend/fly.toml`](backend/fly.toml) — accept its defaults.

### 1c. Set secrets

```bash
flyctl secrets set \
  DATABASE_URL='postgresql+psycopg2://USER:PASS@HOST/DB?sslmode=require' \
  GEMINI_API_KEY='AIzaSy...your_key...' \
  ALLOWED_ORIGINS='https://tarti.app,https://www.tarti.app'
```

| Secret | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection string (Neon or otherwise). Without it the app falls back to SQLite, which doesn't survive Fly machine restarts. |
| `GEMINI_API_KEY` | optional | Without it, agents use the deterministic fallback path. Quality drop but service still works. |
| `ALLOWED_ORIGINS` | ✅ | Comma-separated list of frontend origins. The `chrome-extension://*` regex is always allowed. |
| `GEMINI_MODEL` | optional | Defaults to `gemini-1.5-flash`. |
| `GEMINI_CACHE_TTL_SECONDS` | optional | Defaults to 900 (15 min). |

### 1d. Deploy

```bash
flyctl deploy
```

First deploy takes 2-3 minutes (image build + machine create + healthcheck wait). The lifespan runs Alembic migrations against Neon on the first machine to boot — subsequent deploys just upgrade if there are new revisions.

### 1e. Verify

```bash
flyctl status                            # machine should be "started"
curl https://tarti-backend.fly.dev/api/ready    # → {"status":"ok","db":"reachable"}
flyctl logs                              # tail structured JSON logs
```

In Fly's logs UI you'll see per-request entries like:

```json
{"ts":"2026-05-17T...","level":"INFO","logger":"tarti.request",
 "msg":"POST /api/analyze-purchase -> 200",
 "request_id":"...","method":"POST","path":"/api/analyze-purchase",
 "status":200,"duration_ms":42.1,"remote":"..."}
```

### 1f. Operational notes

- **Scale-to-zero:** [`fly.toml`](backend/fly.toml) sets `min_machines_running = 0`. First request after idle takes ~1-2s cold start. Set to 1 (and accept the $2/mo cost) for a warm process.
- **Readiness probe:** `/api/ready` runs `SELECT 1`, so a Neon hiccup fails fast and Fly routes traffic away.
- **Custom domain:** `flyctl certs add api.tarti.app` after pointing DNS A/AAAA records at Fly. Then update `ALLOWED_ORIGINS` to include `https://tarti.app` and `https://www.tarti.app`.

---

## 2. Landing → Vercel

### 2a. Connect the repo

1. Visit https://vercel.com/new
2. Import the GitHub repo
3. Set **Root Directory** = `landing/`
4. Framework preset: Next.js (auto-detected)

### 2b. Environment variables

In the Vercel project Settings → Environment Variables, add:

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_TARTI_API_BASE` | `https://tarti-backend.fly.dev` | URL from step 1d. Used by [`streamAnalyze.ts`](landing/lib/streamAnalyze.ts). |
| `NEXT_PUBLIC_SITE_URL` | `https://tarti.app` | Used by [`opengraph-image.tsx`](landing/app/opengraph-image.tsx), `robots.ts`, `sitemap.ts`. |

Both have the `NEXT_PUBLIC_` prefix so Next inlines them at build time.

### 2c. Deploy

Vercel auto-deploys on every push to `main`. First deploy builds + serves at `https://<project>.vercel.app`. Add a custom domain (e.g. `tarti.app`) in the project Settings → Domains; DNS is one A record (`76.76.21.21`).

### 2d. Verify

- Visit `https://tarti.app/` → Hero loads, preloader fades out
- Click **Analizi Başlat** → NDJSON request to `tarti-backend.fly.dev`, panel shows real verdict (not fallback fixture)
- View `https://tarti.app/opengraph-image` → see the rendered 1200×630 OG image
- View `https://tarti.app/robots.txt` and `/sitemap.xml`

---

## 3. Extension → Chrome Web Store

### 3a. Update production endpoints

In [`extension/src/background.ts`](extension/src/background.ts), point the three URLs at the deployed backend:

```ts
const ANALYZE_URL = "https://tarti-backend.fly.dev/api/analyze-purchase";
const ANALYZE_STREAM_URL = "https://tarti-backend.fly.dev/api/analyze-purchase/stream";
const OBSERVATION_URL = "https://tarti-backend.fly.dev/api/price-observation";
```

Add the production host to [`extension/manifest.json`](extension/manifest.json) `host_permissions`:

```json
"host_permissions": [
  "https://tarti-backend.fly.dev/*",
  "http://127.0.0.1:8000/*",
  "https://*.trendyol.com/*",
  ...
]
```

(Keep the localhost entries for dev parity.)

### 3b. Build the production zip

```bash
cd extension
npm ci
npm run build
cd dist && zip -r ../tarti-extension-v0.1.0.zip .
```

### 3c. Submit

1. Pay the $5 [Chrome Web Store developer fee](https://chrome.google.com/webstore/devconsole) (one-time, per account)
2. Click **New Item**, upload `tarti-extension-v0.1.0.zip`
3. Fill in store-listing fields:
   - **Title:** Tartı
   - **Description:** Satın almadan önce 5 saniyelik akıllı kontrol. Yorum güvenilirliği, sahte indirim ve bütçe aşımını tek karar rengiyle gösterir.
   - **Screenshots:** 5 images at 1280×800 — panel running on the demo page, on Trendyol, with green/yellow/red verdicts
   - **Category:** Shopping
   - **Privacy practices:** Declare what data you collect (we observe product URLs + prices — declare this)
4. Provide a **Privacy Policy URL** (Chrome requires one; host on `tarti.app/privacy` or a Gist)
5. Submit for review — turnaround is usually 1-3 days

### 3d. Privacy policy minimum content

Cover:
- Product URL + price observations sent to `tarti-backend.fly.dev` (anonymous, for crowdsource history)
- Anonymous installId stored in `chrome.storage.local`
- No PII, no tracking pixels, no analytics
- Data retention: append-only DB, contact email for deletion requests

---

## Troubleshooting

### Backend health endpoint returns 503

`/api/ready` is failing — usually means the DB connection is broken. Check:

- `flyctl secrets list` confirms `DATABASE_URL` is set
- Connection string includes `+psycopg2` after `postgresql`
- Neon hasn't suspended the project (free tier auto-suspends after inactivity; first request wakes it but might time out)

### `flyctl deploy` fails on healthcheck

Migrations may be taking longer than the 20s grace period. Bump `grace_period` in [`backend/fly.toml`](backend/fly.toml) to `60s` and redeploy.

### Landing demo always shows fallback fixture

The browser's CORS check is failing. Look in the page console for the actual error. Most common cause: `ALLOWED_ORIGINS` on the backend doesn't include the deployed landing URL.

### Extension can't reach backend

`host_permissions` in `manifest.json` must include the production backend URL. Reload the extension in `chrome://extensions` after changing manifest.
