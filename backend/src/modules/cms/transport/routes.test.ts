import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'

import { handleError } from '../../../http/errors'
import { createFixedWindowRateLimit } from '../../../http/security'
import { createRequireAnyRole, type AuthHttpEnv } from '../../auth'
import type { CmsService } from '../application/cms-service'
import type { CmsPreviewService } from '../application/preview-service'
import { CmsConflictError, CmsRepositoryError } from '../domain/errors'
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
        id: menuId,
        location: 'header',
        items: [{ label: 'О нас', href: '/about', analyticsTag: 'nav-about' }],
        revision: 5,
        draftPayload: { internalNotes: 'Do not publish' },
      }),
      saveSettings: async () => ({
        key: 'site-settings',
        draftPayload: { companyName: 'Новое имя', internalFlags: { preview: true } },
        revision: 8,
      }),
      listMenus: async () => [{
        id: menuId,
        location: 'header',
        items: [{ label: 'О нас', href: '/about', analyticsTag: 'nav-about' }],
        revision: 5,
      }],
      saveMenu: async () => ({
        id: menuId,
        location: 'header',
        draftPayload: { items: [{ label: 'О компании', href: '/about' }], internalNotes: 'Do not publish' },
        revision: 6,
      }),
      savePublicationPolicy: async (_actor: unknown, input: { editorCanPublish: boolean }) => ({
        editorCanPublish: input.editorCanPublish,
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
      id: menuId,
      location: 'header',
      items: [{ label: 'О нас', href: '/about' }],
      revision: 5,
    })

    const menus = await app.request('/api/cms/menus', { headers: { 'x-role': 'editor' } })
    expect(menus.status).toBe(200)
    expect(await menus.json()).toEqual([{
      id: menuId,
      location: 'header',
      items: [{ label: 'О нас', href: '/about' }],
      revision: 5,
    }])

    const savedMenu = await app.request(`/api/cms/menus/${menuId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-role': 'owner' },
      body: JSON.stringify({ items: [{ label: 'О компании', href: '/about' }], expectedRevision: 5 }),
    })
    expect(savedMenu.status).toBe(200)
    expect(await savedMenu.json()).toEqual({
      id: menuId,
      location: 'header',
      items: [{ label: 'О компании', href: '/about' }],
      revision: 6,
    })

    const savedSettings = await app.request('/api/cms/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-role': 'owner' },
      body: JSON.stringify({ companyName: 'Новое имя', expectedRevision: 7 }),
    })
    expect(savedSettings.status).toBe(200)
    expect(await savedSettings.json()).toEqual({ companyName: 'Новое имя', revision: 8 })

    const policy = await app.request('/api/cms/publication/policy', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-role': 'owner' },
      body: JSON.stringify({ editorCanPublish: true }),
    })
    expect(policy.status).toBe(200)
    expect(await policy.json()).toEqual({ editorCanPublish: true })
  })

  test('retries a failed publication without accepting a revision or snapshot', async () => {
    const auth = createMiddleware<AuthHttpEnv>(async (c, next) => {
      c.set('user', {
        id: 'owner',
        role: 'owner',
        email: 'owner@example.com',
        displayName: null,
        createdAt: new Date().toISOString(),
        sessionId: 'session',
      })
      await next()
    })
    let calls = 0
    const service = {
      retryPublication: async () => {
        calls += 1
        return { retried: true as const }
      },
    } as unknown as CmsService
    const app = new Hono<AuthHttpEnv>()
    app.route('/api/cms', createCmsRoutes({
      requireAuth: auth,
      requireCmsAccess: createRequireAnyRole('editor', 'owner'),
      service,
      preview: {} as CmsPreviewService,
    }))
    app.onError(handleError)

    const response = await app.request('/api/cms/publication/retry', { method: 'POST' })

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ retried: true })
    expect(calls).toBe(1)
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

  test('rejects a site package selector in a page save request', async () => {
    const auth = createMiddleware<AuthHttpEnv>(async (c, next) => {
      c.set('user', { id: 'editor', role: 'editor', email: 'editor@example.com', displayName: null, createdAt: new Date().toISOString(), sessionId: 'session' })
      await next()
    })
    const service = { savePage: async () => ({ id: pageId, title: 'Страница', path: '/', draftPayload: {}, revision: 2 }) } as unknown as CmsService
    const app = new Hono<AuthHttpEnv>()
    app.route('/api/cms', createCmsRoutes({ requireAuth: auth, requireCmsAccess: auth, service, preview: {} as CmsPreviewService }))
    app.onError(handleError)

    const response = await app.request(`/api/cms/pages/${pageId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Страница',
        path: '/',
        blocks: [{ id: 'hero', type: 'hero', data: { title: 'Титул', text: 'Текст', primaryAction: { label: 'Далее', href: '/about' } } }],
        expectedRevision: 1,
        sitePackageId: 'other-package',
      }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
  })

  test('never returns approval or publication snapshots from mutation responses', async () => {
    const auth = createMiddleware<AuthHttpEnv>(async (c, next) => {
      c.set('user', { id: 'owner', role: 'owner', email: 'owner@example.com', displayName: null, createdAt: new Date().toISOString(), sessionId: 'session' })
      await next()
    })
    const service = {
      submitForApproval: async () => ({ id: pageId, status: 'pending', requesterUserId: pageId, candidateSnapshot: { secret: 'private' } }),
      approve: async () => ({ id: pageId, revision: 3, snapshot: { secret: 'private' } }),
      reject: async () => ({ id: pageId, status: 'rejected', requesterUserId: pageId, decisionNote: 'Не подходит', candidateSnapshot: { secret: 'private' } }),
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
    expect(submitted).toEqual({ id: pageId, status: 'pending', requesterUserId: pageId, decisionNote: null })
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
    expect(rejection).toEqual({ id: pageId, status: 'rejected', requesterUserId: pageId, decisionNote: 'Не подходит' })

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

  test('maps a stale expected revision to 409 and returns the current revision', async () => {
    const auth = createMiddleware<AuthHttpEnv>(async (c, next) => {
      c.set('user', {
        id: 'editor',
        role: 'editor',
        email: 'editor@example.com',
        displayName: null,
        createdAt: new Date().toISOString(),
        sessionId: 'session',
      })
      await next()
    })
    const service = {
      savePage: async () => {
        // Thrown by the repository's optimistic CAS; the transport must map it and carry
        // the surviving revision so the editor can rebase instead of guessing.
        throw new CmsConflictError(pageId, 7)
      },
    } as unknown as CmsService
    const routes = createCmsRoutes({ requireAuth: auth, requireCmsAccess: auth, service, preview: {} as CmsPreviewService })
    const app = new Hono<AuthHttpEnv>()
    app.route('/api/cms', routes)
    app.onError(handleError)

    const response = await app.request(`/api/cms/pages/${pageId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Главная',
        path: '/',
        blocks: [
          {
            id: 'hero',
            type: 'hero',
            data: {
              title: 'Добро пожаловать',
              text: 'Описание компании',
              primaryAction: { label: 'Подробнее', href: '/about' },
            },
          },
        ],
        expectedRevision: 6,
      }),
    })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.code).toBe('CMS_CONFLICT')
    expect(body.error.details).toEqual({ currentRevision: 7 })
  })

  test('rate limits CMS mutations per user without charging CMS reads', async () => {
    const auth = createMiddleware<AuthHttpEnv>(async (c, next) => {
      c.set('user', {
        id: 'editor',
        role: 'editor',
        email: 'editor@example.com',
        displayName: null,
        createdAt: new Date().toISOString(),
        sessionId: 'session',
      })
      await next()
    })
    const service = {
      listPages: async () => [],
      savePage: async () => ({ id: pageId, title: 'Главная', path: '/' }),
    } as unknown as CmsService
    const mutationRateLimit = createFixedWindowRateLimit<AuthHttpEnv>({
      errorMessage: 'Too many CMS mutations',
      key: (c) => c.var.user?.id ?? 'anonymous',
      max: 2,
      windowSeconds: 60,
    })
    const routes = createCmsRoutes({
      requireAuth: auth,
      requireCmsAccess: auth,
      mutationRateLimit,
      service,
      preview: {} as CmsPreviewService,
    })
    const app = new Hono()
    app.route('/api/cms', routes)
    const saveDraft = () => app.request(`/api/cms/pages/${pageId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Главная',
        path: '/',
        blocks: [
          {
            id: 'hero',
            type: 'hero',
            data: {
              title: 'Добро пожаловать',
              text: 'Описание компании',
              primaryAction: { label: 'Подробнее', href: '/about' },
            },
          },
        ],
        expectedRevision: 1,
      }),
    })

    expect((await app.request('/api/cms/pages')).status).toBe(200)
    expect((await app.request('/api/cms/pages')).status).toBe(200)
    expect((await saveDraft()).status).toBe(200)
    expect((await saveDraft()).status).toBe(200)
    const limited = await saveDraft()
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()
  })

  test('maps a stale approval decision to 409 with CMS_APPROVAL_STALE', async () => {
    const auth = createMiddleware<AuthHttpEnv>(async (c, next) => {
      c.set('user', {
        id: 'owner',
        role: 'owner',
        email: 'owner@example.com',
        displayName: null,
        createdAt: new Date().toISOString(),
        sessionId: 'session',
      })
      await next()
    })
    const service = {
      approve: async () => {
        throw new CmsRepositoryError('Approval is no longer pending', 'CMS_APPROVAL_STALE')
      },
    } as unknown as CmsService
    const routes = createCmsRoutes({ requireAuth: auth, requireCmsAccess: auth, service, preview: {} as CmsPreviewService })
    const app = new Hono<AuthHttpEnv>()
    app.route('/api/cms', routes)
    app.onError(handleError)

    const response = await app.request('/api/cms/approvals/018f8c8d-5f34-7db2-8b98-2c7bf3d80a11/approve', { method: 'POST' })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.code).toBe('CMS_APPROVAL_STALE')
  })

  test('reject passes the trimmed note through and validates it before the service', async () => {
    const auth = createMiddleware<AuthHttpEnv>(async (c, next) => {
      const role = c.req.header('x-role') === 'owner' ? 'owner' : 'editor'
      c.set('user', {
        id: role,
        role,
        email: 'owner@example.com',
        displayName: null,
        createdAt: new Date().toISOString(),
        sessionId: 'session',
      })
      await next()
    })
    let rejectedWith: { id: string; note: string } | undefined
    const service = {
      reject: async (_actor: unknown, id: string, note: string) => {
        rejectedWith = { id, note }
        return { id, status: 'rejected', requesterUserId: 'editor', decisionNote: note }
      },
    } as unknown as CmsService
    const routes = createCmsRoutes({ requireAuth: auth, requireCmsAccess: auth, service, preview: {} as CmsPreviewService })
    const app = new Hono<AuthHttpEnv>()
    app.route('/api/cms', routes)
    app.onError(handleError)

    const rejected = await app.request('/api/cms/approvals/018f8c8d-5f34-7db2-8b98-2c7bf3d80a11/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-role': 'owner' },
      body: JSON.stringify({ note: '  Переделать заголовок  ' }),
    })
    expect(rejected.status).toBe(200)
    expect(rejectedWith).toEqual({ id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a11', note: 'Переделать заголовок' })
    expect(await rejected.json()).toEqual({
      id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a11',
      status: 'rejected',
      requesterUserId: 'editor',
      decisionNote: 'Переделать заголовок',
    })

    // An empty note never reaches the service. (Role gating of decisions is the service's
    // cms:approve capability, covered in the service suite.)
    const empty = await app.request('/api/cms/approvals/018f8c8d-5f34-7db2-8b98-2c7bf3d80a11/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-role': 'owner' },
      body: JSON.stringify({ note: '   ' }),
    })
    expect(empty.status).toBe(400)
    expect(rejectedWith).toEqual({ id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a11', note: 'Переделать заголовок' })
  })
})
