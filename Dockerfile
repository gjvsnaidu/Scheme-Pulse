# syntax=docker/dockerfile:1
FROM node:22-alpine AS web
WORKDIR /w
COPY web/package*.json ./
RUN npm ci
COPY web ./
RUN npm run build

FROM node:22-alpine AS api
WORKDIR /s
COPY server/package*.json ./
RUN npm ci
COPY server ./
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production SERVE_WEB=true WEB_DIST=/app/web/dist UPLOAD_DIR=/data/uploads PORT=4000
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev && mkdir -p /data/uploads && chown -R node:node /data
COPY --from=api /s/dist ./dist
COPY --from=web /w/dist /app/web/dist
USER node
EXPOSE 4000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://localhost:4000/api/health || exit 1
CMD ["node", "dist/index.js"]
