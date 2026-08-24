import {
  publicationMediaCopySchema,
  publicationSnapshotSchema,
  type PublicationMediaCopy,
} from '@web-app-demo/contracts'

import type { PrivateStorage } from '../../../storage/port'

export type PublicationMediaAssetForCopy = {
  id: string
  contentVersion: string
  objectKey: string
  contentType: string
  state: string
}

export type PublicationMediaCopyRepository = {
  getPublication(revision: number): Promise<{ revision: number; snapshot: unknown } | null>
  getMediaAssets(ids: string[]): Promise<PublicationMediaAssetForCopy[]>
}

export type PublicationMediaCopyStorage = Pick<PrivateStorage, 'createDownloadUrl'>

export class PublicationMediaCopyInputService {
  constructor(
    private readonly repository: PublicationMediaCopyRepository,
    private readonly storage: PublicationMediaCopyStorage,
  ) {}

  async createForBuild(revision: number, slot: 'blue' | 'green'): Promise<PublicationMediaCopy[]> {
    const publication = await this.repository.getPublication(revision)
    if (!publication) throw new Error(`Publication ${revision} was not found`)

    const snapshot = publicationSnapshotSchema.parse(publication.snapshot)
    if (snapshot.revision !== revision) throw new Error('Publication snapshot revision does not match its record')
    if (snapshot.media.length === 0) return []

    const assets = await this.repository.getMediaAssets(snapshot.media.map((media) => media.id))
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]))

    const copies: PublicationMediaCopy[] = []
    for (const descriptor of snapshot.media) {
      const asset = assetsById.get(descriptor.id)
      if (!asset || asset.state !== 'ready') {
        throw new Error(`Publication media ${descriptor.id} is not ready`)
      }
      if (asset.contentVersion !== descriptor.contentVersion || asset.contentType !== descriptor.mimeType) {
        throw new Error(`Publication media ${descriptor.id} does not match the frozen snapshot`)
      }

      const download = await this.storage.createDownloadUrl({ key: asset.objectKey, expiresInSeconds: 300 })
      copies.push(publicationMediaCopySchema.parse({
        sourceUrl: download.url,
        destinationPath: `/${slot}${descriptor.publicPath}`,
        contentType: descriptor.mimeType,
      }))
    }
    return copies
  }
}
