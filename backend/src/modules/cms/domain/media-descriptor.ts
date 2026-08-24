import { publicMediaDescriptorSchema, type PublicMediaDescriptor } from '@web-app-demo/contracts'

export type PublicMediaAssetInput = {
  id: string
  contentVersion: string
  filename: string
  contentType: string
  byteSize: number
  width: number | null
  height: number | null
  altText: string | null
}

export function toPublicMediaDescriptor(input: PublicMediaAssetInput): PublicMediaDescriptor {
  const safeFilename = input.filename
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180) || 'asset'

  return publicMediaDescriptorSchema.parse({
    id: input.id,
    contentVersion: input.contentVersion,
    filename: input.filename,
    mimeType: input.contentType,
    byteSize: input.byteSize,
    width: input.width,
    height: input.height,
    alt: input.altText?.trim() || null,
    publicPath: `/media/${input.id}/${input.contentVersion}/${safeFilename}`,
  })
}
