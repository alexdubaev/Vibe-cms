import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const packageIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const dockerResourceNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/
const digestPattern = /^sha256:[a-f0-9]{64}$/
const placeholderPattern = /(change[-_ ]?me|default|example|placeholder|replace[-_ ]?with|your[-_ ]|password|secret123)/i

const imageKinds = ['BACKEND', 'WEBAPP', 'PREVIEW', 'BUILDER']
const publicOriginNames = [
  'ADMIN_ORIGIN',
  'API_ORIGIN',
  'PREVIEW_ORIGIN',
  'CMS_WEBSITE_PUBLIC_ORIGIN',
]

export function validateStudioInstallationConfig(source) {
  const installationSlug = required(source, 'INSTALLATION_SLUG')
  if (!slugPattern.test(installationSlug) || installationSlug.length > 63) {
    throw new Error('INSTALLATION_SLUG must be a lowercase DNS-style slug')
  }

  const origins = Object.fromEntries(
    publicOriginNames.map((name) => [name, httpsOrigin(required(source, name), name)]),
  )
  if (new Set(Object.values(origins)).size !== publicOriginNames.length) {
    throw new Error('Studio production origins must be unique')
  }

  const databaseUrl = postgresUrl(required(source, 'DATABASE_URL'), 'DATABASE_URL')
  const databaseAdminUrl = postgresUrl(required(source, 'DATABASE_ADMIN_URL'), 'DATABASE_ADMIN_URL')
  const expectedDatabaseName = `vibe_${installationSlug.replaceAll('-', '_')}`
  for (const [name, url] of [
    ['DATABASE_URL', databaseUrl],
    ['DATABASE_ADMIN_URL', databaseAdminUrl],
  ]) {
    const databaseName = decodeURIComponent(url.pathname.slice(1))
    if (databaseName !== expectedDatabaseName) {
      throw new Error(`${name} database name must be ${expectedDatabaseName}`)
    }
    assertUsableSecret(decodeURIComponent(url.password), `${name} password`, 20)
  }
  if (databaseUrl.host !== databaseAdminUrl.host || databaseUrl.pathname !== databaseAdminUrl.pathname) {
    throw new Error('DATABASE_URL and DATABASE_ADMIN_URL must target the same PostgreSQL database')
  }
  const databaseRole = decodeURIComponent(databaseUrl.username)
  const databaseAdminRole = decodeURIComponent(databaseAdminUrl.username)
  if (databaseRole === databaseAdminRole) {
    throw new Error('DATABASE_URL and DATABASE_ADMIN_URL must use different PostgreSQL roles')
  }
  const roleScope = installationSlug.replaceAll('-', '_')
  for (const [name, role] of [
    ['DATABASE_URL', databaseRole],
    ['DATABASE_ADMIN_URL', databaseAdminRole],
  ]) {
    if (!role.includes(roleScope)) {
      throw new Error(`${name} must authenticate as a ${roleScope}-specific PostgreSQL role`)
    }
  }

  const sitePackageId = required(source, 'CMS_SITE_PACKAGE_ID')
  if (!packageIdPattern.test(sitePackageId)) {
    throw new Error('CMS_SITE_PACKAGE_ID must be a lowercase package slug')
  }

  assertUsableSecret(required(source, 'JWT_SECRET'), 'JWT_SECRET', 64, true)
  assertUsableSecret(required(source, 'CMS_BUILDER_HMAC_SECRET'), 'CMS_BUILDER_HMAC_SECRET', 32)
  assertUsableSecret(required(source, 'CMS_WEBSITE_PROMOTION_TOKEN'), 'CMS_WEBSITE_PROMOTION_TOKEN', 32)
  assertUsableSecret(required(source, 'CMS_BUILDER_YMQ_SECRET_ACCESS_KEY'), 'CMS_BUILDER_YMQ_SECRET_ACCESS_KEY', 32)

  const privateBucket = validateS3Scope(source, {
    prefix: 'PRIVATE_STORAGE',
    installationSlug,
  })
  const publicBucket = validateS3Scope(source, {
    prefix: 'CMS_WEBSITE_STORAGE',
    installationSlug,
  })
  if (privateBucket === publicBucket) {
    throw new Error('Private media and public destination buckets must be different')
  }
  if (required(source, 'PRIVATE_STORAGE_ACCESS_KEY_ID') === required(source, 'CMS_WEBSITE_STORAGE_ACCESS_KEY_ID')) {
    throw new Error('Private media and public destination buckets must use different access keys')
  }

  httpsUrl(required(source, 'CMS_WEBSITE_SELECTOR_URL'), 'CMS_WEBSITE_SELECTOR_URL')
  httpsUrl(required(source, 'CMS_WEBSITE_PURGE_URL'), 'CMS_WEBSITE_PURGE_URL')
  httpsUrl(required(source, 'CMS_BUILDER_QUEUE_URL'), 'CMS_BUILDER_QUEUE_URL')
  httpsOrigin(required(source, 'CMS_BUILDER_YMQ_ENDPOINT'), 'CMS_BUILDER_YMQ_ENDPOINT')
  required(source, 'CMS_BUILDER_YMQ_REGION')
  required(source, 'CMS_BUILDER_YMQ_ACCESS_KEY_ID')

  for (const name of ['STUDIO_POSTGRES_NETWORK', 'STUDIO_BUILD_LOCK_VOLUME']) {
    const value = required(source, name)
    if (!dockerResourceNamePattern.test(value)) throw new Error(`${name} must be a Docker resource name`)
  }

  const buildLockFile = required(source, 'CMS_ASTRO_BUILD_LOCK_FILE')
  if (!isAbsolute(buildLockFile)) {
    throw new Error('CMS_ASTRO_BUILD_LOCK_FILE must be an absolute path')
  }

  const ports = ['ADMIN_BIND_PORT', 'API_BIND_PORT', 'PREVIEW_BIND_PORT'].map((name) => {
    const raw = required(source, name)
    const value = Number(raw)
    if (!Number.isInteger(value) || value < 1024 || value > 65535) {
      throw new Error(`${name} must be an integer from 1024 to 65535`)
    }
    return value
  })
  if (new Set(ports).size !== ports.length) throw new Error('Studio loopback bind ports must be unique')

  for (const kind of imageKinds) {
    const imageName = `${kind}_IMAGE`
    const digestName = `${kind}_IMAGE_DIGEST`
    const image = required(source, imageName)
    if (/\s|@/.test(image)) throw new Error(`${imageName} must be an image repository without a digest`)
    if (!digestPattern.test(required(source, digestName))) {
      throw new Error(`${digestName} must be a sha256 image digest`)
    }
  }

  return Object.freeze({
    installationSlug,
    composeProjectName: `vibe-${installationSlug}`,
    adminOrigin: origins.ADMIN_ORIGIN,
    apiOrigin: origins.API_ORIGIN,
    previewOrigin: origins.PREVIEW_ORIGIN,
    websitePublicOrigin: origins.CMS_WEBSITE_PUBLIC_ORIGIN,
    databaseUrl: databaseUrl.toString(),
    databaseAdminUrl: databaseAdminUrl.toString(),
    sitePackageId,
    buildLockFile,
  })
}

