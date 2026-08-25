import { describe, expect, test } from 'bun:test'

import {
  createS3PublicationStorageAdapter,
  s3PublicationStorageOptionsFromEnvironment,
  type FetchLike,
} from '../src/s3-storage'

const fixedDate = () => new Date('2026-08-24T12:34:56.000Z')

function response(status = 200, body = '') {
  return new Response(body, { status })
}

function header(init: RequestInit | undefined, name: string) {
  return new Headers(init?.headers).get(name)
}

function options(fetcher: FetchLike, overrides: Record<string, unknown> = {}) {
  return {
    endpoint: 'https://storage.yandexcloud.net',
    bucket: 'vibe-public',
    accessKeyId: 'access-key',
    secretAccessKey: 'secret-key',
    region: 'ru-central1',
    forcePathStyle: true,
    now: fixedDate,
    fetcher,
    ...overrides,
  }
}

describe('S3 publication storage adapter', () => {
  test('signs immutable path-style PUTs for Yandex Object Storage', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetcher: FetchLike = async (input, init) => {
      calls.push({ url: String(input), init })
      return response()
    }
    const adapter = createS3PublicationStorageAdapter(options(fetcher))
    const body = new TextEncoder().encode('Vibe')

    await adapter.putImmutable({
      key: 'blue/_astro/app.js',
      body,
      contentType: 'text/javascript; charset=utf-8',
      cacheControl: 'public, max-age=31536000, immutable',
      redirectLocation: '/new-path',
    })

    expect(calls[0].url).toBe('https://storage.yandexcloud.net/vibe-public/blue/_astro/app.js')
    expect(calls[0].init?.method).toBe('PUT')
    expect(header(calls[0].init, 'content-type')).toBe('text/javascript; charset=utf-8')
    expect(header(calls[0].init, 'cache-control')).toBe('public, max-age=31536000, immutable')
    expect(header(calls[0].init, 'x-amz-website-redirect-location')).toBe('/new-path')
    expect(header(calls[0].init, 'x-amz-date')).toBe('20260824T123456Z')
    expect(header(calls[0].init, 'x-amz-content-sha256')).toBe('339cddc8e5b2e300536efaa6b30bb90619f969ce9ab0b8d610e6a657cc3a7530')
    expect(header(calls[0].init, 'host')).toBe('storage.yandexcloud.net')
    expect(header(calls[0].init, 'authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=access-key\/20260824\/ru-central1\/s3\/aws4_request, SignedHeaders=/)
  })

  test('supports a generic virtual-host S3 endpoint and a path-style local endpoint', async () => {
    const calls: string[] = []
    const fetcher: FetchLike = async (input) => {
      calls.push(String(input))
      return response()
    }

    await createS3PublicationStorageAdapter(options(fetcher, {
      endpoint: 'https://fra1.digitaloceanspaces.com',
      region: 'fra1',
      forcePathStyle: false,
    })).headObject('blue/index.html')
    await createS3PublicationStorageAdapter(options(fetcher, {
      endpoint: 'http://127.0.0.1:9000',
      region: 'us-east-1',
      forcePathStyle: true,
    })).headObject('green/index.html')

    expect(calls).toEqual([
      'https://vibe-public.fra1.digitaloceanspaces.com/blue/index.html',
      'http://127.0.0.1:9000/vibe-public/green/index.html',
    ])
  })

  test('lists and deletes only one configured slot, including continuation pages', async () => {
    const calls: Array<{ url: string; method?: string }> = []
    const fetcher: FetchLike = async (input, init) => {
      calls.push({ url: String(input), method: init?.method })
      if (init?.method === 'GET' && !String(input).includes('continuation-token=')) {
        return response(200, '<ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>green/index.html</Key></Contents><NextContinuationToken>next&amp;token</NextContinuationToken></ListBucketResult>')
      }
      if (init?.method === 'GET') {
        return response(200, '<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>green/_astro/app&amp;2.js</Key></Contents></ListBucketResult>')
      }
      return response(204)
    }
    const adapter = createS3PublicationStorageAdapter(options(fetcher, { slots: ['green'] }))

    await adapter.deleteInactivePrefix('green/')

    expect(calls).toEqual([
      { method: 'GET', url: 'https://storage.yandexcloud.net/vibe-public?list-type=2&prefix=green%2F' },
      { method: 'DELETE', url: 'https://storage.yandexcloud.net/vibe-public/green/index.html' },
      { method: 'GET', url: 'https://storage.yandexcloud.net/vibe-public?list-type=2&prefix=green%2F&continuation-token=next%26token' },
      { method: 'DELETE', url: 'https://storage.yandexcloud.net/vibe-public/green/_astro/app%262.js' },
    ])
    await expect(adapter.deleteInactivePrefix('green/_astro/')).rejects.toThrow('exactly one configured slot prefix')
    await expect(adapter.deleteInactivePrefix('blue/')).rejects.toThrow('exactly one configured slot prefix')
  })

  test('confines immutable writes and object reads to configured safe slot keys', async () => {
    const fetcher: FetchLike = async (input, init) => {
      if (init?.method === 'HEAD' && String(input).endsWith('/missing.txt')) return response(404)
      if (init?.method === 'GET' && String(input).endsWith('/missing.txt')) return response(404)
      return response(200, 'vibe-publication:4')
    }
    const adapter = createS3PublicationStorageAdapter(options(fetcher, { slots: ['blue'] }))

    await expect(adapter.putImmutable({ key: 'green/index.html', body: new Uint8Array(), contentType: 'text/html' })).rejects.toThrow('configured slot prefix')
    await expect(adapter.putImmutable({ key: 'blue/../green/index.html', body: new Uint8Array(), contentType: 'text/html' })).rejects.toThrow('configured slot prefix')
    await expect(adapter.headObject('blue/__publication_revision.txt')).resolves.toBe(true)
    await expect(adapter.headObject('blue/missing.txt')).resolves.toBe(false)
    await expect(adapter.readObject('blue/__publication_revision.txt')).resolves.toEqual(new TextEncoder().encode('vibe-publication:4'))
    await expect(adapter.readObject('blue/missing.txt')).resolves.toBeNull()
    await expect(adapter.headObject('green/index.html')).rejects.toThrow('outside the configured prefixes')
    await expect(adapter.readObject('media/private-key')).rejects.toThrow('outside the configured prefixes')
  })

  test('copies credential-free non-redirecting media with immutable headers and a size limit', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetcher: FetchLike = async (input, init) => {
      calls.push({ url: String(input), init })
      if (String(input).includes('redirect')) return response(302)
      if (String(input).includes('large')) return response(200, '12345')
      if (String(input).startsWith('https://cdn.example/')) return response(200, 'data')
      return response()
    }
    const adapter = createS3PublicationStorageAdapter(options(fetcher, {
      bucket: 'vibe-media',
      maxMediaBytes: 4,
    }))

    await adapter.copyFromSignedUrl({
      sourceUrl: 'https://cdn.example/signed?token=one',
      destinationPath: '/green/media/site-1/asset-1/logo.png',
      contentType: 'image/png',
    })

    expect(calls[0].init?.redirect).toBe('error')
    expect(calls[1].url).toBe('https://storage.yandexcloud.net/vibe-media/green/media/site-1/asset-1/logo.png')
    expect(header(calls[1].init, 'cache-control')).toBe('public, max-age=31536000, immutable')
    expect(header(calls[1].init, 'content-type')).toBe('image/png')

    for (const sourceUrl of [
      'http://cdn.example/signed',
      'https://user:password@cdn.example/signed',
      'https://cdn.example/signed#fragment',
    ]) {
      await expect(adapter.copyFromSignedUrl({
        sourceUrl,
        destinationPath: '/green/media/site-1/asset-1/logo.png',
        contentType: 'image/png',
      })).rejects.toThrow('credential-free HTTPS URL')
    }
    await expect(adapter.copyFromSignedUrl({
      sourceUrl: 'https://cdn.example/redirect',
      destinationPath: '/green/media/site-1/asset-1/logo.png',
      contentType: 'image/png',
    })).rejects.toThrow('media source download failed (302)')
    await expect(adapter.copyFromSignedUrl({
      sourceUrl: 'https://cdn.example/large',
      destinationPath: '/green/media/site-1/asset-1/logo.png',
      contentType: 'image/png',
    })).rejects.toThrow('maximum media size')
    expect(calls.filter((call) => call.init?.method === 'PUT')).toHaveLength(1)
  })
})

