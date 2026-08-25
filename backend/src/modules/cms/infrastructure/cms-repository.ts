import { Prisma, type CmsPage, type CmsPublication } from '../../../generated/prisma/client'
import type { DbClient } from '../../../db'

import type { CmsRepository } from '../application/ports'
import type { PreviewStore } from '../application/preview-service'
import { CmsConflictError, CmsImmutableRevisionError, CmsPublicationConflictError, CmsRepositoryError } from '../domain/errors'
import { normalizeCmsPath } from '../domain/path-policy'
import { acquireCmsSitePackageWriteLock } from './site-package-repository'

const DEFAULT_KEY = 'default'
const DEFAULT_SITE_SETTINGS_PAYLOAD = { companyName: 'Vibe CMS' }

const asJson = (value: unknown) => value as Prisma.InputJsonValue

type RuntimeSitePackage = { id: string; version: string; schemaVersion: number }

type PublicationWriteInput = {
  revision: number
  snapshot: unknown
  sourceApprovalId?: string
  actorUserId?: string
  actorRole?: 'editor' | 'owner'
}

export async function withSelectedSitePackageLock<Result>(
  db: DbClient,
  sitePackage: RuntimeSitePackage,
  operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
) {
  return db.$transaction(async (transaction) => {
    await acquireCmsSitePackageWriteLock(transaction)
    await assertSelectedSitePackageTransactionState(transaction, sitePackage)
    return operation(transaction)
  }, { timeout: 60_000 })
}

export async function assertSelectedSitePackageState(db: DbClient, sitePackage: RuntimeSitePackage) {
  await withSelectedSitePackageLock(db, sitePackage, async () => undefined)
}

async function assertSelectedSitePackageTransactionState(
  transaction: Prisma.TransactionClient,
  sitePackage: RuntimeSitePackage,
) {
  const state = await transaction.cmsSitePackageState.findUnique({
    where: { key: DEFAULT_KEY },
    select: { packageId: true, packageVersion: true, schemaVersion: true },
  })
  if (
    state === null
    || state.packageId !== sitePackage.id
    || state.packageVersion !== sitePackage.version
    || state.schemaVersion !== sitePackage.schemaVersion
  ) {
    const persisted = state
      ? `${state.packageId}@${state.packageVersion} schema ${state.schemaVersion}`
      : 'uninitialised'
    throw new CmsRepositoryError(
      `CMS site package state ${persisted} does not match runtime ${sitePackage.id}@${sitePackage.version} schema ${sitePackage.schemaVersion}`,
      'CMS_VALIDATION',
    )
  }
}

export function assertSnapshotMatchesSelectedSitePackage(
  snapshot: unknown,
  sitePackage: RuntimeSitePackage,
  errorCode: 'CMS_APPROVAL_STALE' | 'CMS_VALIDATION' = 'CMS_VALIDATION',
) {
  const record = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? snapshot as Record<string, unknown>
    : null
  const descriptor = record?.sitePackage && typeof record.sitePackage === 'object' && !Array.isArray(record.sitePackage)
    ? record.sitePackage as Record<string, unknown>
    : null
  if (
    typeof record?.revision !== 'number'
    || !Number.isInteger(record.revision)
    || Number(record?.revision) < 1
    || descriptor?.id !== sitePackage.id
    || descriptor.version !== sitePackage.version
    || descriptor.schemaVersion !== sitePackage.schemaVersion
  ) {
    throw new CmsRepositoryError(
      `CMS publication snapshot does not match selected package ${sitePackage.id}@${sitePackage.version} schema ${sitePackage.schemaVersion}`,
      errorCode,
    )
  }
}

async function createPublicationTransaction(
  tx: Prisma.TransactionClient,
  input: PublicationWriteInput,
) {
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
}

