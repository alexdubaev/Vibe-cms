import { describe, expect, test } from 'bun:test'

import type { PrivateStorage } from '../../storage/port'
import { MediaService } from './application/media-service'
import type { MediaAssetRecord, MediaRepository } from './application/ports'
import { MediaError } from './domain/errors'
import { detectMediaMime } from './domain/file-signatures'

const uuid = '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10'

function asset(overrides: Partial<MediaAssetRecord> = {}): MediaAssetRecord {
  return {
    id: uuid,
    filename: 'hero.png',
    objectKey: 'cms-media/2026/08/object',
    contentVersion: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a11',
    contentType: 'image/png',
    byteSize: 128,
    width: null,
    height: null,
    altText: null,
    state: 'pending',
    storageEtag: null,
    ...overrides,
  }
}

function createService(overrides: Partial<MediaRepository> = {}, storageOverrides: Partial<PrivateStorage> = {}) {
  const current = asset()
  const repository: MediaRepository = {
    createPending: async () => current,
    findPending: async () => current,
    markReady: async ({}) => ({ ...current, state: 'ready', storageEtag: 'etag' }),
    list: async () => [current],
    updateAlt: async () => ({ ...current, altText: 'Описание' }),
    markDeleting: async () => ({ objectKey: current.objectKey, usageCount: 0 }),
    ...overrides,
  }
  const storage: PrivateStorage = {
    driver: 'filesystem',
    createUploadUrl: async () => ({ key: current.objectKey, method: 'PUT', url: 'https://storage.test/upload', headers: {}, contentLength: 128, expiresAt: '2026-08-24T10:01:00.000Z' }),
    createDownloadUrl: async () => ({ key: current.objectKey, url: 'https://storage.test/download', expiresAt: '2026-08-24T10:01:00.000Z' }),
    headObject: async () => ({ key: current.objectKey, contentLength: current.byteSize, contentType: current.contentType, etag: 'etag' }),
    readRange: async () => pngSignature(),
    deleteObject: async () => {},
    putObjectOnce: async () => ({ stored: true as const, etag: 'etag' }),
    ...storageOverrides,
  }
  return new MediaService({
    repository,
    storage,
    createObjectKey: () => current.objectKey,
    deferDelete: () => {},
    clock: { now: () => new Date('2026-08-24T10:00:00.000Z') },
  })
}

describe('media file signatures', () => {
  test('detects supported signatures instead of trusting MIME alone', () => {
    expect(detectMediaMime(pngSignature())).toBe('image/png')
    expect(detectMediaMime(new TextEncoder().encode('%PDF-1.7'))).toBe('application/pdf')
    expect(detectMediaMime(new TextEncoder().encode('<svg></svg>'))).toBeNull()
  })
})

describe('media service', () => {
  test('issues an opaque upload ticket without exposing the object key', async () => {
    const service = createService()
    const result = await service.createUpload({ id: 'editor', role: 'editor' }, { filename: 'hero.png', mimeType: 'image/png', byteSize: 128 })
    expect(result.asset.filename).toBe('hero.png')
    expect(result.asset).not.toHaveProperty('objectKey')
    expect(result.upload.url).toContain('storage.test')
  })

  test('rejects a magic-byte spoof during finalisation', async () => {
    const service = createService({}, { readRange: async () => new TextEncoder().encode('<svg></svg>') })
    await expectRejected(service.finalize({ id: 'editor', role: 'editor' }, uuid), MediaError)
  })

  test('extracts image dimensions before marking an upload ready', async () => {
    let readyInput: { assetId: string; storageEtag?: string; width?: number; height?: number } | undefined
    const service = createService({
      markReady: async (input) => {
        readyInput = input
        return { ...asset(), state: 'ready', storageEtag: input.storageEtag ?? null, width: input.width ?? null, height: input.height ?? null }
      },
    }, { readRange: async () => pngDimensions(640, 480) })

    const result = await service.finalize({ id: 'editor', role: 'editor' }, uuid)

    expect(readyInput).toEqual({ assetId: uuid, storageEtag: 'etag', width: 640, height: 480 })
    expect(result.asset.width).toBe(640)
    expect(result.asset.height).toBe(480)
  })

  test('does not queue deletion while usage references remain', async () => {
    let deferred = false
    const service = new MediaService({
      repository: { ...({ markDeleting: async () => ({ objectKey: 'cms-media/key', usageCount: 2 }) } as unknown as MediaRepository) },
      storage: {} as PrivateStorage,
      createObjectKey: () => 'cms-media/key',
      deferDelete: () => { deferred = true },
    })
    await expectRejected(service.remove({ id: 'owner', role: 'owner' }, uuid), MediaError)
    expect(deferred).toBe(false)
  })
})

function pngSignature() {
  return pngDimensions(1, 1)
}

function pngDimensions(width: number, height: number) {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8)
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}

async function expectRejected(operation: Promise<unknown>, type: new (...args: never[]) => Error) {
  let error: unknown
  try {
    await operation
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(type)
}
