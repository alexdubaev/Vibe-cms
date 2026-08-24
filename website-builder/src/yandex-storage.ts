import type { MediaCopyPort, MediaCopyRequest } from './media-copy'
import type { StaticObject, StaticUploadPort } from './static-upload'

/** The small fetch surface used by the adapter. It keeps the S3 signer easy to test. */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

export type YandexObjectStorageOptions = {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  region?: string
  /** Limits static writes/deletes to these deployment slot prefixes. */
  slots?: Array<'blue' | 'green'>
  fetcher?: FetchLike
  /** Injectable clock for deterministic signing tests. */
  now?: () => Date
  /** Maximum number of bytes copied from a signed media URL. */
  maxMediaBytes?: number
}

export type YandexObjectStorageAdapter = StaticUploadPort & MediaCopyPort & {
  headObject(key: string): Promise<boolean>
  readObject(key: string): Promise<Uint8Array | null>
}

const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const AWS_ALGORITHM = 'AWS4-HMAC-SHA256'
const SERVICE = 's3'
const DEFAULT_REGION = 'ru-central1'
const DEFAULT_MAX_MEDIA_BYTES = 100 * 1024 * 1024
const SLOT_PREFIX = /^(blue|green)\/$/
const STATIC_OBJECT = /^(blue|green)\/(.+)$/
const MEDIA_DESTINATION = /^\/(blue|green)\/media\/[a-z0-9-]+\/[a-z0-9-]+\/[A-Za-z0-9._-]+$/
const MEDIA_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'video/mp4',
  'application/pdf',
])

/**
 * S3-compatible Object Storage adapter for a builder release.
 *
 * It deliberately uses path-style requests and the AWS Signature V4 protocol,
 * which Yandex Object Storage supports. No object key is ever accepted outside
 * a configured slot (for static releases) or the narrow media destination form.
 */
