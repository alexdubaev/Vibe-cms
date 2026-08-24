import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'

import { createPrisma, type DbClient } from '../../../db'
import { createBuilderNonceStore } from './builder-nonce-store'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('builder nonce store against PostgreSQL', () => {
  let db: DbClient

  beforeAll(() => {
    db = createPrisma(databaseUrl!)
  })

  beforeEach(async () => {
    await db.cmsBuilderRequestNonce.deleteMany()
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  test('reserves a nonce once even when the key version or build changes', async () => {
    const store = createBuilderNonceStore(db)
    const first = await store.reserve({
      nonce: 'nonce-0000000001',
      buildId: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10',
      keyVersion: 'active',
      expiresAt: new Date('2026-08-24T10:05:00.000Z'),
    })
    const sameNonce = await store.reserve({
      nonce: 'nonce-0000000001',
      buildId: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10',
      keyVersion: 'previous',
      expiresAt: new Date('2026-08-24T10:05:00.000Z'),
    })
    const differentBuild = await store.reserve({
      nonce: 'nonce-0000000001',
      buildId: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a11',
      keyVersion: 'active',
      expiresAt: new Date('2026-08-24T10:05:00.000Z'),
    })

    expect(first).toBe(true)
    expect(sameNonce).toBe(false)
    expect(differentBuild).toBe(false)
    expect(await db.cmsBuilderRequestNonce.count()).toBe(1)
  })
})
