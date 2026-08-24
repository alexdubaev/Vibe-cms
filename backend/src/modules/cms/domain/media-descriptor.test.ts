import { describe, expect, test } from 'bun:test'

import { toPublicMediaDescriptor } from './media-descriptor'

const asset = {
  id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10',
  contentVersion: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a11',
  filename: 'Hero image (final).png',
  contentType: 'image/png',
  byteSize: 128,
  width: 640,
  height: 480,
  altText: 'Hero',
} as const

describe('toPublicMediaDescriptor', () => {
  test('derives a safe immutable public path without exposing the private object key', () => {
    const descriptor = toPublicMediaDescriptor(asset)

    expect(descriptor).toEqual({
      id: asset.id,
      contentVersion: asset.contentVersion,
      filename: asset.filename,
      mimeType: asset.contentType,
      byteSize: asset.byteSize,
      width: asset.width,
      height: asset.height,
      alt: asset.altText,
      publicPath: `/media/${asset.id}/${asset.contentVersion}/Hero-image-final-.png`,
    })
    expect(descriptor).not.toHaveProperty('objectKey')
  })

  test('keeps non-image dimensions null and gives empty safe names a fallback', () => {
    const descriptor = toPublicMediaDescriptor({
      ...asset,
      filename: '  ---  ',
      contentType: 'application/pdf',
      width: null,
      height: null,
      altText: null,
    })

    expect(descriptor.filename).toBe('---')
    expect(descriptor.publicPath).toBe(`/media/${asset.id}/${asset.contentVersion}/asset`)
    expect(descriptor.width).toBeNull()
    expect(descriptor.height).toBeNull()
  })
})
