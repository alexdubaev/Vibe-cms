import { previewSessionResponseSchema, type PreviewSessionResponse } from '@web-app-demo/contracts'

const previewPathPrefix = '/__preview/'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const tokenPattern = /^[A-Za-z0-9_-]{43,256}$/

/**
 * The preview exchange is deliberately a server-side helper. Do not import this module from a
 * browser island: a grant is an opaque one-time credential and must be sent only to the configured
 * backend origin, never to an arbitrary URL or persisted in browser storage.
 */
export type PreviewGrant = {
  pageId: string
  token: string
}

export type PreviewFetcher = (input: string, init: RequestInit) => Promise<Response>

export class PreviewExchangeError extends Error {
  constructor(message = 'Preview is unavailable') {
    super(message)
    this.name = 'PreviewExchangeError'
  }
}

/**
 * Parses the exact one-time URL emitted by the backend. Unknown query parameters, fragments,
 * credentials, non-HTTPS non-loopback origins, and non-UUID page ids are rejected before any network request.
 */
export function parsePreviewGrantUrl(input: string | URL): PreviewGrant {
  let url: URL
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(input)
  } catch {
    throw new PreviewExchangeError()
  }

  const localHttp = url.protocol === 'http:' && ['127.0.0.1', '::1', 'localhost'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password || url.hash) {
    throw new PreviewExchangeError()
  }

  if (!url.pathname.startsWith(previewPathPrefix)) {
    throw new PreviewExchangeError()
  }

  const encodedPageId = url.pathname.slice(previewPathPrefix.length)
  if (!encodedPageId || encodedPageId.includes('/')) {
    throw new PreviewExchangeError()
  }

  let pageId: string
  try {
    pageId = decodeURIComponent(encodedPageId)
  } catch {
    throw new PreviewExchangeError()
  }
  if (!uuidPattern.test(pageId)) throw new PreviewExchangeError()

  const queryKeys = [...url.searchParams.keys()]
  if (queryKeys.length !== 1 || queryKeys[0] !== 'token') {
    throw new PreviewExchangeError()
  }
  const token = url.searchParams.get('token')
  if (!token || !tokenPattern.test(token)) throw new PreviewExchangeError()

  return { pageId, token }
}

function backendExchangeUrl(origin: string): string {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    throw new PreviewExchangeError()
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new PreviewExchangeError()
  }
  if (url.pathname !== '/' && url.pathname !== '') throw new PreviewExchangeError()
  return new URL('/api/cms/preview/exchange', url).toString()
}

/**
 * Exchanges a grant exactly once. The caller must not retry this request: the backend consumes the
 * grant atomically, so a retry receives the same generic invalid/expired response as any other bad
 * grant. The response body is parsed through the shared contract and backend details are not
 * surfaced to the preview page.
 */
export async function exchangePreviewGrant(input: {
  grantUrl: string | URL
  backendOrigin: string
  fetcher?: PreviewFetcher
}): Promise<PreviewSessionResponse> {
  const grant = parsePreviewGrantUrl(input.grantUrl)
  const endpoint = backendExchangeUrl(input.backendOrigin)
  const fetcher = input.fetcher ?? globalThis.fetch
  if (typeof fetcher !== 'function') throw new PreviewExchangeError()

  let response: Response
  try {
    response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: grant.token }),
      credentials: 'omit',
      redirect: 'error',
    })
  } catch {
    throw new PreviewExchangeError()
  }
  if (!response.ok) throw new PreviewExchangeError()

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new PreviewExchangeError()
  }
  try {
    return previewSessionResponseSchema.parse(payload)
  } catch {
    throw new PreviewExchangeError()
  }
}

/** Creates the scoped, non-persistent cookie a future Node preview route should set. */
export function previewSessionCookie(session: PreviewSessionResponse, now = Date.now()): string {
  const expiresAt = Date.parse(session.expiresAt)
  const maxAge = Math.min(15 * 60, Math.floor((expiresAt - now) / 1000))
  if (!Number.isFinite(expiresAt) || maxAge < 1) throw new PreviewExchangeError()
  return `cms_preview_session=${encodeURIComponent(session.sessionToken)}; Path=/__preview; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`
}

/** Shared response policy for every protected preview response, including an indistinguishable 404. */
export function previewSecurityHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  }
}

export function previewNotFoundResponse(): Response {
  return new Response('Not Found', {
    status: 404,
    headers: {
      ...previewSecurityHeaders(),
      'Content-Type': 'text/plain; charset=utf-8',
    },
  })
}
