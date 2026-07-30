# ── Stage 1: Build React app ──────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

# Install dependencies (cached unless package.json changes)
COPY package*.json ./
RUN npm ci --no-audit --no-fund

# Copy source
COPY . .

# Vite bakes VITE_* vars at build time — passed as build args from docker-compose
ARG VITE_GOOGLE_MAPS_KEY=""
ARG VITE_RAZORPAY_KEY_ID=""
ENV VITE_GOOGLE_MAPS_KEY=$VITE_GOOGLE_MAPS_KEY
ENV VITE_RAZORPAY_KEY_ID=$VITE_RAZORPAY_KEY_ID

RUN npm run build

# ── Stage 2: Serve with nginx ─────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# Copy built assets
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx config
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
