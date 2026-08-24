import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'

import { createPrisma, type DbClient } from '../../db'
import type { PrivateStorage } from '../../storage/port'
import { MediaService } from './application/media-service'
import { createMediaRepository } from './infrastructure/media-repository'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('media repository and service against PostgreSQL', () => {
  let db: DbClient
  let service: MediaService
  let deleted: string[]

  beforeAll(() => {
    db = createPrisma(databaseUrl!)
    deleted = []
    const storage: PrivateStorage = {
      driver: 'filesystem',
      createUploadUrl: async ({ key, byteSize }) => ({ key, method: 'PUT', url: `https://storage.test/${key}`, headers: {}, contentLength: byteSize, expiresAt: '2026-08-24T10:01:00.000Z' }),
      createDownloadUrl: async ({ key }) => ({ key, url: `https://storage.test/${key}`, expiresAt: '2026-08-24T10:01:00.000Z' }),
      headObject: async (key) => ({ key, contentLength: 128, contentType: 'image/png', etag: 'etag-1' }),
      readRange: async () => pngDimensions(1, 1),
      deleteObject: async (key) => { deleted.push(key) },
      putObjectOnce: async () => ({ stored: true as const, etag: 'etag-1' }),
    }
    service = new MediaService({
      repository: createMediaRepository(db),
      storage,
      createObjectKey: () => 'cms-media/2026/08/integration-key',
      deferDelete: ({ objectKey }) => { deleted.push(objectKey) },
    })
  })

  beforeEach(async () => {
    deleted.length = 0
    await db.cmsMediaUsage.deleteMany()
    await db.cmsMediaAsset.deleteMany()
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  test('finalizes bytes against storage and deletes an unused asset by durable handoff', async () => {
    const created = await service.createUpload(
      { id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a20', role: 'owner' },
      { filename: 'hero.png', mimeType: 'image/png', byteSize: 128 },
    )
    const finalized = await service.finalize({ id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a20', role: 'owner' }, created.asset.id)
    expect(finalized.asset.state).toBe('ready')
    const stored = await db.cmsMediaAsset.findUniqueOrThrow({ where: { id: created.asset.id } })
    expect(stored.storageEtag).toBe('etag-1')
    expect(stored.width).toBe(1)
    expect(stored.height).toBe(1)

    await service.remove({ id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a20', role: 'owner' }, created.asset.id)
    expect((await db.cmsMediaAsset.findUniqueOrThrow({ where: { id: created.asset.id } })).state).toBe('deleting')
    expect(deleted).toEqual(['cms-media/2026/08/integration-key'])
  })
})

function pngDimensions(width: number, height: number) {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}
