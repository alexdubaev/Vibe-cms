import { describe, expect, test } from 'bun:test'

import { createYandexObjectStorageAdapter, type FetchLike } from '../src/yandex-storage'

const endpoint = 'https://storage.yandexcloud.net'
const fixedDate = () => new Date('2026-08-24T12:34:56.000Z')

function response(status = 200, body = '') {
  return new Response(body, { status })
}

function header(init: RequestInit | undefined, name: string) {
  return new Headers(init?.headers).get(name)
}

describe('Yandex Object Storage adapter', () => {
  test('signs immutable slot PUTs with SigV4 and sends cache metadata', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetcher: FetchLike = async (input, init) => {
      calls.push({ url: String(input), init })
      return response()
    }
    const adapter = createYandexObjectStorageAdapter({
      endpoint,
      bucket: 'vibe-public',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
      region: 'ru-central1',
      now: fixedDate,
      fetcher,
    })

    const body = new TextEncoder().encode('Vibe')
    await adapter.putImmutable({
      key: 'blue/_astro/app.js',
      body,
      contentType: 'text/javascript; charset=utf-8',
      cacheControl: 'public, max-age=31536000, immutable',
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${endpoint}/vibe-public/blue/_astro/app.js`)
    expect(calls[0].init?.method).toBe('PUT')
    expect(header(calls[0].init, 'content-type')).toBe('text/javascript; charset=utf-8')
    expect(header(calls[0].init, 'cache-control')).toBe('public, max-age=31536000, immutable')
    expect(header(calls[0].init, 'x-amz-date')).toBe('20260824T123456Z')
    expect(header(calls[0].init, 'x-amz-content-sha256')).toBe('339cddc8e5b2e300536efaa6b30bb90619f969ce9ab0b8d610e6a657cc3a7530')
    expect(header(calls[0].init, 'host')).toBe('storage.yandexcloud.net')
    expect(header(calls[0].init, 'authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=access-key\/20260824\/ru-central1\/s3\/aws4_request, SignedHeaders=/)
    expect(header(calls[0].init, 'authorization')).toContain('Signature=')
    expect(new Uint8Array(await new Response(calls[0].init?.body).arrayBuffer())).toEqual(body)
  })

  test('lists and deletes only the exact configured slot prefix, including continuation pages', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetcher: FetchLike = async (input, init) => {
      calls.push({ url: String(input), init })
      if (init?.method === 'GET' && String(input).includes('prefix=blue%2F')) return response(200, '<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>')
      if (init?.method === 'GET' && !String(input).includes('continuation-token=')) {
        return response(200, '<ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>green/index.html</Key></Contents><NextContinuationToken>next&amp;token</NextContinuationToken></ListBucketResult>')
      }
      if (init?.method === 'GET') {
        return response(200, '<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>green/_astro/app&amp;2.js</Key></Contents></ListBucketResult>')
      }
      return response(204)
    }
    const adapter = createYandexObjectStorageAdapter({
      endpoint,
      bucket: 'vibe-public',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
      now: fixedDate,
      fetcher,
    })

    await adapter.deleteInactivePrefix('green/')

    expect(calls.map((call) => `${call.init?.method}:${call.url}`)).toEqual([
      'GET:https://storage.yandexcloud.net/vibe-public?list-type=2&prefix=green%2F',
      'DELETE:https://storage.yandexcloud.net/vibe-public/green/index.html',
      'GET:https://storage.yandexcloud.net/vibe-public?list-type=2&prefix=green%2F&continuation-token=next%26token',
      'DELETE:https://storage.yandexcloud.net/vibe-public/green/_astro/app%262.js',
    ])

    await expect(adapter.deleteInactivePrefix('green/_astro/')).rejects.toThrow('exactly one configured slot prefix')
    await expect(adapter.deleteInactivePrefix('blue/')).resolves.toBeUndefined()
  })

  test('rejects static objects outside allowed slot and exposes safe marker HEAD', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetcher: FetchLike = async (input, init) => {
      calls.push({ url: String(input), init })
      return init?.method === 'HEAD' && String(input).endsWith('/missing.txt') ? response(404) : response()
    }
    const adapter = createYandexObjectStorageAdapter({
      endpoint,
      bucket: 'vibe-public',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
      slots: ['blue'],
      now: fixedDate,
      fetcher,
    })

    await expect(adapter.putImmutable({ key: 'green/index.html', body: new Uint8Array(), contentType: 'text/html' })).rejects.toThrow('configured slot prefix')
    await expect(adapter.putImmutable({ key: 'blue/../green/index.html', body: new Uint8Array(), contentType: 'text/html' })).rejects.toThrow('configured slot prefix')
    await expect(adapter.headObject('blue/__publication_revision.txt')).resolves.toBe(true)
    await expect(adapter.headObject('blue/missing.txt')).resolves.toBe(false)
    await expect(adapter.headObject('green/__publication_revision.txt')).rejects.toThrow('outside the configured prefixes')
    expect(calls.filter((call) => call.init?.method === 'HEAD')).toHaveLength(2)
  })

  test('reads release markers from configured slots and treats missing objects as absent', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetcher: FetchLike = async (input, init) => {
      calls.push({ url: String(input), init })
      return String(input).endsWith('/missing.txt') ? response(404) : response(200, 'vibe-publication:4')
    }
    const adapter = createYandexObjectStorageAdapter({
      endpoint,
      bucket: 'vibe-public',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
      slots: ['blue'],
      now: fixedDate,
      fetcher,
    })

    await expect(adapter.readObject('blue/__publication_revision.txt')).resolves.toEqual(new TextEncoder().encode('vibe-publication:4'))
    await expect(adapter.readObject('blue/missing.txt')).resolves.toBeNull()
    await expect(adapter.readObject('green/__publication_revision.txt')).rejects.toThrow('outside the configured prefixes')
    expect(calls.map((call) => `${call.init?.method}:${call.url}`)).toEqual([
      'GET:https://storage.yandexcloud.net/vibe-public/blue/__publication_revision.txt',
      'GET:https://storage.yandexcloud.net/vibe-public/blue/missing.txt',
    ])
  })

  test('copies media from a signed URL into the validated media prefix', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetcher: FetchLike = async (input, init) => {
      calls.push({ url: String(input), init })
      if (init?.method === 'GET' && String(input).startsWith('https://cdn.example/')) return response(200, 'image-data')
      return response()
    }
    const adapter = createYandexObjectStorageAdapter({
      endpoint,
      bucket: 'vibe-media',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
      now: fixedDate,
      fetcher,
    })

    await adapter.copyFromSignedUrl({
      sourceUrl: 'https://cdn.example/signed?token=one',
      destinationPath: '/media/site-1/asset-1/logo.png',
      contentType: 'image/png',
    })

    expect(calls[0].url).toBe('https://cdn.example/signed?token=one')
    expect(calls[0].init?.method).toBe('GET')
    expect(calls[0].init?.redirect).toBe('error')
    expect(calls[1].url).toBe(`${endpoint}/vibe-media/media/site-1/asset-1/logo.png`)
    expect(calls[1].init?.method).toBe('PUT')
    expect(header(calls[1].init, 'content-type')).toBe('image/png')
    expect(new Uint8Array(await new Response(calls[1].init?.body).arrayBuffer())).toEqual(new TextEncoder().encode('image-data'))
    await expect(adapter.copyFromSignedUrl({
      sourceUrl: 'https://cdn.example/signed?token=one',
      destinationPath: '/media/site-1/asset-1/../../private.txt',
      contentType: 'text/plain',
    })).rejects.toThrow('destination path is invalid')
  })

  test('fails closed when the signed media URL redirects', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetcher: FetchLike = async (input, init) => {
      calls.push({ url: String(input), init })
      return response(302, '')
    }
    const adapter = createYandexObjectStorageAdapter({
      endpoint,
      bucket: 'vibe-media',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
      now: fixedDate,
      fetcher,
    })

    await expect(adapter.copyFromSignedUrl({
      sourceUrl: 'https://cdn.example/signed?token=one',
      destinationPath: '/media/site-1/asset-1/logo.png',
      contentType: 'image/png',
    })).rejects.toThrow('media source download failed (302)')
    expect(calls[0].init?.redirect).toBe('error')
    expect(calls).toHaveLength(1)
  })

  test('rejects media bodies larger than the configured maximum before writing', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetcher: FetchLike = async (input, init) => {
      calls.push({ url: String(input), init })
      if (init?.method === 'GET' && String(input).startsWith('https://cdn.example/')) {
        return response(200, '12345')
      }
      return response()
    }
    const adapter = createYandexObjectStorageAdapter({
      endpoint,
      bucket: 'vibe-media',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
      maxMediaBytes: 4,
      now: fixedDate,
      fetcher,
    })

    await expect(adapter.copyFromSignedUrl({
      sourceUrl: 'https://cdn.example/signed?token=one',
      destinationPath: '/media/site-1/asset-1/logo.png',
      contentType: 'image/png',
    })).rejects.toThrow('maximum media size')
    expect(calls.filter((call) => call.init?.method === 'PUT')).toHaveLength(0)
  })
})
