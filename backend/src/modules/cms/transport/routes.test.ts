import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'

import { handleError } from '../../../http/errors'
import { createRequireAnyRole, type AuthHttpEnv } from '../../auth'
import type { CmsService } from '../application/cms-service'
import type { CmsPreviewService } from '../application/preview-service'
import { createCmsPreviewRuntimeRoutes, createCmsRoutes } from './routes'

const pageId = '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10'

describe('CMS HTTP routes', () => {
  test('serves strict settings and menu presentation DTOs only to CMS roles', async () => {
    const menuId = '018f8c8d-5f34-7db2-8b98-2c7bf3d80a30'
    const auth = createMiddleware<AuthHttpEnv>(async (c, next) => {
      const requestedRole = c.req.header('x-role')
      c.set('user', {
        id: requestedRole ?? 'user',
        role: requestedRole === 'owner' ? 'owner' : requestedRole === 'editor' ? 'editor' : 'user',
        email: 'cms@example.com',
        displayName: null,
        createdAt: new Date().toISOString(),
        sessionId: 'session',
      })
      await next()
    })
    const service = {
      getSiteSettings: async () => ({
        companyName: 'Северный ветер',
        revision: 7,
        draftPayload: { internalFlags: { preview: true } },
      }),
      getMenu: async () => ({
        location: 'header',
        items: [{ label: 'О нас', href: '/about', analyticsTag: 'nav-about' }],
        revision: 5,
        draftPayload: { internalNotes: 'Do not publish' },
      }),
    } as unknown as CmsService
    const app = new Hono<AuthHttpEnv>()
    app.route('/api/cms', createCmsRoutes({
      requireAuth: auth,
      requireCmsAccess: createRequireAnyRole('editor', 'owner'),
      service,
      preview: {} as CmsPreviewService,
    }))
    app.onError(handleError)

    expect((await app.request('/api/cms/settings')).status).toBe(403)

    const settings = await app.request('/api/cms/settings', { headers: { 'x-role': 'editor' } })
    expect(settings.status).toBe(200)
    expect(await settings.json()).toEqual({ companyName: 'Северный ветер', revision: 7 })

    const menu = await app.request(`/api/cms/menus/${menuId}`, { headers: { 'x-role': 'owner' } })
    expect(menu.status).toBe(200)
    expect(await menu.json()).toEqual({
      location: 'header',
      items: [{ label: 'О нас', href: '/about' }],
      revision: 5,
    })
  })

  test('serves a draft page and authorized media URL only with a preview session', async () => {
    const service = {
      getPageForEditor: async () => ({
        id: pageId,
        title: 'Черновик',
        path: '/draft',
        draftPayload: { blocks: [{ id: 'hero', type: 'hero' }], secret: 'draft-only' },
        draftRevision: 4,
        archived: false,
      }),
    } as unknown as CmsService
    const preview = {
      authorizeSession: async (token: string, requestedPageId?: string) => {
        expect(token).toBe('preview-session')
        expect(requestedPageId).toBe(pageId)
        return { actor: { id: 'editor', role: 'editor' as const }, pageId, expiresAt: new Date('2026-08-24T10:15:00.000Z') }
      },
      getMedia: async (token: string, assetId: string) => {
        expect(token).toBe('preview-session')
        expect(assetId).toBe('018f8c8d-5f34-7db2-8b98-2c7bf3d80a11')
        return { id: assetId, objectKey: 'cms-media/private.png', contentType: 'image/png' }
      },
    } as unknown as CmsPreviewService
    const routes = createCmsPreviewRuntimeRoutes({
      preview,
      service,
      storage: {
        createDownloadUrl: async ({ key }) => ({
          key,
          url: 'https://storage.example.test/signed/private.png',
          expiresAt: '2026-08-24T10:01:00.000Z',
        }),
      },
    })
    const app = new Hono()
    app.route('/api/cms/preview', routes)

    const page = await app.request(`/api/cms/preview/pages/${pageId}`, {
      headers: { 'x-cms-preview-session': 'preview-session' },
    })
    expect(page.status).toBe(200)
    expect(await page.json()).toMatchObject({ id: pageId, draftRevision: 4 })
    expect(page.headers.get('cache-control')).toBe('private, no-store')
    expect(page.headers.get('x-robots-tag')).toBe('noindex, nofollow')

    const media = await app.request('/api/cms/preview/media/018f8c8d-5f34-7db2-8b98-2c7bf3d80a11', {
      headers: { 'x-cms-preview-session': 'preview-session' },
    })
    expect(media.status).toBe(200)
    expect(await media.json()).toEqual({
      id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a11',
      mimeType: 'image/png',
      downloadUrl: 'https://storage.example.test/signed/private.png',
      expiresAt: '2026-08-24T10:01:00.000Z',
    })

    const unauthorized = await app.request(`/api/cms/preview/pages/${pageId}`)
    expect(unauthorized.status).toBe(404)
    expect(await unauthorized.text()).toContain('Not Found')
    expect(unauthorized.headers.get('cache-control')).toBe('private, no-store')
    expect(unauthorized.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  })

  test('serves authenticated safe read DTOs and never exposes approval snapshots', async () => {
    const auth = createMiddleware<AuthHttpEnv>(async (c, next) => {
      c.set('user', { id: 'editor', role: 'editor', email: 'editor@example.com', displayName: null, createdAt: new Date().toISOString(), sessionId: 'session' })
      await next()
    })
    const service = {
      listPages: async () => [{ id: pageId, title: 'Страница', path: '/', draftRevision: 2, archived: false }],
      getPageForEditor: async () => ({ id: pageId, title: 'Страница', path: '/', draftPayload: { blocks: [] }, draftRevision: 2, archived: false }),
      getPublicationSummary: async () => ({
        policy: { editorCanPublish: false },
        controller: null,
        latestPublication: null,
      }),
      listPendingApprovals: async () => [{ id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a11', status: 'pending', requesterUserId: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a12' }],
    } as unknown as CmsService
    const preview = {} as CmsPreviewService
    const routes = createCmsRoutes({ requireAuth: auth, requireCmsAccess: auth, service, preview })
    const app = new Hono()
    app.route('/api/cms', routes)

    const pagesResponse = await app.request('/api/cms/pages')
    expect(pagesResponse.status).toBe(200)
    const pages = await pagesResponse.json() as Array<Record<string, unknown>>
    expect(pages).toEqual([{ id: pageId, title: 'Страница', path: '/', draftRevision: 2, archived: false }])
    expect(pages[0]).not.toHaveProperty('objectKey')
    expect(pagesResponse.headers.get('cache-control')).toBe('private, no-store')

    const pageResponse = await app.request(`/api/cms/pages/${pageId}`)
    expect(pageResponse.status).toBe(200)
    const page = await pageResponse.json() as Record<string, unknown>
    expect(page).toMatchObject({ id: pageId, draftRevision: 2 })
    expect(page).not.toHaveProperty('objectKey')

  })

  test('serves safe collection entry labels for selection pickers', async () => {
    const auth = createMiddleware<AuthHttpEnv>(async (c, next) => {
      c.set('user', { id: 'editor', role: 'editor', email: 'editor@example.com', displayName: null, createdAt: new Date().toISOString(), sessionId: 'session' })
      await next()
    })
    const service = {
      listEntries: async () => [{
        id: pageId,
        type: 'service',
        name: 'Аудит',
        summary: 'Проверка сайта',
        revision: 4,
        archived: false,
        draftPayload: { secret: 'private' },
      }],
    } as unknown as CmsService
    const routes = createCmsRoutes({ requireAuth: auth, requireCmsAccess: auth, service, preview: {} as CmsPreviewService })
    const app = new Hono()
    app.route('/api/cms', routes)

    const response = await app.request('/api/cms/entries?type=service')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([{
      id: pageId,
      type: 'service',
      name: 'Аудит',
      summary: 'Проверка сайта',
      revision: 4,
      archived: false,
    }])
  })

  test('serves collection editor reads and optimistic create/update mutations', async () => {
    const auth = createMiddleware<AuthHttpEnv>(async (c, next) => {
      c.set('user', { id: 'editor', role: 'editor', email: 'editor@example.com', displayName: null, createdAt: new Date().toISOString(), sessionId: 'session' })
      await next()
    })
    const entryId = '018f8c8d-5f34-7db2-8b98-2c7bf3d80a13'
    const service = {
      getEntry: async () => ({ id: entryId, type: 'service', draftPayload: { name: 'Аудит' }, draftRevision: 2, archived: false, objectKey: 'private' }),
      createEntry: async () => ({ id: entryId, type: 'service', draftPayload: { name: 'Аудит' }, draftRevision: 1, archived: false }),
      saveEntry: async () => ({ id: entryId, type: 'service', draftPayload: { name: 'Обновлённый аудит' }, draftRevision: 3, archived: false }),
    } as unknown as CmsService
    const routes = createCmsRoutes({ requireAuth: auth, requireCmsAccess: auth, service, preview: {} as CmsPreviewService })
    const app = new Hono()
    app.route('/api/cms', routes)

    const editor = await app.request(`/api/cms/entries/${entryId}`)
    expect(editor.status).toBe(200)
    expect(await editor.json()).toEqual({ id: entryId, type: 'service', draftPayload: { name: 'Аудит' }, draftRevision: 2, archived: false })

    const created = await app.request('/api/cms/entries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'service', name: 'Аудит', summary: 'Проверка сайта' }),
    })
    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({ id: entryId, type: 'service', draftRevision: 1 })

    const saved = await app.request(`/api/cms/entries/${entryId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'service', name: 'Обновлённый аудит', expectedRevision: 2 }),
    })
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({ id: entryId, draftRevision: 3 })
  })

  test('requires CMS access and marks authenticated responses private', async () => {
    const auth = createMiddleware<AuthHttpEnv>(async (c, next) => {
      c.set('user', { id: 'editor', role: 'editor', email: 'editor@example.com', displayName: null, createdAt: new Date().toISOString(), sessionId: 'session' })
      await next()
    })
    const service = { savePage: async () => ({ id: pageId, title: 'Страница', path: '/', draftPayload: {}, revision: 2 }) } as unknown as CmsService
    const preview = {} as CmsPreviewService
    const routes = createCmsRoutes({ requireAuth: auth, requireCmsAccess: auth, service, preview })
    const app = new Hono()
    app.route('/api/cms', routes)

    const response = await app.request(`/api/cms/pages/${pageId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Страница',
        path: '/',
        blocks: [{ id: 'hero', type: 'hero', data: { title: 'Титул', text: 'Текст', primaryAction: { label: 'Далее', href: '/about' } } }],
        expectedRevision: 1,
      }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  test('never returns approval or publication snapshots from mutation responses', async () => {
    const auth = createMiddleware<AuthHttpEnv>(async (c, next) => {
      c.set('user', { id: 'owner', role: 'owner', email: 'owner@example.com', displayName: null, createdAt: new Date().toISOString(), sessionId: 'session' })
      await next()
    })
    const service = {
      submitForApproval: async () => ({ id: pageId, status: 'pending', requesterUserId: pageId, candidateSnapshot: { secret: 'private' } }),
      approve: async () => ({ id: pageId, revision: 3, snapshot: { secret: 'private' } }),
      reject: async () => ({ id: pageId, status: 'rejected', requesterUserId: pageId, candidateSnapshot: { secret: 'private' } }),
      publishCurrent: async () => ({ id: pageId, revision: 3, snapshot: { secret: 'private' } }),
    } as unknown as CmsService
    const routes = createCmsRoutes({ requireAuth: auth, requireCmsAccess: auth, service, preview: {} as CmsPreviewService })
    const app = new Hono()
    app.route('/api/cms', routes)

    const submit = await app.request('/api/cms/approvals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revision: 3 }),
    })
    const submitted = await submit.json() as Record<string, unknown>
    expect(submit.status).toBe(201)
    expect(submitted).toEqual({ id: pageId, status: 'pending', requesterUserId: pageId })
    expect(submitted).not.toHaveProperty('candidateSnapshot')

    const approved = await app.request(`/api/cms/approvals/${pageId}/approve`, { method: 'POST' })
    const publication = await approved.json() as Record<string, unknown>
    expect(approved.status).toBe(201)
    expect(publication).toEqual({ id: pageId, revision: 3 })
    expect(publication).not.toHaveProperty('snapshot')

    const rejected = await app.request(`/api/cms/approvals/${pageId}/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'Не подходит' }),
    })
    const rejection = await rejected.json() as Record<string, unknown>
    expect(rejected.status).toBe(200)
    expect(rejection).toEqual({ id: pageId, status: 'rejected', requesterUserId: pageId })

    const published = await app.request('/api/cms/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revision: 3 }),
    })
    expect(await published.json()).toEqual({ id: pageId, revision: 3 })
  })

  test('serves safe revision metadata and scopes restore to the requested page', async () => {
    const auth = createMiddleware<AuthHttpEnv>(async (c, next) => {
      c.set('user', { id: 'editor', role: 'editor', email: 'editor@example.com', displayName: null, createdAt: new Date().toISOString(), sessionId: 'session' })
      await next()
    })
    const revisionId = '018f8c8d-5f34-7db2-8b98-2c7bf3d80a16'
    const service = {
      listPageRevisions: async () => [{
        id: revisionId,
        revision: 2,
        sourceDraftRevision: 3,
        publicationRevision: null,
        createdAt: '2026-08-24T09:00:00.000Z',
        sourcePayload: { secret: 'private' },
      }],
      restorePage: async () => ({ id: pageId, title: 'Восстановлено', path: '/', draftPayload: {}, revision: 4 }),
    } as unknown as CmsService
    const routes = createCmsRoutes({ requireAuth: auth, requireCmsAccess: auth, service, preview: {} as CmsPreviewService })
    const app = new Hono()
    app.route('/api/cms', routes)

    const listed = await app.request(`/api/cms/pages/${pageId}/revisions`)
    expect(listed.status).toBe(200)
    expect(await listed.json()).toEqual([{
      id: revisionId,
      revision: 2,
      sourceDraftRevision: 3,
      publicationRevision: null,
      createdAt: '2026-08-24T09:00:00.000Z',
    }])

    const restored = await app.request(`/api/cms/pages/${pageId}/revisions/${revisionId}/restore`, { method: 'POST' })
    expect(restored.status).toBe(200)
    expect(await restored.json()).toEqual({ id: pageId, title: 'Восстановлено', path: '/', draftPayload: {}, revision: 4 })
  })
})
