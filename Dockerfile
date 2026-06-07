# syntax=docker/dockerfile:1

# Multi-Stage-Build für Next.js (standalone). glibc-Basis (bookworm) wegen der
# nativen Module sharp und @node-rs/argon2 (prebuilt linux-x64-gnu).
FROM node:22-bookworm-slim AS base
WORKDIR /app

# --- Dependencies ---
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# --- Build ---
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
# APP_BASE_URL wird NICHT zur Build-Zeit benötigt: issuer/Redirects lesen sie zur Laufzeit
# (getEnv()), CSRF nutzt den Origin↔Host-Abgleich (siehe next.config.mjs). Das Image ist damit
# deployment-URL-unabhängig – APP_BASE_URL kommt erst beim Start aus der .env (compose).
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- Runtime ---
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN groupadd -r nodejs && useradd -r -g nodejs nextjs

# Standalone-Output + statische Assets + Migrationen.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/drizzle ./drizzle

# Upload-Verzeichnis (wird per Volume gemountet); Ownership wird beim ersten
# Mount eines leeren Named-Volumes übernommen.
RUN mkdir -p /app/uploads && chown -R nextjs:nodejs /app/uploads

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