export function createCmsRepository(
  db: DbClient,
  sitePackage: RuntimeSitePackage,
): CmsRepository {
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

    async retryPublication() {
      return db.$transaction(async (tx) => {
        const controller = await tx.cmsPublicationController.findUnique({ where: { key: DEFAULT_KEY } })
        if (!controller || controller.desiredRevision === null || controller.activeBuildId !== null || controller.status !== 'failed') {
          return false
        }
        const updated = await tx.cmsPublicationController.updateMany({
          where: {
            key: DEFAULT_KEY,
            desiredRevision: controller.desiredRevision,
            activeBuildId: null,
            status: 'failed',
          },
          data: { status: 'queued', lastError: null, heartbeatAt: null },
        })
        if (updated.count !== 1) return false
        await tx.taskOutbox.create({
          data: {
            type: 'website:rebuild:wakeup',
            dedupeKey: `website:rebuild:retry:${controller.desiredRevision}:${Date.now()}`,
            payload: { revision: controller.desiredRevision },
          },
        })
        return true
      })
    },

    async createPage(input) {
      const path = normalizeCmsPath(input.path)
      try {
        return await withMutableDraftWrite(db, sitePackage, (transaction) =>
          transaction.cmsPage.create({
            data: {
              path,
              title: input.title,
              draftPayload: asJson(input.payload),
            },
          }))
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
      return withMutableDraftWrite(db, sitePackage, async (transaction) => {
        const result = await transaction.cmsPage.updateMany({
          where: { id: pageId, draftRevision: expectedRevision },
          data: {
            draftPayload: asJson(payload),
            draftRevision: { increment: 1 },
          },
        })

        if (result.count === 1) return { updated: true as const, revision: expectedRevision + 1 }

        const current = await transaction.cmsPage.findUnique({ where: { id: pageId }, select: { draftRevision: true } })
        return {
          updated: false as const,
          conflict: { aggregateId: pageId, currentRevision: current?.draftRevision },
        }
      })
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
              sitePackageSchemaVersion: input.sitePackageSchemaVersion,
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
      return withMutableDraftWrite(db, sitePackage, (transaction) =>
        transaction.cmsContentEntry.create({
          data: { type: input.type, draftPayload: asJson(input.payload) },
        }))
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
      return withMutableDraftWrite(db, sitePackage, async (transaction) => {
        const result = await transaction.cmsContentEntry.updateMany({
          where: { id: entryId, draftRevision: expectedRevision },
          data: { draftPayload: asJson(payload), draftRevision: { increment: 1 } },
        })
        if (result.count === 1) return { updated: true as const, revision: expectedRevision + 1 }
        const current = await transaction.cmsContentEntry.findUnique({ where: { id: entryId }, select: { draftRevision: true } })
        return { updated: false as const, conflict: { aggregateId: entryId, currentRevision: current?.draftRevision } }
      })
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
            sitePackageSchemaVersion: input.sitePackageSchemaVersion,
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
      return withMutableDraftWrite(db, sitePackage, async (transaction) => {
        const result = await transaction.cmsMenu.updateMany({
          where: { id: menuId, draftRevision: expectedRevision },
          data: { draftPayload: asJson(payload), draftRevision: { increment: 1 } },
        })
        if (result.count === 1) return { updated: true as const, revision: expectedRevision + 1 }
        const current = await transaction.cmsMenu.findUnique({ where: { id: menuId }, select: { draftRevision: true } })
        return { updated: false as const, conflict: { aggregateId: menuId, currentRevision: current?.draftRevision } }
      })
    },

    async getSiteSettings() {
      // The CMS shell and editor both require this singleton. Initialise it lazily so migrated
      // installations and test/dev databases do not depend on an out-of-band seed step.
      return withMutableDraftWrite(db, sitePackage, (transaction) =>
        transaction.cmsSiteSettings.upsert({
          where: { key: DEFAULT_KEY },
          create: {
            key: DEFAULT_KEY,
            draftPayload: asJson(DEFAULT_SITE_SETTINGS_PAYLOAD),
          },
          update: {},
        }))
    },

    async updateSiteSettingsDraft(expectedRevision, payload) {
      return withMutableDraftWrite(db, sitePackage, async (transaction) => {
        const result = await transaction.cmsSiteSettings.updateMany({
          where: { key: DEFAULT_KEY, draftRevision: expectedRevision },
          data: { draftPayload: asJson(payload), draftRevision: { increment: 1 } },
        })
        if (result.count === 1) return { updated: true as const, revision: expectedRevision + 1 }
        const current = await transaction.cmsSiteSettings.findUnique({ where: { key: DEFAULT_KEY }, select: { draftRevision: true } })
        return { updated: false as const, conflict: { aggregateId: DEFAULT_KEY, currentRevision: current?.draftRevision } }
      })
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
          await acquireCmsSitePackageWriteLock(tx)
          await assertSelectedSitePackageTransactionState(tx, sitePackage)
          assertSnapshotMatchesSelectedSitePackage(input.snapshot, sitePackage)
          return createPublicationTransaction(tx, input)
        })
      } catch (error) {
        if (error instanceof CmsPublicationConflictError) throw error
        if (isUniqueViolation(error)) throw new CmsPublicationConflictError(input.revision)
        throw error
      }
    },

    async createApproval(input) {
      return db.$transaction(async (tx) => {
        await acquireCmsSitePackageWriteLock(tx)
        await assertSelectedSitePackageTransactionState(tx, sitePackage)
        assertSnapshotMatchesSelectedSitePackage(input.candidateSnapshot, sitePackage)
        return tx.cmsApprovalRequest.create({
          data: {
            revisionMap: asJson(input.revisionMap),
            candidateSnapshot: asJson(input.candidateSnapshot),
            requesterUserId: input.requesterUserId,
          },
        })
      })
    },

    async approveAndCreatePublication(input) {
      let attemptedRevision = 0
      try {
        return await db.$transaction(async (tx) => {
          await acquireCmsSitePackageWriteLock(tx)
          await assertSelectedSitePackageTransactionState(tx, sitePackage)
          const approval = await tx.cmsApprovalRequest.findUnique({ where: { id: input.approvalId } })
          if (!approval || approval.status !== 'pending') return null

          assertSnapshotMatchesSelectedSitePackage(
            approval.candidateSnapshot,
            sitePackage,
            'CMS_APPROVAL_STALE',
          )
          const revision = (approval.candidateSnapshot as { revision: number }).revision
          attemptedRevision = revision
          const decided = await tx.cmsApprovalRequest.updateMany({
            where: { id: input.approvalId, status: 'pending' },
            data: {
              status: 'approved',
              reviewerUserId: input.reviewerUserId,
              decidedAt: new Date(),
            },
          })
          if (decided.count !== 1) return null

          return createPublicationTransaction(tx, {
            revision,
            snapshot: approval.candidateSnapshot,
            sourceApprovalId: approval.id,
            actorUserId: input.reviewerUserId,
            actorRole: input.actorRole,
          })
        })
      } catch (error) {
        if (error instanceof CmsPublicationConflictError) throw error
        if (isUniqueViolation(error)) throw new CmsPublicationConflictError(attemptedRevision)
        throw error
      }
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

async function withMutableDraftWrite<Result>(
  db: DbClient,
  sitePackage: { id: string; schemaVersion: number },
  operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
) {
  return db.$transaction(async (transaction) => {
    await acquireCmsSitePackageWriteLock(transaction)
    const state = await transaction.cmsSitePackageState.findUnique({
      where: { key: DEFAULT_KEY },
      select: { packageId: true, schemaVersion: true },
    })
    if (state === null && sitePackage.schemaVersion !== 1) {
      throw new CmsRepositoryError(
        `CMS site package state is not initialised for schema version ${sitePackage.schemaVersion}`,
        'CMS_VALIDATION',
      )
    }
    if (state && (state.packageId !== sitePackage.id || state.schemaVersion !== sitePackage.schemaVersion)) {
      throw new CmsRepositoryError(
        `CMS site package schema version ${state.packageId}@${state.schemaVersion} does not match writer ${sitePackage.id}@${sitePackage.schemaVersion}`,
        'CMS_VALIDATION',
      )
    }
    return operation(transaction)
  }, { timeout: 60_000 })
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
