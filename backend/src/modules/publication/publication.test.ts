import { describe, expect, test } from 'bun:test'

import { PublicationRebuildController, type PublicationRepository } from './application/rebuild-controller'

const baseController = {
  key: 'default',
  desiredRevision: 4,
  publishedRevision: 3,
  activeBuildId: null,
  activeSlot: 'blue' as const,
  status: 'queued' as const,
  heartbeatAt: null,
  updatedAt: new Date('2026-08-24T10:00:00.000Z'),
  lastError: null,
}

function createRepository(overrides: Partial<PublicationRepository> = {}) {
  const builds: Array<{
    id: string
    publicationRevision: number
    slot: 'blue' | 'green'
    state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  }> = []
  const calls: string[] = []
  const repository: PublicationRepository = {
    getController: async () => baseController,
    claimBuild: async (input) => {
      calls.push(`claim:${input.publicationRevision}:${input.slot}`)
      const build = { id: 'build-1', ...input, state: 'queued' as const }
      builds.push(build)
      return build
    },
    markDispatchFailed: async (buildId, message) => {
      calls.push(`dispatch-failed:${buildId}:${message}`)
    },
    markStale: async (buildId, message) => {
      calls.push(`stale:${buildId}:${message}`)
    },
    ...overrides,
  }
  return { repository, builds, calls }
}

describe('publication rebuild controller', () => {
  test('claims the newest desired revision on the inactive slot and dispatches only the build id', async () => {
    const { repository, calls } = createRepository()
    const dispatched: unknown[] = []
    const controller = new PublicationRebuildController(repository, {
      dispatch: async (input) => { dispatched.push(input) },
    }, {
      now: () => new Date('2026-08-24T10:00:01.000Z'),
    })

    await expect(controller.reconcile()).resolves.toMatchObject({ kind: 'dispatched', buildId: 'build-1', revision: 4, slot: 'green' })
    expect(calls).toEqual(['claim:4:green'])
    expect(dispatched).toEqual([{ buildId: 'build-1' }])
  })

  test('does not start a second build while the active heartbeat is fresh', async () => {
    const { repository, calls } = createRepository({
      getController: async () => ({ ...baseController, activeBuildId: 'build-live', heartbeatAt: new Date('2026-08-24T09:59:45.000Z') }),
    })
    const controller = new PublicationRebuildController(repository, { dispatch: async () => undefined }, {
      now: () => new Date('2026-08-24T10:00:01.000Z'),
    })

    await expect(controller.reconcile()).resolves.toEqual({ kind: 'active', buildId: 'build-live' })
    expect(calls).toEqual([])
  })

  test('expires a stale build before claiming the newest desired revision', async () => {
    const { repository, calls } = createRepository({
      getController: async () => ({ ...baseController, activeBuildId: 'build-stale', heartbeatAt: new Date('2026-08-24T09:57:00.000Z') }),
    })
    const controller = new PublicationRebuildController(repository, { dispatch: async () => undefined }, {
      now: () => new Date('2026-08-24T10:00:01.000Z'),
    })

    await controller.reconcile()
    expect(calls).toEqual(['stale:build-stale:Builder heartbeat expired', 'claim:4:green'])
  })

  test('leaves a recoverable failure when dispatch cannot be accepted', async () => {
    const { repository, calls } = createRepository()
    const controller = new PublicationRebuildController(repository, {
      dispatch: async () => { throw new Error('YMQ unavailable') },
    }, {
      now: () => new Date('2026-08-24T10:00:01.000Z'),
    })

    await expect(controller.reconcile()).resolves.toEqual({ kind: 'dispatch-failed', buildId: 'build-1', revision: 4 })
    expect(calls).toEqual(['claim:4:green', 'dispatch-failed:build-1:YMQ unavailable'])
  })

  test('prepares the immutable snapshot before dispatching the build command', async () => {
    const { repository, calls } = createRepository()
    const sequence: string[] = []
    const controller = new PublicationRebuildController(repository, {
      dispatch: async () => { sequence.push('dispatch') },
    }, {
      now: () => new Date('2026-08-24T10:00:01.000Z'),
    }, 120_000, {
      ensureArtifact: async (revision) => { sequence.push(`artifact:${revision}`) },
    })

    await expect(controller.reconcile()).resolves.toMatchObject({ kind: 'dispatched' })
    expect(sequence).toEqual(['artifact:4', 'dispatch'])
    expect(calls).toEqual(['claim:4:green'])
  })

  test('turns an artifact failure into a recoverable controller failure', async () => {
    const { repository, calls } = createRepository()
    const controller = new PublicationRebuildController(repository, {
      dispatch: async () => { throw new Error('must not dispatch') },
    }, {
      now: () => new Date('2026-08-24T10:00:01.000Z'),
    }, 120_000, {
      ensureArtifact: async () => { throw new Error('snapshot unavailable') },
    })

    await expect(controller.reconcile()).resolves.toMatchObject({ kind: 'dispatch-failed' })
    expect(calls).toEqual(['claim:4:green', 'dispatch-failed:build-1:snapshot unavailable'])
  })
})
