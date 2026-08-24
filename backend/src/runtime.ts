import 'dotenv/config'

import { createBackgroundTasks, type BackgroundTasks } from './background-tasks'
import { createPrisma, type DbClient } from './db'
import { createEmailDelivery, type EmailDelivery } from './email'
import { loadEnv, type AppEnv } from './env'
import {
  createYmqHttpMessageSender,
  createYmqPublicationDispatcher,
  PublicationArtifactService,
  PublicationRebuildController,
  createPublicationRepository,
} from './modules/publication'
import { createPrivateStorage, type PrivateStorageRuntime } from './storage'

export type PublicationRebuildRuntime = {
  reconcile(): Promise<{ kind: string }>
}

export type BackendRuntime = {
  backgroundTasks: BackgroundTasks
  /**
   * Built here rather than defaulted inside `createApp`, because the `outbox:drain` job runs
   * under `cron.ts` and never calls `createApp` - it would otherwise have no way to send.
   */
  emailDelivery: EmailDelivery
  env: AppEnv
  prisma: DbClient
  /**
   * The storage port plus the routes the filesystem driver needs mounted. Background jobs reach
   * the port through `privateStorage.storage`; `jobs.ts` must stay free of runtime imports.
   */
  privateStorage: PrivateStorageRuntime
  /** Optional publication controller. Provider wiring injects it into API/job runtimes. */
  publicationRebuild?: PublicationRebuildRuntime
  close: (timeoutMs?: number) => Promise<void>
}

export async function closeBackendRuntime(
  resources: {
    backgroundTasks: BackgroundTasks
    prisma: Pick<DbClient, '$disconnect'>
  },
  timeoutMs: number,
) {
  const drained = await resources.backgroundTasks.drain(timeoutMs)
  if (!drained) {
    console.error('Background task drain exceeded the shutdown grace period')
  }
  await resources.prisma.$disconnect()
}

export function createBackendRuntime(
  source: Record<string, string | undefined> = Bun.env,
  options: { publicationRebuild?: PublicationRebuildRuntime } = {},
): BackendRuntime {
  const env = loadEnv(source)
  const prisma = createPrisma(env.DATABASE_URL)
  const backgroundTasks = createBackgroundTasks()
  const emailDelivery = createEmailDelivery(env)
  const privateStorage = createPrivateStorage(env)
  const publicationRebuild = createPublicationRuntime({ env, prisma, privateStorage })
  let closed = false

  return {
    backgroundTasks,
    emailDelivery,
    env,
    prisma,
    privateStorage,
    publicationRebuild: options.publicationRebuild ?? publicationRebuild,
    close: async (timeoutMs = env.SHUTDOWN_GRACE_SECONDS * 1000) => {
      if (closed) return
      closed = true
      await closeBackendRuntime({ backgroundTasks, prisma }, timeoutMs)
    },
  }
}

function createPublicationRuntime(input: {
  env: AppEnv
  prisma: DbClient
  privateStorage: PrivateStorageRuntime
}): PublicationRebuildRuntime | undefined {
  const { env, prisma, privateStorage } = input
  if (!env.CMS_BUILDER_QUEUE_URL || !env.CMS_BUILDER_HMAC_ACTIVE_SECRET) return undefined
  if (!env.CMS_BUILDER_YMQ_ACCESS_KEY_ID || !env.CMS_BUILDER_YMQ_SECRET_ACCESS_KEY) return undefined

  const repository = createPublicationRepository(prisma)
  const artifact = new PublicationArtifactService(repository, privateStorage.storage)
  const sender = createYmqHttpMessageSender({
    endpoint: env.CMS_BUILDER_YMQ_ENDPOINT,
    region: env.CMS_BUILDER_YMQ_REGION,
    accessKeyId: env.CMS_BUILDER_YMQ_ACCESS_KEY_ID,
    secretAccessKey: env.CMS_BUILDER_YMQ_SECRET_ACCESS_KEY,
  })
  return new PublicationRebuildController(
    repository,
    createYmqPublicationDispatcher({ queueUrl: env.CMS_BUILDER_QUEUE_URL, sendMessage: sender.sendMessage }),
    undefined,
    undefined,
    artifact,
  )
}
