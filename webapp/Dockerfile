FROM oven/bun:1.3.14 AS selected-site-package

WORKDIR /app

ARG CMS_SITE_PACKAGE_ID=vibe-core

COPY package.json bun.lock bunfig.toml ./
COPY backend/package.json backend/package.json
COPY webapp/package.json webapp/package.json
COPY website/package.json website/package.json
COPY website-builder/package.json website-builder/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/selected-site-package/package.json packages/selected-site-package/package.json

RUN bun install --frozen-lockfile --ignore-scripts --filter @vibe-cms/selected-site-package

COPY scripts/stage-site-package.mjs scripts/stage-site-package.mjs
COPY packages/contracts packages/contracts
COPY site-packages site-packages

RUN rm -rf /app/packages/selected-site-package
RUN bun scripts/stage-site-package.mjs ${CMS_SITE_PACKAGE_ID}

FROM oven/bun:1.3.14 AS build

WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
COPY backend/package.json backend/package.json
COPY webapp/package.json webapp/package.json
COPY website/package.json website/package.json
COPY website-builder/package.json website-builder/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY --from=selected-site-package /app/packages/selected-site-package packages/selected-site-package

RUN bun install --frozen-lockfile --ignore-scripts --network-concurrency=4 --filter @web-app-demo/webapp

COPY packages/contracts packages/contracts
COPY webapp webapp

RUN bun run --cwd webapp build

FROM nginx:1.29-alpine AS runtime

COPY --from=build /app/webapp/dist /usr/share/nginx/html

EXPOSE 80
