FROM oven/bun:1.3.14 AS build

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

RUN bun install --frozen-lockfile
RUN bun scripts/stage-site-package.mjs ${CMS_SITE_PACKAGE_ID} --validate-only
COPY webapp webapp
COPY website website

ARG VITE_API_URL
ARG PUBLIC_WEBSITE_URL
ARG PUBLIC_WEBAPP_URL
ENV VITE_API_URL=${VITE_API_URL}
ENV PUBLIC_WEBSITE_URL=${PUBLIC_WEBSITE_URL}
ENV PUBLIC_WEBAPP_URL=${PUBLIC_WEBAPP_URL}

RUN bun run build:webapp
RUN bun run build:website

FROM scratch AS export
COPY --from=build /app/webapp/dist /webapp
COPY --from=build /app/website/dist /website
