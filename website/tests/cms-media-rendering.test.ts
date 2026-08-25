import { deepEqual, strictEqual } from 'node:assert/strict'
import { test } from 'node:test'

import { resolveCmsMediaSrc, resolveCmsMediaSources } from '../src/cms/media'

const media = [
  {
    id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10',
    contentVersion: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a11',
    filename: 'hero.png',
    mimeType: 'image/png' as const,
    byteSize: 100,
    width: 800,
    height: 600,
    alt: 'Hero',
    publicPath: '/media/018f8c8d-5f34-7db2-8b98-2c7bf3d80a10/018f8c8d-5f34-7db2-8b98-2c7bf3d80a11/hero.png',
  },
  {
    id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a12',
    contentVersion: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a13',
    filename: 'gallery.webp',
    mimeType: 'image/webp' as const,
    byteSize: 200,
    width: 900,
    height: 700,
    alt: 'Gallery',
    publicPath: '/media/018f8c8d-5f34-7db2-8b98-2c7bf3d80a12/018f8c8d-5f34-7db2-8b98-2c7bf3d80a13/gallery.webp',
  },
]

test('resolves every published media path used by a gallery', () => {
  deepEqual(resolveCmsMediaSources(media, [media[0].id, media[1].id]), [
    media[0].publicPath,
    media[1].publicPath,
  ])
  deepEqual(resolveCmsMediaSources(media, ['missing-media-id']), [])
})

test('preview media resolution remains scoped to the server-side proxy', () => {
  strictEqual(resolveCmsMediaSrc(media, media[0].id, '/__preview/media'),
    `/__preview/media/${media[0].id}`,
  )
})