export function createYandexObjectStorageAdapter(options: YandexObjectStorageOptions): YandexObjectStorageAdapter {
  const endpoint = new URL(options.endpoint)
  if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') {
    throw new Error('Yandex Object Storage endpoint must use HTTP(S)')
  }
  if (!options.bucket || /[\\/]/.test(options.bucket)) throw new Error('Yandex Object Storage bucket is invalid')
  if (!options.accessKeyId) throw new Error('Yandex Object Storage access key is required')
  if (!options.secretAccessKey) throw new Error('Yandex Object Storage secret key is required')

  const region = options.region ?? DEFAULT_REGION
  const fetcher = options.fetcher ?? globalThis.fetch
  const allowedSlots = new Set<'blue' | 'green'>(options.slots ?? ['blue', 'green'])
  if (allowedSlots.size === 0) throw new Error('At least one Object Storage slot is required')
  for (const slot of allowedSlots) {
    if (slot !== 'blue' && slot !== 'green') throw new Error(`Unsupported Object Storage slot: ${slot}`)
  }
  const now = options.now ?? (() => new Date())
  const maxMediaBytes = options.maxMediaBytes ?? DEFAULT_MAX_MEDIA_BYTES
  if (!Number.isSafeInteger(maxMediaBytes) || maxMediaBytes <= 0) {
    throw new Error('Maximum media size must be a positive safe integer')
  }

  return {
    async putImmutable(object) {
      if (!isAllowedStaticKey(object.key, allowedSlots)) {
        throw new Error('Static object escaped the configured slot prefix')
      }
      await request({
        method: 'PUT',
        key: object.key,
        body: object.body,
        headers: {
          'content-type': object.contentType,
          ...(object.cacheControl ? { 'cache-control': object.cacheControl } : {}),
        },
      })
    },

    async deleteInactivePrefix(prefix) {
      if (!isAllowedSlotPrefix(prefix, allowedSlots)) {
        throw new Error('Object Storage deletion must target exactly one configured slot prefix')
      }
      let continuationToken: string | undefined
      do {
        const query: Array<[string, string]> = [['list-type', '2'], ['prefix', prefix]]
        if (continuationToken) query.push(['continuation-token', continuationToken])
        const response = await request({ method: 'GET', query })
        const document = await response.text()
        const keys = parseListKeys(document)
        for (const key of keys) {
          if (!key.startsWith(prefix)) throw new Error('Object Storage list returned a key outside the requested prefix')
          await request({ method: 'DELETE', key })
        }
        continuationToken = parseNextContinuationToken(document)
      } while (continuationToken)
    },

    async headObject(key: string) {
      if (!isReadableKey(key, allowedSlots)) throw new Error('Object Storage HEAD key is outside the configured prefixes')
      const response = await request({ method: 'HEAD', key, allowNotFound: true })
      return response.status >= 200 && response.status < 300
    },

    async readObject(key: string) {
      if (!isReadableKey(key, allowedSlots)) throw new Error('Object Storage GET key is outside the configured prefixes')
      const response = await request({ method: 'GET', key, allowNotFound: true })
      if (response.status === 404) return null
      return new Uint8Array(await response.arrayBuffer())
    },

    async copyFromSignedUrl(input: MediaCopyRequest) {
      if (!isSafeSignedUrl(input.sourceUrl)) throw new Error('Media source must be a credential-free HTTPS URL without a fragment')
      const destination = MEDIA_DESTINATION.exec(input.destinationPath)
      if (!destination || !allowedSlots.has(destination[1] as 'blue' | 'green')) throw new Error('Media destination path is invalid')
      if (!MEDIA_CONTENT_TYPES.has(input.contentType)) throw new Error('Media content type is invalid')
      const sourceResponse = await fetcher(input.sourceUrl, { method: 'GET', redirect: 'error' })
      await ensureSuccess(sourceResponse, 'media source download')
      const body = await readResponseBodyWithLimit(sourceResponse, maxMediaBytes)
      await request({
        method: 'PUT',
        key: input.destinationPath.slice(1),
        body,
        headers: {
          'content-type': input.contentType,
          'cache-control': 'public, max-age=31536000, immutable',
        },
      })
    },
  }

  async function request(input: {
    method: 'GET' | 'PUT' | 'DELETE' | 'HEAD'
    key?: string
    query?: Array<[string, string]>
    body?: Uint8Array
    headers?: Record<string, string>
    allowNotFound?: boolean
  }): Promise<Response> {
    if (input.key !== undefined && !isSafeKey(input.key)) throw new Error('Object Storage key is invalid')
    const url = objectUrl(endpoint, options.bucket, input.key, input.query)
    const body = input.body ?? new Uint8Array()
    const signed = await signRequest({
      method: input.method,
      url,
      body,
      headers: input.headers ?? {},
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      region,
      now: now(),
    })
    const response = await fetcher(url.toString(), {
      method: input.method,
      headers: signed.headers,
      ...(input.method === 'GET' || input.method === 'DELETE' || input.method === 'HEAD' ? {} : { body: body as unknown as BodyInit }),
    })
    if (!(input.allowNotFound && response.status === 404)) {
      await ensureSuccess(response, `${input.method} ${input.key ?? 'bucket'}`)
    }
    return response
  }
}

function isAllowedStaticKey(key: string, allowedSlots: Set<'blue' | 'green'>) {
  const match = STATIC_OBJECT.exec(key)
  return Boolean(match && allowedSlots.has(match[1] as 'blue' | 'green') && isSafeKey(key))
}

function isAllowedSlotPrefix(prefix: string, allowedSlots: Set<'blue' | 'green'>) {
  if (!SLOT_PREFIX.test(prefix)) return false
  return allowedSlots.has(prefix.slice(0, -1) as 'blue' | 'green')
}

function isReadableKey(key: string, allowedSlots: Set<'blue' | 'green'>) {
  return isAllowedStaticKey(key, allowedSlots)
}

