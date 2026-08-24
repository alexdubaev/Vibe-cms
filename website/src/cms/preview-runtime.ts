import {
  pageDraftSchema,
  previewMediaResponseSchema,
  previewPageResponseSchema,
  type PreviewMediaResponse,
  type PreviewPageResponse,
} from '@web-app-demo/contracts'

import { PreviewExchangeError, type PreviewFetcher } from './preview'
import type { PublicPage } from './block-registry'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const tokenPattern = /^[A-Za-z0-9_-]{43,256}$/

export function readPreviewSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null
  const values = cookieHeader.split(';').map((part) => part.trim()).filter(Boolean)
  const matches = values.filter((part) => part.startsWith('cms_preview_session='))
  if (matches.length !== 1) return null

  const raw = matches[0].slice('cms_preview_session='.length)
  try {
    const token = decodeURIComponent(raw)
    return tokenPattern.test(token) ? token : null
  } catch {
    return null
  }
}

export async function fetchPreviewPage(input: {
  backendOrigin: string
  pageId: string
  sessionToken: string
  fetcher?: PreviewFetcher
}): Promise<PreviewPageResponse> {
  if (!uuidPattern.test(input.pageId) || !tokenPattern.test(input.sessionToken)) throw new PreviewExchangeError()
  const payload = await fetchPreviewJson(input, `/api/cms/preview/pages/${input.pageId}`)
  try {
    return previewPageResponseSchema.parse(payload)
  } catch {
    throw new PreviewExchangeError()
  }
}

export async function fetchPreviewMedia(input: {
  backendOrigin: string
  assetId: string
  sessionToken: string
  fetcher?: PreviewFetcher
}): Promise<PreviewMediaResponse> {
  if (!uuidPattern.test(input.assetId) || !tokenPattern.test(input.sessionToken)) throw new PreviewExchangeError()
  const payload = await fetchPreviewJson(input, `/api/cms/preview/media/${input.assetId}`)
  try {
    return previewMediaResponseSchema.parse(payload)
  } catch {
    throw new PreviewExchangeError()
  }
}

export function previewPageToPublicPage(page: PreviewPageResponse): PublicPage {
  let draftPayload: Record<string, unknown>
  if (page.draftPayload && typeof page.draftPayload === 'object' && !Array.isArray(page.draftPayload)) {
    draftPayload = page.draftPayload as Record<string, unknown>
  } else {
    throw new PreviewExchangeError()
  }

  try {
    const draft = pageDraftSchema.parse({ ...draftPayload, expectedRevision: page.draftRevision })
    return {
      id: page.id,
      title: draft.title,
      path: draft.path,
      ...(draft.navigationLabel ? { navigationLabel: draft.navigationLabel } : {}),
      ...(draft.seo ? { seo: draft.seo } : {}),
      blocks: draft.blocks,
    }
  } catch {
    throw new PreviewExchangeError()
  }
}

async function fetchPreviewJson(
  input: { backendOrigin: string; sessionToken: string; fetcher?: PreviewFetcher },
  path: string,
) {
  const endpoint = previewEndpoint(input.backendOrigin, path)
  const fetcher = input.fetcher ?? globalThis.fetch
  if (typeof fetcher !== 'function') throw new PreviewExchangeError()

  let response: Response
  try {
    response = await fetcher(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-store',
        'X-CMS-Preview-Session': input.sessionToken,
      },
      credentials: 'omit',
      redirect: 'error',
    })
  } catch {
    throw new PreviewExchangeError()
  }
  if (!response.ok) throw new PreviewExchangeError()

  try {
    return await response.json() as unknown
  } catch {
    throw new PreviewExchangeError()
  }
}

function previewEndpoint(origin: string, path: string) {
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
  return new URL(path, url).toString()
}
