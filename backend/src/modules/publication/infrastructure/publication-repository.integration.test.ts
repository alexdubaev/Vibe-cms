import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'

import { createPrisma, type DbClient } from '../../../db'
import { createPublicationRepository } from './publication-repository'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('publication repository against PostgreSQL', () => {
  let db: DbClient

  beforeAll(() => {
    db = createPrisma(databaseUrl!)
  })

  beforeEach(async () => {
    await db.cmsPublication.deleteMany()
    await db.cmsPublicationBuild.deleteMany()
    await db.cmsPublicationController.deleteMany()
    await db.cmsPublicationController.create({
      data: {
        key: 'default',
        desiredRevision: 4,
        publishedRevision: 3,
        activeSlot: 'blue',
        status: 'queued',
      },
    })
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  test('claims one build under the controller row lock and records its inactive slot', async () => {
    const repository = createPublicationRepository(db)

    const build = await repository.claimBuild({
      publicationRevision: 4,
      slot: 'green',
      now: new Date('2026-08-24T10:00:00.000Z'),
    })

    expect(build).toMatchObject({ publicationRevision: 4, slot: 'green', state: 'queued' })
    expect(await db.cmsPublicationController.findUniqueOrThrow({ where: { key: 'default' } })).toMatchObject({
      activeBuildId: build!.id,
      status: 'queued',
    })
    expect(await db.cmsPublicationBuild.count({ where: { publicationRevision: 4 } })).toBe(1)
  })

  test('returns null for a second claim while the first build is active', async () => {
    const repository = createPublicationRepository(db)

    const first = await repository.claimBuild({ publicationRevision: 4, slot: 'green', now: new Date() })
    const second = await repository.claimBuild({ publicationRevision: 4, slot: 'green', now: new Date() })

    expect(first).not.toBeNull()
    expect(second).toBeNull()
    expect(await db.cmsPublicationBuild.count()).toBe(1)
  })

  test('marks dispatch failure recoverably and clears the active build', async () => {
    const repository = createPublicationRepository(db)
    const build = await repository.claimBuild({ publicationRevision: 4, slot: 'green', now: new Date() })

    await repository.markDispatchFailed(build!.id, 'YMQ unavailable')

    expect(await db.cmsPublicationBuild.findUniqueOrThrow({ where: { id: build!.id } })).toMatchObject({ state: 'failed' })
    expect(await db.cmsPublicationController.findUniqueOrThrow({ where: { key: 'default' } })).toMatchObject({
      activeBuildId: null,
      status: 'failed',
      lastError: 'YMQ unavailable',
    })
  })

  test('accepts a heartbeat only from the active build', async () => {
    const repository = createPublicationRepository(db)
    const build = await repository.claimBuild({ publicationRevision: 4, slot: 'green', now: new Date() })
    const heartbeatAt = new Date('2026-08-24T10:01:00.000Z')

    let heartbeatResult: boolean
    try {
      heartbeatResult = await repository.heartbeat(build!.id, heartbeatAt)
    } catch (error) {
      console.error(error)
      throw error
    }
    expect(heartbeatResult!).toBe(true)
    expect(await db.cmsPublicationBuild.findUniqueOrThrow({ where: { id: build!.id } })).toMatchObject({
      state: 'running',
      heartbeatAt,
    })
    expect(await db.cmsPublicationController.findUniqueOrThrow({ where: { key: 'default' } })).toMatchObject({
      activeBuildId: build!.id,
      status: 'building',
      heartbeatAt,
    })
  })

  test('publishes a build only after the builder reports a verified marker', async () => {
    const repository = createPublicationRepository(db)
    const build = await repository.claimBuild({ publicationRevision: 4, slot: 'green', now: new Date() })

    let result: 'accepted' | 'stale'
    try {
      result = await repository.recordResult({
        buildId: build!.id,
        status: 'succeeded',
        markerVerified: true,
        now: new Date('2026-08-24T10:02:00.000Z'),
      })
    } catch (error) {
      console.error(error)
      throw error
    }
    expect(result!).toBe('accepted')
    expect(await db.cmsPublicationBuild.findUniqueOrThrow({ where: { id: build!.id } })).toMatchObject({
      state: 'succeeded',
      markerVerifiedAt: new Date('2026-08-24T10:02:00.000Z'),
    })
    expect(await db.cmsPublicationController.findUniqueOrThrow({ where: { key: 'default' } })).toMatchObject({
      activeBuildId: null,
      activeSlot: 'green',
      publishedRevision: 4,
      status: 'published',
    })
  })

  test('does not let a duplicate terminal callback move publication state twice', async () => {
    const repository = createPublicationRepository(db)
    const build = await repository.claimBuild({ publicationRevision: 4, slot: 'green', now: new Date() })
    const result = { buildId: build!.id, status: 'succeeded' as const, markerVerified: true, now: new Date() }

    const firstResult = await repository.recordResult(result)
    expect(firstResult).toBe('accepted')
    let secondResult: 'accepted' | 'stale'
    try {
      secondResult = await repository.recordResult(result)
    } catch (error) {
      console.error(error)
      throw error
    }
    expect(secondResult).toBe('stale')
  })

  test('does not promote a build that reports success without a verified marker', async () => {
    const repository = createPublicationRepository(db)
    const build = await repository.claimBuild({ publicationRevision: 4, slot: 'green', now: new Date() })

    const result = await repository.recordResult({
      buildId: build!.id,
      status: 'succeeded',
      markerVerified: false,
      now: new Date('2026-08-24T10:02:00.000Z'),
    })

    expect(result).toBe('accepted')
    expect(await db.cmsPublicationBuild.findUniqueOrThrow({ where: { id: build!.id } })).toMatchObject({
      state: 'failed',
      diagnostics: { error: 'Builder did not verify publication marker' },
    })
    // The blue slot stays live: no promotion without verification.
    expect(await db.cmsPublicationController.findUniqueOrThrow({ where: { key: 'default' } })).toMatchObject({
      activeBuildId: null,
      activeSlot: 'blue',
      publishedRevision: 3,
      status: 'failed',
      lastError: 'Builder did not verify publication marker',
    })
  })

  test('records a builder failure and allows claiming a fresh build for the same revision', async () => {
    const repository = createPublicationRepository(db)
    const build = await repository.claimBuild({ publicationRevision: 4, slot: 'green', now: new Date() })

    const failed = await repository.recordResult({
      buildId: build!.id,
      status: 'failed',
      diagnostics: 'builder crashed',
      now: new Date(),
    })
    expect(failed).toBe('accepted')
    expect(await db.cmsPublicationController.findUniqueOrThrow({ where: { key: 'default' } })).toMatchObject({
      activeBuildId: null,
      status: 'failed',
      lastError: 'builder crashed',
    })

    const reclaimed = await repository.claimBuild({ publicationRevision: 4, slot: 'green', now: new Date() })
    expect(reclaimed).not.toBeNull()
    expect(reclaimed!.id).not.toBe(build!.id)
    expect(await db.cmsPublicationBuild.count({ where: { publicationRevision: 4 } })).toBe(2)
    expect(
      await db.cmsPublicationController.findUniqueOrThrow({ where: { key: 'default' } }),
    ).toMatchObject({ activeBuildId: reclaimed!.id, status: 'queued' })
  })

  test('markStale fails the orphaned build and frees the controller for recovery', async () => {
    const repository = createPublicationRepository(db)
    const build = await repository.claimBuild({ publicationRevision: 4, slot: 'green', now: new Date() })
    await repository.heartbeat(build!.id, new Date())

    await repository.markStale(build!.id, 'Builder heartbeat expired')

    expect(await db.cmsPublicationBuild.findUniqueOrThrow({ where: { id: build!.id } })).toMatchObject({
      state: 'failed',
      diagnostics: { error: 'Builder heartbeat expired' },
    })
    expect(await db.cmsPublicationController.findUniqueOrThrow({ where: { key: 'default' } })).toMatchObject({
      activeBuildId: null,
      heartbeatAt: null,
      status: 'failed',
      lastError: 'Builder heartbeat expired',
    })
  })

  test('resolves exactly one claim when two workers claim the same revision concurrently', async () => {
    const repository = createPublicationRepository(db)

    const [first, second] = await Promise.all([
      repository.claimBuild({ publicationRevision: 4, slot: 'green', now: new Date() }),
      repository.claimBuild({ publicationRevision: 4, slot: 'green', now: new Date() }),
    ])

    const winner = [first, second].find((claim) => claim !== null)
    expect(winner).toBeDefined()
    expect([first, second].filter((claim) => claim !== null)).toHaveLength(1)
    expect(await db.cmsPublicationBuild.count({ where: { publicationRevision: 4 } })).toBe(1)
    expect(
      await db.cmsPublicationController.findUniqueOrThrow({ where: { key: 'default' } }),
    ).toMatchObject({ activeBuildId: winner!.id })
  })

  test('claims and records an immutable publication artifact with idempotent retries', async () => {
    await db.cmsPublication.create({
      data: {
        revision: 4,
        snapshot: { revision: 4 },
      },
    })
    const repository = createPublicationRepository(db)

    const claimed = await repository.claimArtifact(4, 'cms-publications/4/snapshot.json')
    expect(claimed).toEqual({ kind: 'claimed' })
    expect(await db.cmsPublication.findUniqueOrThrow({ where: { revision: 4 } })).toMatchObject({
      artifactState: 'uploading',
      artifactObjectKey: 'cms-publications/4/snapshot.json',
    })

    await repository.markArtifactReady(4, { objectKey: 'cms-publications/4/snapshot.json', etag: 'etag-4' })
    let readyClaim: unknown
    try {
      readyClaim = await repository.claimArtifact(4, 'cms-publications/4/snapshot.json')
    } catch (error) {
      console.error(error)
      throw error
    }
    expect(readyClaim).toEqual({
      kind: 'ready',
      objectKey: 'cms-publications/4/snapshot.json',
      etag: 'etag-4',
    })
  })
})
