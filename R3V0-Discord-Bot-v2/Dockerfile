FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY tests ./tests
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DATABASE_PATH=/app/data/goat.sqlite
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json config.json ./
COPY assets ./assets
RUN mkdir -p /app/data && chown -R node:node /app
USER node
CMD ["node", "dist/src/index.js"]
