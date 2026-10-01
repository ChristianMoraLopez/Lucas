# syntax=docker/dockerfile:1.7
# ============================================================================
# Luks connector · imagen para linux/arm64 (Oracle Ampere A1) y linux/amd64
#
# Se construye desde la raíz del repo (usa el pnpm-lock.yaml del monorepo):
#   docker build -f services/connector/Dockerfile -t lucas-connector .
# En el servidor lo hace deploy/docker-compose.yml.
# ============================================================================

ARG NODE_VERSION=22

# ---------------------------------------------------------------------------
# 1. Compilar
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY supabase/package.json supabase/
COPY services/connector/package.json services/connector/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @lucas/connector...
COPY services/connector/tsconfig.json services/connector/tsconfig.build.json services/connector/
COPY services/connector/src services/connector/src
RUN pnpm --filter @lucas/connector build

# ---------------------------------------------------------------------------
# 2. Solo las dependencias de producción
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY supabase/package.json supabase/
COPY services/connector/package.json services/connector/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @lucas/connector...

# ---------------------------------------------------------------------------
# 3. Imagen final
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/services/connector/node_modules ./services/connector/node_modules
COPY --from=build /repo/services/connector/dist ./services/connector/dist
COPY services/connector/package.json ./services/connector/
WORKDIR /repo/services/connector
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.HEALTH_PORT || 8080) + '/health/vivo').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/main.js"]
