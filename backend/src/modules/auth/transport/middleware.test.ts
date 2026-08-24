import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { handleError } from '../../../http/errors'
import { AuthFailure } from '../domain/errors'
import { createRequireAnyRole, createRequireAuth, type AuthHttpEnv } from './middleware'

describe('requireAuth middleware', () => {
  test('rejects missing and invalid bearer tokens, and lets a valid one through', async () => {
    const app = createProtectedTestApp()

    const missing = await app.request('/protected')
    expect(missing.status).toBe(401)

    const invalid = await app.request('/protected', {
      headers: { Authorization: 'Bearer invalid-token' },
    })
    expect(invalid.status).toBe(401)

    // The contrast that stops the two assertions above passing on a middleware that rejects
    // everything. What the handler then reads out of the context is a type, not a runtime rule.
    const valid = await app.request('/protected', {
      headers: { Authorization: 'Bearer valid-token' },
    })
    expect(valid.status).toBe(200)
  })

  test('allows CMS roles while rejecting regular users', async () => {
    const app = new Hono<AuthHttpEnv>()
    app.use('*', async (c, next) => {
      c.set('user', {
        id: 'user-1',
        email: 'user@example.com',
        displayName: null,
        role: c.req.header('x-role') === 'owner' ? 'owner' : 'user',
        createdAt: '2026-01-01T00:00:00.000Z',
        sessionId: 'session-1',
      })
      await next()
    })
    app.use('*', createRequireAnyRole('editor', 'owner'))
    app.get('/protected', (c) => c.text('ok'))
    app.onError(handleError)

    expect((await app.request('/protected')).status).toBe(403)
    expect((await app.request('/protected', { headers: { 'x-role': 'owner' } })).status).toBe(200)
  })
})

function createProtectedTestApp() {
  const app = new Hono<AuthHttpEnv>()
  const requireAuth = createRequireAuth(async (accessToken) => {
    if (accessToken !== 'valid-token') {
      throw new AuthFailure('access_token_invalid', 'Access token is invalid or expired')
    }

    return {
      id: 'user-1',
      email: 'user@example.com',
      displayName: null,
      role: 'user',
      createdAt: '2026-01-01T00:00:00.000Z',
      sessionId: 'session-1',
    }
  })

  app.use('*', requireAuth)
  app.get('/protected', (c) => {
    const user = c.var.user
    return c.json({
      email: user.email,
      sessionId: user.sessionId,
      userId: user.id,
    })
  })
  app.onError(handleError)

  return app
}
