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
COPY server/package.json server/package.json
COPY frontend/package.json frontend/package.json
COPY harness-sidecar/package.json harness-sidecar/package.json
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
CMD ["node", "harness-sidecar/dist/main.js"]
