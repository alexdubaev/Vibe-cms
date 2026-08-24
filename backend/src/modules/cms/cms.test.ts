import { describe, expect, test } from 'bun:test'

import type { CmsRepository } from './application/ports'
import { CmsService } from './application/cms-service'
import { CmsPreviewService, type PreviewStore } from './application/preview-service'
import { CmsRepositoryError, CmsConflictError } from './domain/errors'
import { materialiseSnapshot } from './domain/materialise-snapshot'

const heroDraft = (expectedRevision: number) => ({
  title: 'Главная',
  path: '/',
  blocks: [
    {
      id: 'hero',
      type: 'hero' as const,
      data: {
        title: 'Добро пожаловать',
        text: 'Описание компании',
        primaryAction: { label: 'Подробнее', href: '/about' },
      },
    },
  ],
  expectedRevision,
})

function createService(overrides: Partial<CmsRepository> = {}) {
  const page = {
    id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10',
    path: '/',
    title: 'Главная',
    draftPayload: heroDraft(1),
    draftRevision: 1,
    archivedAt: null,
  }
  const approval = {
    id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a11',
    revisionMap: { revision: 1 },
    candidateSnapshot: { revision: 1, frozen: 'yes' },
    requesterUserId: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a12',
    status: 'pending' as const,
    reviewerUserId: null,
    decisionNote: null,
  }
  const publication = {
    id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a13',
    revision: 1,
    snapshot: approval.candidateSnapshot,
  }
  const repository: Partial<CmsRepository> = {
    getPage: async () => page,
    updatePageDraft: async (_id, expectedRevision) => {
      if (expectedRevision !== page.draftRevision) {
        return { updated: false, conflict: { aggregateId: page.id, currentRevision: page.draftRevision } }
      }
      page.draftRevision += 1
      return { updated: true, revision: page.draftRevision }
    },
    createPageRevision: async () => ({ id: 'page-revision', pageId: page.id, revision: page.draftRevision, sourcePayload: heroDraft(page.draftRevision) }),
    createContentEntryRevision: async () => ({ id: 'entry-revision', entryId: 'entry', revision: 1 }),
    getPolicy: async () => ({ key: 'default', editorCanPublish: false }),
    createApproval: async () => approval,
    getApproval: async () => approval,
    decideApproval: async ({ status }) => ({ ...approval, status, reviewerUserId: 'owner' }),
    createPublication: async () => publication,
    getPageRevision: async () => ({ id: 'revision', pageId: page.id, revision: 1, sourcePayload: heroDraft(1) }),
    ...overrides,
  }
  const service = new CmsService({
    repository: repository as CmsRepository,
    snapshot: { createCandidate: async () => ({ snapshot: approval.candidateSnapshot as never, revisionMap: { revision: 1 } }) },
  })
  return { service, page, approval, publication }
}

