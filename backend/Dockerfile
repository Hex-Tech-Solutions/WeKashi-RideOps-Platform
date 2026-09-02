# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

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

# Prune dev dependencies — only keep production deps in the next stage
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

# Install curl for health checks (minimal)
RUN apk add --no-cache curl

# Switch to non-root user
USER appuser

EXPOSE 3000

# Migrations run in docker-compose command before starting server
CMD ["node", "dist/server.js"]
