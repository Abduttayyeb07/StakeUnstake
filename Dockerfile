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
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# checkpoint, backfill cursor, dedupe set + subscribers live in /data
# so they survive container restarts
ENV STATE_FILE=/data/state.json
ENV BACKFILL_STATE_FILE=/data/backfill-state.json
ENV DEDUPE_FILE=/data/alerts-seen.json
ENV SUBSCRIBERS_FILE=/data/subscribers.json
RUN mkdir -p /data && chown node:node /data
VOLUME /data

USER node
CMD ["node", "dist/src/index.js"]
