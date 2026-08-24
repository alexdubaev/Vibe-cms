import { expect, test } from 'bun:test'

import {
  approveCmsApproval,
  createCmsEntry,
  getCmsEntry,
  getCmsEntries,
  getCmsPageRevisions,
  getCmsMenu,
  getCmsMenus,
  getCmsSiteSettings,
  saveCmsSiteSettings,
  saveCmsMenu,
  saveCmsPublicationPolicy,
  createCmsPreviewGrant,
  publishCmsCurrent,
  rejectCmsApproval,
  restoreCmsPageRevision,
  saveCmsPage,
  saveCmsEntry,
  submitCmsApproval,
} from '@/features/cms/api'
import type { AuthenticatedTransport } from '@/platform/api'

test('saveCmsPage validates the draft and sends an optimistic PATCH', async () => {
  let request: { path: string; options?: Record<string, unknown> } | undefined
  const transport: AuthenticatedTransport = {
    async request(path, _schema, options) {
      request = { path, options: options as Record<string, unknown> | undefined }
      return {
        id: '00000000-0000-7000-8000-000000000001',
        title: 'Главная',
        path: '/',
        draftPayload: {},
        revision: 2,
      } as never
    },
  }

  await saveCmsPage(transport, '00000000-0000-7000-8000-000000000001', {
    title: 'Главная',
    path: '/',
    blocks: [{
      id: 'hero',
      type: 'hero',
      data: {
        title: 'Добро пожаловать',
        text: 'Описание страницы',
        primaryAction: { label: 'Подробнее', href: '/about' },
      },
    }],
    expectedRevision: 1,
  })

  expect(request).toMatchObject({
    path: '/api/cms/pages/00000000-0000-7000-8000-000000000001',
    options: { method: 'PATCH', body: { expectedRevision: 1 } },
  })
})

test('publication actions use safe response contracts and never send snapshots', async () => {
  const calls: Array<{ path: string; options?: Record<string, unknown> }> = []
  const transport: AuthenticatedTransport = {
    async request(path, _schema, options) {
      calls.push({ path, options: options as Record<string, unknown> | undefined })
      return { id: '00000000-0000-7000-8000-000000000001', status: 'pending', requesterUserId: '00000000-0000-7000-8000-000000000001', revision: 2 } as never
    },
  }

  await submitCmsApproval(transport, 2)
  await approveCmsApproval(transport, '00000000-0000-7000-8000-000000000001')
  await rejectCmsApproval(transport, '00000000-0000-7000-8000-000000000001', 'Нужно уточнить')
  await publishCmsCurrent(transport, 2)

  expect(calls).toEqual([
    { path: '/api/cms/approvals', options: { method: 'POST', body: { revision: 2 } } },
    { path: '/api/cms/approvals/00000000-0000-7000-8000-000000000001/approve', options: { method: 'POST' } },
    { path: '/api/cms/approvals/00000000-0000-7000-8000-000000000001/reject', options: { method: 'POST', body: { note: 'Нужно уточнить' } } },
    { path: '/api/cms/publish', options: { method: 'POST', body: { revision: 2 } } },
  ])
})

test('publication policy lets an owner update one clear capability only', async () => {
  let request: { path: string; options?: Record<string, unknown> } | undefined
  const transport: AuthenticatedTransport = {
    async request(path, _schema, options) {
      request = { path, options: options as Record<string, unknown> | undefined }
      return { editorCanPublish: true } as never
    },
  }
  await saveCmsPublicationPolicy(transport, true)
  expect(request).toEqual({
    path: '/api/cms/publication/policy',
    options: { method: 'PATCH', body: { editorCanPublish: true } },
  })
})

test('page revision history reads safe metadata and restores through a scoped route', async () => {
  const pageId = '00000000-0000-7000-8000-000000000001'
  const revisionId = '00000000-0000-7000-8000-000000000002'
  const calls: Array<{ path: string; options?: Record<string, unknown> }> = []
  const transport: AuthenticatedTransport = {
    async request(path, _schema, options) {
      calls.push({ path, options: options as Record<string, unknown> | undefined })
      return path.endsWith('/restore')
        ? { id: pageId, title: 'Восстановлено', path: '/', draftPayload: {}, revision: 4 }
        : [{
            id: revisionId,
            revision: 2,
            sourceDraftRevision: 3,
            publicationRevision: null,
            createdAt: '2026-08-24T09:00:00.000Z',
          }]
    },
  }

  await getCmsPageRevisions(transport, pageId)
  await restoreCmsPageRevision(transport, pageId, revisionId)

  expect(calls).toEqual([
    { path: `/api/cms/pages/${pageId}/revisions`, options: undefined },
    { path: `/api/cms/pages/${pageId}/revisions/${revisionId}/restore`, options: { method: 'POST' } },
  ])
})

