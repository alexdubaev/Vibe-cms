import { describe, expect, test } from 'bun:test'
import { OpenAPIHono } from '@hono/zod-openapi'

import { handleError } from '../../../http/errors'
import {
  createBuilderRequestVerifier,
  signBuilderRequest,
  type BuilderRequest,
} from '../application/build-request-auth'
import type { PublicationCallbackRepository } from '../application/rebuild-controller'
import type { PublicationArtifactService } from '../application/artifact-service'
import type { PublicationMediaCopyInputService } from '../application/media-copy-input'
import { createPublicationInternalRoutes } from './internal-routes'

const buildId = '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10'
const timestamp = 1_724_488_800

class MemoryNonceStore {
  private readonly used = new Set<string>()

  async reserve(input: { nonce: string; buildId: string }) {
    const key = `${input.nonce}:${input.buildId}`
    if (this.used.has(key)) return false
    this.used.add(key)
    return true
  }
}

function createTestApp(
  repository: Pick<PublicationCallbackRepository, 'heartbeat' | 'recordResult'> & Partial<Pick<PublicationCallbackRepository, 'getBuildForInput'>> = {
  heartbeat: async () => true,
  recordResult: async () => 'accepted',
}, artifact?: Pick<PublicationArtifactService, 'ensureArtifact' | 'createArtifactDownload'>, media?: Pick<PublicationMediaCopyInputService, 'createForBuild'>) {
  const app = new OpenAPIHono()
  const verifier = createBuilderRequestVerifier({
    activeSecret: 'builder-secret',
    nonceStore: new MemoryNonceStore(),
    now: () => new Date(timestamp * 1_000),
  })
  app.route('/api/internal/cms', createPublicationInternalRoutes({ repository, verifier, artifact, media, now: () => new Date(timestamp * 1_000) }))
  app.onError(handleError)
  return app
}

async function signedRequest(path: string, body: string, nonce: string, init: { method?: string } = {}) {
  const request: BuilderRequest = {
    method: init.method ?? 'POST',
    path,
    timestamp,
    nonce,
    buildId,
    body,
  }
  return new Request(`http://localhost${path}`, {
    method: request.method,
    headers: {
      'content-type': 'application/json',
      'x-cms-builder-timestamp': String(timestamp),
      'x-cms-builder-nonce': nonce,
      'x-cms-builder-signature': signBuilderRequest('builder-secret', request),
    },
    body,
  })
}

describe('publication internal builder routes', () => {
  test('accepts a signed heartbeat and result callback', async () => {
    const calls: unknown[] = []
    const app = createTestApp({
      heartbeat: async (...input) => { calls.push(input); return true },
      recordResult: async (input) => { calls.push(input); return 'accepted' },
    })

    const heartbeat = await app.fetch(await signedRequest(`/api/internal/cms/builds/${buildId}/heartbeat`, '{}', 'nonce-0000000001'))
    const result = await app.fetch(await signedRequest(`/api/internal/cms/builds/${buildId}/result`, '{"status":"succeeded","markerVerified":true}', 'nonce-0000000002'))

    expect(heartbeat.status).toBe(202)
    expect(result.status).toBe(202)
    expect(calls).toHaveLength(2)
  })

  test('rejects a body tamper and replays before reaching the repository', async () => {
    let calls = 0
    const app = createTestApp({
      heartbeat: async () => { calls += 1; return true },
      recordResult: async () => { calls += 1; return 'accepted' },
    })
    const signed = await signedRequest(`/api/internal/cms/builds/${buildId}/heartbeat`, '{}', 'nonce-0000000003')
    const tampered = new Request(signed, { body: '{"changed":true}' })

    expect((await app.fetch(tampered)).status).toBe(401)
    expect((await app.fetch(await signedRequest(`/api/internal/cms/builds/${buildId}/heartbeat`, '{}', 'nonce-0000000003'))).status).toBe(202)
    expect((await app.fetch(await signedRequest(`/api/internal/cms/builds/${buildId}/heartbeat`, '{}', 'nonce-0000000003'))).status).toBe(409)
    expect(calls).toBe(1)
  })

  test('returns a conflict when the callback belongs to a stale build', async () => {
    const app = createTestApp({
      heartbeat: async () => false,
      recordResult: async () => 'stale',
    })

    const response = await app.fetch(await signedRequest(`/api/internal/cms/builds/${buildId}/result`, '{"status":"failed","markerVerified":false}', 'nonce-0000000004'))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'CONFLICT' } })
  })

  test('returns a signed artifact URL for an active build without exposing its object key', async () => {
    const app = createTestApp({
      heartbeat: async () => true,
      recordResult: async () => 'accepted',
      getBuildForInput: async () => ({ id: buildId, publicationRevision: 4, slot: 'green', state: 'queued' }),
    }, {
      ensureArtifact: async () => ({ revision: 4, objectKey: 'cms-publications/4/snapshot.json', etag: 'etag-4' }),
      createArtifactDownload: async () => ({ revision: 4, url: 'https://storage.test/snapshot', expiresAt: '2026-08-24T10:05:00.000Z', etag: 'etag-4' }),
    })

    const response = await app.fetch(await signedRequest(`/api/internal/cms/builds/${buildId}/input`, '{}', 'nonce-0000000005'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      buildId,
      publicationRevision: 4,
      slot: 'green',
      snapshotArtifact: { url: 'https://storage.test/snapshot', expiresAt: '2026-08-24T10:05:00.000Z', etag: 'etag-4' },
      media: [],
    })
    expect(JSON.stringify(payload)).not.toContain('objectKey')
  })

  test('returns only signed media URLs and safe slot destinations in builder input', async () => {
    const app = createTestApp({
      heartbeat: async () => true,
      recordResult: async () => 'accepted',
      getBuildForInput: async () => ({ id: buildId, publicationRevision: 4, slot: 'green', state: 'queued' }),
    }, {
      ensureArtifact: async () => ({ revision: 4, objectKey: 'cms-publications/4/snapshot.json', etag: 'etag-4' }),
      createArtifactDownload: async () => ({ revision: 4, url: 'https://storage.test/snapshot', expiresAt: '2026-08-24T10:05:00.000Z', etag: 'etag-4' }),
    }, {
      createForBuild: async () => [{
        sourceUrl: 'https://private.example/signed-hero',
        destinationPath: '/green/media/018f8c8d-5f34-7db2-8b98-2c7bf3d80a10/018f8c8d-5f34-7db2-8b98-2c7bf3d80a11/hero.png',
        contentType: 'image/png',
      }],
    })

    const response = await app.fetch(await signedRequest(`/api/internal/cms/builds/${buildId}/input`, '{}', 'nonce-0000000006'))
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.media).toEqual([{
      sourceUrl: 'https://private.example/signed-hero',
      destinationPath: '/green/media/018f8c8d-5f34-7db2-8b98-2c7bf3d80a10/018f8c8d-5f34-7db2-8b98-2c7bf3d80a11/hero.png',
      contentType: 'image/png',
    }])
    expect(JSON.stringify(payload)).not.toContain('objectKey')
  })
})
