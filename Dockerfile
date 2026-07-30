# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json bun.lockb* ./
RUN npm install --no-audit --no-fund
COPY . .
# Vite bakes VITE_* at build time. Pass the Google Maps key (and Razorpay key id)
# from .env.prod via compose build args so the deployed bundle picks them up.
ARG VITE_GOOGLE_MAPS_KEY=""
ARG VITE_RAZORPAY_KEY_ID=""
ENV VITE_GOOGLE_MAPS_KEY=$VITE_GOOGLE_MAPS_KEY
ENV VITE_RAZORPAY_KEY_ID=$VITE_RAZORPAY_KEY_ID
RUN npm run build

# ---------- runtime ----------
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
