import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  exchangePreviewGrant,
  parsePreviewGrantUrl,
  previewNotFoundResponse,
  previewSecurityHeaders,
  previewSessionCookie,
  PreviewExchangeError,
} from '../src/cms/preview'

const pageId = '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10'
const token = 'a'.repeat(43)
const grantUrl = `https://preview.example.test/__preview/${pageId}?token=${token}`
const session = {
  sessionToken: 'b'.repeat(43),
  expiresAt: '2026-08-24T10:15:00.000Z',
}

describe('protected preview helpers', () => {
  test('parses only the exact HTTPS one-time grant URL', () => {
    assert.deepEqual(parsePreviewGrantUrl(grantUrl), { pageId, token })
    assert.throws(() => parsePreviewGrantUrl(grantUrl.replace('https:', 'http:')), PreviewExchangeError)
    assert.throws(() => parsePreviewGrantUrl(`${grantUrl}&extra=ignored`), PreviewExchangeError)
    assert.throws(
      () => parsePreviewGrantUrl(`https://preview.example.test/__preview/${pageId}/other?token=${token}`),
      PreviewExchangeError,
    )
    assert.throws(
      () => parsePreviewGrantUrl(`https://preview.example.test/__preview/not-a-uuid?token=${token}`),
      PreviewExchangeError,
    )
  })

  test('exchanges the token server-to-server without forwarding cookies or the grant URL', async () => {
    let request: { url: string; init: RequestInit } | undefined
    const result = await exchangePreviewGrant({
      grantUrl,
      backendOrigin: 'https://api.example.test',
      fetcher: async (url, init) => {
        request = { url, init }
        return new Response(JSON.stringify(session), { status: 200, headers: { 'Content-Type': 'application/json' } })
      },
    })

    assert.deepEqual(result, session)
    assert.equal(request?.url, 'https://api.example.test/api/cms/preview/exchange')
    assert.equal(request?.init.method, 'POST')
    assert.equal(new Headers(request?.init.headers).get('Cookie'), null)
    assert.equal(request?.init.credentials, 'omit')
    assert.equal(request?.init.redirect, 'error')
    assert.deepEqual(JSON.parse(String(request?.init.body)), { token })
    assert.equal(String(request?.init.body).includes(grantUrl), false)
  })

  test('fails closed for backend errors and malformed session responses', async () => {
    const fetcher = async () => new Response(JSON.stringify({ message: 'secret backend details' }), { status: 401 })
    await assert.rejects(exchangePreviewGrant({ grantUrl, backendOrigin: 'https://api.example.test', fetcher }), /Preview is unavailable/)

    const malformed = async () => new Response(JSON.stringify({ sessionToken: 'too-short' }), { status: 200 })
    await assert.rejects(
      exchangePreviewGrant({ grantUrl, backendOrigin: 'https://api.example.test', fetcher: malformed }),
      /Preview is unavailable/,
    )
  })

  test('creates a short scoped HttpOnly cookie and standard private headers', () => {
    assert.equal(previewSessionCookie(session, Date.parse('2026-08-24T10:00:00.000Z')).includes(
      'cms_preview_session=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb; Path=/__preview; HttpOnly; SameSite=Lax; Secure; Max-Age=900',
    ), true)
    assert.deepEqual(previewSecurityHeaders(), { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' })
    const response = previewNotFoundResponse()
    assert.equal(response.status, 404)
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow')
  })
})
