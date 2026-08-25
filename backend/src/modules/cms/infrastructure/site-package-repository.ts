import type { DbClient } from '../../../db'
import { Prisma } from '../../../generated/prisma/client'

import { CmsConflictError } from '../domain/errors'
import type {
  CmsMutableSitePackageDrafts,
  CmsSitePackageMigrationRepository,
  CmsSitePackageMigrationTransaction,
  CmsSitePackageState,
} from '../domain/site-package-state'

const DEFAULT_KEY = 'default'
const MIGRATION_TRANSACTION_TIMEOUT_MS = 60_000
const CMS_SITE_PACKAGE_MIGRATION_LOCK = 'cms-site-package-migration'

export function createCmsSitePackageMigrationRepository(
  db: DbClient,
): CmsSitePackageMigrationRepository {
  return {
    transaction(operation) {
      return db.$transaction(async (transaction) => {
        await acquireCmsSitePackageMigrationLock(transaction)
        return operation(createTransactionRepository(transaction))
      }, { timeout: MIGRATION_TRANSACTION_TIMEOUT_MS })
    },
  }
}

export function acquireCmsSitePackageMigrationLock(db: Pick<Prisma.TransactionClient, '$executeRaw'>) {
  return db.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${CMS_SITE_PACKAGE_MIGRATION_LOCK}, 0))`,
  )
}

export function acquireCmsSitePackageWriteLock(db: Pick<Prisma.TransactionClient, '$executeRaw'>) {
  return db.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${CMS_SITE_PACKAGE_MIGRATION_LOCK}, 0))`,
  )
}

function createTransactionRepository(
  db: Prisma.TransactionClient,
): CmsSitePackageMigrationTransaction {
  return {
    async getState() {
      const state = await db.cmsSitePackageState.findUnique({ where: { key: DEFAULT_KEY } })
      return state ? toState(state) : null
    },

    async readMutableDrafts() {
      const [settings, pages, entries, menus] = await Promise.all([
        db.cmsSiteSettings.findMany({ select: { key: true, draftRevision: true, draftPayload: true } }),
        db.cmsPage.findMany({ select: { id: true, draftRevision: true, draftPayload: true } }),
        db.cmsContentEntry.findMany({
          select: { id: true, type: true, draftRevision: true, draftPayload: true },
        }),
        db.cmsMenu.findMany({
          select: { id: true, location: true, draftRevision: true, draftPayload: true },
        }),
      ])
      return {
        settings: settings.map((draft) => ({
          id: draft.key,
          draftRevision: draft.draftRevision,
          payload: draft.draftPayload,
        })),
        pages: pages.map((draft) => ({
          id: draft.id,
          draftRevision: draft.draftRevision,
          payload: draft.draftPayload,
        })),
        entries: entries.map((draft) => ({
          id: draft.id,
          type: draft.type,
          draftRevision: draft.draftRevision,
          payload: draft.draftPayload,
        })),
        menus: menus.map((draft) => ({
          id: draft.id,
          location: draft.location,
          draftRevision: draft.draftRevision,
          payload: draft.draftPayload,
        })),
      }
    },

    async replaceMutableDrafts(drafts) {
      await replaceDrafts(db, drafts)
    },

    async setState(state) {
      await db.cmsSitePackageState.upsert({
        where: { key: DEFAULT_KEY },
        create: { key: DEFAULT_KEY, ...stateToData(state) },
        update: stateToData(state),
      })
    },
  }
}

async function replaceDrafts(db: Prisma.TransactionClient, drafts: CmsMutableSitePackageDrafts) {
  for (const draft of drafts.settings) {
    await assertUpdated(db.cmsSiteSettings.updateMany({
      where: { key: draft.id, draftRevision: draft.draftRevision - 1 },
      data: { draftPayload: asJson(draft.payload), draftRevision: draft.draftRevision },
    }), draft.id)
  }
  for (const draft of drafts.pages) {
    await assertUpdated(db.cmsPage.updateMany({
      where: { id: draft.id, draftRevision: draft.draftRevision - 1 },
      data: { draftPayload: asJson(draft.payload), draftRevision: draft.draftRevision },
    }), draft.id)
  }
  for (const draft of drafts.entries) {
    await assertUpdated(db.cmsContentEntry.updateMany({
      where: { id: draft.id, draftRevision: draft.draftRevision - 1 },
      data: { draftPayload: asJson(draft.payload), draftRevision: draft.draftRevision },
    }), draft.id)
  }
  for (const draft of drafts.menus) {
    await assertUpdated(db.cmsMenu.updateMany({
      where: { id: draft.id, draftRevision: draft.draftRevision - 1 },
      data: { draftPayload: asJson(draft.payload), draftRevision: draft.draftRevision },
    }), draft.id)
  }
}

async function assertUpdated(update: PromiseLike<{ count: number }>, aggregateId: string) {
  const result = await update
  if (result.count !== 1) throw new CmsConflictError(aggregateId)
}

function stateToData(state: CmsSitePackageState) {
  return {
    packageId: state.packageId,
    packageVersion: state.packageVersion,
    schemaVersion: state.schemaVersion,
    migratedAt: state.migratedAt,
  }
}

function toState(state: {
  packageId: string
  packageVersion: string
  schemaVersion: number
  migratedAt: Date
}): CmsSitePackageState {
  return state
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}
