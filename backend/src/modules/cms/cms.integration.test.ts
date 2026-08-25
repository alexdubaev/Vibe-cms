import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'

import { createPrisma, type DbClient } from '../../db'
import { CmsService } from './application/cms-service'
import { selectedBlockDefinitions, selectedPageDraftSchema, selectedSitePackageDescriptor } from '@vibe-cms/selected-site-package/contract'
import { createCmsRepository } from './infrastructure/cms-repository'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

const pagePayload = {
  title: 'О компании',
  path: '/about',
  blocks: [
    {
      id: 'hero',
      type: 'hero' as const,
      data: {
        title: 'О компании',
        text: 'Мы создаём понятные сайты.',
        primaryAction: { label: 'Контакты', href: '/contacts' },
      },
    },
  ],
}

const snapshot = {
  revision: 1,
  generatedAt: '2026-08-24T10:00:00.000Z',
  settings: { companyName: 'Vibe CMS' },
  pages: [{ id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10', title: 'О компании', path: '/about', blocks: pagePayload.blocks }],
  collections: [],
  menus: [],
  redirects: [],
  media: [],
}

maybeDescribe('CMS application against PostgreSQL', () => {
  let db: DbClient
  let service: CmsService
  let pageId: string

  beforeAll(() => {
    db = createPrisma(databaseUrl!)
    service = new CmsService({
      repository: createCmsRepository(db, selectedSitePackageDescriptor),
      snapshot: { createCandidate: async () => ({ snapshot, revisionMap: { page: 1 } }) },
      validation: { pageDraftSchema: selectedPageDraftSchema, blockDefinitions: selectedBlockDefinitions },
    })
  })

  beforeEach(async () => {
    await db.taskOutbox.deleteMany()
    await db.cmsPublication.deleteMany()
    await db.cmsApprovalRequest.deleteMany()
    await db.cmsPageRevision.deleteMany()
    await db.cmsPage.deleteMany()
    await db.cmsPolicy.deleteMany()
    await db.cmsSiteSettings.deleteMany()
    await db.cmsPublicationController.deleteMany()
    await db.cmsPolicy.create({ data: { key: 'default', editorCanPublish: false } })
    pageId = (await db.cmsPage.create({ data: { path: '/about', title: 'О компании', draftPayload: pagePayload } })).id
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  test('freezes an editor approval while newer drafts continue to save', async () => {
    const editor = { id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a20', role: 'editor' as const }
    const owner = { id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a21', role: 'owner' as const }
    const draft = { ...pagePayload, expectedRevision: 1 }
    const approval = await service.submitForApproval(editor, 1)
    await service.savePage(editor, pageId, { ...draft, title: 'Новая редакция' })
    const publication = await service.approve(owner, approval.id)

    expect(publication.snapshot).toEqual(snapshot)
    expect((await db.cmsPage.findUniqueOrThrow({ where: { id: pageId } })).draftRevision).toBe(2)
    expect(await db.cmsPageRevision.count({ where: { pageId } })).toBe(1)
    expect((await db.cmsApprovalRequest.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe('approved')
  })

  test('records the desired publication revision and one durable rebuild wake-up atomically', async () => {
    const owner = { id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a21', role: 'owner' as const }

    await service.publishCurrent(owner, 1)

    expect(await db.cmsPublicationController.findUniqueOrThrow({ where: { key: 'default' } })).toMatchObject({
      desiredRevision: 1,
      publishedRevision: null,
      activeBuildId: null,
      status: 'queued',
    })
    expect(await db.taskOutbox.findMany({
      where: { type: 'website:rebuild:wakeup' },
      select: { dedupeKey: true, payload: true, status: true },
    })).toEqual([{ dedupeKey: 'website:rebuild:1', payload: { revision: 1 }, status: 'pending' }])
  })

  test('coalesces the controller to the newest desired revision while retaining deduplicated wake-ups', async () => {
    const owner = { id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a21', role: 'owner' as const }

    await service.publishCurrent(owner, 1)
    await service.publishCurrent(owner, 2)

    expect((await db.cmsPublicationController.findUniqueOrThrow({ where: { key: 'default' } })).desiredRevision).toBe(2)
    expect(await db.taskOutbox.findMany({
      where: { type: 'website:rebuild:wakeup' },
      orderBy: { dedupeKey: 'asc' },
      select: { dedupeKey: true },
    })).toEqual([
      { dedupeKey: 'website:rebuild:1' },
      { dedupeKey: 'website:rebuild:2' },
    ])
  })
})
