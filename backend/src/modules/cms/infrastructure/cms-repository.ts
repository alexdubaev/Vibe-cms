import { Prisma, type CmsPage, type CmsPublication } from '../../../generated/prisma/client'
import type { DbClient } from '../../../db'

import type { CmsRepository } from '../application/ports'
import type { PreviewStore } from '../application/preview-service'
import { CmsConflictError, CmsImmutableRevisionError, CmsPublicationConflictError, CmsRepositoryError } from '../domain/errors'
import { normalizeCmsPath } from '../domain/path-policy'

const DEFAULT_KEY = 'default'

const asJson = (value: unknown) => value as Prisma.InputJsonValue

export function createCmsRepository(db: DbClient): CmsRepository {
  return {
    async getPolicy() {
      return db.cmsPolicy.findUnique({ where: { key: DEFAULT_KEY } })
    },

    async ensurePolicy(input = {}) {
      return db.cmsPolicy.upsert({
        where: { key: DEFAULT_KEY },
        create: {
          key: DEFAULT_KEY,
          editorCanPublish: input.editorCanPublish ?? false,
          updatedByUserId: input.updatedByUserId,
        },
        update: {
          ...(input.editorCanPublish === undefined ? {} : { editorCanPublish: input.editorCanPublish }),
          ...(input.updatedByUserId === undefined ? {} : { updatedByUserId: input.updatedByUserId }),
        },
      })
    },

    async getController() {
      return db.cmsPublicationController.findUnique({ where: { key: DEFAULT_KEY } })
    },

    async getLatestPublication() {
      return db.cmsPublication.findFirst({
        orderBy: { revision: 'desc' },
        select: {
          id: true,
          revision: true,
          artifactState: true,
          createdAt: true,
        },
      })
    },

    async listPendingApprovals() {
      return db.cmsApprovalRequest.findMany({
        where: { status: 'pending' },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          status: true,
          requesterUserId: true,
          createdAt: true,
        },
      })
    },

    async ensureController() {
      return db.cmsPublicationController.upsert({
        where: { key: DEFAULT_KEY },
        create: { key: DEFAULT_KEY },
        update: {},
      })
    },

    async createPage(input) {
      const path = normalizeCmsPath(input.path)
      try {
        return await db.cmsPage.create({
          data: {
            path,
            title: input.title,
            draftPayload: asJson(input.payload),
          },
        })
      } catch (error) {
        if (isUniqueViolation(error)) throw new CmsConflictError(path)
        throw error
      }
    },

    async findPageByPath(path) {
      return db.cmsPage.findUnique({ where: { path: normalizeCmsPath(path) } })
    },

    async getPage(pageId) {
      return db.cmsPage.findUnique({ where: { id: pageId } })
    },

    async listPages() {
      return db.cmsPage.findMany({
        orderBy: { path: 'asc' },
        select: {
          id: true,
          path: true,
          title: true,
          draftPayload: true,
          draftRevision: true,
          archivedAt: true,
        },
      })
    },

    async getPageForEditor(pageId) {
      return db.cmsPage.findUnique({
        where: { id: pageId },
        select: {
          id: true,
          path: true,
          title: true,
          draftPayload: true,
          draftRevision: true,
          archivedAt: true,
        },
      })
    },

    async updatePageDraft(pageId, expectedRevision, payload) {
      const result = await db.cmsPage.updateMany({
        where: { id: pageId, draftRevision: expectedRevision },
        data: {
          draftPayload: asJson(payload),
          draftRevision: { increment: 1 },
        },
      })

      if (result.count === 1) return { updated: true as const, revision: expectedRevision + 1 }

      const current = await db.cmsPage.findUnique({ where: { id: pageId }, select: { draftRevision: true } })
      return {
        updated: false as const,
        conflict: { aggregateId: pageId, currentRevision: current?.draftRevision },
      }
    },

    async createPageRevision(input) {
      try {
        return await db.$transaction(async (tx) => {
          const last = await tx.cmsPageRevision.findFirst({
            where: { pageId: input.pageId },
            orderBy: { revision: 'desc' },
            select: { revision: true },
          })
          return tx.cmsPageRevision.create({
            data: {
              pageId: input.pageId,
              revision: (last?.revision ?? 0) + 1,
              sourceDraftRevision: input.sourceDraftRevision,
              sourcePayload: asJson(input.sourcePayload),
              publicPayload: asJson(input.publicPayload),
              authorUserId: input.authorUserId,
              publicationRevision: input.publicationRevision,
            },
          })
        })
      } catch (error) {
        if (isUniqueViolation(error)) throw new CmsConflictError(input.pageId)
        throw error
      }
    },

    async updatePageRevision(revisionId) {
      throw new CmsImmutableRevisionError(revisionId)
    },

    async getPageRevision(revisionId) {
      return db.cmsPageRevision.findUnique({ where: { id: revisionId } })
    },

    async listPageRevisions(pageId) {
      return db.cmsPageRevision.findMany({
        where: { pageId },
        orderBy: { revision: 'desc' },
        select: {
          id: true,
          pageId: true,
          revision: true,
          sourceDraftRevision: true,
          publicationRevision: true,
          createdAt: true,
        },
      })
    },

    async createContentEntry(input) {
      return db.cmsContentEntry.create({
        data: { type: input.type, draftPayload: asJson(input.payload) },
      })
    },

    async listContentEntries(type) {
      return db.cmsContentEntry.findMany({
        where: {
          archivedAt: null,
          ...(type ? { type } : {}),
        },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          type: true,
          draftPayload: true,
          draftRevision: true,
          archivedAt: true,
        },
      })
    },

    async getContentEntry(entryId) {
      return db.cmsContentEntry.findUnique({ where: { id: entryId } })
    },

    async updateContentEntryDraft(entryId, expectedRevision, payload) {
      const result = await db.cmsContentEntry.updateMany({
        where: { id: entryId, draftRevision: expectedRevision },
        data: { draftPayload: asJson(payload), draftRevision: { increment: 1 } },
      })
      if (result.count === 1) return { updated: true as const, revision: expectedRevision + 1 }
      const current = await db.cmsContentEntry.findUnique({ where: { id: entryId }, select: { draftRevision: true } })
      return { updated: false as const, conflict: { aggregateId: entryId, currentRevision: current?.draftRevision } }
    },

    async createContentEntryRevision(input) {
      return db.$transaction(async (tx) => {
        const last = await tx.cmsContentEntryRevision.findFirst({
          where: { entryId: input.entryId },
          orderBy: { revision: 'desc' },
          select: { revision: true },
        })
        return tx.cmsContentEntryRevision.create({
          data: {
            entryId: input.entryId,
            revision: (last?.revision ?? 0) + 1,
            sourceDraftRevision: input.sourceDraftRevision,
            sourcePayload: asJson(input.sourcePayload),
            publicPayload: asJson(input.publicPayload),
            authorUserId: input.authorUserId,
            publicationRevision: input.publicationRevision,
          },
        })
      })
    },

    async createMediaAsset(input) {
      return db.cmsMediaAsset.create({
        data: {
          filename: input.filename ?? 'unnamed',
          objectKey: input.objectKey,
          contentVersion: input.contentVersion,
          storageEtag: input.storageEtag,
          contentType: input.contentType,
          byteSize: input.byteSize,
          width: input.width,
          height: input.height,
          durationMs: input.durationMs,
          altText: input.altText,
          state: input.state,
        },
      })
    },

    async getMenu(menuId) {
      return db.cmsMenu.findUnique({ where: { id: menuId } })
    },

    async listMenus() {
      return db.cmsMenu.findMany({ orderBy: { location: 'asc' } })
    },

    async updateMenuDraft(menuId, expectedRevision, payload) {
      const result = await db.cmsMenu.updateMany({
        where: { id: menuId, draftRevision: expectedRevision },
        data: { draftPayload: asJson(payload), draftRevision: { increment: 1 } },
      })
      if (result.count === 1) return { updated: true as const, revision: expectedRevision + 1 }
      const current = await db.cmsMenu.findUnique({ where: { id: menuId }, select: { draftRevision: true } })
      return { updated: false as const, conflict: { aggregateId: menuId, currentRevision: current?.draftRevision } }
    },

    async getSiteSettings() {
      return db.cmsSiteSettings.findUnique({ where: { key: DEFAULT_KEY } })
    },

    async updateSiteSettingsDraft(expectedRevision, payload) {
      const result = await db.cmsSiteSettings.updateMany({
        where: { key: DEFAULT_KEY, draftRevision: expectedRevision },
        data: { draftPayload: asJson(payload), draftRevision: { increment: 1 } },
      })
      if (result.count === 1) return { updated: true as const, revision: expectedRevision + 1 }
      const current = await db.cmsSiteSettings.findUnique({ where: { key: DEFAULT_KEY }, select: { draftRevision: true } })
      return { updated: false as const, conflict: { aggregateId: DEFAULT_KEY, currentRevision: current?.draftRevision } }
    },

    async replaceMediaUsage(assetId, usages) {
      await db.$transaction(async (tx) => {
        await tx.cmsMediaUsage.deleteMany({ where: { assetId } })
        if (usages.length > 0) {
          await tx.cmsMediaUsage.createMany({
            data: usages.map((usage) => ({ assetId, ...usage })),
          })
        }
      })
    },

    async replaceContentUsage(owner, usages) {
      await db.$transaction(async (tx) => {
        await tx.cmsContentUsage.deleteMany({ where: owner })
        if (usages.length > 0) {
          await tx.cmsContentUsage.createMany({
            data: usages.map((usage) => ({ ...owner, ...usage })),
          })
        }
      })
    },

    async createPublication(input) {
      try {
        return await db.$transaction(async (tx) => {
          const latest = await tx.cmsPublication.findFirst({
            orderBy: { revision: 'desc' },
            select: { revision: true },
          })
          if (latest && input.revision <= latest.revision) {
            throw new CmsPublicationConflictError(input.revision, latest.revision)
          }
          if (input.actorRole === 'editor') {
            const policy = await tx.cmsPolicy.findUnique({ where: { key: DEFAULT_KEY }, select: { editorCanPublish: true } })
            if (!policy?.editorCanPublish) {
              throw new CmsRepositoryError('Editor publishing is disabled by the owner', 'FORBIDDEN')
            }
          }

          const publication = await tx.cmsPublication.create({
            data: {
              revision: input.revision,
              snapshot: asJson(input.snapshot),
              sourceApprovalId: input.sourceApprovalId,
              actorUserId: input.actorUserId,
            },
          })

          await tx.cmsPublicationController.upsert({
            where: { key: DEFAULT_KEY },
            create: {
              key: DEFAULT_KEY,
              desiredRevision: input.revision,
              status: 'queued',
            },
            update: {},
          })
          await tx.$executeRaw(
            Prisma.sql`
              UPDATE "cms_publication_controller"
              SET "desired_revision" = GREATEST(COALESCE("desired_revision", 0), ${input.revision}),
                  "status" = 'queued',
                  "last_error" = NULL,
                  "updated_at" = CURRENT_TIMESTAMP
              WHERE "key" = ${DEFAULT_KEY}
            `,
          )
          await tx.taskOutbox.createMany({
            data: [{
              type: 'website:rebuild:wakeup',
              dedupeKey: `website:rebuild:${input.revision}`,
              payload: { revision: input.revision },
            }],
            skipDuplicates: true,
          })

          return publication
        })
      } catch (error) {
        if (error instanceof CmsPublicationConflictError) throw error
        if (isUniqueViolation(error)) throw new CmsPublicationConflictError(input.revision)
        throw error
      }
    },

    async createApproval(input) {
      return db.cmsApprovalRequest.create({
        data: {
          revisionMap: asJson(input.revisionMap),
          candidateSnapshot: asJson(input.candidateSnapshot),
          requesterUserId: input.requesterUserId,
        },
      })
    },

    async getApproval(approvalId) {
      return db.cmsApprovalRequest.findUnique({ where: { id: approvalId } })
    },

    async decideApproval(input) {
      const updated = await db.cmsApprovalRequest.updateMany({
        where: { id: input.approvalId, status: input.expectedStatus },
        data: {
          status: input.status,
          reviewerUserId: input.reviewerUserId,
          decisionNote: input.decisionNote,
          decidedAt: new Date(),
        },
      })
      if (updated.count !== 1) return null
      return db.cmsApprovalRequest.findUnique({ where: { id: input.approvalId } })
    },
  }
}

