# syntax=docker/dockerfile:1.7

# Docker Hardened Images (DHI). Pulls require `docker login dhi.io`.
# Override these args if you mirror the images into another registry.
ARG NODE_DEV_IMAGE=dhi.io/node:24-alpine3.24-dev
ARG NODE_RUNTIME_IMAGE=dhi.io/node:24-alpine3.24

# ---------------------------------------------------------------------------
# Build stage: install dev dependencies, typecheck, build UI + bundled server.
# ---------------------------------------------------------------------------
FROM ${NODE_DEV_IMAGE} AS build

WORKDIR /app
ENV CI=1

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

COPY tsconfig.json vite.config.ts vitest.config.ts ./
COPY src ./src

RUN NODE_ENV=production npm run build \
 && test -f dist/web/index.html \
 && test -f dist/server/main.cjs \
 && mkdir -p /app/empty-data/cache

# ---------------------------------------------------------------------------
# Runtime stage: hardened Node image, no shell, non-root, bundled app only.
# ---------------------------------------------------------------------------
FROM ${NODE_RUNTIME_IMAGE} AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4780 \
    HOME=/data \
    DCTAGGER_DATA_DIR=/data \
    DCTAGGER_ROOT_FOLDER=/music \
    DCTAGGER_DESTINATION_FOLDER=/output

COPY --from=build --chown=1000:1000 /app/dist ./dist
COPY --from=build --chown=1000:1000 /app/package.json ./package.json
COPY --from=build --chown=1000:1000 /app/empty-data /data

USER 1000:1000
EXPOSE 4780
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||4780)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["node", "dist/server/main.cjs"]

LABEL org.opencontainers.image.title="DCTagger" \
      org.opencontainers.image.description="Local Discogs music tagger with review workspace and batch tagging pipeline" \
      org.opencontainers.image.source="https://github.com/nakedlittlezombie/dctagger"
