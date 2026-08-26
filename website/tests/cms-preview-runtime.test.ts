import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  fetchPreviewMedia,
  fetchPreviewPage,
  previewPageToPublicPage,
  readPreviewSessionCookie,
} from '../src/cms/preview-runtime'

const pageId = '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10'
const assetId = '018f8c8d-5f34-7db2-8b98-2c7bf3d80a11'
const sessionToken = 's'.repeat(43)

const pagePayload = {
  title: 'Черновая страница',
  path: '/draft',
  blocks: [{
    id: 'hero',
    type: 'hero',
    data: {
      title: 'Секретный заголовок',
      text: 'Текст черновика',
      primaryAction: { label: 'Далее', href: '/next' },
    },
  }],
}

describe('request-time preview runtime helpers', () => {
  test('reads only a valid scoped preview session cookie', () => {
    assert.equal(readPreviewSessionCookie(`other=x; cms_preview_session=${sessionToken}; theme=dark`), sessionToken)
    assert.equal(readPreviewSessionCookie(`cms_preview_session=${sessionToken}; cms_preview_session=${sessionToken}`), null)
    assert.equal(readPreviewSessionCookie('cms_preview_session=short'), null)
    assert.equal(readPreviewSessionCookie(undefined), null)
  })

  test('fetches the draft page server-to-server and converts it to a public renderer page', async () => {
    let request: { url: string; init: RequestInit } | undefined
    const dto = {
      id: pageId,
      title: 'Черновая страница',
      path: '/draft',
      draftPayload: pagePayload,
      draftRevision: 4,
      archived: false,
    }
    const result = await fetchPreviewPage({
      backendOrigin: 'https://api.example.test',
      pageId,
      sessionToken,
      fetcher: async (url, init) => {
        request = { url, init }
        return new Response(JSON.stringify(dto), { status: 200, headers: { 'content-type': 'application/json' } })
      },
    })

    assert.equal(request?.url, `https://api.example.test/api/cms/preview/pages/${pageId}`)
    assert.equal(new Headers(request?.init.headers).get('x-cms-preview-session'), sessionToken)
    assert.equal(new Headers(request?.init.headers).get('cookie'), null)
    assert.equal(request?.init.credentials, 'omit')
    assert.equal(request?.init.redirect, 'error')
    assert.deepEqual(previewPageToPublicPage(result), {
      id: pageId,
      title: 'Черновая страница',
      path: '/draft',
      blocks: pagePayload.blocks,
    })
  })

  test('fetches a short-lived private media URL without exposing the preview cookie', async () => {
    let request: { url: string; init: RequestInit } | undefined
    const result = await fetchPreviewMedia({
      backendOrigin: 'https://api.example.test',
      assetId,
      sessionToken,
      fetcher: async (url, init) => {
        request = { url, init }
        return new Response(JSON.stringify({
          id: assetId,
          mimeType: 'image/png',
          downloadUrl: 'https://storage.example.test/signed/private.png',
          expiresAt: '2026-08-24T10:01:00.000Z',
        }), { status: 200 })
      },
    })

    assert.equal(request?.url, `https://api.example.test/api/cms/preview/media/${assetId}`)
    assert.equal(new Headers(request?.init.headers).get('x-cms-preview-session'), sessionToken)
    assert.equal(new Headers(request?.init.headers).get('cookie'), null)
    assert.equal(result.mimeType, 'image/png')
  })
})

describe('preview failure closure', () => {
  test('a non-ok backend response becomes the same generic error for 401 and 404', async () => {
    // Cross-page access and a bad token must be indistinguishable to the caller.
    for (const status of [401, 404]) {
      await assert.rejects(
        fetchPreviewPage({
          backendOrigin: 'https://api.example.test',
          pageId,
          sessionToken,
          fetcher: async () => new Response('no', { status }),
        }),
        /Preview is unavailable/,
      )
    }
  })

  test('a draft payload that does not satisfy the selected draft schema is refused', async () => {
    const invalid = {
      id: pageId,
      title: 'Черновая страница',
      path: '/draft',
      draftPayload: { ...pagePayload, blocks: [{ id: 'x', type: 'not-registered', data: {} }] },
      draftRevision: 4,
      archived: false,
    }
    const dto = await fetchPreviewPage({
      backendOrigin: 'https://api.example.test',
      pageId,
      sessionToken,
      fetcher: async () => new Response(JSON.stringify(invalid), { status: 200 }),
    })
    assert.throws(() => previewPageToPublicPage(dto), /Preview is unavailable/)
  })
})