export function parseStudioEnvironmentFile(contents) {
  const values = {}
  for (const [index, originalLine] of contents.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    let line = originalLine.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('export ')) line = line.slice('export '.length).trimStart()
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) throw new Error(`Invalid environment assignment on line ${index + 1}`)
    const [, name, encodedValue] = match
    if (Object.hasOwn(values, name)) throw new Error(`Duplicate environment variable ${name}`)
    values[name] = decodeEnvironmentValue(encodedValue, index + 1)
  }
  return values
}

export function composeConfigCommand(envFile, installationSlug) {
  if (!slugPattern.test(installationSlug)) throw new Error('INSTALLATION_SLUG must be a lowercase DNS-style slug')
  if (/[\r\n]/.test(envFile)) throw new Error('Environment file path must stay on one line')
  const renderedEnvFile = /\s/.test(envFile) ? `"${envFile.replaceAll('"', '\\"')}"` : envFile
  return `docker compose --project-name vibe-${installationSlug} --env-file ${renderedEnvFile} -f deploy/studio/compose.customer.yml config --quiet`
}

function validateS3Scope(source, { prefix, installationSlug }) {
  httpsUrl(required(source, `${prefix}_ENDPOINT`), `${prefix}_ENDPOINT`)
  required(source, `${prefix}_REGION`)
  const bucket = required(source, `${prefix}_BUCKET`)
  if (!bucket.includes(installationSlug)) {
    throw new Error(`${prefix}_BUCKET must include INSTALLATION_SLUG`)
  }
  required(source, `${prefix}_ACCESS_KEY_ID`)
  assertUsableSecret(required(source, `${prefix}_SECRET_ACCESS_KEY`), `${prefix}_SECRET_ACCESS_KEY`, 32)
  const scopeName = `${prefix}_S3_SCOPE`
  if (required(source, scopeName) !== `bucket:${bucket}/*`) {
    throw new Error(`${scopeName} must equal bucket:${bucket}/*`)
  }
  return bucket
}

