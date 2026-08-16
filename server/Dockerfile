FROM node:24-bookworm-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/agent-spec/package.json packages/agent-spec/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY server/package.json server/package.json
COPY frontend/package.json frontend/package.json
RUN pnpm install --frozen-lockfile

COPY packages/agent-spec packages/agent-spec
COPY packages/contracts packages/contracts
COPY packages/domain packages/domain
COPY server server
RUN pnpm --filter @role-clarifier/contracts build \
    && pnpm --filter @role-clarifier/domain build \
    && pnpm --filter @role-clarifier/api build

EXPOSE 4100
CMD ["sh", "-c", "pnpm --filter @role-clarifier/api db:migrate && pnpm --filter @role-clarifier/api start"]
