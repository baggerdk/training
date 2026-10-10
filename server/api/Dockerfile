# Build context is the repo root (see server/compose.yml): the image needs the API, the migrations, the admin
# website and the app's shared exercise/template code. /.dockerignore is an allowlist of exactly those files.
FROM node:22-alpine

ENV NODE_ENV=production \
    MIGRATIONS_DIR=/app/migrations \
    ADMIN_DIR=/app/admin \
    SHARED_DIR=/app/shared
WORKDIR /app/api

COPY server/api/package.json server/api/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server/api/src ./src
COPY server/migrations /app/migrations
COPY server/admin /app/admin
COPY js/data.js js/ids.js js/templates.js js/progression.js js/sync-map.js js/guide.js /app/shared/js/
COPY img /app/shared/img

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

# Node 22 runs the TypeScript sources directly (type stripping) – no build step
CMD ["node", "src/server.ts"]
