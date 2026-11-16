# syntax=docker/dockerfile:1

# ---- build: compile the server, the CLI and the web front end ----
FROM node:26-trixie-slim AS build
# Compilers for better-sqlite3's native module.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.web.json vite.config.ts ./
COPY src ./src
# The font catalogue snapshot (src/shared/font-catalogue.json) ends up in dist/ (server) and, as the
# browser's projection of it (family names; ids are derived from them), in the web bundle; fail the build
# if it did not.
RUN npm run build \
 && test -s dist/shared/font-catalogue.json \
 && grep -q '"titan-one"' dist/shared/font-catalogue.json \
 && grep -lq 'Titan One' dist/web/assets/*.js \
 && npm prune --omit=dev --no-audit --no-fund

# ---- runtime ----
FROM node:26-trixie-slim
ENV NODE_ENV=production \
    NOTES_DATA_DIR=/data \
    PORT=3000
WORKDIR /app
COPY --from=build /src/package.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/dist ./dist
# The `notes` command (SPEC 9), and /data owned by the non-root user so a new
# named volume is writable on first start.
RUN printf '#!/bin/sh\nexec node /app/dist/cli/notes.js "$@"\n' > /usr/local/bin/notes \
 && chmod 755 /usr/local/bin/notes \
 && mkdir -p /data \
 && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "/app/dist/server/main.js"]
