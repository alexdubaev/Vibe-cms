FROM oven/bun:1.3.14 AS runtime

WORKDIR /app

# The builder image contains the website toolchain and its immutable source. It receives only a
# build id at runtime; backend credentials and database URLs are intentionally absent.
COPY package.json bun.lock ./
COPY backend/package.json backend/package.json
COPY webapp/package.json webapp/package.json
COPY website/package.json website/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY website-builder/package.json website-builder/package.json
RUN bun install --frozen-lockfile --ignore-scripts

COPY packages/contracts packages/contracts
COPY website website
COPY website-builder website-builder

WORKDIR /app/website-builder
CMD ["bun", "src/server.ts"]