describe('S3 publication storage environment', () => {
  const environment = {
    CMS_WEBSITE_STORAGE_ENDPOINT: ' https://storage.example.test ',
    CMS_WEBSITE_STORAGE_BUCKET: ' website-assets ',
    CMS_WEBSITE_STORAGE_ACCESS_KEY_ID: ' access-key ',
    CMS_WEBSITE_STORAGE_SECRET_ACCESS_KEY: ' secret-key ',
    CMS_WEBSITE_STORAGE_REGION: ' us-east-1 ',
    CMS_WEBSITE_STORAGE_FORCE_PATH_STYLE: 'false',
  }

  test('returns trimmed generic adapter options with an explicit addressing mode', () => {
    expect(s3PublicationStorageOptionsFromEnvironment(environment)).toEqual({
      endpoint: 'https://storage.example.test',
      bucket: 'website-assets',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
      region: 'us-east-1',
      forcePathStyle: false,
    })
  })

  test('rejects a missing region and non-boolean force-path-style values at startup', () => {
    expect(() => s3PublicationStorageOptionsFromEnvironment({
      ...environment,
      CMS_WEBSITE_STORAGE_REGION: ' ',
    })).toThrow('CMS_WEBSITE_STORAGE_REGION')
    expect(() => s3PublicationStorageOptionsFromEnvironment({
      ...environment,
      CMS_WEBSITE_STORAGE_FORCE_PATH_STYLE: 'yes',
    })).toThrow('CMS_WEBSITE_STORAGE_FORCE_PATH_STYLE must be true or false')
  })
})
