# Build context is server/ (so the image gets both api/ and migrations/)
FROM node:22-alpine

ENV NODE_ENV=production \
    MIGRATIONS_DIR=/app/migrations
WORKDIR /app/api

COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY api/src ./src
COPY migrations /app/migrations

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

# Node 22 runs the TypeScript sources directly (type stripping) – no build step
CMD ["node", "src/server.ts"]
