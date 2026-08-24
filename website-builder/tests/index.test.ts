import { describe, expect, test } from 'bun:test'

import { createBuilderWorker } from '../src'
import type { PublicationSnapshot } from '@web-app-demo/contracts'

const buildId = '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10'
const snapshot = {
  revision: 4,
  generatedAt: '2026-08-24T10:00:00.000Z',
  settings: { companyName: 'Vibe' },
  pages: [{ id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a11', title: 'Home', path: '/', blocks: [{ type: 'hero', data: { title: 'Hello', body: 'World' } }] }],
  collections: [],
  menus: [],
  redirects: [],
  media: [],
} as unknown as PublicationSnapshot

describe('builder worker', () => {
  test('processes a build sequentially and sends a verified terminal result', async () => {
    const calls: string[] = []
    const worker = createBuilderWorker({
      backend: {
        getBuildInput: async () => ({ buildId, publicationRevision: 4, slot: 'green', snapshotArtifact: { url: 'https://storage.test/snapshot', expiresAt: '2026-08-24T10:05:00.000Z', etag: 'etag-4' }, media: [] }),
        heartbeat: async () => { calls.push('heartbeat') },
        result: async (_id, result) => { calls.push(result.status) },
      },
      downloadSnapshot: async () => snapshot,
      buildSite: async () => { calls.push('build'); return { outputDirectory: '/tmp/site', marker: 'vibe-publication:4', publicationRevision: 4 } },
    })

    await worker.processTrigger({ messages: [{ body: JSON.stringify({ buildId }) }] })
    expect(calls).toEqual(['heartbeat', 'build', 'succeeded'])
  })

  test('reports a failed build after snapshot or Astro errors', async () => {
    const results: unknown[] = []
    const worker = createBuilderWorker({
      backend: {
        getBuildInput: async () => ({ buildId, publicationRevision: 4, slot: 'green', snapshotArtifact: { url: 'https://storage.test/snapshot', expiresAt: '2026-08-24T10:05:00.000Z', etag: 'etag-4' }, media: [] }),
        heartbeat: async () => undefined,
        result: async (_id, result) => { results.push(result) },
      },
      downloadSnapshot: async () => { throw new Error('Astro failed') },
      buildSite: async () => { throw new Error('unreachable') },
    })

    await expect(worker.processBuild(buildId)).rejects.toThrow('Astro failed')
    expect(results).toEqual([{ status: 'failed', markerVerified: false, diagnostics: 'Astro failed' }])
  })

  test('does not report success until the release adapter verifies the public marker', async () => {
    const results: unknown[] = []
    const worker = createBuilderWorker({
      backend: {
        getBuildInput: async () => ({ buildId, publicationRevision: 4, slot: 'green', snapshotArtifact: { url: 'https://storage.test/snapshot', expiresAt: '2026-08-24T10:05:00.000Z', etag: 'etag-4' }, media: [] }),
        heartbeat: async () => undefined,
        result: async (_id, result) => { results.push(result) },
      },
      downloadSnapshot: async () => snapshot,
      buildSite: async () => ({ outputDirectory: '/tmp/site', marker: 'vibe-publication:4', publicationRevision: 4 }),
      publishRelease: async () => ({ markerVerified: false }),
    })

    await expect(worker.processBuild(buildId)).rejects.toThrow('not verified')
    expect(results).toEqual([{ status: 'failed', markerVerified: false, diagnostics: 'Publication marker was not verified after release' }])
  })
})
