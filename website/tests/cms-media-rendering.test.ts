import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveCmsMediaSrc } from '../src/cms/media'
import type { PublicationSnapshot } from '@web-app-demo/contracts'

const media = [
  {
    id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10',
    contentVersion: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a11',
    filename: 'hero.png',
    mimeType: 'image/png',
    byteSize: 128,
    width: 640,
    height: 480,
    alt: 'Hero',
    publicPath: '/media/018f8c8d-5f34-7db2-8b98-2c7bf3d80a10/018f8c8d-5f34-7db2-8b98-2c7bf3d80a11/hero.png',
  },
] as unknown as PublicationSnapshot['media']

test('CMS media resolver uses the immutable public path for live pages', () => {
  assert.equal(resolveCmsMediaSrc(media, media[0].id), media[0].publicPath)
  assert.equal(resolveCmsMediaSrc(media, '018f8c8d-5f34-7db2-8b98-2c7bf3d80a99'), undefined)
})

test('CMS media resolver overrides public paths with the scoped preview proxy', () => {
  assert.equal(resolveCmsMediaSrc(media, media[0].id, '/__preview/media'), `/__preview/media/${media[0].id}`)
})
