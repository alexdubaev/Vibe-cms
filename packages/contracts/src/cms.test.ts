import { describe, expect, test } from 'bun:test'

import {
  CMS_CAPABILITIES,
  capabilitiesForRole,
  cmsConflictSchema,
  contentBlockSchema,
  contentPathSchema,
  collectionEntryCreateSchema,
  collectionEntryDraftSchema,
  mediaAssetSchema,
  pageDraftSchema,
  previewGrantResponseSchema,
  previewMediaResponseSchema,
  previewPageResponseSchema,
  publicationSnapshotSchema,
  structuredTextDocumentSchema,
} from './cms'

describe('CMS contracts', () => {
  test('keeps preview responses safe for a private server-to-server boundary', () => {
    const page = previewPageResponseSchema.parse({
      id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10',
      title: 'Черновик',
      path: '/draft',
      draftPayload: { title: 'Черновик', blocks: [] },
      draftRevision: 4,
      archived: false,
    })
    expect(page).not.toHaveProperty('objectKey')

    const media = previewMediaResponseSchema.parse({
      id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a11',
      mimeType: 'image/png',
      downloadUrl: 'https://storage.example.test/signed/object',
      expiresAt: '2026-08-24T10:01:00.000Z',
    })
    expect(media).not.toHaveProperty('objectKey')
    expect(() => previewMediaResponseSchema.parse({ ...media, objectKey: 'private' })).toThrow()
  })

  test('exposes the role capability matrix without granting editors publication by default', () => {
    expect(capabilitiesForRole('user', { editorCanPublish: true })).toEqual([])
    expect(capabilitiesForRole('editor', { editorCanPublish: false })).not.toContain('cms:publish')
    expect(capabilitiesForRole('editor', { editorCanPublish: true })).toContain('cms:publish')
    expect(capabilitiesForRole('owner', { editorCanPublish: false })).toContain('cms:publish')
    expect(CMS_CAPABILITIES).toContain('cms:approve')
  })

  test('normalizes safe page paths and rejects reserved or ambiguous paths', () => {
    expect(contentPathSchema.parse('  /Services//  ')).toBe('/services')
    expect(contentPathSchema.parse('/')).toBe('/')
    expect(() => contentPathSchema.parse('/api/users')).toThrow()
    expect(() => contentPathSchema.parse('/a/../b')).toThrow()
    expect(() => contentPathSchema.parse('/a%2Fb')).toThrow()
    expect(() => contentPathSchema.parse('/page?draft=true')).toThrow()
  })

  test('keeps structured text strict and bounded', () => {
    const document = structuredTextDocumentSchema.parse({
      type: 'document',
      blocks: [
        {
          type: 'paragraph',
          children: [{ type: 'text', text: 'Надёжный текст', marks: ['bold'] }],
        },
      ],
    })
    expect(document.blocks).toHaveLength(1)
    expect(() =>
      structuredTextDocumentSchema.parse({
        type: 'document',
        blocks: [
          {
            type: 'paragraph',
            children: [{ type: 'html', html: '<script>alert(1)</script>' }],
          },
        ],
      }),
    ).toThrow()
    expect(() =>
      structuredTextDocumentSchema.parse({
        type: 'document',
        blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'x'.repeat(2_001) }] }],
      }),
    ).toThrow()
  })

  test('validates every registered block through a discriminated union', () => {
    const valid = contentBlockSchema.parse({
      id: 'hero-1',
      type: 'hero',
      data: {
        title: 'Добро пожаловать',
        text: 'Короткое описание',
        primaryAction: { label: 'Подробнее', href: '/about' },
      },
    })
    expect(valid.type).toBe('hero')
    expect(() =>
      contentBlockSchema.parse({
        id: 'hero-1',
        type: 'hero',
        data: { title: 'x', unknownField: true },
      }),
    ).toThrow()
  })

  test('rejects public snapshot leakage and unsafe media metadata', () => {
    expect(
      publicationSnapshotSchema.safeParse({
        revision: 1,
        generatedAt: '2026-08-24T00:00:00.000Z',
        settings: { companyName: 'Demo' },
        pages: [],
        collections: [],
        menus: [],
        redirects: [],
        media: [],
      }).success,
    ).toBe(true)
    expect(
      publicationSnapshotSchema.safeParse({
        revision: 1,
        generatedAt: '2026-08-24T00:00:00.000Z',
        objectKey: 'private/raw/key',
        pages: [],
      }).success,
    ).toBe(false)
    expect(() =>
      mediaAssetSchema.parse({
        id: '019c0000-0000-7000-8000-000000000001',
        contentVersion: '019c0000-0000-7000-8000-000000000002',
        filename: 'logo.svg',
        mimeType: 'image/svg+xml',
        byteSize: 120,
        state: 'ready',
        alt: 'Логотип',
      }),
    ).toThrow()
  })

  test('requires optimistic revisions and typed preview/conflict responses', () => {
    expect(
      pageDraftSchema.parse({
        title: 'Главная',
        path: '/',
        blocks: [
          {
            id: 'hero-1',
            type: 'hero',
            data: {
              title: 'Главная',
              text: 'Описание',
              primaryAction: { label: 'Подробнее', href: '/about' },
            },
          },
        ],
        expectedRevision: 0,
      }).expectedRevision,
    ).toBe(0)
    expect(() => pageDraftSchema.parse({ title: 'x', path: '/', blocks: [] })).toThrow()
    expect(
      cmsConflictSchema.parse({
        code: 'CMS_CONFLICT',
        message: 'Черновик изменился',
        currentRevision: 2,
      }).currentRevision,
    ).toBe(2)
    expect(
      previewGrantResponseSchema.parse({
        token: 'a'.repeat(43),
        expiresAt: '2026-08-24T00:10:00.000Z',
        previewUrl: 'https://preview.example.com/__preview/abc',
      }).previewUrl,
    ).toContain('/__preview/')
  })

  test('separates collection creation input from optimistic draft updates', () => {
    const createInput = collectionEntryCreateSchema.parse({
      type: 'service',
      name: 'Аудит',
      summary: 'Проверка сайта',
    })
    expect(createInput).toEqual({
      type: 'service',
      name: 'Аудит',
      summary: 'Проверка сайта',
    })
    expect(() => collectionEntryCreateSchema.parse({ ...createInput, expectedRevision: 0 })).toThrow()
    expect(() => collectionEntryDraftSchema.parse(createInput)).toThrow()
  })
})
