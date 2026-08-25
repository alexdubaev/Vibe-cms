FROM oven/bun:1.3.14 AS selected-site-package

WORKDIR /app

ARG CMS_SITE_PACKAGE_ID

COPY scripts/stage-site-package.mjs scripts/stage-site-package.mjs
COPY packages/contracts packages/contracts
COPY site-packages site-packages
RUN test -n "${CMS_SITE_PACKAGE_ID}" && bun scripts/stage-site-package.mjs ${CMS_SITE_PACKAGE_ID} --prepare

COPY package.json bun.lock bunfig.toml ./
COPY backend/package.json backend/package.json
COPY webapp/package.json webapp/package.json
COPY website/package.json website/package.json
COPY website-builder/package.json website-builder/package.json

RUN bun install --frozen-lockfile --ignore-scripts --filter @vibe-cms/selected-site-package
RUN bun scripts/stage-site-package.mjs ${CMS_SITE_PACKAGE_ID} --validate-only

FROM oven/bun:1.3.14 AS build

WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
COPY backend/package.json backend/package.json
COPY webapp/package.json webapp/package.json
COPY website/package.json website/package.json
COPY website-builder/package.json website-builder/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY --from=selected-site-package /app/packages/selected-site-package packages/selected-site-package

RUN bun install --frozen-lockfile --network-concurrency=4 --filter @web-app-demo/backend

COPY packages/contracts packages/contracts
COPY backend backend

WORKDIR /app/backend

RUN DATABASE_URL="postgresql://superuser:superpassword@localhost:5432/web_app_demo?schema=public" bun run prisma:generate

FROM build AS production-dependencies

WORKDIR /app

RUN rm -rf /app/node_modules
RUN bun install --frozen-lockfile --network-concurrency=4 --production --filter @web-app-demo/backend

FROM oven/bun:1.3.14 AS runtime

WORKDIR /app

COPY --from=build /app/package.json /app/bun.lock /app/bunfig.toml ./
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/packages/contracts ./packages/contracts
COPY --from=build /app/packages/selected-site-package ./packages/selected-site-package
COPY --from=build /app/backend ./backend

WORKDIR /app/backend

ENV NODE_ENV=production

USER bun

CMD ["bun", "src/index.ts"]
