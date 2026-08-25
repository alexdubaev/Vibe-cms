import {
  materialiseSnapshot,
  type SitePackageDescriptor,
  type SnapshotSchema,
  type SnapshotSource,
} from '../domain/materialise-snapshot'

export type SnapshotSourceReader = () => Promise<SnapshotSource>

export type CmsSnapshotValidation<Snapshot> = {
  sitePackage: SitePackageDescriptor
  snapshotSchema: SnapshotSchema<Snapshot>
}

export class CmsSnapshotService<Snapshot = unknown> {
  constructor(
    private readonly readSource: SnapshotSourceReader,
    private readonly clock: { now(): Date },
    private readonly validation: CmsSnapshotValidation<Snapshot>,
  ) {}

  async createCandidate(revision: number): Promise<{ snapshot: Snapshot; revisionMap: unknown }> {
    const source = await this.readSource()
    return {
      snapshot: materialiseSnapshot(revision, this.clock.now(), source, this.validation.sitePackage, this.validation.snapshotSchema),
      revisionMap: { revision },
    }
  }
}
