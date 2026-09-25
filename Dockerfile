# Portal NR-1 — Express API + Vite SPA (produção Americana / Hostinger)
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update -qq && apt-get install -y -qq openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY server/package.json server/package-lock.json ./server/
COPY client/package.json client/package-lock.json ./client/
RUN npm ci \
  && cd server && npm ci \
  && cd ../client && npm ci

FROM deps AS build
WORKDIR /app
COPY . .
ARG DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ENV DATABASE_URL=$DATABASE_URL
ENV NODE_OPTIONS=--max-old-space-size=1536
RUN npx prisma generate \
  && cd server && npm run build \
  && cd ../client && npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV CLIENT_DIST=/app/client/dist
RUN apt-get update -qq && apt-get install -y -qq openssl ca-certificates wget \
  && rm -rf /var/lib/apt/lists/* \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs appuser

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/server/package.json /app/server/package-lock.json ./server/
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/config ./server/config
COPY --from=build /app/client/dist ./client/dist

RUN mkdir -p /app/uploads && chown -R appuser:nodejs /app/uploads

USER appuser
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=10s --retries=5 --start-period=90s \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

CMD ["sh", "-c", "npx prisma migrate deploy && node server/dist/server.js"]
