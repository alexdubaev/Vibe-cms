import { describe, expect, test } from 'bun:test'

import { createBuilderBackendClient } from '../src/backend-client'

const buildId = '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10'

describe('builder backend client', () => {
  test('sends signed commands without private object keys', async () => {
    const calls: Request[] = []
    const client = createBuilderBackendClient({
      baseUrl: 'https://api.example.test/api/internal/cms',
      hmacSecret: 'secret-secret-secret-secret-secret-secret',
      now: () => new Date('2026-08-24T10:00:00.000Z'),
      nonce: () => 'nonce-00000000000001',
      fetchImpl: async (input, init) => {
        calls.push(new Request(input, init))
        return new Response(JSON.stringify({
          buildId,
        publicationRevision: 4,
        slot: 'green',
        snapshotArtifact: { url: 'https://storage.example.test/snapshot', expiresAt: '2026-08-24T10:05:00.000Z', etag: 'etag-4' },
        media: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
      },
    })

    await client.getBuildInput(buildId)
    expect(calls[0]?.headers.get('x-cms-builder-signature')).toMatch(/^[a-f0-9]{64}$/)
    expect(await calls[0]?.text()).toBe('{}')
    expect(JSON.stringify(calls[0])).not.toContain('objectKey')
  })
})
