export type SupportedMediaMime =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/avif'
  | 'video/mp4'
  | 'application/pdf'

const signatures: Record<SupportedMediaMime, (bytes: Uint8Array) => boolean> = {
  'image/jpeg': (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/png': (bytes) => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/webp': (bytes) => ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP',
  'image/avif': (bytes) => isIsoBaseMedia(bytes, ['avif', 'avis']),
  'video/mp4': (bytes) => isIsoBaseMedia(bytes, ['isom', 'iso2', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1']),
  'application/pdf': (bytes) => ascii(bytes, 0, 5) === '%PDF-',
}

export function detectMediaMime(bytes: Uint8Array): SupportedMediaMime | null {
  for (const [mime, matches] of Object.entries(signatures) as Array<[SupportedMediaMime, (bytes: Uint8Array) => boolean]>) {
    if (matches(bytes)) return mime
  }
  return null
}

export function mediaSignatureByteLength(mime: SupportedMediaMime) {
  return mime === 'image/png' ? 32 : mime === 'image/jpeg' ? 3 : 16
}

function startsWith(bytes: Uint8Array, expected: number[]) {
  return expected.every((value, index) => bytes[index] === value)
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.slice(offset, offset + length))
}

function isIsoBaseMedia(bytes: Uint8Array, brands: string[]) {
  if (bytes.length < 12 || ascii(bytes, 4, 4) !== 'ftyp') return false
  const major = ascii(bytes, 8, 4)
  if (brands.includes(major)) return true
  for (let offset = 16; offset + 4 <= bytes.length; offset += 4) {
    if (brands.includes(ascii(bytes, offset, 4))) return true
  }
  return false
}
