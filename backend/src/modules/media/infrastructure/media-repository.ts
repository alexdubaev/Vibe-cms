import type { DbClient } from '../../../db'
import type { MediaRepository } from '../application/ports'

export function createMediaRepository(db: DbClient): MediaRepository {
  return {
    async createPending(input) {
      return toRecord(await db.cmsMediaAsset.create({
        data: {
          filename: input.filename,
          objectKey: input.objectKey,
          contentVersion: input.contentVersion,
          contentType: input.contentType,
          byteSize: input.byteSize,
          state: 'pending',
        },
      }))
    },

    async findPending(assetId) {
      const asset = await db.cmsMediaAsset.findFirst({ where: { id: assetId, state: 'pending' } })
      return asset ? toRecord(asset) : null
    },

    async findReady(assetId) {
      const asset = await db.cmsMediaAsset.findFirst({ where: { id: assetId, state: 'ready' } })
      return asset ? toRecord(asset) : null
    },

    async markReady(input) {
      const updated = await db.cmsMediaAsset.updateMany({
        where: { id: input.assetId, state: 'pending' },
        data: { state: 'ready', storageEtag: input.storageEtag, width: input.width, height: input.height },
      })
      if (updated.count !== 1) return null
      return toRecord(await db.cmsMediaAsset.findUniqueOrThrow({ where: { id: input.assetId } }))
    },

    async list(input = {}) {
      const assets = await db.cmsMediaAsset.findMany({
        where: input.query ? { filename: { contains: input.query, mode: 'insensitive' } } : undefined,
        orderBy: { createdAt: 'desc' },
      })
      return assets.map(toRecord)
    },

    async updateAlt(input) {
      const updated = await db.cmsMediaAsset.updateMany({
        where: { id: input.assetId, state: { not: 'deleted' } },
        data: { altText: input.altText },
      })
      if (updated.count !== 1) return null
      return toRecord(await db.cmsMediaAsset.findUniqueOrThrow({ where: { id: input.assetId } }))
    },

    async markDeleting(assetId) {
      return db.$transaction(async (tx) => {
        const asset = await tx.cmsMediaAsset.findUnique({ where: { id: assetId } })
        if (!asset) return null
        const usageCount = await tx.cmsMediaUsage.count({ where: { assetId } })
        if (usageCount > 0) return { objectKey: asset.objectKey, usageCount }
        const updated = await tx.cmsMediaAsset.updateMany({
          where: { id: assetId, state: { in: ['pending', 'ready'] } },
          data: { state: 'deleting' },
        })
        return updated.count === 1 ? { objectKey: asset.objectKey, usageCount: 0 } : null
      })
    },
  }
}

function toRecord(asset: {
  id: string
  filename: string
  objectKey: string
  contentVersion: string
  contentType: string
  byteSize: number
  width: number | null
  height: number | null
  altText: string | null
  state: 'pending' | 'ready' | 'deleting' | 'deleted'
  storageEtag: string | null
}): import('../application/ports').MediaAssetRecord {
  return asset
}
