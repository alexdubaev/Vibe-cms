import { publicationSnapshotSchema } from '@web-app-demo/contracts'

import type { PrivateStorage } from '../../../storage/port'

export type PublicationArtifactRepository = {
  getPublication(revision: number): Promise<{
    revision: number
    snapshot: unknown
    artifactState: 'missing' | 'uploading' | 'ready'
    artifactObjectKey: string | null
    artifactEtag: string | null
  } | null>
  claimArtifact(revision: number, objectKey: string): Promise<
    | { kind: 'claimed' }
    | { kind: 'busy' }
    | { kind: 'ready'; objectKey: string; etag: string }
  >
  markArtifactReady(revision: number, input: { objectKey: string; etag: string }): Promise<void>
  resetArtifact(revision: number): Promise<void>
}

export type PublicationArtifactStorage = Pick<PrivateStorage, 'putObjectOnce' | 'headObject' | 'createDownloadUrl'>

export class PublicationArtifactService {
  constructor(
    private readonly repository: PublicationArtifactRepository,
    private readonly storage: PublicationArtifactStorage,
  ) {}

  async ensureArtifact(revision: number): Promise<{ revision: number; objectKey: string; etag: string }> {
    const publication = await this.repository.getPublication(revision)
    if (!publication) throw new Error(`Publication ${revision} was not found`)

    if (publication.artifactState === 'ready' && publication.artifactObjectKey && publication.artifactEtag) {
      return { revision, objectKey: publication.artifactObjectKey, etag: publication.artifactEtag }
    }

    const objectKey = `cms-publications/${revision}/snapshot.json`
    const claim = await this.repository.claimArtifact(revision, objectKey)
    if (claim.kind === 'ready') return { revision, ...claim }
    if (claim.kind === 'busy') throw new Error(`Publication artifact ${revision} is already uploading`)

    try {
      const snapshot = publicationSnapshotSchema.parse(publication.snapshot)
      const body = new TextEncoder().encode(JSON.stringify(snapshot))
      const stored = await this.storage.putObjectOnce(objectKey, body, 'application/json')
      const etag = stored.stored
        ? stored.etag
        : await this.existingObjectEtag(objectKey, body.byteLength)
      await this.repository.markArtifactReady(revision, { objectKey, etag })
      return { revision, objectKey, etag }
    } catch (error) {
      await this.repository.resetArtifact(revision)
      throw error
    }
  }

  async createArtifactDownload(revision: number, expiresInSeconds = 300): Promise<{
    revision: number
    url: string
    expiresAt: string
    etag: string
  }> {
    const publication = await this.repository.getPublication(revision)
    if (!publication || publication.artifactState !== 'ready' || !publication.artifactObjectKey || !publication.artifactEtag) {
      throw new Error(`Publication artifact ${revision} is not ready`)
    }
    const download = await this.storage.createDownloadUrl({ key: publication.artifactObjectKey, expiresInSeconds })
    return { revision, url: download.url, expiresAt: download.expiresAt, etag: publication.artifactEtag }
  }

  private async existingObjectEtag(objectKey: string, expectedLength: number): Promise<string> {
    const head = await this.storage.headObject(objectKey)
    if (!head || head.contentLength !== expectedLength || head.contentType !== 'application/json' || !head.etag) {
      throw new Error('Existing publication artifact failed immutable metadata verification')
    }
    return head.etag
  }
}
