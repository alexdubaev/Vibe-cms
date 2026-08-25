import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import {
  composeConfigCommand,
  parseStudioEnvironmentFile,
  validateStudioInstallationConfig,
} from './studio-installation-config.mjs'

const validSource = {
  INSTALLATION_SLUG: 'client-auto',
  ADMIN_ORIGIN: 'https://admin.auto.example',
  API_ORIGIN: 'https://api.auto.example',
  PREVIEW_ORIGIN: 'https://preview.auto.example',
  CMS_WEBSITE_PUBLIC_ORIGIN: 'https://www.auto.example',
  DATABASE_URL: 'postgresql://vibe_client_auto_app:9kR4mP7xT2vN8qL6sD3f@postgres:5432/vibe_client_auto?schema=public',
  DATABASE_ADMIN_URL: 'postgresql://vibe_client_auto_owner:6zH2cB9wQ5nM8rT4yK7p@postgres:5432/vibe_client_auto?schema=public',
  JWT_SECRET: '98d7c261adf503b84e96721cf0a536d898d7c261adf503b84e96721cf0a536d8',
  CMS_BUILDER_HMAC_SECRET: 'e472911f0a58bc63d4e472911f0a58bc63d4e472911f0a58bc63d4e472911f0',
  CMS_WEBSITE_PROMOTION_TOKEN: 'a950e6732c84df71b6a950e6732c84df71b6a950e6732c84df71b6a950e673',
  CMS_SITE_PACKAGE_ID: 'auto-service',
  PRIVATE_STORAGE_ENDPOINT: 'https://s3.media.example',
  PRIVATE_STORAGE_REGION: 'ru-central1',
  PRIVATE_STORAGE_BUCKET: 'client-auto-private-media',
  PRIVATE_STORAGE_ACCESS_KEY_ID: 'media-client-auto-key',
  PRIVATE_STORAGE_SECRET_ACCESS_KEY: 'f03ab84d97e2615cf03ab84d97e2615cf03ab84d',
  PRIVATE_STORAGE_S3_SCOPE: 'bucket:client-auto-private-media/*',
  CMS_WEBSITE_STORAGE_ENDPOINT: 'https://s3.publish.example',
  CMS_WEBSITE_STORAGE_REGION: 'ru-central1',
  CMS_WEBSITE_STORAGE_BUCKET: 'client-auto-public-site',
  CMS_WEBSITE_STORAGE_ACCESS_KEY_ID: 'publish-client-auto-key',
  CMS_WEBSITE_STORAGE_SECRET_ACCESS_KEY: '15c8e470a29df63115c8e470a29df63115c8e470',
  CMS_WEBSITE_STORAGE_S3_SCOPE: 'bucket:client-auto-public-site/*',
  CMS_WEBSITE_SELECTOR_URL: 'https://promotion.auto.example/select',
  CMS_WEBSITE_PURGE_URL: 'https://promotion.auto.example/purge',
  CMS_BUILDER_QUEUE_URL: 'https://message-queue.example/client-auto',
  CMS_BUILDER_YMQ_ENDPOINT: 'https://message-queue.example',
  CMS_BUILDER_YMQ_REGION: 'ru-central1',
  CMS_BUILDER_YMQ_ACCESS_KEY_ID: 'queue-client-auto-key',
  CMS_BUILDER_YMQ_SECRET_ACCESS_KEY: 'd5319f8a2ce7406bd5319f8a2ce7406bd5319f8a',
  STUDIO_POSTGRES_NETWORK: 'vibe-cms-studio-postgres',
  STUDIO_BUILD_LOCK_VOLUME: 'vibe-cms-studio-build-lock',
  CMS_ASTRO_BUILD_LOCK_FILE: '/var/lock/vibe-cms/astro-build.lock',
  ADMIN_BIND_PORT: '18101',
  API_BIND_PORT: '18102',
  PREVIEW_BIND_PORT: '18103',
  BACKEND_IMAGE: 'registry.example/vibe/backend',
  BACKEND_IMAGE_DIGEST: `sha256:${'1a'.repeat(32)}`,
  WEBAPP_IMAGE: 'registry.example/vibe/webapp',
  WEBAPP_IMAGE_DIGEST: `sha256:${'2b'.repeat(32)}`,
  PREVIEW_IMAGE: 'registry.example/vibe/preview',
  PREVIEW_IMAGE_DIGEST: `sha256:${'3c'.repeat(32)}`,
  BUILDER_IMAGE: 'registry.example/vibe/builder',
  BUILDER_IMAGE_DIGEST: `sha256:${'4d'.repeat(32)}`,
} satisfies Record<string, string>