describe('CMS application service', () => {
  test('projects site settings and menus into strict presentation DTOs', async () => {
    const menuId = '018f8c8d-5f34-7db2-8b98-2c7bf3d80a30'
    const { service } = createService({
      getSiteSettings: async () => ({
        key: 'default',
        draftPayload: {
          companyName: 'Северный ветер',
          internalFlags: { preview: true },
        },
        draftRevision: 7,
      }),
      getMenu: async () => ({
        id: menuId,
        location: 'header',
        draftPayload: {
          items: [{ label: 'О нас', href: '/about', analyticsTag: 'nav-about' }],
          internalNotes: 'Do not publish',
        },
        draftRevision: 5,
      }),
    })

    await expect(service.getSiteSettings({ id: 'editor', role: 'editor' })).resolves.toEqual({
      companyName: 'Северный ветер',
      revision: 7,
    })
    await expect(service.getMenu({ id: 'owner', role: 'owner' }, menuId)).resolves.toEqual({
      id: menuId,
      location: 'header',
      items: [{ label: 'О нас', href: '/about' }],
      revision: 5,
    })
  })

  test('lists menu navigation with only editable presentation fields', async () => {
    const { service } = createService({
      listMenus: async () => [{
        id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a31',
        location: 'footer',
        draftPayload: { items: [{ label: 'Контакты', href: '/contacts' }], internalFlag: true },
        draftRevision: 2,
      }],
    })

    await expect(service.listMenus({ id: 'editor', role: 'editor' })).resolves.toEqual([{
      id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a31',
      location: 'footer',
      items: [{ label: 'Контакты', href: '/contacts' }],
      revision: 2,
    }])
  })

  test('rejects regular users before reading CMS presentation data', async () => {
    const { service } = createService()

    await expectRejected(service.getSiteSettings({ id: 'user', role: 'user' }), CmsRepositoryError)
    await expectRejected(service.getMenu({ id: 'user', role: 'user' }, '018f8c8d-5f34-7db2-8b98-2c7bf3d80a30'), CmsRepositoryError)
  })

  test('returns safe read DTOs for pages, publication status, and pending approvals', async () => {
    const { service, page, approval } = createService({
      listPages: async () => [page],
      getPage: async () => page,
      getPageForEditor: async () => page,
      getPolicy: async () => ({ key: 'default', editorCanPublish: true }),
      getController: async () => ({
        key: 'default',
        desiredRevision: 4,
        publishedRevision: 3,
        activeBuildId: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a14',
        activeSlot: 'green',
        status: 'building',
        heartbeatAt: new Date('2026-08-24T10:00:00.000Z'),
        lastError: null,
      }),
      getLatestPublication: async () => ({
        id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a15',
        revision: 3,
        artifactState: 'ready',
        createdAt: new Date('2026-08-24T09:00:00.000Z'),
      }),
      listPendingApprovals: async () => [{ ...approval, candidateSnapshot: { secret: 'must not leave repository' }, revisionMap: { private: true } }],
    })

    const actor = { id: 'editor', role: 'editor' as const }
    expect(await service.listPages(actor)).toEqual([{
      id: page.id,
      title: page.title,
      path: page.path,
      draftRevision: page.draftRevision,
      archived: false,
    }])
    const pageForEditor = await service.getPageForEditor(actor, page.id)
    expect(pageForEditor).toMatchObject({
      id: page.id,
      title: page.title,
      path: page.path,
      draftPayload: page.draftPayload,
      draftRevision: page.draftRevision,
      archived: false,
    })
    expect(pageForEditor).not.toHaveProperty('objectKey')

    expect(await service.getPublicationSummary(actor)).toEqual({
      policy: { editorCanPublish: true },
      controller: {
        desiredRevision: 4,
        publishedRevision: 3,
        activeBuildId: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a14',
        activeSlot: 'green',
        status: 'building',
        heartbeatAt: '2026-08-24T10:00:00.000Z',
        lastError: null,
      },
      latestPublication: {
        id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a15',
        revision: 3,
        artifactState: 'ready',
        createdAt: '2026-08-24T09:00:00.000Z',
      },
    })

    const pending = await service.listPendingApprovals(actor)
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ id: approval.id, status: 'pending', requesterUserId: approval.requesterUserId })
    expect(pending[0]).not.toHaveProperty('candidateSnapshot')
    expect(pending[0]).not.toHaveProperty('revisionMap')
  })

  test('allows editors to save a valid page draft and rejects regular users', async () => {
    const { service } = createService()
    const editor = { id: 'editor', role: 'editor' as const }
    const saved = await service.savePage(editor, 'page', heroDraft(1))

    expect(saved.revision).toBe(2)
    await expectRejected(service.savePage({ id: 'user', role: 'user' }, 'page', heroDraft(2)), CmsRepositoryError)
  })

  test('lists safe active collection entries for selection blocks', async () => {
    const { service } = createService({
      listContentEntries: async () => [
        {
          id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a17',
          type: 'service',
          draftPayload: { name: 'Аудит', summary: 'Проверка сайта' },
          draftRevision: 4,
          archivedAt: null,
        },
      ],
    })

    await expect(service.listEntries({ id: 'editor', role: 'editor' }, 'service')).resolves.toEqual([
      {
        id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a17',
        type: 'service',
        name: 'Аудит',
        summary: 'Проверка сайта',
        revision: 4,
        archived: false,
      },
    ])
  })

  test('creates a collection entry with its first immutable revision', async () => {
    let revisionInput: Record<string, unknown> | undefined
    const entry = {
      id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a18',
      type: 'service' as const,
      draftPayload: { name: 'Аудит', summary: 'Проверка сайта' },
      draftRevision: 1,
      archivedAt: null,
    }
    const { service } = createService({
      createContentEntry: async () => entry,
      createContentEntryRevision: async (input) => {
        revisionInput = input as unknown as Record<string, unknown>
        return { id: 'entry-revision', entryId: entry.id, revision: 1 }
      },
    })

    await expect(service.createEntry({ id: 'editor', role: 'editor' }, {
      type: 'service',
      name: 'Аудит',
      summary: 'Проверка сайта',
    })).resolves.toMatchObject({
      id: entry.id,
      type: 'service',
      draftPayload: { name: 'Аудит', summary: 'Проверка сайта' },
      draftRevision: 1,
    })
    expect(revisionInput).toMatchObject({
      entryId: entry.id,
      sourceDraftRevision: 1,
      sourcePayload: { name: 'Аудит', summary: 'Проверка сайта' },
      publicPayload: { name: 'Аудит', summary: 'Проверка сайта' },
    })
  })

  test('returns a collection entry editor DTO for an existing entry', async () => {
    const entry = {
      id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a19',
      type: 'faq' as const,
      draftPayload: { name: 'Вопрос', summary: 'Ответ' },
      draftRevision: 3,
      archivedAt: null,
    }
    const { service } = createService({ getContentEntry: async () => entry })

    await expect(service.getEntry({ id: 'editor', role: 'editor' }, entry.id)).resolves.toEqual({
      id: entry.id,
      type: entry.type,
      draftPayload: entry.draftPayload,
      draftRevision: entry.draftRevision,
      archived: false,
    })
  })

  test('surfaces stale autosaves as a conflict without retrying', async () => {
    const { service } = createService({
      updatePageDraft: async () => ({ updated: false, conflict: { aggregateId: 'page', currentRevision: 3 } }),
    })

    await expectRejected(service.savePage({ id: 'editor', role: 'editor' }, 'page', heroDraft(1)), CmsConflictError)
  })

  test('lists safe page revision metadata and restores a selected revision', async () => {
    const { service, page } = createService({
      listPageRevisions: async () => [{
        id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a16',
        pageId: page.id,
        revision: 1,
        sourceDraftRevision: 1,
        publicationRevision: null,
        createdAt: new Date('2026-08-24T09:00:00.000Z'),
      }],
      getPageRevision: async () => ({
        id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a16',
        pageId: page.id,
        revision: 1,
        sourcePayload: heroDraft(1),
      }),
    })

    const revisions = await service.listPageRevisions({ id: 'editor', role: 'editor' }, page.id)
    expect(revisions).toEqual([{
      id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a16',
      revision: 1,
      sourceDraftRevision: 1,
      publicationRevision: null,
      createdAt: '2026-08-24T09:00:00.000Z',
    }])
    expect(revisions[0]).not.toHaveProperty('sourcePayload')

    const restored = await service.restorePage(
      { id: 'editor', role: 'editor' },
      '018f8c8d-5f34-7db2-8b98-2c7bf3d80a16',
      page.id,
    )
    expect(restored.revision).toBe(2)
  })

  test('approval publishes the exact frozen candidate snapshot', async () => {
    const { service, approval } = createService()
    const submitted = await service.submitForApproval({ id: 'editor', role: 'editor' }, 1)
    expect(submitted.candidateSnapshot).toEqual(approval.candidateSnapshot)

    const publication = await service.approve({ id: 'owner', role: 'owner' }, approval.id)
    expect(publication.snapshot).toEqual(approval.candidateSnapshot)
  })

  test('editor publishing follows the owner-controlled policy immediately', async () => {
    const disabled = createService()
    await expectRejected(disabled.service.publishCurrent({ id: 'editor', role: 'editor' }, 1), CmsRepositoryError)

    const enabled = createService({ getPolicy: async () => ({ key: 'default', editorCanPublish: true }) })
    await expect(enabled.service.publishCurrent({ id: 'editor', role: 'editor' }, 1)).resolves.toMatchObject({ revision: 1 })
  })
})

