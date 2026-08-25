import type { PublicationSnapshot } from '@web-app-demo/contracts'

export function resolveCmsMediaSrc(
  media: PublicationSnapshot['media'],
  mediaId: string | undefined,
  previewBasePath?: string,
): string | undefined {
  if (!mediaId) return undefined
  if (previewBasePath) return `${previewBasePath.replace(/\/$/, '')}/${mediaId}`
  return media.find((asset) => asset.id === mediaId)?.publicPath
}

export function resolveCmsMediaSources(
  media: PublicationSnapshot['media'],
  mediaIds: readonly string[],
  previewBasePath?: string,
): string[] {
  return mediaIds.flatMap((mediaId) => {
    const source = resolveCmsMediaSrc(media, mediaId, previewBasePath)
    return source ? [source] : []
  })
}
