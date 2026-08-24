import {
  exchangePreviewGrant,
  parsePreviewGrantUrl,
  previewNotFoundResponse,
  previewSecurityHeaders,
  previewSessionCookie,
} from '@/cms/preview'

export const prerender = false

export async function GET({ url }: { url: URL }) {
  const grantUrl = url.searchParams.get('grant')
  const backendOrigin = process.env.CMS_BACKEND_ORIGIN
  if (!grantUrl || !backendOrigin) return previewNotFoundResponse()

  try {
    const grant = parsePreviewGrantUrl(grantUrl)
    const session = await exchangePreviewGrant({ grantUrl, backendOrigin })
    const target = new URL(`/__preview/${grant.pageId}`, url)
    const headers = new Headers(previewSecurityHeaders())
    headers.set('Location', target.toString())
    headers.set('Set-Cookie', previewSessionCookie(session))
    return new Response(null, { status: 303, headers })
  } catch {
    return previewNotFoundResponse()
  }
}
