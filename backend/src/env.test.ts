import { describe, expect, test } from 'bun:test'

import { loadEnv } from './env'

describe('loadEnv', () => {
  test('parses defaults and comma-separated origins', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
      JWT_SECRET: '12345678901234567890123456789012',
      CORS_ORIGINS: 'http://localhost:5173, http://localhost:8081',
    })

    expect(env.PORT).toBe(3000)
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(900)
    expect(env.REFRESH_REUSE_GRACE_SECONDS).toBe(10)
    expect(env.SESSION_ABSOLUTE_TTL_DAYS).toBe(90)
    expect(env.ADMIN_USERS_READ_RATE_LIMIT_MAX).toBe(120)
    expect(env.ADMIN_USERS_READ_RATE_LIMIT_WINDOW_SECONDS).toBe(60)
    expect(env.COOKIE_SECURE).toBe(false)
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173', 'http://localhost:8081'])
    expect(env.PRIVATE_STORAGE_DRIVER).toBe('filesystem')
    expect(env.PRIVATE_STORAGE_LOCAL_ROOT).toBe('.storage')
    expect(env.PRIVATE_STORAGE_REGION).toBeUndefined()
    expect(env.PRIVATE_STORAGE_UPLOAD_MAX_BYTES).toBe(5 * 1024 * 1024)
    expect(env.PRIVATE_STORAGE_UPLOAD_URL_TTL_SECONDS).toBe(900)
    expect(env.PRIVATE_STORAGE_DOWNLOAD_URL_TTL_SECONDS).toBe(300)
  })

  test('rejects known weak JWT secrets in production-like runtimes', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
        JWT_SECRET: 'replace-with-at-least-32-random-characters',
      }),
    ).toThrow('JWT_SECRET')

    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
        JWT_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        COOKIE_SECURE: 'true',
        CORS_ORIGINS: 'https://web.example.com',
      }),
    ).toThrow('JWT_SECRET')

    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
        JWT_SECRET: 'a-memorable-human-secret-phrase-that-is-long-enough-to-pass',
        COOKIE_SECURE: 'true',
        CORS_ORIGINS: 'https://web.example.com',
      }),
    ).toThrow('JWT_SECRET')
  })

  test('requires generated secrets, secure cookies, and HTTPS origins in production', () => {
    const productionBase = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
      JWT_SECRET: '0123456789abcdef'.repeat(4),
      COOKIE_SECURE: 'true',
      CORS_ORIGINS: 'https://web.example.com',
      // Production ships the avatar feature, so it must have durable object storage; the
      // filesystem driver is refused there. See the private storage env suite below.
      PRIVATE_STORAGE_DRIVER: 's3',
      PRIVATE_STORAGE_REGION: 'ru-central1',
      PRIVATE_STORAGE_BUCKET: 'uploads',
      PRIVATE_STORAGE_ENDPOINT: 'https://storage.example.com',
      PRIVATE_STORAGE_ACCESS_KEY_ID: 'access-key',
      PRIVATE_STORAGE_SECRET_ACCESS_KEY: 'secret-key',
      PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT: 'true',
    }

    expect(() => loadEnv(productionBase)).not.toThrow()
    expect(() => loadEnv({ ...productionBase, JWT_SECRET: 'a-memorable-human-secret-phrase-that-is-long-enough-to-pass' }))
      .toThrow('JWT_SECRET')
    expect(() => loadEnv({ ...productionBase, COOKIE_SECURE: 'false' })).toThrow('COOKIE_SECURE')
    expect(() => loadEnv({ ...productionBase, CORS_ORIGINS: 'http://web.example.com' }))
      .toThrow('CORS_ORIGINS')
  })

  test('rejects unsafe production CORS origins', () => {
    const baseEnv = {
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
      JWT_SECRET: '12345678901234567890123456789012',
    }

    expect(() =>
      loadEnv({
        ...baseEnv,
        CORS_ORIGINS: '',
      }),
    ).toThrow('CORS_ORIGINS')

    expect(() =>
      loadEnv({
        ...baseEnv,
        CORS_ORIGINS: '*',
      }),
    ).toThrow('CORS_ORIGINS')

    expect(() =>
      loadEnv({
        ...baseEnv,
        CORS_ORIGINS: 'https://web.example.com/path',
      }),
    ).toThrow('CORS_ORIGINS')

    expect(() =>
      loadEnv({
        ...baseEnv,
        COOKIE_SECURE: 'true',
        CORS_ORIGINS: 'http://web.example.com',
      }),
    ).toThrow('CORS_ORIGINS')
  })

  test('requires WEBAPP_ORIGIN to be an HTTP origin and HTTPS in production', () => {
    const baseEnv = {
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
      JWT_SECRET: '12345678901234567890123456789012',
    }

    expect(() => loadEnv({ ...baseEnv, WEBAPP_ORIGIN: 'https://web.example.com/path' }))
      .toThrow('WEBAPP_ORIGIN')
    expect(() => loadEnv({ ...baseEnv, WEBAPP_ORIGIN: 'ftp://web.example.com' }))
      .toThrow('WEBAPP_ORIGIN')
    expect(() => loadEnv({ ...baseEnv, WEBAPP_ORIGIN: 'http://localhost:5173' }))
      .not.toThrow()
    expect(() =>
      loadEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        JWT_SECRET: '0123456789abcdef'.repeat(4),
        COOKIE_SECURE: 'true',
        CORS_ORIGINS: 'https://web.example.com',
        WEBAPP_ORIGIN: 'http://web.example.com',
      }),
    ).toThrow('WEBAPP_ORIGIN')
  })

  test('keeps absolute session lifetime at least as long as refresh lifetime', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
        JWT_SECRET: '12345678901234567890123456789012',
        REFRESH_TOKEN_TTL_DAYS: '30',
        SESSION_ABSOLUTE_TTL_DAYS: '29',
      }),
    ).toThrow('SESSION_ABSOLUTE_TTL_DAYS')
  })

  test('bounds refresh replay tolerance to a short window', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
        JWT_SECRET: '12345678901234567890123456789012',
        REFRESH_REUSE_GRACE_SECONDS: '61',
      }),
    ).toThrow('REFRESH_REUSE_GRACE_SECONDS')
  })

  test('requires an explicit client IP header when a trusted proxy is enabled', () => {
    const baseEnv = {
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
      JWT_SECRET: '12345678901234567890123456789012',
      TRUST_PROXY: 'true',
    }

    expect(() => loadEnv(baseEnv)).toThrow('TRUSTED_PROXY_CLIENT_IP_HEADER')
    expect(() =>
      loadEnv({
        ...baseEnv,
        TRUSTED_PROXY_CLIENT_IP_HEADER: 'do-connecting-ip',
      }),
    ).not.toThrow()
  })
})

