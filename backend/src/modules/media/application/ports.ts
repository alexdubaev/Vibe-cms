import type { PrivateStorage } from '../../../storage/port'

export type MediaActor = { id: string; role: 'user' | 'editor' | 'owner' }

export type MediaAssetRecord = {
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
}

export type MediaRepository = {
  createPending(input: {
    filename: string
    objectKey: string
    contentVersion?: string
    contentType: string
    byteSize: number
  }): Promise<MediaAssetRecord>
  findPending(assetId: string): Promise<MediaAssetRecord | null>
  findReady(assetId: string): Promise<MediaAssetRecord | null>
  markReady(input: { assetId: string; storageEtag?: string; width?: number; height?: number }): Promise<MediaAssetRecord | null>
  list(input?: { query?: string }): Promise<MediaAssetRecord[]>
  updateAlt(input: { assetId: string; altText: string | null }): Promise<MediaAssetRecord | null>
  markDeleting(assetId: string): Promise<{ objectKey: string; usageCount: number } | null>
}

export type MediaObjectKeyFactory = (input: { assetId?: string; now?: Date }) => string

export type MediaServiceDependencies = {
  repository: MediaRepository
  storage: PrivateStorage
  createObjectKey: MediaObjectKeyFactory
  deferDelete: (input: { assetId: string; objectKey: string }) => void
  queueDelete?: (input: { assetId: string; objectKey: string }) => Promise<void>
  clock?: { now(): Date }
}
