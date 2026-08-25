FROM oven/bun:1.3.14 AS build

WORKDIR /app

ARG CMS_SITE_PACKAGE_ID=vibe-core

COPY package.json bun.lock bunfig.toml ./
COPY backend/package.json backend/package.json
COPY webapp/package.json webapp/package.json
COPY website/package.json website/package.json
COPY website-builder/package.json website-builder/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/selected-site-package/package.json packages/selected-site-package/package.json

RUN bun install --frozen-lockfile --ignore-scripts --network-concurrency=4 \
  --filter @web-app-demo/website --filter @web-app-demo/website-builder

COPY scripts/stage-site-package.mjs scripts/stage-site-package.mjs
COPY packages/contracts packages/contracts
COPY site-packages site-packages
RUN rm -rf /app/packages/selected-site-package
RUN bun scripts/stage-site-package.mjs ${CMS_SITE_PACKAGE_ID}

COPY website website
COPY website-builder website-builder

FROM oven/bun:1.3.14 AS runtime

WORKDIR /app

# The runtime contains only the selected package and its consumers. The source package
# catalogue remains confined to the disposable build stage.
COPY --from=build /app/package.json /app/bun.lock /app/bunfig.toml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/contracts ./packages/contracts
COPY --from=build /app/packages/selected-site-package ./packages/selected-site-package
COPY --from=build /app/website ./website
COPY --from=build /app/website-builder ./website-builder

WORKDIR /app/website-builder
CMD ["bun", "src/server.ts"]