function required(source, name) {
  const value = source[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function httpsOrigin(value, name) {
  const url = httpsUrl(value, name)
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} must be an HTTPS origin only`)
  }
  return url.origin
}

function httpsUrl(value, name) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL`)
  }
  if (url.protocol !== 'https:') throw new Error(`${name} must be an HTTPS origin or URL`)
  if (url.username || url.password) throw new Error(`${name} must not contain credentials`)
  return url
}

function postgresUrl(value, name) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL URL`)
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error(`${name} must use the PostgreSQL protocol`)
  }
  if (!url.hostname || !url.username || !url.password || url.pathname.length < 2) {
    throw new Error(`${name} must include host, role, password, and database name`)
  }
  return url
}

function assertUsableSecret(value, name, minimumLength, hexOnly = false) {
  if (value.length < minimumLength || placeholderPattern.test(value) || new Set(value).size < 8) {
    throw new Error(`${name} must not use a default or example secret`)
  }
  if (hexOnly && !/^[a-f0-9]+$/i.test(value)) {
    throw new Error(`${name} must not use a default or example secret`)
  }
}

function decodeEnvironmentValue(encodedValue, lineNumber) {
  const value = encodedValue.trim()
  if (!value) return ''
  const quote = value[0]
  if (quote === '"' || quote === "'") {
    if (value.at(-1) !== quote) throw new Error(`Unclosed quoted environment value on line ${lineNumber}`)
    const inner = value.slice(1, -1)
    if (quote === "'") return inner
    return inner.replace(/\\(n|r|t|\\|")/g, (_, escaped) => ({ n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"' })[escaped])
  }
  return value.replace(/\s+#.*$/, '').trimEnd()
}

async function main(argv) {
  if (argv[0] !== 'validate' || argv[1] !== '--env' || !argv[2] || argv.length !== 3) {
    throw new Error('Usage: bun scripts/studio-installation-config.mjs validate --env <customer.env>')
  }
  const envFile = argv[2]
  const config = validateStudioInstallationConfig(parseStudioEnvironmentFile(readFileSync(envFile, 'utf8')))
  process.stdout.write(`Validated studio installation ${config.installationSlug}.\n`)
  process.stdout.write(`Compose project: ${config.composeProjectName}\n`)
  process.stdout.write(`Dry-run: ${composeConfigCommand(envFile, config.installationSlug)}\n`)
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