describe('studio installation config', () => {
  test('normalizes one customer installation without exposing the owner database as runtime config', () => {
    const config = validateStudioInstallationConfig(validSource)

    expect(config.installationSlug).toBe('client-auto')
    expect(config.databaseUrl).not.toBe(config.databaseAdminUrl)
    expect(config.adminOrigin).toBe('https://admin.auto.example')
    expect(config.sitePackageId).toBe('auto-service')
    expect(config.composeProjectName).toBe('vibe-client-auto')
  })

  test('rejects duplicate normalized production origins', () => {
    expect(() => validateStudioInstallationConfig({
      ...validSource,
      PREVIEW_ORIGIN: 'https://admin.auto.example/',
    })).toThrow('production origins must be unique')
  })

  test.each(['ADMIN_ORIGIN', 'API_ORIGIN', 'PREVIEW_ORIGIN', 'CMS_WEBSITE_PUBLIC_ORIGIN'])(
    'rejects a non-HTTPS %s',
    (name) => {
      expect(() => validateStudioInstallationConfig({
        ...validSource,
        [name]: validSource[name as keyof typeof validSource].replace('https:', 'http:'),
      })).toThrow(`${name} must be an HTTPS origin`)
    },
  )

  test('rejects a database name that is not scoped to the installation slug', () => {
    expect(() => validateStudioInstallationConfig({
      ...validSource,
      DATABASE_URL: 'postgresql://client_app:runtime-pass@postgres:5432/shared_database?schema=public',
      DATABASE_ADMIN_URL: 'postgresql://client_owner:owner-pass@postgres:5432/shared_database?schema=public',
    })).toThrow('database name must be vibe_client_auto')
  })

  test('rejects the same database role for runtime and ownership operations', () => {
    expect(() => validateStudioInstallationConfig({
      ...validSource,
      DATABASE_ADMIN_URL: validSource.DATABASE_URL,
    })).toThrow('DATABASE_URL and DATABASE_ADMIN_URL must use different PostgreSQL roles')
  })

  test('rejects a runtime database role that belongs to another installation', () => {
    expect(() => validateStudioInstallationConfig({
      ...validSource,
      DATABASE_URL: 'postgresql://vibe_other_customer_app:9kR4mP7xT2vN8qL6sD3f@postgres:5432/vibe_client_auto?schema=public',
    })).toThrow('DATABASE_URL must authenticate as a client_auto-specific PostgreSQL role')
  })

  test('rejects a default database password before it can reach a runtime container', () => {
    expect(() => validateStudioInstallationConfig({
      ...validSource,
      DATABASE_URL: 'postgresql://vibe_client_auto_app:default-password@postgres:5432/vibe_client_auto?schema=public',
    })).toThrow('DATABASE_URL password must not use a default or example secret')
  })

  test.each([
    ['PRIVATE_STORAGE_S3_SCOPE', ''],
    ['PRIVATE_STORAGE_S3_SCOPE', 'bucket:another-customer/*'],
    ['CMS_WEBSITE_STORAGE_S3_SCOPE', 'bucket:client-auto-private-media/*'],
  ])('rejects missing or cross-customer S3 scope in %s', (name, value) => {
    expect(() => validateStudioInstallationConfig({ ...validSource, [name]: value })).toThrow(name)
  })

  test.each([
    ['JWT_SECRET', 'replace-with-at-least-32-random-characters'],
    ['CMS_BUILDER_HMAC_SECRET', 'example-builder-secret-example-builder-secret'],
    ['CMS_WEBSITE_PROMOTION_TOKEN', 'change-me-promotion-token-change-me'],
    ['PRIVATE_STORAGE_SECRET_ACCESS_KEY', 'default-storage-secret-default-storage-secret'],
    ['CMS_WEBSITE_STORAGE_SECRET_ACCESS_KEY', 'placeholder-publish-secret-placeholder'],
  ])('rejects a default/example value for %s', (name, value) => {
    expect(() => validateStudioInstallationConfig({ ...validSource, [name]: value })).toThrow(
      `${name} must not use a default or example secret`,
    )
  })

  test('rejects a relative shared build-lock path', () => {
    expect(() => validateStudioInstallationConfig({
      ...validSource,
      CMS_ASTRO_BUILD_LOCK_FILE: 'var/lock/vibe-cms/astro-build.lock',
    })).toThrow('CMS_ASTRO_BUILD_LOCK_FILE must be an absolute path')
  })

  test('rejects an image that is not pinned by a sha256 digest', () => {
    expect(() => validateStudioInstallationConfig({
      ...validSource,
      BUILDER_IMAGE_DIGEST: 'latest',
    })).toThrow('BUILDER_IMAGE_DIGEST must be a sha256 image digest')
  })

  test('parses quoted env values and produces a secret-free dry-run command', () => {
    const source = parseStudioEnvironmentFile('INSTALLATION_SLUG="client-auto"\nADMIN_ORIGIN=https://admin.auto.example # host\n')
    expect(source).toEqual({
      INSTALLATION_SLUG: 'client-auto',
      ADMIN_ORIGIN: 'https://admin.auto.example',
    })

    const command = composeConfigCommand('deploy/studio/client-auto.env', 'client-auto')
    expect(command).toBe('docker compose --project-name vibe-client-auto --env-file deploy/studio/client-auto.env -f deploy/studio/compose.customer.yml config --quiet')
    expect(command).not.toContain(validSource.JWT_SECRET)
  })

  test('keeps the committed fake example complete and valid', () => {
    const contents = readFileSync('deploy/studio/customer.env.example', 'utf8')
    expect(validateStudioInstallationConfig(parseStudioEnvironmentFile(contents)).installationSlug).toBe('client-auto')
  })
})
