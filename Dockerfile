# FinSentinel container image (STAGE05 profile B). Built on GitHub runners; the dev machine has no Docker.
# Single Node 24 process: Fastify API + built React app + SQLite on the /data volume.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DB_PATH=/data/finsentinel.db \
    UPLOAD_DIR=/data/uploads \
    BACKUP_DIR=/data/backups \
    LLM_GATEWAY=mock \
    SEED_ON_START=0
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/web/dist ./web/dist
COPY src ./src
COPY config ./config
COPY prompts ./prompts
COPY policies ./policies
COPY samples ./samples
COPY tests/fixtures ./tests/fixtures
COPY scripts/smoke.ts scripts/backup.ts scripts/restore.ts scripts/migrate.ts scripts/seed.ts ./scripts/
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# SESSION_SECRET (>= 32 chars) must be supplied at run time; the app refuses to start without it.
CMD ["node", "--env-file-if-exists=.env", "src/server.ts"]
