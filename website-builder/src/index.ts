import { parseBuildCommands } from './trigger-message'
import { rm } from 'node:fs/promises'
import type { BuilderBackendClient, BuildInput } from './backend-client'
import { createSnapshotDownloader, type SiteBuildRunner } from './build-site'

export type BuilderWorker = {
  processTrigger(input: unknown): Promise<void>
  processBuild(buildId: string): Promise<void>
}

export { publishBuiltRelease } from './release-pipeline'
export {
  createS3PublicationStorageAdapter,
  s3PublicationStorageOptionsFromEnvironment,
} from './s3-storage'
export type {
  PublicationObjectReader,
  S3PublicationStorageAdapter,
  S3PublicationStorageEnvironment,
  S3PublicationStorageOptions,
} from './s3-storage'
export { createYandexObjectStorageAdapter } from './yandex-storage'
export type { YandexObjectStorageAdapter, YandexObjectStorageOptions } from './yandex-storage'
export { createHttpPublicationPromotion, promotePublication } from './yandex-promotion'
export type { PublicationPromotionPort, PublicationPromotionOptions } from './yandex-promotion'

export function createBuilderHttpHandler(worker: BuilderWorker) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
    try {
      const body = await request.json() as unknown
      await worker.processTrigger(body)
      return new Response(null, { status: 202 })
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : 'Builder execution failed'
      // A non-2xx response asks YMQ to retry the batch. The worker has already sent a terminal
      // callback when possible, so retries are safe and are deduplicated by the backend state.
      return Response.json({ error: message }, { status: 500 })
    }
  }
}

export function createBuilderWorker(options: {
  backend: BuilderBackendClient
  buildSite: SiteBuildRunner
  downloadSnapshot?: ReturnType<typeof createSnapshotDownloader>
  publishRelease?: (input: {
    build: BuildInput
    output: Awaited<ReturnType<SiteBuildRunner>>
  }) => Promise<{ markerVerified: boolean }>
}) : BuilderWorker {
  const downloadSnapshot = options.downloadSnapshot ?? createSnapshotDownloader()

  return {
    async processTrigger(input) {
      for (const command of parseBuildCommands(input)) await this.processBuild(command.buildId)
    },

    async processBuild(buildId) {
      let build: BuildInput | undefined
      let workDirectory: string | undefined
      try {
        build = await options.backend.getBuildInput(buildId)
        await options.backend.heartbeat(buildId)
        const snapshot = await downloadSnapshot(build.snapshotArtifact)
        const output = await options.buildSite({
          buildId,
          publicationRevision: build.publicationRevision,
          slot: build.slot,
          snapshot,
        })
        workDirectory = output.workDirectory
        if (output.publicationRevision !== build.publicationRevision || output.marker !== `vibe-publication:${build.publicationRevision}`) {
          throw new Error('Builder output marker does not match the requested publication revision')
        }
        const release = options.publishRelease
          ? await options.publishRelease({ build, output })
          : { markerVerified: true }
        if (!release.markerVerified) throw new Error('Publication marker was not verified after release')
        await options.backend.result(buildId, { status: 'succeeded', markerVerified: release.markerVerified })
      } catch (error) {
        const diagnostics = error instanceof Error ? error.message.slice(0, 500) : 'Website build failed'
        if (build) await options.backend.result(buildId, { status: 'failed', markerVerified: false, diagnostics })
        throw error
      } finally {
        if (workDirectory) await rm(workDirectory, { recursive: true, force: true })
      }
    },
  }
}