describe('private storage env', () => {
  const base = {
    DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
    JWT_SECRET: '12345678901234567890123456789012',
  }
  const productionBase = {
    ...base,
    NODE_ENV: 'production',
    JWT_SECRET: 'a'.repeat(63) + 'b',
    COOKIE_SECURE: 'true',
    CORS_ORIGINS: 'https://app.example.com',
  }
  const localS3 = {
    PRIVATE_STORAGE_DRIVER: 's3',
    PRIVATE_STORAGE_REGION: 'us-east-1',
    PRIVATE_STORAGE_BUCKET: 'local-private-storage',
    PRIVATE_STORAGE_ENDPOINT: 'http://127.0.0.1:24331',
    PRIVATE_STORAGE_ACCESS_KEY_ID: 'local-key',
    PRIVATE_STORAGE_SECRET_ACCESS_KEY: 'local-secret',
    PRIVATE_STORAGE_FORCE_PATH_STYLE: 'true',
  }

  test('defaults to the filesystem driver so a fresh checkout needs no cloud and no Docker', () => {
    expect(loadEnv(base).PRIVATE_STORAGE_DRIVER).toBe('filesystem')
  })

  test('accepts a complete loopback S3 configuration', () => {
    const env = loadEnv({ ...base, ...localS3 })

    expect(env.PRIVATE_STORAGE_DRIVER).toBe('s3')
    expect(env.PRIVATE_STORAGE_ENDPOINT).toBe('http://127.0.0.1:24331')
    expect(env.PRIVATE_STORAGE_FORCE_PATH_STYLE).toBe(true)
  })

  test('requires the whole S3 group, naming every key that is missing', () => {
    for (const omitted of [
      'PRIVATE_STORAGE_REGION',
      'PRIVATE_STORAGE_BUCKET',
      'PRIVATE_STORAGE_ENDPOINT',
      'PRIVATE_STORAGE_ACCESS_KEY_ID',
      'PRIVATE_STORAGE_SECRET_ACCESS_KEY',
    ]) {
      const partial: Record<string, string> = { ...base, ...localS3 }
      delete partial[omitted]
      expect(() => loadEnv(partial)).toThrow(omitted)
    }
  })

  test('refuses S3 credentials that the filesystem driver would silently ignore', () => {
    expect(() => loadEnv({ ...base, PRIVATE_STORAGE_BUCKET: 'uploads' })).toThrow(
      'PRIVATE_STORAGE_BUCKET',
    )
    expect(() =>
      loadEnv({ ...base, PRIVATE_STORAGE_ENDPOINT: 'https://storage.example.com' }),
    ).toThrow('PRIVATE_STORAGE_ENDPOINT')
  })

  test('rejects a remote endpoint outside production until it is opted into deliberately', () => {
    const remote = {
      ...base,
      ...localS3,
      PRIVATE_STORAGE_ENDPOINT: 'https://storage.yandexcloud.net',
      PRIVATE_STORAGE_FORCE_PATH_STYLE: 'false',
    }

    expect(() => loadEnv(remote)).toThrow('PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT')
    expect(
      loadEnv({ ...remote, PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT: 'true' })
        .PRIVATE_STORAGE_ENDPOINT,
    ).toBe('https://storage.yandexcloud.net')
  })

  test('keeps production fail-closed: no filesystem driver, no loopback, no plain http', () => {
    expect(() => loadEnv(productionBase)).toThrow('PRIVATE_STORAGE_DRIVER')

    expect(() => loadEnv({ ...productionBase, ...localS3 })).toThrow('PRIVATE_STORAGE_ENDPOINT')

    expect(() =>
      loadEnv({
        ...productionBase,
        ...localS3,
        PRIVATE_STORAGE_ENDPOINT: 'http://storage.example.com',
        PRIVATE_STORAGE_FORCE_PATH_STYLE: 'false',
        PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT: 'true',
      }),
    ).toThrow('https')

    expect(() =>
      loadEnv({
        ...productionBase,
        ...localS3,
        PRIVATE_STORAGE_ENDPOINT: 'https://storage.example.com',
        PRIVATE_STORAGE_FORCE_PATH_STYLE: 'false',
        PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT: 'true',
      }),
    ).not.toThrow()
  })

  test('keeps the remote-endpoint gate load-bearing in production too', () => {
    // A gate that exempts production is inert exactly where a wrong bucket costs the most.
    const productionRemote = {
      ...productionBase,
      ...localS3,
      PRIVATE_STORAGE_ENDPOINT: 'https://storage.example.com',
      PRIVATE_STORAGE_FORCE_PATH_STYLE: 'false',
    }

    expect(() => loadEnv(productionRemote)).toThrow('PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT')
    expect(() =>
      loadEnv({ ...productionRemote, PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT: 'true' }),
    ).not.toThrow()
  })

  test('requires path-style addressing for a local endpoint, which has no bucket subdomains', () => {
    expect(() =>
      loadEnv({ ...base, ...localS3, PRIVATE_STORAGE_FORCE_PATH_STYLE: 'false' }),
    ).toThrow('PRIVATE_STORAGE_FORCE_PATH_STYLE')
  })

  test('rejects an endpoint carrying a path or query instead of a bare origin', () => {
    expect(() =>
      loadEnv({ ...base, ...localS3, PRIVATE_STORAGE_ENDPOINT: 'http://127.0.0.1:24331/bucket' }),
    ).toThrow('origin only')
  })
})
