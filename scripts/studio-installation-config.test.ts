import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

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
  DATABASE_URL: 'postgresql://vibe_client_auto_app:4pZ8vR2mK7xQ9dT5nL3c@postgres:5432/vibe_client_auto?schema=public',
  DATABASE_ADMIN_URL: 'postgresql://vibe_client_auto_owner:8wF3yN6hC2sJ5qM9rV7k@postgres:5432/vibe_client_auto?schema=public',
  JWT_SECRET: '47b2f90e18c6d35a47b2f90e18c6d35a47b2f90e18c6d35a47b2f90e18c6d35a',
  CMS_BUILDER_HMAC_SECRET: 'b7e1935c4a80d26fb7e1935c4a80d26fb7e1935c4a80d26fb7e1935c4a80d26f',
  CMS_WEBSITE_PROMOTION_TOKEN: '6d04a2f98c51e7b36d04a2f98c51e7b36d04a2f98c51e7b36d04a2f98c51e7b3',
  CMS_SITE_PACKAGE_ID: 'auto-service',
  PRIVATE_STORAGE_ENDPOINT: 'https://s3.media.example',
  PRIVATE_STORAGE_REGION: 'ru-central1',
  PRIVATE_STORAGE_BUCKET: 'client-auto-private-media',
  PRIVATE_STORAGE_ACCESS_KEY_ID: 'test-media-client-auto-key',
  PRIVATE_STORAGE_SECRET_ACCESS_KEY: '84c1f7a509d36e2b84c1f7a509d36e2b84c1f7a5',
  PRIVATE_STORAGE_S3_SCOPE: 'bucket:client-auto-private-media/*',
  CMS_WEBSITE_STORAGE_ENDPOINT: 'https://s3.publish.example',
  CMS_WEBSITE_STORAGE_REGION: 'ru-central1',
  CMS_WEBSITE_STORAGE_BUCKET: 'client-auto-public-site',
  CMS_WEBSITE_STORAGE_ACCESS_KEY_ID: 'test-publish-client-auto-key',
  CMS_WEBSITE_STORAGE_SECRET_ACCESS_KEY: '9a26d4f80b71c53e9a26d4f80b71c53e9a26d4f8',
  CMS_WEBSITE_STORAGE_S3_SCOPE: 'bucket:client-auto-public-site/*',
  CMS_WEBSITE_SELECTOR_URL: 'https://promotion.auto.example/select',
  CMS_WEBSITE_PURGE_URL: 'https://promotion.auto.example/purge',
  CMS_BUILDER_QUEUE_URL: 'https://message-queue.example/client-auto',
  CMS_BUILDER_YMQ_ENDPOINT: 'https://message-queue.example',
  CMS_BUILDER_YMQ_REGION: 'ru-central1',
  CMS_BUILDER_YMQ_ACCESS_KEY_ID: 'test-queue-client-auto-key',
  CMS_BUILDER_YMQ_SECRET_ACCESS_KEY: '27e5b91c60a4d83f27e5b91c60a4d83f27e5b91c',
  CMS_BUILDER_YMQ_CONSUMER_ACCESS_KEY_ID: 'test-queue-client-auto-consumer-key',
  CMS_BUILDER_YMQ_CONSUMER_SECRET_ACCESS_KEY: '73c0e4a91f6b2d5873c0e4a91f6b2d5873c0e4a9',
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

  test.each([
    'unrelated_client_auto_legacy',
    'legacy_vibe_client_auto_app',
    'vibe_client_auto_app_legacy',
  ])('rejects the near-miss runtime database role %s', (role) => {
    expect(() => validateStudioInstallationConfig({
      ...validSource,
      DATABASE_URL: `postgresql://${role}:4pZ8vR2mK7xQ9dT5nL3c@postgres:5432/vibe_client_auto?schema=public`,
    })).toThrow('DATABASE_URL role must be exactly vibe_client_auto_app')
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

  test('requires the builder consume-only queue credential pair', () => {
    expect(() => validateStudioInstallationConfig({
      ...validSource,
      CMS_BUILDER_YMQ_CONSUMER_SECRET_ACCESS_KEY: '',
    })).toThrow('CMS_BUILDER_YMQ_CONSUMER_SECRET_ACCESS_KEY is required')
  })

  test('rejects reusing the backend queue producer identity in the builder consumer', () => {
    expect(() => validateStudioInstallationConfig({
      ...validSource,
      CMS_BUILDER_YMQ_CONSUMER_ACCESS_KEY_ID: validSource.CMS_BUILDER_YMQ_ACCESS_KEY_ID,
    })).toThrow('Queue producer and consumer must use different access keys')
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

  test('resolves one private queue producer-to-builder-consumer path', () => {
    const compose = Bun.spawnSync([
      'docker',
      'compose',
      '--project-name',
      'vibe-client-auto',
      '--env-file',
      'deploy/studio/customer.env.example',
      '-f',
      'deploy/studio/compose.customer.yml',
      'config',
    ], { stdout: 'pipe', stderr: 'pipe' })
    expect(new TextDecoder().decode(compose.stderr)).toBe('')
    expect(compose.exitCode).toBe(0)

    const model = parse(new TextDecoder().decode(compose.stdout))
    const backendEnvironment = model.services.backend.environment
    const builderEnvironment = model.services.builder.environment
    expect(builderEnvironment.CMS_BUILDER_QUEUE_URL).toBe(backendEnvironment.CMS_BUILDER_QUEUE_URL)
    expect(builderEnvironment.CMS_BUILDER_YMQ_ENDPOINT).toBe(backendEnvironment.CMS_BUILDER_YMQ_ENDPOINT)
    expect(builderEnvironment.CMS_BUILDER_YMQ_CONSUMER_ACCESS_KEY_ID).toBe(
      publicExample.CMS_BUILDER_YMQ_CONSUMER_ACCESS_KEY_ID,
    )
    expect(builderEnvironment.CMS_BUILDER_YMQ_CONSUMER_SECRET_ACCESS_KEY).toBe(
      publicExample.CMS_BUILDER_YMQ_CONSUMER_SECRET_ACCESS_KEY,
    )
    expect(builderEnvironment.CMS_BUILDER_YMQ_CONSUMER_ACCESS_KEY_ID).not.toBe(
      backendEnvironment.CMS_BUILDER_YMQ_ACCESS_KEY_ID,
    )
    expect(model.services.builder.ports).toBeUndefined()
  })

  const publicExample = parseStudioEnvironmentFile(readFileSync('deploy/studio/customer.env.example', 'utf8'))
  test.each([
    'DATABASE_URL',
    'DATABASE_ADMIN_URL',
    'JWT_SECRET',
    'CMS_BUILDER_HMAC_SECRET',
    'CMS_WEBSITE_PROMOTION_TOKEN',
    'CMS_BUILDER_YMQ_SECRET_ACCESS_KEY',
    'CMS_BUILDER_YMQ_ACCESS_KEY_ID',
    'CMS_BUILDER_YMQ_CONSUMER_ACCESS_KEY_ID',
    'CMS_BUILDER_YMQ_CONSUMER_SECRET_ACCESS_KEY',
    'PRIVATE_STORAGE_ACCESS_KEY_ID',
    'PRIVATE_STORAGE_SECRET_ACCESS_KEY',
    'CMS_WEBSITE_STORAGE_ACCESS_KEY_ID',
    'CMS_WEBSITE_STORAGE_SECRET_ACCESS_KEY',
  ])('rejects the committed public example credential from %s', (name) => {
    const source = { ...validSource }
    if (name === 'DATABASE_URL' || name === 'DATABASE_ADMIN_URL') {
      const candidate = new URL(source[name])
      candidate.password = new URL(publicExample[name]).password
      source[name] = candidate.toString()
    } else {
      source[name] = publicExample[name]
    }
    expect(() => validateStudioInstallationConfig(source)).toThrow(
      `${name}${name.startsWith('DATABASE_') ? ' password' : ''} must not use a public example credential`,
    )
  })
})
