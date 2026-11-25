# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS node-base

FROM node-base AS react-source
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
ENV VITE_AZURACAST_STATION=ghmaas_baladi_radio \
    VITE_PUBLIC_RADIO_ORIGIN=https://hussam.tail1a8390.ts.net \
    VITE_STREAM_URL=""

FROM react-source AS public-build
RUN VITE_ADMIN_ENABLED=false npm run build

FROM react-source AS private-build
RUN VITE_ADMIN_ENABLED=true npm run build -- --outDir dist-admin --emptyOutDir

FROM node-base AS backend-source
WORKDIR /build/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY backend/ ./
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node-base AS frontend
WORKDIR /app
ENV NODE_ENV=production
COPY --from=backend-source /build/backend/node_modules/ ./node_modules/
COPY --from=public-build /build/frontend/dist/ /srv/
COPY deploy/docker/preview.mjs ./preview.mjs
USER 1000:1000
EXPOSE 8080
CMD ["node", "preview.mjs"]

FROM node-base AS backend
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates ffmpeg && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=backend-source /build/backend/package.json ./
COPY --from=backend-source /build/backend/node_modules/ ./node_modules/
COPY --from=backend-source /build/backend/dist/ ./dist/
COPY --from=private-build /build/frontend/dist-admin/ ./frontend/
COPY --chmod=0755 deploy/docker/start-admin.sh /usr/local/bin/start-admin
USER 1000:1000
EXPOSE 18090
ENTRYPOINT ["/usr/local/bin/start-admin"]
CMD ["dist/server.js"]