test('collection entry list uses a type filter and safe labels', async () => {
  let request: { path: string; options?: Record<string, unknown> } | undefined
  const transport: AuthenticatedTransport = {
    async request(path, _schema, options) {
      request = { path, options: options as Record<string, unknown> | undefined }
      return [{
        id: '00000000-0000-7000-8000-000000000003',
        type: 'service',
        name: 'Аудит',
        summary: 'Проверка сайта',
        revision: 2,
        archived: false,
      }] as never
    },
  }

  await getCmsEntries(transport, 'service')
  expect(request).toEqual({ path: '/api/cms/entries?type=service', options: undefined })
})

test('preview grant posts only the page id and preserves the opaque URL contract', async () => {
  const pageId = '00000000-0000-7000-8000-000000000001'
  let request: { path: string; options?: Record<string, unknown> } | undefined
  const transport: AuthenticatedTransport = {
    async request(path, _schema, options) {
      request = { path, options: options as Record<string, unknown> | undefined }
      return {
        token: 'a'.repeat(43),
        expiresAt: '2026-08-25T08:00:00.000Z',
        previewUrl: `https://preview.example.test/__preview/${pageId}?token=${'a'.repeat(43)}`,
      } as never
    },
  }

  await createCmsPreviewGrant(transport, pageId)
  expect(request).toEqual({ path: '/api/cms/preview/grants', options: { method: 'POST', body: { pageId } } })
})

test('site navigation and settings use safe read routes', async () => {
  const menuId = '00000000-0000-7000-8000-000000000004'
  const calls: string[] = []
  const transport: AuthenticatedTransport = {
    async request(path) {
      calls.push(path)
      return path === '/api/cms/settings'
        ? { companyName: 'Vibe', revision: 2 }
        : { location: 'header', items: [{ label: 'Главная', href: '/' }], revision: 3 }
    },
  }
  await getCmsSiteSettings(transport)
  await getCmsMenu(transport, menuId)
  expect(calls).toEqual(['/api/cms/settings', `/api/cms/menus/${menuId}`])
})

test('menu editor discovers navigation and saves only visible links with a revision', async () => {
  const menuId = '00000000-0000-7000-8000-000000000004'
  const calls: Array<{ path: string; options?: Record<string, unknown> }> = []
  const transport: AuthenticatedTransport = {
    async request(path, _schema, options) {
      calls.push({ path, options: options as Record<string, unknown> | undefined })
      return [] as never
    },
  }
  await getCmsMenus(transport)
  await saveCmsMenu(transport, menuId, {
    items: [{ label: 'Главная', href: '/' }],
    expectedRevision: 3,
  })
  expect(calls).toEqual([
    { path: '/api/cms/menus', options: undefined },
    {
      path: `/api/cms/menus/${menuId}`,
      options: { method: 'PATCH', body: { items: [{ label: 'Главная', href: '/' }], expectedRevision: 3 } },
    },
  ])
})

test('site settings save sends only the editable name and the concurrency revision', async () => {
  let request: { path: string; options?: Record<string, unknown> } | undefined
  const transport: AuthenticatedTransport = {
    async request(path, _schema, options) {
      request = { path, options: options as Record<string, unknown> | undefined }
      return { companyName: 'Vibe Studio', revision: 3 } as never
    },
  }

  await saveCmsSiteSettings(transport, { companyName: ' Vibe Studio ', expectedRevision: 2 })
  expect(request).toEqual({
    path: '/api/cms/settings',
    options: { method: 'PATCH', body: { companyName: 'Vibe Studio', expectedRevision: 2 } },
  })
})

test('collection editor API uses separate create, read, and optimistic update contracts', async () => {
  const entryId = '00000000-0000-7000-8000-000000000003'
  const calls: Array<{ path: string; options?: Record<string, unknown> }> = []
  const transport: AuthenticatedTransport = {
    async request(path, _schema, options) {
      calls.push({ path, options: options as Record<string, unknown> | undefined })
      return {
        id: entryId,
        type: 'service',
        draftPayload: { type: 'service', name: 'Аудит' },
        draftRevision: 2,
        archived: false,
      } as never
    },
  }

  await getCmsEntry(transport, entryId)
  await createCmsEntry(transport, { type: 'service', name: 'Аудит' })
  await saveCmsEntry(transport, entryId, { type: 'service', name: 'Новый аудит', expectedRevision: 2 })

  expect(calls).toEqual([
    { path: `/api/cms/entries/${entryId}`, options: undefined },
    { path: '/api/cms/entries', options: { method: 'POST', body: { type: 'service', name: 'Аудит' } } },
    { path: `/api/cms/entries/${entryId}`, options: { method: 'PATCH', body: { type: 'service', name: 'Новый аудит', expectedRevision: 2 } } },
  ])
})
