import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { publishBuiltRelease } from '../src/release-pipeline'

describe('publication release pipeline', () => {
  test('copies snapshot media into the inactive slot before static release and promotion', async () => {
    const calls: string[] = []
    const outputDirectory = await mkdtemp(join(tmpdir(), 'vibe-release-pipeline-'))
    await writeFile(join(outputDirectory, 'index.html'), '<h1>Vibe</h1>')

    try {
      await publishBuiltRelease({
      build: {
        buildId: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10',
        publicationRevision: 4,
        slot: 'green',
        snapshotArtifact: {
          url: 'https://storage.example/snapshot',
          expiresAt: '2026-08-24T10:05:00.000Z',
          etag: 'etag-4',
        },
        media: [{
          sourceUrl: 'https://private.example/signed-hero',
          destinationPath: '/green/media/018f8c8d-5f34-7db2-8b98-2c7bf3d80a10/018f8c8d-5f34-7db2-8b98-2c7bf3d80a11/hero.png',
          contentType: 'image/png',
        }],
      },
      outputDirectory,
      copyMedia: {
        copyFromSignedUrl: async (input) => { calls.push(`media:${input.destinationPath}`) },
      },
      uploader: {
        deleteInactivePrefix: async (prefix) => { calls.push(`delete:${prefix}`) },
        putImmutable: async ({ key }) => { calls.push(`put:${key}`) },
      },
      promotion: {
        verifyInactiveMarker: async () => { calls.push('verify-inactive'); return true },
        switchActiveSlot: async () => { calls.push('select') },
        purgePublicPaths: async () => { calls.push('purge') },
        verifyPublicMarker: async () => { calls.push('verify-public'); return true },
      },
      })
    } finally {
      await rm(outputDirectory, { recursive: true, force: true })
    }

    expect(calls).toEqual([
      'delete:green/',
      'media:/green/media/018f8c8d-5f34-7db2-8b98-2c7bf3d80a10/018f8c8d-5f34-7db2-8b98-2c7bf3d80a11/hero.png',
      'put:green/index.html',
      'put:green/__publication_revision.txt',
      'verify-inactive',
      'select',
      'purge',
      'verify-public',
    ])
  })

  test('does not clear or promote the inactive slot when media copy fails', async () => {
    const calls: string[] = []
    const outputDirectory = await mkdtemp(join(tmpdir(), 'vibe-release-pipeline-'))
    await writeFile(join(outputDirectory, 'index.html'), '<h1>Vibe</h1>')

    try {
      await expect(publishBuiltRelease({
      build: {
        buildId: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10',
        publicationRevision: 4,
        slot: 'green',
        snapshotArtifact: {
          url: 'https://storage.example/snapshot',
          expiresAt: '2026-08-24T10:05:00.000Z',
          etag: 'etag-4',
        },
        media: [{
          sourceUrl: 'https://private.example/signed-hero',
          destinationPath: '/green/media/018f8c8d-5f34-7db2-8b98-2c7bf3d80a10/018f8c8d-5f34-7db2-8b98-2c7bf3d80a11/hero.png',
          contentType: 'image/png',
        }],
      },
      outputDirectory,
      copyMedia: {
        copyFromSignedUrl: async () => { throw new Error('signed media expired') },
      },
      uploader: {
        deleteInactivePrefix: async () => { calls.push('delete') },
        putImmutable: async () => { calls.push('put') },
      },
      promotion: {
        verifyInactiveMarker: async () => { calls.push('verify-inactive'); return true },
        switchActiveSlot: async () => { calls.push('select') },
        purgePublicPaths: async () => { calls.push('purge') },
        verifyPublicMarker: async () => { calls.push('verify-public'); return true },
      },
      })).rejects.toThrow('signed media expired')
    } finally {
      await rm(outputDirectory, { recursive: true, force: true })
    }

    expect(calls).toEqual(['delete'])
  })
})
