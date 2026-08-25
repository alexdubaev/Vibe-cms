import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  buildCmsCustomerExport,
  verifyCmsExportChecksum,
  writeCmsCustomerExport,
  type CmsExportSource,
} from './export-cms-data'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })))
})

function fixtureSource(): CmsExportSource {
  return {
    getSitePackage: async () => ({
      id: 'client-auto',
      version: '1.0.0',
      schemaVersion: 1,
      secret: 'package-secret',
    }),
    getSettings: async () => ({
      draftRevision: 3,
      draftPayload: {
        siteName: 'Автосервис',
        passwordHash: 'settings-password-hash',
        downloadUrl: 'https://objects.example/private?X-Amz-Credential=fake&X-Amz-Signature=fake-signature',
        href: 'http://storage.test/private/file?x-op=get&x-exp=1787650000&x-sig=fake-signature',
        accountUrl: 'https://app.example/reset#token=fake-reset-token',
        publicUrl: 'https://www.example/services?utm_source=cms#diagnostics',
        styleReferenceUrl: 'https://design.example/pattern?signature=diagonal',
      },
      installationId: 'other-customer',
    }),
    listPages: async () => [{
      id: 'page-1',
      path: '/',
      title: 'Главная',
      draftRevision: 2,
      draftPayload: {
        blocks: [{
          id: 'hero-1',
          type: 'hero',
          data: {
            title: 'Ремонт',
            refreshTokenHash: 'refresh-token-hash',
            sourceUrl: 'https://signed.example/private?token=abc',
            emailHash: 'email-hash',
            apiToken: 'api-token',
            signedDownloadUrl: 'https://signed.example/download',
            privateKey: 'private-key',
          },
        }],
      },
      objectKey: 'private/pages/page-1.json',
      customerId: 'other-customer',
    }],
    listCollections: async () => [{
      id: 'entry-1',
      type: 'service',
      draftRevision: 4,
      draftPayload: {
        title: 'Диагностика',
        resetToken: 'reset-token',
      },
      anotherInstallationId: 'other-customer',
    }],
    listMenus: async () => [{
      id: 'menu-1',
      location: 'header',
      draftRevision: 1,
      draftPayload: { items: [{ label: 'Главная', href: '/', secret: 'menu-secret' }] },
    }],
    listRedirects: async () => [{
      sourcePath: '/old',
      destinationPath: '/new',
      active: true,
      builderSecret: 'builder-secret',
    }],
    listMedia: async () => [{
      id: 'media-1',
      contentVersion: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a30',
      filename: 'service.jpg',
      contentType: 'image/jpeg',
      byteSize: 2048,
      width: 1200,
      height: 800,
      altText: 'Автомобиль',
      contentHash: 'a'.repeat(64),
      objectKey: 'private/client-auto/media-1',
      sourceUrl: 'https://signed.example/media-1',
      secretAccessKey: 'storage-secret',
    }],
  }
}

describe('CMS customer export', () => {
  test('exports only customer-owned content DTO fields and a public media manifest', async () => {
    const exported = await buildCmsCustomerExport(fixtureSource(), {
      generatedAt: new Date('2026-08-25T12:00:00.000Z'),
    })

    expect(verifyCmsExportChecksum(exported)).toBe(true)
    expect(exported.settings).toEqual({
      revision: 3,
      payload: {
        siteName: 'Автосервис',
        publicUrl: 'https://www.example/services?utm_source=cms#diagnostics',
        styleReferenceUrl: 'https://design.example/pattern?signature=diagonal',
      },
    })
    expect(exported).toMatchObject({
      formatVersion: 1,
      sitePackage: { id: 'client-auto', version: '1.0.0', schemaVersion: 1 },
      settings: { revision: 3, payload: { siteName: 'Автосервис' } },
      pages: [{ id: 'page-1', path: '/', title: 'Главная', revision: 2 }],
      collections: [{ id: 'entry-1', type: 'service', revision: 4 }],
      menus: [{ id: 'menu-1', location: 'header', revision: 1 }],
      redirects: [{ sourcePath: '/old', destinationPath: '/new' }],
      media: [{
        id: 'media-1',
        publicPath: '/media/media-1/018f8c8d-5f34-7db2-8b98-2c7bf3d80a30/service.jpg',
        contentHash: 'a'.repeat(64),
      }],
      metadata: {
        generatedAt: '2026-08-25T12:00:00.000Z',
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    })

    const serialized = JSON.stringify(exported)
    for (const forbidden of [
      'passwordHash',
      'refreshTokenHash',
      'resetToken',
      'emailHash',
      'apiToken',
      'signedDownloadUrl',
      'privateKey',
      'fake-signature',
      'fake-reset-token',
      'objectKey',
      'sourceUrl',
      'secret',
      'other-customer',
      'signed.example',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  test('writes an explicit mode-0600 file and refuses overwrite unless replace is set', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vibe-cms-export-test-'))
    temporaryDirectories.push(directory)
    const nested = join(directory, 'exports')
    await mkdir(nested)
    const outputPath = join(nested, 'client-auto.json')

    const first = await writeCmsCustomerExport({
      source: fixtureSource(),
      outputPath,
      generatedAt: new Date('2026-08-25T12:00:00.000Z'),
    })

    expect(first.outputPath).toBe(outputPath)
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(first.mode).toBe(0o600)
    if (process.platform !== 'win32') expect((await stat(outputPath)).mode & 0o777).toBe(0o600)
    await expect(writeCmsCustomerExport({ source: fixtureSource(), outputPath })).rejects.toThrow(
      'already exists; pass --replace to overwrite it',
    )

    await writeCmsCustomerExport({
      source: fixtureSource(),
      outputPath,
      replace: true,
      generatedAt: new Date('2026-08-25T12:05:00.000Z'),
    })
    const written = JSON.parse(await readFile(outputPath, 'utf8'))
    expect(written.metadata.generatedAt).toBe('2026-08-25T12:05:00.000Z')
    expect(verifyCmsExportChecksum(written)).toBe(true)
  })

  test('requires an explicit output file path', async () => {
    await expect(writeCmsCustomerExport({ source: fixtureSource(), outputPath: '' })).rejects.toThrow(
      'An explicit export output path is required',
    )
  })
})
