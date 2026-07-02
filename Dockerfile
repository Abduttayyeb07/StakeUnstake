# ---- build stage: compile TypeScript ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# ---- runtime stage: production deps only ----
FROM node:22-alpine
RUN apk add --no-cache su-exec
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# checkpoint, backfill cursor, dedupe set + subscribers live in /data
# so they survive container restarts
ENV STATE_FILE=/data/state.json
ENV BACKFILL_STATE_FILE=/data/backfill-state.json
ENV DEDUPE_FILE=/data/alerts-seen.json
ENV SUBSCRIBERS_FILE=/data/subscribers.json
VOLUME /data

# container starts as root so the entrypoint can chown the (host-owned)
# bind-mounted /data volume, then it drops to the unprivileged node user
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/src/index.js"]
