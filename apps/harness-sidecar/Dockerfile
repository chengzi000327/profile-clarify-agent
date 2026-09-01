FROM node:24-bookworm AS build

RUN corepack enable

RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/agent-spec/package.json packages/agent-spec/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/harness-sidecar/package.json apps/harness-sidecar/package.json
COPY apps/intro-web/package.json apps/intro-web/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @role-clarifier/contracts build
RUN pnpm --filter @role-clarifier/harness-sidecar build
RUN pnpm harness:prepare

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 4110
CMD ["node", "apps/harness-sidecar/dist/main.js"]
