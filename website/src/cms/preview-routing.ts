const previewPrefix = '/__preview'

export function previewRewriteTarget(url: URL) {
  if (url.pathname !== previewPrefix && !url.pathname.startsWith(`${previewPrefix}/`)) return null
  if (url.searchParams.has('token')) {
    const exchange = new URL('/preview/exchange', url)
    exchange.searchParams.set('grant', url.toString())
    return exchange
  }
  return new URL(`/preview${url.pathname.slice(previewPrefix.length)}${url.search}`, url)
}
