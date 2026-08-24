import { loadPublicationSnapshot } from '@/cms/snapshot'

export async function GET() {
  const origin = import.meta.env.PUBLIC_WEBSITE_URL?.replace(/\/$/, '')
  const sitemap = origin ? `\nSitemap: ${origin}/sitemap.xml` : ''
  const snapshot = await loadPublicationSnapshot()
  const body = snapshot
    ? `User-agent: *\nAllow: /${sitemap}\n`
    : `User-agent: *\nAllow: /${sitemap}\n`
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' } })
}
