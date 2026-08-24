import { describe, expect, test } from 'bun:test'

import { extractImageDimensions } from './image-dimensions'

describe('extractImageDimensions', () => {
  test('reads PNG dimensions from the IHDR chunk', () => {
    const bytes = png(640, 480)

    expect(extractImageDimensions(bytes, 'image/png')).toEqual({ width: 640, height: 480 })
  })

  test('finds JPEG dimensions in a SOF segment after metadata', () => {
    const bytes = Uint8Array.from([
      0xff, 0xd8,
      0xff, 0xe1, 0x00, 0x06, 0x45, 0x58, 0x49, 0x46,
      0xff, 0xc0, 0x00, 0x0b, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 0x01, 0x11, 0x00,
    ])

    expect(extractImageDimensions(bytes, 'image/jpeg')).toEqual({ width: 800, height: 600 })
  })

  test('reads WebP VP8X canvas dimensions and rejects truncated headers', () => {
    const bytes = Uint8Array.from([
      ...new TextEncoder().encode('RIFF'), 0x00, 0x00, 0x00, 0x00, ...new TextEncoder().encode('WEBP'),
      ...new TextEncoder().encode('VP8X'), 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x7f, 0x02, 0x00, 0xaf, 0x01, 0x00,
    ])

    expect(extractImageDimensions(bytes, 'image/webp')).toEqual({ width: 640, height: 432 })
    expect(extractImageDimensions(bytes.subarray(0, bytes.length - 1), 'image/webp')).toBeNull()
  })

  test('reads AVIF dimensions from a bounded ispe box', () => {
    const bytes = new Uint8Array(36)
    bytes.set(new TextEncoder().encode('ftypavif'), 4)
    const view = new DataView(bytes.buffer)
    view.setUint32(16, 20)
    bytes.set(new TextEncoder().encode('ispe'), 20)
    view.setUint32(28, 1920)
    view.setUint32(32, 1080)

    expect(extractImageDimensions(bytes, 'image/avif')).toEqual({ width: 1920, height: 1080 })
  })

  test('returns null for non-image media and malformed dimensions', () => {
    expect(extractImageDimensions(new Uint8Array(32), 'application/pdf')).toBeNull()
    expect(extractImageDimensions(png(0, 480), 'image/png')).toBeNull()
  })
})

function png(width: number, height: number) {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8)
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}
