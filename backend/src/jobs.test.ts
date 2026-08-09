import { describe, expect, test } from 'bun:test'

import type { BackendRuntime } from './runtime'
import { runBackgroundJob } from './jobs'

const runtime = {} as BackendRuntime

describe('runBackgroundJob', () => {
  test('runs a registered job', async () => {
    await expect(runBackgroundJob('noop', runtime)).resolves.toBeUndefined()
  })

  test('rejects an unknown job and names the ones that exist', async () => {
    // All three runners take job names from user input or config, so a typo has to fail loudly
    // with the list of real names rather than silently do nothing.
    await expect(runBackgroundJob('missing', runtime)).rejects.toThrow(
      'Unknown job "missing". Available jobs: noop, db:ping, auth:sessions:cleanup, uploads:pending:cleanup',
    )
  })

  test('rejects Object.prototype keys instead of running nothing and reporting success', async () => {
    // `'constructor' in backgroundJobs` is true. A provider timer configured with that name would
    // exit 0 every night while doing no work at all, which looks healthy in every dashboard.
    for (const inherited of ['constructor', 'toString', 'hasOwnProperty']) {
      await expect(runBackgroundJob(inherited, runtime)).rejects.toThrow(
        `Unknown job "${inherited}"`,
      )
    }
  })

  describe('uploads:pending:cleanup', () => {
    const expired = [
      { id: 'upload-1', objectKey: 'avatars/2026/07/one' },
      { id: 'upload-2', objectKey: 'avatars/2026/07/two' },
    ]

    function createCleanupRuntime({ failingKey }: { failingKey?: string } = {}) {
      const calls: { findMany: unknown[]; deleteMany: unknown[]; deletedObjects: string[] } = {
        findMany: [],
        deleteMany: [],
        deletedObjects: [],
      }

      const runtime = {
        prisma: {
          userAvatar: {
            findMany: async (input: unknown) => {
              calls.findMany.push(input)
              return expired
            },
            deleteMany: async (input: { where: { id: { in: string[] } } }) => {
              calls.deleteMany.push(input)
              return { count: input.where.id.in.length }
            },
          },
        },
        privateStorage: {
          storage: {
            deleteObject: async (objectKey: string) => {
              if (objectKey === failingKey) throw new Error('storage unavailable')
              calls.deletedObjects.push(objectKey)
            },
          },
        },
      } as unknown as BackendRuntime

      return { calls, runtime }
    }

    test('collects pending uploads whose signed URL expired over an hour ago', async () => {
      const { calls, runtime: cleanupRuntime } = createCleanupRuntime()
      const now = new Date('2026-08-09T12:00:00.000Z')

      await runBackgroundJob('uploads:pending:cleanup', cleanupRuntime, now)

      expect(calls.findMany).toEqual([
        {
          where: {
            state: 'pending',
            // Slack past expiry for clock skew between the app and the database. Finalize
            // already refuses an expired upload, so this is not what protects the boundary.
            expiresAt: { lt: new Date('2026-08-09T11:00:00.000Z') },
          },
          orderBy: { expiresAt: 'asc' },
          take: 500,
        },
      ])
    })

    test('removes the stored object before the row that points at it', async () => {
      const { calls, runtime: cleanupRuntime } = createCleanupRuntime()

      await runBackgroundJob('uploads:pending:cleanup', cleanupRuntime, new Date())

      expect(calls.deletedObjects).toEqual(['avatars/2026/07/one', 'avatars/2026/07/two'])
      expect(calls.deleteMany).toEqual([
        { where: { id: { in: ['upload-1', 'upload-2'] } } },
      ])
    })

    test('keeps the row when its object could not be deleted, so the next run retries', async () => {
      // The row is the only record of the object key. Deleting it after a failed object delete
      // would strand that object forever, which is the exact leak this ordering exists to avoid.
      const { calls, runtime: cleanupRuntime } = createCleanupRuntime({
        failingKey: 'avatars/2026/07/one',
      })

      await runBackgroundJob('uploads:pending:cleanup', cleanupRuntime, new Date())

      expect(calls.deletedObjects).toEqual(['avatars/2026/07/two'])
      expect(calls.deleteMany).toEqual([{ where: { id: { in: ['upload-2'] } } }])
    })

    test('does not issue a delete when every object failed', async () => {
      const { calls, runtime: cleanupRuntime } = createCleanupRuntime()
      const runtimeAllFailing = {
        ...cleanupRuntime,
        privateStorage: {
          storage: {
            deleteObject: async () => {
              throw new Error('storage unavailable')
            },
          },
        },
      } as unknown as BackendRuntime

      await runBackgroundJob('uploads:pending:cleanup', runtimeAllFailing, new Date())

      expect(calls.deleteMany).toEqual([])
    })
  })

  test('deletes expired and revoked auth sessions after the retention window', async () => {
    const sessionCalls: unknown[] = []
    const resetTokenCalls: unknown[] = []
    const cleanupRuntime = {
      env: { SESSION_ABSOLUTE_TTL_DAYS: 90, SESSION_RETENTION_DAYS: 7 },
      prisma: {
        authSession: {
          deleteMany: async (input: unknown) => {
            sessionCalls.push(input)
            return { count: 2 }
          },
        },
        passwordResetToken: {
          deleteMany: async (input: unknown) => {
            resetTokenCalls.push(input)
            return { count: 3 }
          },
        },
      },
    } as unknown as BackendRuntime

    const now = new Date('2026-04-08T12:00:00.000Z')
    await runBackgroundJob('auth:sessions:cleanup', cleanupRuntime, now)

    expect(sessionCalls).toHaveLength(1)
    expect(sessionCalls[0]).toMatchObject({
      where: {
        OR: [
          { expiresAt: { lt: expect.any(Date) } },
          { revokedAt: { lt: expect.any(Date) } },
          { createdAt: { lt: new Date('2026-01-01T12:00:00.000Z') } },
        ],
      },
    })
    expect(resetTokenCalls).toEqual([{
      where: { expiresAt: { lt: now } },
    }])
  })
})
