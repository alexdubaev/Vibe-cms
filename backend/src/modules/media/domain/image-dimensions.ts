import type { SupportedMediaMime } from './file-signatures'

export type ImageDimensions = { width: number; height: number }

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

/**
 * Reads dimensions from bounded file prefixes. It never decodes pixels and returns null when
 * the prefix is too short or the container header is malformed.
 */
export function extractImageDimensions(bytes: Uint8Array, mimeType: SupportedMediaMime): ImageDimensions | null {
  switch (mimeType) {
    case 'image/png':
      return pngDimensions(bytes)
    case 'image/jpeg':
      return jpegDimensions(bytes)
    case 'image/webp':
      return webpDimensions(bytes)
    case 'image/avif':
      return avifDimensions(bytes)
    default:
      return null
  }
}

function pngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (!startsWith(bytes, PNG_SIGNATURE) || bytes.length < 24 || ascii(bytes, 12, 4) !== 'IHDR') return null
  return dimensions(readUint32BE(bytes, 16), readUint32BE(bytes, 20))
}

function jpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2

  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) return null
    const marker = bytes[offset++]
    if (marker === 0x00) continue
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue
    if (marker === 0xda) return null
    if (offset + 2 > bytes.length) return null

    const segmentLength = readUint16BE(bytes, offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segmentLength < 7) return null
      return dimensions(readUint16BE(bytes, offset + 5), readUint16BE(bytes, offset + 3))
    }
    offset += segmentLength
  }

  return null
}

function webpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null
  let offset = 12

  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4)
    const size = readUint32LE(bytes, offset + 4)
    const payload = offset + 8
    if (payload + size > bytes.length) return null

    if (type === 'VP8X' && size >= 10) {
      return dimensions(readUint24LE(bytes, payload + 4) + 1, readUint24LE(bytes, payload + 7) + 1)
    }
    if (type === 'VP8 ' && size >= 10 && bytes[payload + 3] === 0x9d && bytes[payload + 4] === 0x01 && bytes[payload + 5] === 0x2a) {
      return dimensions(readUint16LE(bytes, payload + 6) & 0x3fff, readUint16LE(bytes, payload + 8) & 0x3fff)
    }
    if (type === 'VP8L' && size >= 5 && bytes[payload] === 0x2f) {
      const width = 1 + (bytes[payload + 1] | ((bytes[payload + 2] & 0x3f) << 8))
      const height = 1 + ((bytes[payload + 2] >> 6) | (bytes[payload + 3] << 2) | ((bytes[payload + 4] & 0x0f) << 10))
      return dimensions(width, height)
    }

    offset = payload + size + (size % 2)
  }

  return null
}

function avifDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 12 || ascii(bytes, 4, 4) !== 'ftyp') return null

  // `ispe` is a full box nested below AVIF metadata. Scan only valid bounded box headers so a
  // filename or arbitrary payload cannot be mistaken for dimensions.
  for (let typeOffset = 12; typeOffset + 4 <= bytes.length; typeOffset += 1) {
    if (ascii(bytes, typeOffset, 4) !== 'ispe' || typeOffset < 4) continue
    const boxStart = typeOffset - 4
    const boxSize = readUint32BE(bytes, boxStart)
    if (boxSize < 20 || boxStart + boxSize > bytes.length) continue
    return dimensions(readUint32BE(bytes, typeOffset + 8), readUint32BE(bytes, typeOffset + 12))
  }

  return null
}

function dimensions(width: number, height: number): ImageDimensions | null {
  return width > 0 && height > 0 ? { width, height } : null
}

function startsWith(bytes: Uint8Array, expected: number[]) {
  return expected.every((value, index) => bytes[index] === value)
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.slice(offset, offset + length))
}

function readUint16BE(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) | bytes[offset + 1]
}

function readUint16LE(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function readUint24LE(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

function readUint32BE(bytes: Uint8Array, offset: number) {
  return bytes[offset] * 0x1000000 + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]
}

function readUint32LE(bytes: Uint8Array, offset: number) {
  return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16) + bytes[offset + 3] * 0x1000000
}
