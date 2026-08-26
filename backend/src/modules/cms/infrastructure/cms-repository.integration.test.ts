import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'

import { createPrisma, type DbClient } from '../../../db'
import { selectedSitePackageDescriptor } from '@vibe-cms/selected-site-package/contract'
import { CmsConflictError, CmsImmutableRevisionError, CmsPublicationConflictError } from '../domain/errors'
import { assertSelectedSitePackageState, createCmsRepository, withSelectedSitePackageLock } from './cms-repository'
import { createCmsSitePackageMigrationRepository } from './site-package-repository'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

const publicationSnapshot = (
  revision: number,
  sitePackage = selectedSitePackageDescriptor,
) => ({ revision, sitePackage })

async function expectRejected<T extends Error>(operation: Promise<unknown>, errorType: new (...args: never[]) => T) {
  let error: unknown
  try {
    await operation
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(errorType)
}

maybeDescribe('CMS repository against PostgreSQL', () => {
  let db: DbClient
  let repository: ReturnType<typeof createCmsRepository>

  beforeAll(async () => {
    db = createPrisma(databaseUrl!)
    repository = createCmsRepository(db, selectedSitePackageDescriptor)
  })

  beforeEach(async () => {
    await db.cmsAuditEvent.deleteMany()
    await db.cmsBuilderRequestNonce.deleteMany()
    await db.cmsPreviewSession.deleteMany()
    await db.cmsPreviewGrant.deleteMany()
    await db.cmsPublicationBuild.deleteMany()
    await db.cmsRedirect.deleteMany()
    await db.cmsPublication.deleteMany()
    await db.cmsApprovalRequest.deleteMany()
    await db.cmsContentUsage.deleteMany()
    await db.cmsMediaUsage.deleteMany()
    await db.cmsMediaAsset.deleteMany()
    await db.cmsMenuRevision.deleteMany()
    await db.cmsMenu.deleteMany()
    await db.cmsContentEntryRevision.deleteMany()
    await db.cmsContentEntry.deleteMany()
    await db.cmsPageRevision.deleteMany()
    await db.cmsPage.deleteMany()
    await db.cmsPolicy.deleteMany()
    await db.cmsSiteSettings.deleteMany()
    await db.cmsPublicationController.deleteMany()
    await db.cmsSitePackageState.deleteMany()
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  test('uses PostgreSQL UUIDv7 defaults for CMS aggregates', async () => {
    const page = await repository.createPage({ path: '/about', title: 'О компании', payload: { blocks: [] } })

    expect(page.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(page.draftRevision).toBe(1)
  })

  test('enforces singleton policy and controller through repository primitives', async () => {
    const first = await repository.ensurePolicy({ editorCanPublish: false })
    const second = await repository.ensurePolicy({ editorCanPublish: true })
    const controller = await repository.ensureController()
    const controllerAgain = await repository.ensureController()

    expect(first.key).toBe('default')
    expect(second.key).toBe('default')
    expect(second.editorCanPublish).toBe(true)
    expect(controller.key).toBe(controllerAgain.key)
    expect(await db.cmsPolicy.count()).toBe(1)
    expect(await db.cmsPublicationController.count()).toBe(1)
  })

  test('initialises default site settings when the singleton row is absent', async () => {
    const settings = await repository.getSiteSettings()

    expect(settings).toMatchObject({
      key: 'default',
      draftPayload: { companyName: 'Vibe CMS' },
      draftRevision: 1,
    })
    expect(await db.cmsSiteSettings.count()).toBe(1)
  })

  test('fails closed when startup or publication sees a different persisted package', async () => {
    await db.cmsSitePackageState.create({
      data: {
        key: 'default',
        packageId: 'another-package',
        packageVersion: '1.0.0',
        schemaVersion: 1,
        migratedAt: new Date(),
      },
    })

    await expect(assertSelectedSitePackageState(db, selectedSitePackageDescriptor))
      .rejects.toThrow('does not match runtime')
    await expect(withSelectedSitePackageLock(db, selectedSitePackageDescriptor, async () => 'snapshot'))
      .rejects.toThrow('does not match runtime')
  })

  test('normalises paths before applying the unique page-path constraint', async () => {
    await repository.createPage({ path: 'About//', title: 'О компании', payload: { blocks: [] } })

    await expectRejected(
      repository.createPage({ path: '/about', title: 'Другая страница', payload: { blocks: [] } }),
      CmsConflictError,
    )
  })

  test('rejects writes to immutable page revisions', async () => {
    const page = await repository.createPage({ path: '/services', title: 'Услуги', payload: { blocks: [] } })
    const revision = await repository.createPageRevision({
      pageId: page.id,
      sourceDraftRevision: page.draftRevision,
      sourcePayload: page.draftPayload,
      publicPayload: { path: page.path, title: page.title, blocks: [] },
      sitePackageSchemaVersion: 1,
    })

    await expectRejected(repository.updatePageRevision(revision.id, { sourcePayload: { changed: true } }),
      CmsImmutableRevisionError,
    )
  })

  test('lists page revision metadata newest first without source payloads', async () => {
    const page = await repository.createPage({ path: '/history', title: 'История', payload: { blocks: [] } })
    await repository.createPageRevision({
      pageId: page.id,
      sourceDraftRevision: 1,
      sourcePayload: { secret: 'first' },
      publicPayload: { title: 'Первый' },
      sitePackageSchemaVersion: 1,
    })
    await repository.updatePageDraft(page.id, 1, { blocks: [{ type: 'textImage' }] })
    await repository.createPageRevision({
      pageId: page.id,
      sourceDraftRevision: 2,
      sourcePayload: { secret: 'second' },
      publicPayload: { title: 'Второй' },
      publicationRevision: 7,
      sitePackageSchemaVersion: 1,
    })

    const revisions = await repository.listPageRevisions(page.id)
    expect(revisions).toHaveLength(2)
    expect(revisions[0]).toMatchObject({ revision: 2, sourceDraftRevision: 2, publicationRevision: 7 })
    expect(revisions[1]).toMatchObject({ revision: 1, sourceDraftRevision: 1, publicationRevision: null })
    expect(revisions[0]).not.toHaveProperty('sourcePayload')
  })

  test('returns a typed optimistic conflict when the expected revision is stale', async () => {
    const page = await repository.createPage({ path: '/contact', title: 'Контакты', payload: { blocks: [] } })
    const updated = await repository.updatePageDraft(page.id, page.draftRevision, { blocks: [{ type: 'textImage' }] })
    const stale = await repository.updatePageDraft(page.id, page.draftRevision, { blocks: [] })

    expect(updated).toEqual({ updated: true, revision: 2 })
    expect(stale.updated).toBe(false)
    if (!stale.updated) expect(stale.conflict.aggregateId).toBe(page.id)
  })

  test('admits exactly one of two concurrent draft saves and reports the conflict to the loser', async () => {
    const page = await repository.createPage({ path: '/race', title: 'Гонка', payload: { blocks: [] } })

    const [first, second] = await Promise.all([
      repository.updatePageDraft(page.id, page.draftRevision, { blocks: [{ type: 'textImage' }] }),
      repository.updatePageDraft(page.id, page.draftRevision, { blocks: [] }),
    ])

    const outcomes = [first, second].sort((left, right) =>
      left.updated === right.updated ? 0 : left.updated ? -1 : 1,
    )
    expect(outcomes[0]).toEqual({ updated: true, revision: 2 })
    expect(outcomes[1].updated).toBe(false)
    if (!outcomes[1].updated) {
      expect(outcomes[1].conflict).toEqual({ aggregateId: page.id, currentRevision: 2 })
    }
    expect(
      (await db.cmsPage.findUniqueOrThrow({ where: { id: page.id } })).draftRevision,
    ).toBe(2)
  })

  // Known gap: updatePageDraft stores the draft path without re-checking uniqueness against
  // other pages (the unique cmsPage.path column is only written at create), so a page edit can
  // move its published path onto another page's path. Needs a product decision before a test
  // can pin the intended behavior.
  test.todo('updatePageDraft enforces path uniqueness across pages')

  test('optimistic conflicts for menus and site settings name the surviving revision', async () => {
    const menu = await db.cmsMenu.create({
      data: { location: 'header', draftPayload: { items: [] } },
    })

    const menuUpdate = await repository.updateMenuDraft(menu.id, 1, { items: [{ label: 'О нас', href: '/about' }] })
    const menuStale = await repository.updateMenuDraft(menu.id, 1, { items: [] })
    expect(menuUpdate).toEqual({ updated: true, revision: 2 })
    expect(menuStale.updated).toBe(false)
    if (!menuStale.updated) {
      expect(menuStale.conflict).toEqual({ aggregateId: menu.id, currentRevision: 2 })
    }

    await repository.getSiteSettings()
    const settingsUpdate = await repository.updateSiteSettingsDraft(1, { companyName: 'Новое имя' })
    const settingsStale = await repository.updateSiteSettingsDraft(1, { companyName: 'Ещё новое' })
    expect(settingsUpdate).toEqual({ updated: true, revision: 2 })
    expect(settingsStale.updated).toBe(false)
    if (!settingsStale.updated) {
      expect(settingsStale.conflict).toEqual({ aggregateId: 'default', currentRevision: 2 })
    }
  })

  test('lists active collection entries by type without returning unrelated payload fields', async () => {
    const active = await repository.createContentEntry({
      type: 'service',
      payload: { name: 'Аудит', summary: 'Проверка сайта' },
    })
    const archived = await repository.createContentEntry({
      type: 'service',
      payload: { name: 'Старый аудит' },
    })
    await db.cmsContentEntry.update({ where: { id: archived.id }, data: { archivedAt: new Date() } })
    await repository.createContentEntry({ type: 'case', payload: { name: 'Кейс' } })

    const entries = await repository.listContentEntries('service')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ id: active.id, type: 'service', draftRevision: 1, archivedAt: null })
    expect(entries[0]).not.toHaveProperty('objectKey')
  })

  test('replaces media and content usage rows transactionally', async () => {
    const page = await repository.createPage({ path: '/gallery', title: 'Галерея', payload: { blocks: [] } })
    const entry = await repository.createContentEntry({ type: 'case', payload: { title: 'Кейс' } })
    const asset = await repository.createMediaAsset({
      objectKey: 'media/asset-a',
      contentVersion: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a00',
      contentType: 'image/webp',
      byteSize: 512,
    })

    await repository.replaceMediaUsage(asset.id, [
      { ownerType: 'page', ownerId: page.id, scope: 'draft' },
      { ownerType: 'entry', ownerId: entry.id, scope: 'draft' },
    ])
    await repository.replaceContentUsage({ ownerType: 'page', ownerId: page.id, scope: 'draft' }, [
      { referencedType: 'entry', referencedId: entry.id, path: 'blocks[0].caseId' },
    ])

    expect(await db.cmsMediaUsage.count({ where: { assetId: asset.id } })).toBe(2)
    expect(await db.cmsContentUsage.count({ where: { ownerId: page.id } })).toBe(1)
  })

  test('keeps publication revisions monotonic', async () => {
    await db.cmsSitePackageState.create({
      data: {
        key: 'default',
        packageId: selectedSitePackageDescriptor.id,
        packageVersion: selectedSitePackageDescriptor.version,
        schemaVersion: selectedSitePackageDescriptor.schemaVersion,
        migratedAt: new Date(),
      },
    })
    const first = await repository.createPublication({ revision: 1, snapshot: publicationSnapshot(1) })

    await expectRejected(repository.createPublication({ revision: 1, snapshot: publicationSnapshot(1) }),
      CmsPublicationConflictError,
    )
    await expect(repository.createPublication({ revision: 0, snapshot: publicationSnapshot(0) }))
      .rejects.toThrow('snapshot does not match selected package')

    expect(first.revision).toBe(1)
    expect((await repository.createPublication({ revision: 2, snapshot: publicationSnapshot(2) })).revision).toBe(2)
  })

  test('does not approve or publish a frozen snapshot from before a package migration', async () => {
    const oldDescriptor = { id: 'vibe-core', version: '1.0.0', schemaVersion: 1 }
    const newDescriptor = { id: 'vibe-core', version: '2.0.0', schemaVersion: 2 }
    const oldRepository = createCmsRepository(db, oldDescriptor)
    const packageRepository = createCmsSitePackageMigrationRepository(db)
    await packageRepository.transaction((transaction) => transaction.setState({
      packageId: oldDescriptor.id,
      packageVersion: oldDescriptor.version,
      schemaVersion: oldDescriptor.schemaVersion,
      migratedAt: new Date(),
    }))
    const approval = await oldRepository.createApproval({
      revisionMap: { revision: 1 },
      candidateSnapshot: publicationSnapshot(1, oldDescriptor),
      requesterUserId: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a12',
    })
    await packageRepository.transaction((transaction) => transaction.setState({
      packageId: newDescriptor.id,
      packageVersion: newDescriptor.version,
      schemaVersion: newDescriptor.schemaVersion,
      migratedAt: new Date(),
    }))

    const newRepository = createCmsRepository(db, newDescriptor)
    await expect(newRepository.approveAndCreatePublication({
      approvalId: approval.id,
      reviewerUserId: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a21',
      actorRole: 'owner',
    })).rejects.toThrow('snapshot does not match selected package')
    expect((await db.cmsApprovalRequest.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe('pending')
    expect(await db.cmsPublication.count()).toBe(0)
    expect(await db.taskOutbox.count({ where: { type: 'website:rebuild:wakeup' } })).toBe(0)
  })

  test('serializes approval publication behind migration without stranding an approved request', async () => {
    const staleDb = createPrisma(databaseUrl!)
    const oldDescriptor = { id: 'vibe-core', version: '1.0.0', schemaVersion: 1 }
    const oldRepository = createCmsRepository(staleDb, oldDescriptor)
    const packageRepository = createCmsSitePackageMigrationRepository(db)
    await packageRepository.transaction((transaction) => transaction.setState({
      packageId: oldDescriptor.id,
      packageVersion: oldDescriptor.version,
      schemaVersion: oldDescriptor.schemaVersion,
      migratedAt: new Date(),
    }))
    const approval = await oldRepository.createApproval({
      revisionMap: { revision: 1 },
      candidateSnapshot: publicationSnapshot(1, oldDescriptor),
      requesterUserId: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a12',
    })
    const migrationHasLock = Promise.withResolvers<void>()
    const finishMigration = Promise.withResolvers<void>()
    const migration = packageRepository.transaction(async (transaction) => {
      migrationHasLock.resolve()
      await finishMigration.promise
      await transaction.setState({
        packageId: oldDescriptor.id,
        packageVersion: '2.0.0',
        schemaVersion: 2,
        migratedAt: new Date(),
      })
    })
    let approvalAttempt: Promise<unknown> | undefined
    try {
      await migrationHasLock.promise
      let approvalSettled = false
      approvalAttempt = oldRepository.approveAndCreatePublication({
        approvalId: approval.id,
        reviewerUserId: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a21',
        actorRole: 'owner',
      }).finally(() => { approvalSettled = true })
      await Bun.sleep(75)
      expect(approvalSettled).toBe(false)

      finishMigration.resolve()
      await migration
      await expect(approvalAttempt).rejects.toThrow('does not match runtime')
      expect((await db.cmsApprovalRequest.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe('pending')
      expect(await db.cmsPublication.count()).toBe(0)
    } finally {
      finishMigration.resolve()
      await Promise.allSettled([migration, ...(approvalAttempt ? [approvalAttempt] : [])])
      await staleDb.$disconnect()
    }
  }, 15_000)

  test('cascades page revisions while restricting deletion of used media', async () => {
    const page = await repository.createPage({ path: '/cascade', title: 'Каскад', payload: { blocks: [] } })
    await repository.createPageRevision({
      pageId: page.id,
      sourceDraftRevision: page.draftRevision,
      sourcePayload: page.draftPayload,
      publicPayload: { path: page.path, title: page.title, blocks: [] },
      sitePackageSchemaVersion: 1,
    })
    const asset = await repository.createMediaAsset({
      objectKey: 'media/asset-b',
      contentVersion: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a01',
      contentType: 'image/webp',
      byteSize: 512,
    })
    await repository.replaceMediaUsage(asset.id, [{ ownerType: 'page', ownerId: page.id, scope: 'draft' }])

    await db.cmsPage.delete({ where: { id: page.id } })
    expect(await db.cmsPageRevision.count({ where: { pageId: page.id } })).toBe(0)
    await expectRejected(db.cmsMediaAsset.delete({ where: { id: asset.id } }), Error)
  })

  test('rolls back mutable package drafts and state without rewriting immutable revisions', async () => {
    const page = await repository.createPage({ path: '/migration', title: 'Migration', payload: { version: 1 } })
    const revision = await repository.createPageRevision({
      pageId: page.id,
      sourceDraftRevision: page.draftRevision,
      sourcePayload: page.draftPayload,
      publicPayload: page.draftPayload,
      sitePackageSchemaVersion: 1,
    })
    const packageRepository = createCmsSitePackageMigrationRepository(db)

    await expect(packageRepository.transaction(async (transaction) => {
      const drafts = await transaction.readMutableDrafts()
      drafts.pages[0]!.payload = { version: 2 }
      drafts.pages[0]!.draftRevision += 1
      await transaction.replaceMutableDrafts(drafts)
      await transaction.setState({
        packageId: 'vibe-core',
        packageVersion: '2.0.0',
        schemaVersion: 2,
        migratedAt: new Date(),
      })
      throw new Error('rollback')
    })).rejects.toThrow('rollback')

    expect((await repository.getPage(page.id))?.draftPayload).toEqual({ version: 1 })
    expect(await db.cmsSitePackageState.findUnique({ where: { key: 'default' } })).toBeNull()
    expect((await repository.getPageRevision(revision.id))?.sourcePayload).toEqual({ version: 1 })
  })

  test('rejects a stale-schema create that starts while package state advances', async () => {
    const staleDb = createPrisma(databaseUrl!)
    const packageRepository = createCmsSitePackageMigrationRepository(db)
    await packageRepository.transaction((transaction) => transaction.setState({
      packageId: 'vibe-core',
      packageVersion: '1.0.0',
      schemaVersion: 1,
      migratedAt: new Date(),
    }))
    const staleRepository = createCmsRepository(staleDb, {
      id: 'vibe-core',
      version: '1.0.0',
      schemaVersion: 1,
    })
    const migrationHasLock = Promise.withResolvers<void>()
    const finishMigration = Promise.withResolvers<void>()
    const migration = packageRepository.transaction(async (transaction) => {
      migrationHasLock.resolve()
      await finishMigration.promise
      await transaction.setState({
        packageId: 'vibe-core',
        packageVersion: '2.0.0',
        schemaVersion: 2,
        migratedAt: new Date(),
      })
    })
    let staleCreate: Promise<unknown> | undefined
    try {
      await migrationHasLock.promise

      let createSettled = false
      staleCreate = staleRepository
        .createPage({ path: '/stale-create', title: 'Stale', payload: { version: 1 } })
        .finally(() => { createSettled = true })
      await Bun.sleep(75)
      expect(createSettled).toBe(false)

      finishMigration.resolve()
      await migration
      await expect(staleCreate).rejects.toThrow('schema version')
      expect(await db.cmsPage.count({ where: { path: '/stale-create' } })).toBe(0)
      expect(await db.cmsSitePackageState.findUnique({ where: { key: 'default' } })).toMatchObject({
        schemaVersion: 2,
      })
    } finally {
      finishMigration.resolve()
      await Promise.allSettled([migration, ...(staleCreate ? [staleCreate] : [])])
      await staleDb.$disconnect()
    }
  }, 15_000)
})
