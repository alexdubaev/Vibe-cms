import { Prisma } from '../../../generated/prisma/client'
import type { DbClient } from '../../../db'

import type { PublicationArtifactRepository } from '../application/artifact-service'
import type { PublicationMediaCopyRepository } from '../application/media-copy-input'
import type {
  PublicationBuildRecord,
  PublicationCallbackRepository,
  PublicationControllerRecord,
  PublicationSlot,
} from '../application/rebuild-controller'

const DEFAULT_KEY = 'default'

export function createPublicationRepository(db: DbClient): PublicationCallbackRepository & PublicationArtifactRepository & PublicationMediaCopyRepository {
  return {
    async getController() {
      const row = await db.cmsPublicationController.findUnique({ where: { key: DEFAULT_KEY } })
      return row ? toControllerRecord(row) : null
    },

    async getBuildForInput(buildId) {
      const row = await db.cmsPublicationBuild.findUnique({ where: { id: buildId } })
      return row
        ? {
            id: row.id,
            publicationRevision: row.publicationRevision,
            slot: row.slot as PublicationSlot,
            state: row.state as PublicationBuildRecord['state'],
          }
        : null
    },

    async claimBuild(input) {
      return db.$transaction(async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT "key" FROM "cms_publication_controller" WHERE "key" = ${DEFAULT_KEY} FOR UPDATE`,
        )
        const controller = await tx.cmsPublicationController.findUnique({ where: { key: DEFAULT_KEY } })
        if (!controller || controller.desiredRevision === null) return null
        if (controller.desiredRevision !== input.publicationRevision) return null
        if (controller.publishedRevision !== null && controller.desiredRevision <= controller.publishedRevision) return null
        if (controller.activeBuildId !== null) return null

        const build = await tx.cmsPublicationBuild.create({
          data: {
            publicationRevision: input.publicationRevision,
            slot: input.slot,
            state: 'queued',
          },
        })
        const updated = await tx.cmsPublicationController.updateMany({
          where: { key: DEFAULT_KEY, activeBuildId: null },
          data: {
            activeBuildId: build.id,
            status: 'queued',
            heartbeatAt: null,
            lastError: null,
          },
        })
        if (updated.count !== 1) return null
        return toBuildRecord(build)
      })
    },

    async markDispatchFailed(buildId, message) {
      await db.$transaction(async (tx) => {
        await tx.cmsPublicationBuild.updateMany({
          where: { id: buildId, state: { in: ['queued', 'running'] } },
          data: { state: 'failed', diagnostics: { error: message } },
        })
        await tx.cmsPublicationController.updateMany({
          where: { key: DEFAULT_KEY, activeBuildId: buildId },
          data: { activeBuildId: null, heartbeatAt: null, status: 'failed', lastError: message },
        })
      })
    },

    async markStale(buildId, message) {
      await db.$transaction(async (tx) => {
        await tx.cmsPublicationBuild.updateMany({
          where: { id: buildId, state: { in: ['queued', 'running'] } },
          data: { state: 'failed', diagnostics: { error: message } },
        })
        await tx.cmsPublicationController.updateMany({
          where: { key: DEFAULT_KEY, activeBuildId: buildId },
          data: { activeBuildId: null, heartbeatAt: null, status: 'failed', lastError: message },
        })
      })
    },

    async heartbeat(buildId, heartbeatAt) {
      return db.$transaction(async (tx) => {
        const controller = await tx.cmsPublicationController.findUnique({ where: { key: DEFAULT_KEY } })
        if (!controller || controller.activeBuildId !== buildId) return false
        const updatedBuild = await tx.cmsPublicationBuild.updateMany({
          where: { id: buildId, state: { in: ['queued', 'running'] } },
          data: { state: 'running', heartbeatAt },
        })
        if (updatedBuild.count !== 1) return false
        const updatedController = await tx.cmsPublicationController.updateMany({
          where: { key: DEFAULT_KEY, activeBuildId: buildId },
          data: { status: 'building', heartbeatAt, lastError: null },
        })
        return updatedController.count === 1
      })
    },

    async recordResult(input) {
      return db.$transaction(async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT "key" FROM "cms_publication_controller" WHERE "key" = ${DEFAULT_KEY} FOR UPDATE`,
        )
        const controller = await tx.cmsPublicationController.findUnique({ where: { key: DEFAULT_KEY } })
        const build = await tx.cmsPublicationBuild.findUnique({ where: { id: input.buildId } })
        if (!controller || !build || controller.activeBuildId !== input.buildId || !['queued', 'running'].includes(build.state)) {
          return 'stale' as const
        }

        const diagnostic = safeDiagnostic(input.diagnostics)
        if (input.status === 'failed' || !input.markerVerified) {
          const message = input.status === 'failed' ? diagnostic ?? 'Website builder failed' : 'Builder did not verify publication marker'
          await tx.cmsPublicationBuild.update({
            where: { id: input.buildId },
            data: { state: 'failed', diagnostics: { error: message } },
          })
          await tx.cmsPublicationController.update({
            where: { key: DEFAULT_KEY },
            data: { activeBuildId: null, heartbeatAt: null, status: 'failed', lastError: message },
          })
          return 'accepted' as const
        }

        await tx.cmsPublicationBuild.update({
          where: { id: input.buildId },
          data: { state: 'succeeded', markerVerifiedAt: input.now, diagnostics: diagnostic ? { message: diagnostic } : undefined },
        })
        const followUpRequired = (controller.desiredRevision ?? build.publicationRevision) > build.publicationRevision
        await tx.cmsPublicationController.update({
          where: { key: DEFAULT_KEY },
          data: {
            activeBuildId: null,
            activeSlot: build.slot,
            heartbeatAt: null,
            publishedRevision: Math.max(controller.publishedRevision ?? 0, build.publicationRevision),
            status: followUpRequired ? 'queued' : 'published',
            lastError: null,
          },
        })
        return 'accepted' as const
      })
    },

    async getPublication(revision) {
      const row = await db.cmsPublication.findUnique({ where: { revision } })
      return row
        ? {
            revision: row.revision,
            snapshot: row.snapshot,
            artifactState: row.artifactState,
            artifactObjectKey: row.artifactObjectKey,
            artifactEtag: row.artifactEtag,
          }
        : null
    },

    async getMediaAssets(ids) {
      if (ids.length === 0) return []
      return db.cmsMediaAsset.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          contentVersion: true,
          objectKey: true,
          contentType: true,
          state: true,
        },
      })
    },

    async claimArtifact(revision, objectKey) {
      return db.$transaction(async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT "revision" FROM "cms_publications" WHERE "revision" = ${revision} FOR UPDATE`,
        )
        const publication = await tx.cmsPublication.findUnique({ where: { revision } })
        if (!publication) throw new Error(`Publication ${revision} was not found`)
        if (publication.artifactState === 'ready' && publication.artifactObjectKey && publication.artifactEtag) {
          return { kind: 'ready' as const, objectKey: publication.artifactObjectKey, etag: publication.artifactEtag }
        }
        if (publication.artifactState === 'uploading') return { kind: 'busy' as const }

        const updated = await tx.cmsPublication.updateMany({
          where: { revision, artifactState: 'missing' },
          data: { artifactState: 'uploading', artifactObjectKey: objectKey, artifactEtag: null },
        })
        return updated.count === 1 ? { kind: 'claimed' as const } : { kind: 'busy' as const }
      })
    },

    async markArtifactReady(revision, input) {
      await db.cmsPublication.updateMany({
        where: { revision, artifactState: 'uploading' },
        data: { artifactState: 'ready', artifactObjectKey: input.objectKey, artifactEtag: input.etag },
      })
    },

    async resetArtifact(revision) {
      await db.cmsPublication.updateMany({
        where: { revision, artifactState: 'uploading' },
        data: { artifactState: 'missing', artifactObjectKey: null, artifactEtag: null },
      })
    },
  }
}

function toControllerRecord(row: {
  key: string
  desiredRevision: number | null
  publishedRevision: number | null
  activeBuildId: string | null
  activeSlot: string
  status: string
  heartbeatAt: Date | null
  updatedAt: Date
  lastError: string | null
}): PublicationControllerRecord {
  return {
    key: row.key,
    desiredRevision: row.desiredRevision,
    publishedRevision: row.publishedRevision,
    activeBuildId: row.activeBuildId,
    activeSlot: row.activeSlot as PublicationSlot,
    status: row.status as PublicationControllerRecord['status'],
    heartbeatAt: row.heartbeatAt,
    updatedAt: row.updatedAt,
    lastError: row.lastError,
  }
}

function toBuildRecord(row: {
  id: string
  publicationRevision: number
  slot: string
  state: string
}): PublicationBuildRecord {
  return {
    id: row.id,
    publicationRevision: row.publicationRevision,
    slot: row.slot as PublicationSlot,
    state: row.state as PublicationBuildRecord['state'],
  }
}

function safeDiagnostic(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const message = value.trim().slice(0, 500)
  return message || undefined
}