describe('CMS preview grants', () => {
  test('consumes a one-time grant and rejects a second use', async () => {
    let stored: { codeHash: string; actorUserId: string; pageId: string; expiresAt: Date; consumed: boolean } | undefined
    const store: PreviewStore = {
      async createGrant(input) {
        stored = { ...input, consumed: false }
        return { id: 'grant', ...input }
      },
      async consumeGrant(input) {
        if (!stored || stored.consumed || stored.codeHash !== input.codeHash || stored.expiresAt <= input.now) return null
        stored.consumed = true
        return { id: 'grant', actorUserId: stored.actorUserId, pageId: stored.pageId, expiresAt: stored.expiresAt }
      },
      async createSession() {},
      async findSession() { return null },
      async findMediaAsset() { return null },
    }
    const preview = new CmsPreviewService({
      store,
      origin: 'https://preview.example.test',
      randomToken: () => 'x'.repeat(64),
      hashToken: (value) => `hash:${value}`,
      clock: { now: () => new Date('2026-08-24T10:00:00.000Z') },
    })

    const grant = await preview.issueGrant({ id: 'editor', role: 'editor' }, '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10')
    expect(grant.previewUrl).toContain('/__preview/')
    expect((await preview.consumeGrant(grant.token)).pageId).toBe('018f8c8d-5f34-7db2-8b98-2c7bf3d80a10')
    await expectRejected(preview.consumeGrant(grant.token), CmsRepositoryError)
  })
})

describe('public snapshot materialisation', () => {
  test('accepts the public allowlist and rejects draft-only fields', () => {
    const snapshot = materialiseSnapshot(3, new Date('2026-08-24T10:00:00.000Z'), {
      settings: { companyName: 'Vibe CMS' },
      pages: [
        {
          id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10',
          title: 'Главная',
          path: '/',
          blocks: heroDraft(1).blocks,
        },
      ],
      collections: [],
      menus: [],
      redirects: [],
      media: [],
    })
    expect(snapshot.revision).toBe(3)
    expect(snapshot.pages[0]).not.toHaveProperty('draftRevision')

    expect(() =>
      materialiseSnapshot(3, new Date('2026-08-24T10:00:00.000Z'), {
        settings: { companyName: 'Vibe CMS', secret: 'must not leak' },
        pages: [],
        collections: [],
        menus: [],
        redirects: [],
        media: [],
      }),
    ).toThrow()
  })
})

async function expectRejected(operation: Promise<unknown>, type: new (...args: never[]) => Error) {
  let error: unknown
  try {
    await operation
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(type)
}
