import { expect, test } from 'bun:test'

import { describeMediaFile, resolveMediaMimeType } from '@/features/cms/media-upload'

test('resolveMediaMimeType supports CMS media types and safe extensions', () => {
  expect(resolveMediaMimeType(new File(['x'], 'logo.png', { type: '' }))).toBe('image/png')
  expect(resolveMediaMimeType(new File(['x'], 'clip.mp4', { type: 'video/mp4' }))).toBe('video/mp4')
  expect(resolveMediaMimeType(new File(['x'], 'notes.exe', { type: 'application/octet-stream' }))).toBeNull()
})

test('describeMediaFile rejects unsupported and out-of-range files before ticket request', () => {
  expect(describeMediaFile(new File(['x'], 'bad.exe', { type: 'application/octet-stream' }))).toEqual({
    ok: false,
    reason: 'type',
  })
  expect(describeMediaFile(new File(['x'], 'tiny.png', { type: 'image/png' }))).toEqual({
    ok: false,
    reason: 'too-small',
  })
})
