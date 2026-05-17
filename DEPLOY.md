# Thundrly — Deployment (Ubuntu 24.04 + Docker + Nginx)

Single-server deployment. Docker Compose runs Postgres + backend + landing
on the loopback interface; host-installed Nginx terminates TLS and
reverse-proxies. Domain: `thundrly.com` (landing) + `api.thundrly.com`
(backend).

```
┌─────────────────────────────────────────────────────────────┐
│  Ubuntu 24.04 server (your VPS)                             │
│                                                             │
│   nginx :443 ──┬─→ thundrly.com         → 127.0.0.1:3000 ──┐│
│                │                          (landing container)│
│                │                                            │
│                └─→ api.thundrly.com     → 127.0.0.1:8000 ──┐│
│                                            (backend container)│
│                                                  │          │
│   docker compose network ────────────── postgres :5432    ──┘│
└─────────────────────────────────────────────────────────────┘
```

---

## 1. One-time server bootstrap

### 1a. SSH in + base packages

```bash
ssh user@your-server
sudo apt update && sudo apt upgrade -y
sudo apt install -y git nginx ufw certbot python3-certbot-nginx
```

### 1b. Install Docker + Compose (official repo)

```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Allow running docker without sudo for your user (re-login after).
sudo usermod -aG docker $USER
```

### 1c. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'   # opens 80 + 443
sudo ufw enable
```

Postgres (5432) and the app ports (3000, 8000) stay closed — they bind
to `127.0.0.1` only, so Nginx on the host is the only thing that can
reach them.

### 1d. DNS

Point both records at your server's public IP:

```
thundrly.com.       A   <YOUR_IP>
www.thundrly.com.   A   <YOUR_IP>
api.thundrly.com.   A   <YOUR_IP>
```

Wait for `dig +short thundrly.com api.thundrly.com` to return the right
IP before continuing (5-30 min depending on registrar).

---

## 2. Pull + configure the project

```bash
sudo mkdir -p /srv && sudo chown $USER:$USER /srv
cd /srv
git clone https://github.com/Lucestdra/btk-tarti.git thundrly
cd thundrly
```

### 2a. Create the production `.env`

```bash
cp .env.example .env
# Generate a strong Postgres password
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> .env
# Optional — Gemini key for the richer LLM-narrated verdicts
echo "GEMINI_API_KEY=AIzaSy..." >> .env
nano .env   # clean up any duplicate lines from the appends above
```

`.env` is gitignored — never commit it.

---

## 3. Build + launch the stack

```bash
cd /srv/thundrly
docker compose up -d --build
```

First build takes 3-5 min (downloads Python + Node + Postgres base images,
runs pip install + npm ci + next build). Watch logs:

```bash
docker compose logs -f --tail=50
```

Wait for these signals before moving on:

- `thundrly-postgres ... database system is ready to accept connections`
- `thundrly-backend ... INFO ... Uvicorn running on http://0.0.0.0:8000`
- `thundrly-landing ... ✓ Ready in 1234ms`

### 3a. Sanity-check from the host

```bash
curl http://127.0.0.1:8000/api/ready
# {"status":"ok","service":"thundrly-backend","db":"reachable"}

curl -I http://127.0.0.1:3000/
# HTTP/1.1 200 OK   …  X-Powered-By: Next.js
```

---

## 4. Nginx + TLS

### 4a. Drop in the vhost configs

```bash
sudo cp /srv/thundrly/deploy/nginx/api.thundrly.com.conf  /etc/nginx/sites-available/
sudo cp /srv/thundrly/deploy/nginx/thundrly.com.conf      /etc/nginx/sites-available/

sudo ln -s /etc/nginx/sites-available/api.thundrly.com.conf /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/thundrly.com.conf     /etc/nginx/sites-enabled/

sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t && sudo systemctl reload nginx
```

At this point HTTP works (port 80 only). HTTPS lines in the configs are
commented out — certbot fills them in.

### 4b. Issue Let's Encrypt certificates

```bash
sudo certbot --nginx \
  -d thundrly.com -d www.thundrly.com \
  -d api.thundrly.com \
  --redirect \
  --agree-tos -m you@thundrly.com
```

