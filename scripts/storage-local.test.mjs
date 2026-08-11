
import { describe, expect, test } from 'bun:test'

import {
  assertLocalPrivateStorageEndpoint,
  localPrivateStorageCorsRule,
  localPrivateStorageEndpoint,
  localPrivateStorageEnv,
} from './repo-env.mjs'
import { envBlock } from './storage-local.mjs'

describe('assertLocalPrivateStorageEndpoint', () => {
  test('accepts loopback endpoints', () => {
    for (const endpoint of ['http://127.0.0.1:24331', 'http://localhost:9000', 'http://[::1]:1']) {
      expect(assertLocalPrivateStorageEndpoint(endpoint)).toBe(endpoint)
    }
  })

  test('refuses anything that is not loopback, so this cannot touch a real bucket', () => {
    for (const endpoint of [
      'https://storage.yandexcloud.net',
      'https://nyc3.digitaloceanspaces.com',
      'http://10.0.0.5:9000',
      'not-a-url',
    ]) {
      expect(() => assertLocalPrivateStorageEndpoint(endpoint)).toThrow()
    }
  })
})

describe('localPrivateStorageEnv', () => {
  test('describes a complete, loopback, path-style S3 configuration', () => {
    const env = localPrivateStorageEnv('24331')

    expect(env).toEqual({
      PRIVATE_STORAGE_DRIVER: 's3',
      PRIVATE_STORAGE_REGION: 'us-east-1',
      PRIVATE_STORAGE_BUCKET: 'local-private-storage',
      PRIVATE_STORAGE_ENDPOINT: 'http://127.0.0.1:24331',
      PRIVATE_STORAGE_ACCESS_KEY_ID: 'local-private-storage-not-a-real-key',
      PRIVATE_STORAGE_SECRET_ACCESS_KEY:
        'local-private-storage-not-a-real-secret-do-not-use-in-production',
      PRIVATE_STORAGE_FORCE_PATH_STYLE: 'true',
    })
  })

  test('renders an env block that can be pasted into a shell', () => {
    const lines = envBlock().split('\n')

    expect(lines).toHaveLength(7)
    expect(lines.every((line) => /^PRIVATE_STORAGE_[A-Z_]+=\S/.test(line))).toBe(true)
    expect(envBlock()).toContain(`PRIVATE_STORAGE_ENDPOINT=${localPrivateStorageEndpoint()}`)
  })
})

describe('localPrivateStorageCorsRule', () => {
  test('allows the methods and headers a browser upload actually uses', () => {
    const rule = localPrivateStorageCorsRule(
      ['http://localhost:5173'],
      ['Content-Type', 'If-None-Match'],
      ['ETag'],
    )

    expect(rule.AllowedMethods).toEqual(expect.arrayContaining(['GET', 'PUT', 'HEAD']))
    expect(rule.AllowedHeaders).toContain('If-None-Match')
    expect(rule.ExposeHeaders).toContain('ETag')
    expect(rule.AllowedOrigins).toEqual(['http://localhost:5173'])
    // A presigned URL carries its own authority, so the bucket never needs to accept it.
    expect(rule.AllowedHeaders).not.toContain('Authorization')
  })
})
