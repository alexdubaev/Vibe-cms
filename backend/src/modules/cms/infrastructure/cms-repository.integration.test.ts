import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'

import { createPrisma, type DbClient } from '../../../db'
import { CmsConflictError, CmsImmutableRevisionError, CmsPublicationConflictError } from '../domain/errors'
import { createCmsRepository } from './cms-repository'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

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
    repository = createCmsRepository(db)
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
    })
    await repository.updatePageDraft(page.id, 1, { blocks: [{ type: 'textImage' }] })
    await repository.createPageRevision({
      pageId: page.id,
      sourceDraftRevision: 2,
      sourcePayload: { secret: 'second' },
      publicPayload: { title: 'Второй' },
      publicationRevision: 7,
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
    const first = await repository.createPublication({ revision: 1, snapshot: { pages: [] } })

    await expectRejected(repository.createPublication({ revision: 1, snapshot: { pages: [] } }),
      CmsPublicationConflictError,
    )
    await expectRejected(repository.createPublication({ revision: 0, snapshot: { pages: [] } }),
      CmsPublicationConflictError,
    )

    expect(first.revision).toBe(1)
    expect((await repository.createPublication({ revision: 2, snapshot: { pages: [] } })).revision).toBe(2)
  })

  test('cascades page revisions while restricting deletion of used media', async () => {
    const page = await repository.createPage({ path: '/cascade', title: 'Каскад', payload: { blocks: [] } })
    await repository.createPageRevision({
      pageId: page.id,
      sourceDraftRevision: page.draftRevision,
      sourcePayload: page.draftPayload,
      publicPayload: { path: page.path, title: page.title, blocks: [] },
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
})
