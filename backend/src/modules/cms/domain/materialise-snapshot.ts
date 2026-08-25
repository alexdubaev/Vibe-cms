export type SnapshotSource = {
  settings: unknown
  pages: unknown[]
  collections: unknown[]
  menus: unknown[]
  redirects: unknown[]
  media: unknown[]
}

export type SitePackageDescriptor = {
  id: string
  version: string
  schemaVersion: number
}

export type SnapshotSchema<Snapshot> = {
  parse(input: unknown): Snapshot
}

/**
 * The only boundary at which a draft becomes public data. The strict contract
 * is an allowlist, so draft-only fields cannot accidentally reach publication.
 */
export function materialiseSnapshot<Snapshot>(
  revision: number,
  generatedAt: Date,
  source: SnapshotSource,
  sitePackage: SitePackageDescriptor,
  snapshotSchema: SnapshotSchema<Snapshot>,
): Snapshot {
  return snapshotSchema.parse({
    revision,
    generatedAt: generatedAt.toISOString(),
    ...source,
    sitePackage,
  })
}
