import { defineMiddleware } from 'astro:middleware'
import { previewRewriteTarget } from './cms/preview-routing'

const previewPrefix = '/__preview'

export const onRequest = defineMiddleware(async (context, next) => {
  const isPreviewRequest = context.url.pathname === previewPrefix || context.url.pathname.startsWith(`${previewPrefix}/`)
  const response = isPreviewRequest
    ? await context.rewrite(previewRewriteTarget(context.url)!)
    : await next()
  if (!isPreviewRequest) return response

  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'private, no-store')
  headers.set('X-Robots-Tag', 'noindex, nofollow')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
})
