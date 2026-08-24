import { loadPublicationSnapshot } from '@/cms/snapshot'

export async function GET() {
  const origin = (import.meta.env.PUBLIC_WEBSITE_URL ?? 'https://example.invalid').replace(/\/$/, '')
  const snapshot = await loadPublicationSnapshot()
  const urls = (snapshot?.pages ?? [{ path: '/' }]).map((page) => `${origin}${page.path === '/' ? '/' : page.path}`)
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`),
    '</urlset>',
  ].join('\n')
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' } })
}

function escapeXml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}
