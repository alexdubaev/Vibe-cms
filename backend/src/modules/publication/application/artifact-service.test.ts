import { describe, expect, test } from 'bun:test'

import { PublicationArtifactService, type PublicationArtifactRepository } from './artifact-service'

const publication = {
  revision: 4,
  generatedAt: '2026-08-24T10:00:00.000Z',
  settings: { companyName: 'Vibe CMS' },
  pages: [{
    id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10',
    title: 'Главная',
    path: '/',
    blocks: [{
      id: 'hero',
      type: 'hero' as const,
      data: {
        title: 'Главная',
        text: 'Текст',
        primaryAction: { label: 'Контакты', href: '/contacts' },
      },
    }],
  }],
  collections: [],
  menus: [],
  redirects: [],
  media: [],
}

function createRepository(overrides: Partial<PublicationArtifactRepository> = {}) {
  const state: {
    artifactState: 'missing' | 'uploading' | 'ready'
    artifactObjectKey: string | null
    artifactEtag: string | null
  } = { artifactState: 'missing', artifactObjectKey: null, artifactEtag: null }
  const repository: PublicationArtifactRepository = {
    getPublication: async () => ({ revision: 4, snapshot: publication, ...state }),
    claimArtifact: async (revision, objectKey) => {
      if (state.artifactState === 'ready') return { kind: 'ready', objectKey: state.artifactObjectKey!, etag: state.artifactEtag! }
      if (state.artifactState === 'uploading') return { kind: 'busy' }
      state.artifactState = 'uploading'
      state.artifactObjectKey = objectKey
      return { kind: 'claimed' }
    },
    markArtifactReady: async (_revision, input) => {
      state.artifactState = 'ready'
      state.artifactObjectKey = input.objectKey
      state.artifactEtag = input.etag
    },
    resetArtifact: async () => {
      state.artifactState = 'missing'
    },
    ...overrides,
  }
  return { repository, state }
}

describe('publication artifact service', () => {
  test('validates and stores an immutable snapshot artifact once', async () => {
    const { repository } = createRepository()
    const writes: unknown[] = []
    const service = new PublicationArtifactService(repository, {
      putObjectOnce: async (key, body, contentType) => {
        writes.push({ key, body: new TextDecoder().decode(body), contentType })
        return { stored: true, etag: 'etag-4' }
      },
      headObject: async () => null,
      createDownloadUrl: async ({ key, expiresInSeconds }) => ({ key, url: `https://storage.test/${key}`, expiresAt: new Date(1_724_488_800_000 + (expiresInSeconds ?? 300) * 1_000).toISOString() }),
    })

    await expect(service.ensureArtifact(4)).resolves.toEqual({
      revision: 4,
      objectKey: 'cms-publications/4/snapshot.json',
      etag: 'etag-4',
    })
    expect(writes).toEqual([{
      key: 'cms-publications/4/snapshot.json',
      body: JSON.stringify(publication),
      contentType: 'application/json',
    }])
  })

  test('returns an existing ready artifact without touching storage', async () => {
    const { repository } = createRepository()
    let writes = 0
    const service = new PublicationArtifactService(repository, {
      putObjectOnce: async () => { writes += 1; return { stored: true, etag: 'new' } },
      headObject: async () => null,
      createDownloadUrl: async ({ key }) => ({ key, url: `https://storage.test/${key}`, expiresAt: '2026-08-24T10:05:00.000Z' }),
    })
    await repository.markArtifactReady(4, { objectKey: 'cms-publications/4/snapshot.json', etag: 'old' })

    await expect(service.ensureArtifact(4)).resolves.toMatchObject({ etag: 'old' })
    expect(writes).toBe(0)
  })

  test('recovers the ETag when another worker won the write-once race', async () => {
    const { repository } = createRepository()
    const service = new PublicationArtifactService(repository, {
      putObjectOnce: async () => ({ stored: false, reason: 'already_exists' }),
      headObject: async () => ({ key: 'cms-publications/4/snapshot.json', contentLength: new TextEncoder().encode(JSON.stringify(publication)).byteLength, contentType: 'application/json', etag: 'winner-etag' }),
      createDownloadUrl: async ({ key }) => ({ key, url: `https://storage.test/${key}`, expiresAt: '2026-08-24T10:05:00.000Z' }),
    })

    await expect(service.ensureArtifact(4)).resolves.toMatchObject({ etag: 'winner-etag' })
  })

  test('resets an uploading row when storage fails so reconciliation can retry', async () => {
    const { repository, state } = createRepository()
    const service = new PublicationArtifactService(repository, {
      putObjectOnce: async () => { throw new Error('storage unavailable') },
      headObject: async () => null,
      createDownloadUrl: async ({ key }) => ({ key, url: `https://storage.test/${key}`, expiresAt: '2026-08-24T10:05:00.000Z' }),
    })

    await expect(service.ensureArtifact(4)).rejects.toThrow('storage unavailable')
    expect(state.artifactState).toBe('missing')
  })

  test('returns a short-lived signed read URL only for a ready artifact', async () => {
    const { repository } = createRepository()
    const service = new PublicationArtifactService(repository, {
      putObjectOnce: async () => ({ stored: true, etag: 'etag-4' }),
      headObject: async () => null,
      createDownloadUrl: async ({ key, expiresInSeconds }) => ({ key, url: `https://storage.test/${key}`, expiresAt: `${expiresInSeconds}s` }),
    })

    await service.ensureArtifact(4)
    await expect(service.createArtifactDownload(4, 120)).resolves.toEqual({
      revision: 4,
      url: 'https://storage.test/cms-publications/4/snapshot.json',
      expiresAt: '120s',
      etag: 'etag-4',
    })
  })
})