function isSafeKey(key: string) {
  if (!key || key.startsWith('/') || key.includes('\\')) return false
  const segments = key.split('/')
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function objectUrl(endpoint: URL, bucket: string, key?: string, query?: Array<[string, string]>) {
  const url = new URL(endpoint.toString())
  const basePath = url.pathname.replace(/\/$/, '')
  const path = [basePath, encodePathSegment(bucket), ...(key === undefined ? [] : key.split('/').map(encodePathSegment))]
  url.pathname = path.filter(Boolean).join('/') || '/'
  url.search = query ? query.map(([name, value]) => `${encodeQuery(name)}=${encodeQuery(value)}`).join('&') : ''
  return url
}

function encodePathSegment(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

function encodeQuery(value: string) {
  return encodePathSegment(value)
}

async function signRequest(input: {
  method: string
  url: URL
  body: Uint8Array
  headers: Record<string, string>
  accessKeyId: string
  secretAccessKey: string
  region: string
  now: Date
}) {
  const amzDate = toAmzDate(input.now)
  const shortDate = amzDate.slice(0, 8)
  const payloadHash = input.body.byteLength === 0 ? EMPTY_HASH : await sha256Hex(input.body)
  const headers = new Map<string, string>([
    ['host', input.url.host],
    ['x-amz-content-sha256', payloadHash],
    ['x-amz-date', amzDate],
  ])
  for (const [name, value] of Object.entries(input.headers)) headers.set(name.toLowerCase(), normalizeHeader(value))
  const sortedHeaders = [...headers.entries()].sort(([left], [right]) => left.localeCompare(right))
  const canonicalHeaders = sortedHeaders.map(([name, value]) => `${name}:${value}\n`).join('')
  const signedHeaders = sortedHeaders.map(([name]) => name).join(';')
  const canonicalRequest = [
    input.method,
    input.url.pathname || '/',
    canonicalQuery(input.url),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')
  const scope = `${shortDate}/${input.region}/${SERVICE}/aws4_request`
  const stringToSign = [AWS_ALGORITHM, amzDate, scope, await sha256Hex(new TextEncoder().encode(canonicalRequest))].join('\n')
  const signingKey = await deriveSigningKey(input.secretAccessKey, shortDate, input.region)
  const signature = bytesToHex(await hmacSha256(signingKey, stringToSign))
  const authorization = `${AWS_ALGORITHM} Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  return {
    headers: {
      ...Object.fromEntries(Object.entries(input.headers)),
      Host: input.url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: authorization,
    },
  }
}

function canonicalQuery(url: URL) {
  const pairs = [...url.searchParams.entries()]
    .map(([name, value]) => [encodeQuery(name), encodeQuery(value)] as const)
    .sort(([leftName, leftValue], [rightName, rightValue]) => leftName.localeCompare(rightName) || leftValue.localeCompare(rightValue))
  return pairs.map(([name, value]) => `${name}=${value}`).join('&')
}

function normalizeHeader(value: string) {
  return value.trim().replace(/[\t ]+/g, ' ')
}

function toAmzDate(date: Date) {
  if (Number.isNaN(date.getTime())) throw new Error('Invalid signing date')
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

async function sha256Hex(data: Uint8Array) {
  return bytesToHex(await globalThis.crypto.subtle.digest('SHA-256', data as unknown as BufferSource))
}

async function hmacSha256(key: Uint8Array, value: string) {
  const cryptoKey = await globalThis.crypto.subtle.importKey('raw', key as unknown as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value) as unknown as BufferSource))
}

async function deriveSigningKey(secret: string, date: string, region: string) {
  const dateKey = await hmacSha256(new TextEncoder().encode(`AWS4${secret}`), date)
  const regionKey = await hmacSha256(dateKey, region)
  const serviceKey = await hmacSha256(regionKey, SERVICE)
  return hmacSha256(serviceKey, 'aws4_request')
}

function bytesToHex(bytes: ArrayBuffer | Uint8Array) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function ensureSuccess(response: Response, operation: string) {
  if (response.status >= 200 && response.status < 300) return
  const body = (await response.text()).slice(0, 500)
  throw new Error(`Object Storage ${operation} failed (${response.status}): ${body}`)
}

async function readResponseBodyWithLimit(response: Response, maxBytes: number) {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null) {
    const length = Number(declaredLength)
    if (Number.isFinite(length) && length > maxBytes) throw mediaSizeError(maxBytes)
  }

  if (!response.body) {
    const body = new Uint8Array(await response.arrayBuffer())
    if (body.byteLength > maxBytes) throw mediaSizeError(maxBytes)
    return body
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      if (!result.value) continue
      total += result.value.byteLength
      if (total > maxBytes) {
        try {
          await reader.cancel()
        } catch {
          // Preserve the size-limit error even if the source rejects cancellation.
        }
        throw mediaSizeError(maxBytes)
      }
      chunks.push(new Uint8Array(result.value))
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function mediaSizeError(maxBytes: number) {
  return new Error(`Object Storage media source exceeds maximum media size of ${maxBytes} bytes`)
}

function parseListKeys(xml: string) {
  return [...xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map((match) => decodeXml(match[1]))
}

function parseNextContinuationToken(xml: string) {
  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml)
  if (!truncated) return undefined
  const match = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/i)
  return match ? decodeXml(match[1]) : undefined
}

function decodeXml(value: string) {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
}

function isSafeSignedUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash
  } catch {
    return false
  }
}
