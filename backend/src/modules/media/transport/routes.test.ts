import { describe, expect, test } from 'bun:test'
import type { MiddlewareHandler } from 'hono'

import type { AuthHttpEnv } from '../../auth'
import type { MediaService } from '../application/media-service'
import { createMediaRoutes } from './routes'

const user = {
  id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a20',
  email: 'media@example.com',
  displayName: 'Media editor',
  role: 'owner' as const,
  createdAt: '2026-08-25T00:00:00.000Z',
  sessionId: 'session-media-test',
}

describe('media transport routes', () => {
  test('authenticates before checking CMS access', async () => {
    const requireAuth: MiddlewareHandler<AuthHttpEnv> = async (context, next) => {
      context.set('user', user)
      await next()
    }
    const requireCmsAccess: MiddlewareHandler<AuthHttpEnv> = async (context, next) => {
      expect(context.var.user).toEqual(user)
      await next()
    }
    const service = {
      list: async (actor: typeof user) => {
        expect(actor).toEqual(user)
        return []
      },
    } as unknown as MediaService

    const response = await createMediaRoutes(requireAuth, requireCmsAccess, service).request('/')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
  })

  test('rejects unauthenticated and viewer-role requests before any service work', async () => {
    let serviceCalls = 0
    const service = {
      list: async () => { serviceCalls += 1; return { assets: [] } },
      createUpload: async () => { serviceCalls += 1; return {} },
      finalize: async () => { serviceCalls += 1; return {} },
      createImageDownload: async () => { serviceCalls += 1; return {} },
      updateAlt: async () => { serviceCalls += 1; return {} },
      remove: async () => { serviceCalls += 1; return {} },
    } as unknown as MediaService
    // Simulated requireAuth with the real contract: no session means 401, nothing set.
    const requireAuth: MiddlewareHandler<AuthHttpEnv> = async (context, next) => {
      const header = context.req.header('x-role')
      if (!header) return context.json({ error: { code: 'UNAUTHORIZED' } }, 401)
      context.set('user', { ...user, role: header as 'owner' })
      await next()
    }
    const requireCmsAccess: MiddlewareHandler<AuthHttpEnv> = async (context, next) => {
      // Media management is editor/owner only; plain users stop here.
      if (context.var.user.role === 'user') return context.json({ error: { code: 'FORBIDDEN' } }, 403)
      await next()
    }
    const routes = createMediaRoutes(requireAuth, requireCmsAccess, service)
    const assetId = '018f8c8d-5f34-7db2-8b98-2c7bf3d80a21'
    const requests: Array<[string, RequestInit?]> = [
      ['/', { method: 'GET' }],
      [`/${assetId}/download`, { method: 'GET' }],
      ['/uploads', { method: 'POST', body: '{}' }],
      [`/${assetId}/finalize`, { method: 'POST' }],
      [`/${assetId}`, { method: 'PATCH', body: '{}' }],
      [`/${assetId}`, { method: 'DELETE' }],
    ]

    for (const [path, init] of requests) {
      const unauthenticated = await routes.request(path, {
        ...init,
        headers: { 'content-type': 'application/json' },
      })
      expect(unauthenticated.status).toBe(401)
      expect((await unauthenticated.json()).error.code).toBe('UNAUTHORIZED')
    }
    for (const [path, init] of requests) {
      const viewer = await routes.request(path, {
        ...init,
        headers: { 'content-type': 'application/json', 'x-role': 'user' },
      })
      expect(viewer.status).toBe(403)
    }
    expect(serviceCalls).toBe(0)
  })
})
