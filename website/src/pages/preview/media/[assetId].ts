import {
  previewNotFoundResponse,
  previewSecurityHeaders,
} from '@/cms/preview'
import { fetchPreviewMedia, readPreviewSessionCookie } from '@/cms/preview-runtime'

export const prerender = false

export async function GET({ params, request }: { params: Record<string, string | undefined>; request: Request }) {
  const assetId = params.assetId
  const sessionToken = readPreviewSessionCookie(request.headers.get('cookie') ?? undefined)
  const backendOrigin = process.env.CMS_BACKEND_ORIGIN
  if (!assetId || !sessionToken || !backendOrigin) return previewNotFoundResponse()

  try {
    const media = await fetchPreviewMedia({ backendOrigin, assetId, sessionToken })
    const stored = await fetch(media.downloadUrl, { credentials: 'omit', redirect: 'error' })
    if (!stored.ok || !stored.body) return previewNotFoundResponse()

    const headers = new Headers(previewSecurityHeaders())
    headers.set('Content-Type', media.mimeType)
    for (const name of ['Content-Length', 'ETag', 'Accept-Ranges', 'Content-Range']) {
      const value = stored.headers.get(name)
      if (value) headers.set(name, value)
    }
    return new Response(stored.body, { status: stored.status, headers })
  } catch {
    return previewNotFoundResponse()
  }
}
