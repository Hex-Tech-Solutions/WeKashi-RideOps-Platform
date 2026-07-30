# Stage 1: builder
FROM node:20-slim AS builder
WORKDIR /app

# openssl is required by Prisma; build tools are needed for native modules (bcrypt)
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# Stage 2: runtime
FROM node:20-slim AS runtime
WORKDIR /app

# openssl for Prisma at runtime; wget for the healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r appgroup && useradd -r -g appgroup appuser

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json

# Uploads dir (persistent volume mounts here); created so the named volume
# inherits appuser ownership on first mount.
RUN mkdir -p /app/uploads

# Set ownership
RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/server.js"]
