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
})
