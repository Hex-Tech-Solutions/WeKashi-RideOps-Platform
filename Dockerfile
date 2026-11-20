# ── Stage 1: Build React app ──────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

# Install dependencies (cached unless package.json changes)
COPY package*.json ./
RUN npm ci --no-audit --no-fund

# Copy source
COPY . .

# Vite bakes VITE_* vars at build time — passed as build args from docker-compose.
# Cashfree checkout needs no build-time key (the SDK uses a runtime session id).
ARG VITE_GOOGLE_MAPS_KEY=""
ENV VITE_GOOGLE_MAPS_KEY=$VITE_GOOGLE_MAPS_KEY

RUN npm run build

# ── Stage 2: Serve with nginx ─────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# Copy built assets
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx config + the shared security-headers snippet it includes
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/conf.d/security-headers.conf

# Connection limits. The stock image allows 1024 connections / file descriptors
# per worker, and every proxied socket.io connection uses two (client + API).
# Load test (Nov 2026): at ~2,000 open sockets nginx ran out of descriptors and
# answered EVERY request with 500. Raise both, and fail the build if the edit
# didn't apply.
RUN sed -i -E 's/worker_connections +[0-9]+;/worker_connections 16384;/' /etc/nginx/nginx.conf \
 && sed -i '1i worker_rlimit_nofile 65535;' /etc/nginx/nginx.conf \
 && grep -q 'worker_connections 16384;' /etc/nginx/nginx.conf \
 && grep -q '^worker_rlimit_nofile 65535;' /etc/nginx/nginx.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
