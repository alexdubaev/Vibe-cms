import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CmsSitePackageDescriptor } from '@web-app-demo/contracts'

import { createBuilderWorker } from '../src'
import { createAstroSiteRunner, createSnapshotDownloader } from '../src/build-site'

const temporaryRoots: string[] = []

const customerA = {
  id: 'customer-a',
  version: '1.0.0',
  schemaVersion: 1,
} satisfies CmsSitePackageDescriptor

const snapshot = {
  revision: 4,
  generatedAt: '2026-08-24T10:00:00.000Z',
  sitePackage: customerA,
  settings: { companyName: 'Vibe' },
  pages: [{
    id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a11',
    title: 'Home',
    path: '/',
    blocks: [{
      id: 'hero-home',
      type: 'hero',
      data: { title: 'Hello', text: 'World', primaryAction: { label: 'More', href: '/about' } },
    }],
  }],
  collections: [],
  menus: [],
  redirects: [],
  media: [],
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('selected Site Package validation', () => {
  test('rejects a snapshot package mismatch before creating artifacts or spawning Astro', async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'vibe-builder-package-mismatch-'))
    temporaryRoots.push(tempDirectory)
    const run = mock(async () => undefined)
    const buildSite = createAstroSiteRunner({
      descriptor: customerA,
      publicWebsiteUrl: 'https://site.example',
      run,
      tempDirectory,
      websiteDirectory: '/app/website',
    })

    await expect(buildSite({
      buildId: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10',
      publicationRevision: 4,
      slot: 'green',
      snapshot: {
        ...snapshot,
        sitePackage: { id: 'customer-b', version: '1.0.0', schemaVersion: 1 },
      },
    })).rejects.toThrow('Snapshot Site Package customer-b@1.0.0 does not match builder customer-a@1.0.0')

    expect(run).not.toHaveBeenCalled()
    expect(await readdir(tempDirectory)).toEqual([])
  })

  test('rejects a future snapshot schema version before creating artifacts or spawning Astro', async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'vibe-builder-package-schema-'))
    temporaryRoots.push(tempDirectory)
    const run = mock(async () => undefined)
    const buildSite = createAstroSiteRunner({
      descriptor: customerA,
      publicWebsiteUrl: 'https://site.example',
      run,
      tempDirectory,
      websiteDirectory: '/app/website',
    })

    await expect(buildSite({
      buildId: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10',
      publicationRevision: 4,
      slot: 'green',
      snapshot: { ...snapshot, sitePackage: { ...customerA, schemaVersion: 2 } },
    })).rejects.toThrow('Snapshot Site Package customer-a@1.0.0 does not match builder customer-a@1.0.0')

    expect(run).not.toHaveBeenCalled()
    expect(await readdir(tempDirectory)).toEqual([])
  })
})

describe('createSnapshotDownloader', () => {
  test('accepts package-bearing snapshots validated by the build-selected publication schema', async () => {
    const selectedSnapshot = {
      ...snapshot,
      sitePackage: { id: 'vibe-core', version: '1.0.0', schemaVersion: 1 },
    }
    const response = Response.json(selectedSnapshot, { headers: { etag: 'snapshot-etag' } })
    const downloadSnapshot = createSnapshotDownloader({ fetchImpl: async () => response })

    const downloaded = await downloadSnapshot({
      url: 'https://storage.example/snapshot.json',
      expiresAt: '2026-08-24T10:05:00.000Z',
      etag: 'snapshot-etag',
    })

    expect(downloaded.sitePackage).toEqual({ id: 'vibe-core', version: '1.0.0', schemaVersion: 1 })
  })

  test('parses downloaded JSON with the build-selected publication schema', async () => {
    const response = Response.json({
      ...snapshot,
      sitePackage: { id: 'vibe-core', version: '1.0.0', schemaVersion: 1 },
      pages: [{
        ...snapshot.pages[0],
        blocks: [{ id: 'unknown-home', type: 'customer-only-block', data: {} }],
      }],
    }, { headers: { etag: 'snapshot-etag' } })
    const downloadSnapshot = createSnapshotDownloader({ fetchImpl: async () => response })

    await expect(downloadSnapshot({
      url: 'https://storage.example/snapshot.json',
      expiresAt: '2026-08-24T10:05:00.000Z',
      etag: 'snapshot-etag',
    })).rejects.toThrow()
  })
})

describe('locked Astro build failure safety', () => {
  test('removes its temporary workspace when Astro fails before returning a result', async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'vibe-builder-cleanup-failure-'))
    temporaryRoots.push(tempDirectory)
    const buildSite = createAstroSiteRunner({
      descriptor: customerA,
      publicWebsiteUrl: 'https://site.example',
      websiteDirectory: '/app/website',
      tempDirectory,
      run: async () => { throw new Error('Astro failed') },
    })

    await expect(buildSite({
      buildId: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10',
      publicationRevision: 4,
      slot: 'green',
      snapshot,
    })).rejects.toThrow('Astro failed')

    expect(await readdir(tempDirectory)).toEqual([])
  })

  test('reports a lock timeout without publishing over the prior live release', async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'vibe-builder-lock-timeout-'))
    temporaryRoots.push(tempDirectory)
    const results: unknown[] = []
    let liveRelease = 'blue:3'
    const buildSite = createAstroSiteRunner({
      descriptor: customerA,
      publicWebsiteUrl: 'https://site.example',
      websiteDirectory: '/app/website',
      tempDirectory,
      run: async () => { throw new Error('Astro build lock timed out after 600 seconds') },
    })
    const worker = createBuilderWorker({
      backend: {
        getBuildInput: async () => ({
          buildId: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10',
          publicationRevision: 4,
          slot: 'green',
          snapshotArtifact: {
            url: 'https://storage.example/snapshot',
            expiresAt: '2026-08-24T10:05:00.000Z',
            etag: 'etag-4',
          },
          media: [],
        }),
        heartbeat: async () => undefined,
        result: async (_buildId, result) => { results.push(result) },
      },
      downloadSnapshot: async () => snapshot,
      buildSite,
      publishRelease: async () => {
        liveRelease = 'green:4'
        return { markerVerified: true }
      },
    })

    await expect(worker.processBuild('018f8c8d-5f34-7db2-8b98-2c7bf3d80a10'))
      .rejects.toThrow('Astro build lock timed out after 600 seconds')
    expect(results).toEqual([{
      status: 'failed',
      markerVerified: false,
      diagnostics: 'Astro build lock timed out after 600 seconds',
    }])
    expect(liveRelease).toBe('blue:3')
  })
})
