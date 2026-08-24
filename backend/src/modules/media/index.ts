import type { MiddlewareHandler } from 'hono'

import type { TaskDeferrer } from '../../background-tasks'
import type { DbClient } from '../../db'
import { enqueueTask } from '../../outbox'
import { createStorageObjectKey, type PrivateStorage } from '../../storage'
import type { AuthHttpEnv } from '../auth'
import { MediaService } from './application/media-service'
import { createMediaRepository } from './infrastructure/media-repository'
import { createMediaRoutes } from './transport/routes'

export function createMediaModule(options: {
  backgroundTasks: TaskDeferrer
  db: DbClient
  requireCmsAccess: MiddlewareHandler<AuthHttpEnv>
  storage: PrivateStorage
}) {
  const service = new MediaService({
    repository: createMediaRepository(options.db),
    storage: options.storage,
    createObjectKey: ({ now }) => createStorageObjectKey({ namespace: 'cms-media', now }),
    deferDelete: ({ objectKey }) => options.backgroundTasks.defer(() => options.storage.deleteObject(objectKey)),
    queueDelete: async ({ assetId, objectKey }) => {
      await enqueueTask(options.db, {
        type: 'media:delete-object',
        dedupeKey: assetId,
        payload: { assetId, objectKey },
      })
    },
  })
  return { routes: createMediaRoutes(options.requireCmsAccess, service), service }
}

export { MediaService } from './application/media-service'
export * from './application/ports'
export * from './domain/errors'
export * from './domain/file-signatures'
