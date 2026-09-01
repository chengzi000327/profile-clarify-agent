FROM node:24-bookworm-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/agent-spec/package.json packages/agent-spec/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/harness-sidecar/package.json apps/harness-sidecar/package.json
COPY apps/intro-web/package.json apps/intro-web/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

COPY apps/web apps/web
RUN pnpm --filter @role-clarifier/web build

FROM caddy:2.10-alpine
ENV PORT=80
ENV API_UPSTREAM=http://api:4100
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
EXPOSE 80
