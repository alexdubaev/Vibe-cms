import { mediaAssetSchema } from '@web-app-demo/contracts'
import { z } from 'zod'

import { detectMediaMime, mediaSignatureByteLength, type SupportedMediaMime } from '../domain/file-signatures'
import { MediaError } from '../domain/errors'
import { extractImageDimensions } from '../domain/image-dimensions'
import type { MediaActor, MediaAssetRecord, MediaServiceDependencies } from './ports'

const mediaMimeSchema = z.enum([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'video/mp4',
  'application/pdf',
])
const createUploadSchema = z.object({
  filename: z.string().trim().min(1).max(180).refine((value) => !/[\\/\u0000-\u001f\u007f]/.test(value)),
  mimeType: mediaMimeSchema,
  byteSize: z.number().int().positive(),
}).strict()

const limits: Record<SupportedMediaMime, [number, number]> = {
  'image/jpeg': [100, 15 * 1024 * 1024],
  'image/png': [100, 15 * 1024 * 1024],
  'image/webp': [100, 15 * 1024 * 1024],
  'image/avif': [100, 15 * 1024 * 1024],
  'video/mp4': [1_024, 100 * 1024 * 1024],
  'application/pdf': [100, 25 * 1024 * 1024],
}
const maxDimensionReadBytes = 512 * 1024

export class MediaService {
  private readonly clock: { now(): Date }

  constructor(private readonly dependencies: MediaServiceDependencies) {
    this.clock = dependencies.clock ?? { now: () => new Date() }
  }

  async createUpload(actor: MediaActor, input: unknown) {
    this.requireEditor(actor)
    const request = createUploadSchema.parse(input)
    const [minimum, maximum] = limits[request.mimeType]
    if (request.byteSize < minimum || request.byteSize > maximum) {
      throw new MediaError('Media size is outside the allowed range', 'MEDIA_REJECTED')
    }
    const objectKey = this.dependencies.createObjectKey({ now: this.clock.now() })
    const upload = await this.dependencies.storage.createUploadUrl({
      key: objectKey,
      contentType: request.mimeType,
      byteSize: request.byteSize,
    })
    const asset = await this.dependencies.repository.createPending({
      ...request,
      contentType: request.mimeType,
      objectKey,
    })
    return {
      asset: this.toDto(asset),
      upload: {
        uploadId: asset.id,
        method: upload.method,
        url: upload.url,
        headers: upload.headers,
        contentLength: upload.contentLength,
        expiresAt: upload.expiresAt,
      },
    }
  }

  async finalize(actor: MediaActor, assetId: string) {
    this.requireEditor(actor)
    const asset = await this.dependencies.repository.findPending(assetId)
    if (!asset) throw new MediaError('Media upload was not found', 'MEDIA_NOT_FOUND')
    const stored = await this.dependencies.storage.headObject(asset.objectKey)
    if (!stored) throw new MediaError('Media upload has not finished', 'MEDIA_REJECTED')
    if (stored.contentLength !== asset.byteSize || stored.contentType !== asset.contentType) {
      throw new MediaError('Uploaded media does not match the declared content', 'MEDIA_REJECTED')
    }
    const readEnd = Math.min(asset.byteSize, asset.contentType.startsWith('image/') ? maxDimensionReadBytes : mediaSignatureByteLength(asset.contentType as SupportedMediaMime)) - 1
    const signature = await this.dependencies.storage.readRange(asset.objectKey, {
      start: 0,
      end: readEnd,
    })
    if (!signature || detectMediaMime(signature) !== asset.contentType) {
      throw new MediaError('Uploaded bytes are not a supported media format', 'MEDIA_REJECTED')
    }
    const dimensions = asset.contentType.startsWith('image/')
      ? extractImageDimensions(signature, asset.contentType as SupportedMediaMime)
      : null
    if (asset.contentType.startsWith('image/') && !dimensions) {
      throw new MediaError('Uploaded image dimensions could not be determined', 'MEDIA_REJECTED')
    }
    const ready = await this.dependencies.repository.markReady({
      assetId,
      storageEtag: stored.etag,
      ...(dimensions ?? {}),
    })
    if (!ready) throw new MediaError('Media upload was already finalized', 'MEDIA_NOT_FOUND')
    return { asset: this.toDto(ready) }
  }

  async list(actor: MediaActor, query?: string) {
    this.requireEditor(actor)
    return { assets: (await this.dependencies.repository.list({ query })).map((asset) => this.toDto(asset)) }
  }

  async createImageDownload(actor: MediaActor, assetId: string) {
    this.requireEditor(actor)
    const asset = await this.dependencies.repository.findReady(assetId)
    if (!asset || !asset.contentType.startsWith('image/')) {
      throw new MediaError('Image was not found', 'MEDIA_NOT_FOUND')
    }
    const download = await this.dependencies.storage.createDownloadUrl({
      key: asset.objectKey,
      expiresInSeconds: 60,
    })
    return { url: download.url, expiresAt: download.expiresAt }
  }

  async updateAlt(actor: MediaActor, assetId: string, altText: string | null) {
    this.requireEditor(actor)
    const asset = await this.dependencies.repository.updateAlt({ assetId, altText: altText?.trim() || null })
    if (!asset) throw new MediaError('Media asset was not found', 'MEDIA_NOT_FOUND')
    return { asset: this.toDto(asset) }
  }

  async remove(actor: MediaActor, assetId: string) {
    if (actor.role !== 'owner') throw new MediaError('Only an owner can delete media', 'FORBIDDEN')
    const result = await this.dependencies.repository.markDeleting(assetId)
    if (!result) throw new MediaError('Media asset was not found', 'MEDIA_NOT_FOUND')
    if (result.usageCount > 0) throw new MediaError('Media is still used by website content', 'CMS_MEDIA_IN_USE', { count: result.usageCount })
    if (this.dependencies.queueDelete) {
      await this.dependencies.queueDelete({ assetId, objectKey: result.objectKey })
    } else {
      this.dependencies.deferDelete({ assetId, objectKey: result.objectKey })
    }
    return { deleted: true }
  }

  private requireEditor(actor: MediaActor) {
    if (actor.role !== 'editor' && actor.role !== 'owner') {
      throw new MediaError('You do not have permission to manage media', 'FORBIDDEN')
    }
  }

  private toDto(asset: MediaAssetRecord) {
    const dto = {
      id: asset.id,
      contentVersion: asset.contentVersion,
      filename: asset.filename,
      mimeType: asset.contentType,
      byteSize: asset.byteSize,
      width: asset.width,
      height: asset.height,
      alt: asset.altText,
      state: asset.state,
    }
    return mediaAssetSchema.parse(dto)
  }
}
