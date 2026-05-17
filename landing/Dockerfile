# syntax=docker/dockerfile:1.7
# Three stages: deps → build → runtime.
# Final runtime image is the Next.js "standalone" output, which is a
# minimal Node server with only the deps actually imported at runtime.
#
# Build context is the repo root (so `shared/` is reachable). See
# `docker-compose.yml` for the `context: .` + `dockerfile: landing/Dockerfile`
# configuration.

# ---------- Deps ----------
FROM node:20-alpine AS deps
WORKDIR /app
COPY landing/package.json landing/package-lock.json ./
RUN npm ci --ignore-scripts

# ---------- Build ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY landing ./
# `shared/` is consumed via the @shared/* path alias.
COPY shared ../shared

# Next.js inlines NEXT_PUBLIC_* at build time, so they must be present
# here. docker-compose passes them through as `args:`.
ARG NEXT_PUBLIC_THUNDRLY_API_BASE
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_THUNDRLY_API_BASE=${NEXT_PUBLIC_THUNDRLY_API_BASE} \
    NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---------- Runtime ----------
FROM node:20-alpine AS runtime
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Static assets + standalone server.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

EXPOSE 3000

CMD ["node", "server.js"]