export function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

export function pagePathFromRecord(page: CmsPage) {
  return normalizeCmsPath(page.path)
}

export function publicationRevisionFromRecord(publication: CmsPublication) {
  return publication.revision
}

export function createCmsPreviewStore(db: DbClient): PreviewStore {
  return {
    async createGrant(input) {
      return db.cmsPreviewGrant.create({ data: input })
    },
    async consumeGrant(input) {
      const grant = await db.cmsPreviewGrant.findFirst({
        where: { codeHash: input.codeHash, consumedAt: null, expiresAt: { gt: input.now } },
      })
      if (!grant) return null
      const consumed = await db.cmsPreviewGrant.updateMany({
        where: { id: grant.id, consumedAt: null, expiresAt: { gt: input.now } },
        data: { consumedAt: input.now },
      })
      return consumed.count === 1 ? grant : null
    },
    async createSession(input) {
      await db.cmsPreviewSession.create({ data: input })
    },
    async findSession(input) {
      const session = await db.cmsPreviewSession.findFirst({
        where: { tokenHash: input.tokenHash, revokedAt: null, expiresAt: { gt: input.now } },
      })
      if (!session) return null

      const actor = await db.user.findUnique({ where: { id: session.actorUserId }, select: { role: true } })
      const actorRole = toPreviewActorRole(actor?.role)
      if (!actorRole) return null

      return {
        id: session.id,
        actorUserId: session.actorUserId,
        actorRole,
        pageId: session.pageId,
        expiresAt: session.expiresAt,
      }
    },
    async findMediaAsset(assetId) {
      return db.cmsMediaAsset.findUnique({
        where: { id: assetId },
        select: { id: true, objectKey: true, contentType: true, state: true },
      })
    },
  }
}

function toPreviewActorRole(role: string | undefined): 'user' | 'editor' | 'owner' | null {
  if (role === 'admin' || role === 'owner') return 'owner'
  if (role === 'editor') return 'editor'
  if (role === 'user') return 'user'
  return null
}
