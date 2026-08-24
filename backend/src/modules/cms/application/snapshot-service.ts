import type { PublicationSnapshot } from '@web-app-demo/contracts'

import { materialiseSnapshot, type SnapshotSource } from '../domain/materialise-snapshot'

export type SnapshotSourceReader = () => Promise<SnapshotSource>

export class CmsSnapshotService {
  constructor(
    private readonly readSource: SnapshotSourceReader,
    private readonly clock: { now(): Date } = { now: () => new Date() },
  ) {}

  async createCandidate(revision: number): Promise<{ snapshot: PublicationSnapshot; revisionMap: unknown }> {
    const source = await this.readSource()
    return {
      snapshot: materialiseSnapshot(revision, this.clock.now(), source),
      revisionMap: { revision },
    }
  }
}
