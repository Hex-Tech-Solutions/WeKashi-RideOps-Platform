# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

# Prisma needs OpenSSL to pick the right query engine for the platform;
# without it, it warns and falls back to an openssl-1.1.x binary that may not
# match the image.
RUN apk add --no-cache openssl

# Install dependencies first (cached layer unless package.json changes)
COPY package*.json ./
RUN npm ci --no-audit --no-fund

# Copy source and build TypeScript
COPY . .

# Generate the Prisma client BEFORE tsc runs. Without this, @prisma/client is
# an unpopulated stub: Prisma.InputJsonValue doesn't exist, transaction clients
# are untyped, and the build dies with ~55 TS2694/TS7006 errors that look like
# unrelated "implicitly has an 'any' type" problems.
RUN npx prisma generate

RUN npm run build

# Prune dev dependencies — only keep production deps in the next stage.
#
# NOTE: `prisma` (the CLI) is intentionally a runtime dependency in
# package.json, not a devDependency, so it survives this prune. The container
# runs `npx prisma migrate deploy` on every boot (see the compose `command:`),
# and if the CLI were pruned, npx would try to DOWNLOAD it into node_modules at
# runtime — which fails, because the runtime stage runs as a non-root user that
# cannot write to /app/node_modules.
RUN npm prune --production

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

# Security: run as non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy only what's needed to run
COPY --from=build /app/dist           ./dist
COPY --from=build /app/node_modules   ./node_modules
COPY --from=build /app/package.json   ./package.json
COPY --from=build /app/prisma         ./prisma

# curl for the healthcheck; openssl so the Prisma query engine loads correctly
# when `prisma migrate deploy` runs at container startup.
RUN apk add --no-cache curl openssl

# Local upload dir, owned by the runtime user. Only used when
# AZURE_STORAGE_CONNECTION_STRING is unset (storage.ts falls back to disk);
# without this, appuser cannot mkdir under /app and uploads fail.
RUN mkdir -p /app/uploads && chown -R appuser:appgroup /app/uploads

# Switch to non-root user
USER appuser

EXPOSE 3000

# Migrations run in docker-compose command before starting server
CMD ["node", "dist/server.js"]
