FROM node:24-bookworm-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY agent-intro-frontend/package.json agent-intro-frontend/package.json
COPY frontend/package.json frontend/package.json
COPY harness-sidecar/package.json harness-sidecar/package.json
COPY server/package.json server/package.json
COPY packages/agent-spec/package.json packages/agent-spec/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN pnpm install --frozen-lockfile

COPY agent-intro-frontend agent-intro-frontend
RUN pnpm --filter @role-clarifier/intro-web build

FROM caddy:2.10-alpine
ENV PORT=80
COPY agent-intro-frontend/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/agent-intro-frontend/dist /srv
EXPOSE 80
