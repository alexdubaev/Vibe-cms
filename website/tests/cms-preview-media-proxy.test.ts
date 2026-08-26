import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'

import { GET as getPreviewMedia } from '../src/pages/preview/media/[assetId]'

const assetId = '018f8c8d-5f34-7db2-8b98-2c7bf3d80a11'
const sessionToken = 's'.repeat(43)

describe('preview media proxy', () => {
  const previousOrigin = process.env.CMS_BACKEND_ORIGIN
  const originalFetch = globalThis.fetch

  afterEach(() => {
    process.env.CMS_BACKEND_ORIGIN = previousOrigin
    globalThis.fetch = originalFetch
  })

  test('copies only whitelisted storage headers and never forwards storage session state', async () => {
    process.env.CMS_BACKEND_ORIGIN = 'https://api.example.test'
    let proxiedUrl: string | undefined
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/api/cms/preview/media/')) {
        return new Response(JSON.stringify({
          id: assetId,
          mimeType: 'image/png',
          downloadUrl: 'https://storage.example.test/signed/asset?sig=SECRET',
          expiresAt: '2026-08-24T10:05:00.000Z',
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      proxiedUrl = url
      return new Response('pngbytes', {
        status: 200,
        headers: {
          'Content-Length': '8',
          ETag: '"asset-etag"',
          'Accept-Ranges': 'bytes',
          // Everything below this line must never reach the preview client.
          'Set-Cookie': 'storage-session=leaked',
          Location: 'https://storage.example.test/elsewhere',
          'X-Secret-Header': 'internal',
        },
      })
    }) as typeof fetch

    const response = await getPreviewMedia({
      params: { assetId },
      request: new Request(`https://site.example/preview/media/${assetId}`, {
        headers: { cookie: `cms_preview_session=${sessionToken}` },
      }),
    })

    assert.equal(response.status, 200)
    assert.equal(proxiedUrl, 'https://storage.example.test/signed/asset?sig=SECRET')
    assert.equal(response.headers.get('Content-Type'), 'image/png')
    assert.equal(response.headers.get('ETag'), '"asset-etag"')
    assert.equal(response.headers.get('Accept-Ranges'), 'bytes')
    assert.equal(response.headers.get('Set-Cookie'), null)
    assert.equal(response.headers.get('Location'), null)
    assert.equal(response.headers.get('X-Secret-Header'), null)
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow')
  })

  test('a missing cookie, unknown asset, or failed storage read all return the same 404', async () => {
    process.env.CMS_BACKEND_ORIGIN = 'https://api.example.test'
    const notFound = new Response('no', { status: 404 })
    globalThis.fetch = (async () => notFound) as typeof fetch

    const noCookie = await getPreviewMedia({
      params: { assetId },
      request: new Request(`https://site.example/preview/media/${assetId}`),
    })
    assert.equal(noCookie.status, 404)
    assert.equal(noCookie.headers.get('Cache-Control'), 'private, no-store')

    const unknownAsset = await getPreviewMedia({
      params: { assetId },
      request: new Request(`https://site.example/preview/media/${assetId}`, {
        headers: { cookie: `cms_preview_session=${sessionToken}` },
      }),
    })
    assert.equal(unknownAsset.status, 404)
    assert.equal((await noCookie.text()), (await unknownAsset.text()))
  })
})
