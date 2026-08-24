import { describe, expect, test } from 'bun:test'

import { PublicationMediaCopyInputService } from './media-copy-input'

const assetId = '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10'
const contentVersion = '018f8c8d-5f34-7db2-8b98-2c7bf3d80a11'

const snapshot = {
  revision: 4,
  generatedAt: '2026-08-24T10:00:00.000Z',
  settings: { companyName: 'Vibe' },
  pages: [],
  collections: [],
  menus: [],
  redirects: [],
  media: [{
    id: assetId,
    contentVersion,
    filename: 'hero.png',
    mimeType: 'image/png',
    byteSize: 128,
    width: 2,
    height: 2,
    alt: 'Hero',
    publicPath: `/media/${assetId}/${contentVersion}/hero.png`,
  }],
}

describe('publication media copy input', () => {
  test('creates short-lived signed inputs for frozen ready media without exposing private keys', async () => {
    const downloads: unknown[] = []
    const service = new PublicationMediaCopyInputService({
      getPublication: async () => ({ revision: 4, snapshot }),
      getMediaAssets: async () => [{
        id: assetId,
        contentVersion,
        objectKey: 'cms-media/private-hero.png',
        contentType: 'image/png',
        state: 'ready',
      }],
    }, {
      createDownloadUrl: async (input) => {
        downloads.push(input)
        return { key: input.key, url: 'https://private.example/signed-hero', expiresAt: '2026-08-24T10:05:00.000Z' }
      },
    })

    const result = await service.createForBuild(4, 'green')

    expect(result).toEqual([{
      sourceUrl: 'https://private.example/signed-hero',
      destinationPath: `/green/media/${assetId}/${contentVersion}/hero.png`,
      contentType: 'image/png',
    }])
    expect(downloads).toEqual([{ key: 'cms-media/private-hero.png', expiresInSeconds: 300 }])
    expect(JSON.stringify(result)).not.toContain('objectKey')
  })

  test('fails closed when a snapshot media asset is not ready or does not match its frozen version', async () => {
    const service = new PublicationMediaCopyInputService({
      getPublication: async () => ({ revision: 4, snapshot }),
      getMediaAssets: async () => [{
        id: assetId,
        contentVersion: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a12',
        objectKey: 'cms-media/private-hero.png',
        contentType: 'image/png',
        state: 'pending',
      }],
    }, {
      createDownloadUrl: async () => { throw new Error('must not sign unavailable media') },
    })

    await expect(service.createForBuild(4, 'green')).rejects.toThrow('not ready')
  })
})
