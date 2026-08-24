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
