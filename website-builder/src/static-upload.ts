import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

export type StaticObject = {
  key: string
  body: Uint8Array
  contentType: string
  cacheControl?: string
  redirectLocation?: string
}

export async function collectStaticObjects(input: {
  outputDirectory: string
  slot: 'blue' | 'green'
}): Promise<StaticObject[]> {
  const files = await listFiles(input.outputDirectory)
  return Promise.all(files.map(async (filePath) => {
    const relativePath = relative(input.outputDirectory, filePath).replaceAll('\\', '/')
    const body = new Uint8Array(await readFile(filePath))
    return {
      key: `${input.slot}/${relativePath}`,
      body,
      contentType: contentTypeFor(relativePath),
      cacheControl: cacheControlFor(relativePath),
    }
  }))
}

export type StaticUploadPort = {
  putImmutable(object: StaticObject): Promise<void>
  deleteInactivePrefix(prefix: string): Promise<void>
}

export async function uploadStaticRelease(input: {
  port: StaticUploadPort
  slot: 'blue' | 'green'
  objects: StaticObject[]
  redirects?: ReadonlyArray<{ source: string; destination: string }>
  revision: number
  beforeStaticUpload?: () => Promise<void>
}) {
  const prefix = `${input.slot}/`
  const redirectObjects = (input.redirects ?? []).map((redirect) => {
    if (!redirect.source.startsWith('/') || !redirect.destination.startsWith('/') || redirect.source.includes('..') || redirect.destination.includes('..')) {
      throw new Error('Website redirect path is invalid')
    }
    const sourcePath = redirect.source.slice(1) || 'index.html'
    return {
      key: `${prefix}${sourcePath}`,
      body: new Uint8Array(),
      contentType: 'text/html; charset=utf-8',
      cacheControl: 'no-cache',
      redirectLocation: redirect.destination,
    } satisfies StaticObject
  })
  const releaseObjects = [...input.objects, ...redirectObjects]
  // Validate the complete object set before removing anything from the slot.
  // A late invalid key must never leave a previously published release empty.
  for (const object of releaseObjects) {
    if (!isStaticObjectKey(object.key, input.slot)) throw new Error('Static upload object escaped the assigned slot')
  }
  await input.port.deleteInactivePrefix(prefix)
  await input.beforeStaticUpload?.()
  for (const object of releaseObjects) {
    await input.port.putImmutable(object)
  }
  const marker = new TextEncoder().encode(`vibe-publication:${input.revision}`)
  await input.port.putImmutable({ key: `${prefix}__publication_revision.txt`, body: marker, contentType: 'text/plain', cacheControl: 'no-store' })
}

function isStaticObjectKey(key: string, slot: 'blue' | 'green') {
  if (typeof key !== 'string') return false
  const segments = key.split('/')
  if (segments.length < 2 || segments[0] !== slot) return false
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..' && !segment.includes('\\'))
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? listFiles(path) : [path]
  }))
  return nested.flat()
}

function contentTypeFor(path: string) {
  const extension = extname(path).toLowerCase()
  return ({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.woff2': 'font/woff2',
  } as Record<string, string>)[extension] ?? 'application/octet-stream'
}

function cacheControlFor(path: string) {
  if (path.endsWith('.html') || path.endsWith('.xml') || path.endsWith('.txt')) return 'no-cache'
  return path.includes('/_astro/') || /\.[a-f0-9]{8,}\./i.test(path)
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=3600'
}