Certbot edits the vhost files in-place, adds `ssl_certificate` /
`ssl_certificate_key` lines, and inserts the HTTPS server blocks. It
schedules its own renewal via `systemd.timer` — no cron entry needed.

Verify auto-renewal:

```bash
sudo systemctl status certbot.timer
sudo certbot renew --dry-run
```

### 4c. Final smoke test

```bash
curl https://api.thundrly.com/api/ready
# {"status":"ok","service":"thundrly-backend","db":"reachable"}

curl -I https://thundrly.com/
# HTTP/2 200

# Streaming endpoint sanity — should print 5 NDJSON lines without buffering
curl -N -X POST https://api.thundrly.com/api/analyze-purchase/stream \
  -H 'content-type: application/json' \
  --data-binary @- <<'JSON'
{"userId":"deploy-smoketest","platform":"trendyol","product":{"title":"x","price":100,"currency":"TRY","category":"Test","url":"https://x/p"},"reviews":[],"priceHistory":[],"session":{"timeOnPageSeconds":1,"clickSpeedMs":1,"currentHour":12,"purchasesToday":0}}
JSON
```

Open the landing in a browser: <https://thundrly.com/>. Click
**Analizi Başlat** — the NDJSON request should hit
`api.thundrly.com/api/analyze-purchase/stream` (Network tab confirms),
and the panel renders the real verdict (not the fallback fixture).

---

## 5. Day-to-day operations

### Update + redeploy

```bash
cd /srv/thundrly
git pull
docker compose up -d --build
```

Migrations run automatically on backend startup (see
`backend/app/db/migrations.py`). New Alembic revisions just apply.

### Tail logs

```bash
docker compose logs -f --tail=200 backend    # JSON-structured request logs
docker compose logs -f --tail=200 landing
```

### Restart a single service

```bash
docker compose restart backend
```

### Postgres shell

```bash
docker compose exec postgres psql -U thundrly thundrly
```

### Backup the database

```bash
docker compose exec -T postgres pg_dump -U thundrly thundrly | \
  gzip > /srv/thundrly/backups/$(date +%Y%m%d).sql.gz
```

Add to cron or `systemd.timer` for daily backups.

---

## 6. Update the extension

The extension's [`src/config.ts`](extension/src/config.ts) already swaps
`http://127.0.0.1:8000` → `https://api.thundrly.com` based on
`import.meta.env.PROD`, so:

```bash
cd extension
npm ci
npm run build         # produces extension/dist with production URLs baked in
cd dist && zip -r ../thundrly-extension-v0.1.0.zip .
```

Upload the resulting zip to the Chrome Web Store dashboard. Once
published, users get auto-updates pushed to their browsers.

For local dev (extension calling local backend) the same `npm run dev`
flow works — `import.meta.env.PROD === false` selects the localhost URLs.

---

## Troubleshooting

### `docker compose up` fails to start backend

```bash
docker compose logs backend
```

Common cause: `DATABASE_URL` malformed, or Postgres hasn't finished
starting. Compose waits on `postgres.condition: service_healthy`, but
the first boot can take 10-15s longer than the healthcheck's
`start_period`. Just run `docker compose up -d` again.

### Nginx returns 502 Bad Gateway

The proxy can't reach the container. Check:

```bash
sudo ss -tlnp | grep -E '3000|8000'
# Should show TWO lines, both bound to 127.0.0.1
```

If the ports aren't bound, `docker compose ps` will show the service as
"unhealthy" or "exited" — check its logs.

### Streaming endpoint returns 200 but panel sees no events

Nginx is buffering. Confirm the config has `proxy_buffering off;` in the
`api.thundrly.com` vhost. Reload nginx after any config change:
`sudo nginx -t && sudo systemctl reload nginx`.

### Free-tier disk filling up with Docker images

```bash
docker system prune -af --volumes        # drops unused images + volumes
docker compose down && docker compose up -d --build
```

Postgres data is in the named volume `thundrly-postgres-data` which
`prune --volumes` does NOT remove unless it's truly orphaned (the
compose service still references it).

### CORS errors in browser

Backend's `ALLOWED_ORIGINS` (set in `docker-compose.yml`) must include
the deployed landing origin. After changing, `docker compose up -d`
restarts only the backend container.
