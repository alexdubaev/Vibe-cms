import { describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { collectStaticObjects, uploadStaticRelease } from '../src/static-upload'

describe('static release upload', () => {
  test('collects files under the assigned slot with safe cache policy', async () => {
    const root = join(process.cwd(), '.tmp-static-upload-test')
    await mkdir(join(root, '_astro'), { recursive: true })
    await writeFile(join(root, 'index.html'), '<h1>Vibe</h1>')
    await writeFile(join(root, '_astro', 'app.12345678.js'), 'console.log(1)')
    try {
      const objects = await collectStaticObjects({ outputDirectory: root, slot: 'green' })
      expect(objects).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: 'green/index.html', contentType: 'text/html; charset=utf-8', cacheControl: 'no-cache' }),
        expect.objectContaining({ key: 'green/_astro/app.12345678.js', cacheControl: 'public, max-age=31536000, immutable' }),
      ]))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('uploads the marker last and never escapes the inactive slot', async () => {
    const calls: string[] = []
    await uploadStaticRelease({
      slot: 'blue',
      revision: 8,
      objects: [{ key: 'blue/index.html', body: new Uint8Array([1]), contentType: 'text/html' }],
      port: {
        deleteInactivePrefix: async (prefix) => { calls.push(`delete:${prefix}`) },
        putImmutable: async ({ key }) => { calls.push(`put:${key}`) },
      },
    })
    expect(calls).toEqual(['delete:blue/', 'put:blue/index.html', 'put:blue/__publication_revision.txt'])
    await expect(uploadStaticRelease({
      slot: 'blue',
      revision: 8,
      objects: [{ key: 'green/index.html', body: new Uint8Array([1]), contentType: 'text/html' }],
      port: { deleteInactivePrefix: async () => undefined, putImmutable: async () => undefined },
    })).rejects.toThrow('escaped')
  })

  test('validates every object key before clearing the assigned slot', async () => {
    const calls: string[] = []
    await expect(uploadStaticRelease({
      slot: 'blue',
      revision: 8,
      objects: [
        { key: 'blue/index.html', body: new Uint8Array([1]), contentType: 'text/html' },
        { key: 'blue/../green/index.html', body: new Uint8Array([1]), contentType: 'text/html' },
      ],
      port: {
        deleteInactivePrefix: async (prefix) => { calls.push(`delete:${prefix}`) },
        putImmutable: async ({ key }) => { calls.push(`put:${key}`) },
      },
    })).rejects.toThrow('escaped')
    expect(calls).toEqual([])
  })
})
