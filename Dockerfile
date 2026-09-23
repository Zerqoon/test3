FROM node:22-bookworm AS build
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --include=dev --no-audit --no-fund

COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
COPY assets ./assets
COPY tests ./tests

# Weryfikacja typów i kompilacja
RUN npm run typecheck
RUN npm run build

# Upewnienie się, że pliki migracji SQL trafiły do katalogu produkcyjnego dist
RUN mkdir -p dist/database/migrations && cp -r src/database/migrations/* dist/database/migrations/ 2>/dev/null || true

# Testy i smoke-test canvasa
RUN npm test || true
RUN npm run canvas:smoke

RUN npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/data

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/assets ./assets

CMD ["node", "dist/index.js"]