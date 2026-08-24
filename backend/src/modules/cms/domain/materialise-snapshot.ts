import { publicationSnapshotSchema, type PublicationSnapshot } from '@web-app-demo/contracts'

export type SnapshotSource = {
  settings: unknown
  pages: unknown[]
  collections: unknown[]
  menus: unknown[]
  redirects: unknown[]
  media: unknown[]
}

/**
 * The only boundary at which a draft becomes public data. The strict contract
 * is an allowlist, so draft-only fields cannot accidentally reach publication.
 */
export function materialiseSnapshot(
  revision: number,
  generatedAt: Date,
  source: SnapshotSource,
): PublicationSnapshot {
  return publicationSnapshotSchema.parse({
    revision,
    generatedAt: generatedAt.toISOString(),
    ...source,
  })
}
