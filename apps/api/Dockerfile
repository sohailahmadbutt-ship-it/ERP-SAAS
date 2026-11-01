# Built from the repository root: docker build -f apps/api/Dockerfile .
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma
RUN pnpm install --frozen-lockfile --filter api...
COPY apps/api apps/api
RUN pnpm --filter api build && pnpm --filter api deploy --prod --legacy /out \
 && cd /out && npx prisma generate --schema prisma/schema.prisma

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out ./
COPY --from=build /repo/apps/api/dist ./dist
USER node
EXPOSE 4000
# Apply any new migrations, then start.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
