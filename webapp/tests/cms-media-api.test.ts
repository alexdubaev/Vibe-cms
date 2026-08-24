import { expect, test } from 'bun:test'

import {
  createCmsMediaUpload,
  deleteCmsMedia,
  finalizeCmsMediaUpload,
  getCmsMedia,
  updateCmsMediaAlt,
} from '@/features/cms/api'
import type { AuthenticatedTransport } from '@/platform/api'

const assetId = '00000000-0000-7000-8000-000000000001'

test('media list sends an optional trimmed search query', async () => {
  const calls: Array<{ path: string; options?: Record<string, unknown> }> = []
  const transport: AuthenticatedTransport = {
    async request(path, _schema, options) {
      calls.push({ path, options: options as Record<string, unknown> | undefined })
      return { assets: [] } as never
    },
  }

  await getCmsMedia(transport, '  logo  ')
  await getCmsMedia(transport)

  expect(calls).toEqual([
    { path: '/api/cms/media?q=logo', options: undefined },
    { path: '/api/cms/media', options: undefined },
  ])
})

test('media mutations use safe PATCH and DELETE contracts', async () => {
  const calls: Array<{ path: string; options?: Record<string, unknown> }> = []
  const transport: AuthenticatedTransport = {
    async request(path, _schema, options) {
      calls.push({ path, options: options as Record<string, unknown> | undefined })
      return path.endsWith('/media')
        ? { deleted: true }
        : {
            asset: {
              id: assetId,
              contentVersion: assetId,
              filename: 'logo.png',
              mimeType: 'image/png',
              byteSize: 1200,
              width: 120,
              height: 40,
              alt: 'Логотип',
              state: 'ready',
            },
          }
    },
  }

  await updateCmsMediaAlt(transport, assetId, '  Логотип  ')
  await deleteCmsMedia(transport, assetId)

  expect(calls).toEqual([
    {
      path: `/api/cms/media/${assetId}`,
      options: { method: 'PATCH', body: { alt: 'Логотип' } },
    },
    {
      path: `/api/cms/media/${assetId}`,
      options: { method: 'DELETE' },
    },
  ])
})

test('media upload lifecycle keeps the file ticket separate from backend requests', async () => {
  const calls: Array<{ path: string; options?: Record<string, unknown> }> = []
  const transport: AuthenticatedTransport = {
    async request(path, _schema, options) {
      calls.push({ path, options: options as Record<string, unknown> | undefined })
      return {
        asset: {
          id: assetId,
          contentVersion: assetId,
          filename: 'logo.png',
          mimeType: 'image/png',
          byteSize: 1200,
          width: null,
          height: null,
          alt: null,
          state: 'pending',
        },
        upload: {
          uploadId: assetId,
          method: 'PUT',
          url: 'https://storage.example/upload',
          headers: { 'Content-Type': 'image/png' },
          contentLength: 1200,
          expiresAt: '2026-08-24T12:00:00.000Z',
        },
      } as never
    },
  }

  await createCmsMediaUpload(transport, { filename: 'logo.png', mimeType: 'image/png', byteSize: 1200 })
  await finalizeCmsMediaUpload(transport, assetId)

  expect(calls).toEqual([
    {
      path: '/api/cms/media/uploads',
      options: { method: 'POST', body: { filename: 'logo.png', mimeType: 'image/png', byteSize: 1200 } },
    },
    {
      path: `/api/cms/media/${assetId}/finalize`,
      options: { method: 'POST' },
    },
  ])
})
