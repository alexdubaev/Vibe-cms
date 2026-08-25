import { createHash } from 'node:crypto'
import { chmod, open } from 'node:fs/promises'
import { resolve } from 'node:path'

import { selectedSitePackageDescriptor } from '@vibe-cms/selected-site-package/contract'

import { createPrisma, type DbClient } from '../src/db'

type UnknownRecord = Record<string, unknown>

export type CmsExportSource = {
  getSitePackage(): Promise<UnknownRecord>
  getSettings(): Promise<UnknownRecord | null>
  listPages(): Promise<UnknownRecord[]>
  listCollections(): Promise<UnknownRecord[]>
  listMenus(): Promise<UnknownRecord[]>
  listRedirects(): Promise<UnknownRecord[]>
  listMedia(): Promise<UnknownRecord[]>
}

export type CmsCustomerExport = {
  formatVersion: 1
  sitePackage: { id: string; version: string; schemaVersion: number }
  settings: { revision: number; payload: unknown } | null
  pages: Array<{ id: string; path: string; title: string; revision: number; payload: unknown }>
  collections: Array<{ id: string; type: string; revision: number; payload: unknown }>
  menus: Array<{ id: string; location: string; revision: number; payload: unknown }>
  redirects: Array<{ sourcePath: string; destinationPath: string }>
  media: Array<{
    id: string
    filename: string
    contentType: string
    byteSize: number
    width: number | null
    height: number | null
    altText: string | null
    publicPath: string
    contentHash: string | null
  }>
  metadata: { generatedAt: string; contentSha256: string }
}

const forbiddenPayloadKeys = new Set([
  'passwordhash',
  'refreshtokenhash',
  'resettoken',
  'resettokenhash',
  'buildersecret',
  'objectkey',
  'sourceurl',
  'signedurl',
  'secret',
  'secretaccesskey',
  'accesskeyid',
  'privatekey',
])
const omittedPayloadValue = Symbol('omitted-payload-value')
const knownUrlAuthorityParameters = new Set([
  'awsaccesskeyid',
  'googleaccessid',
  'xamzcredential',
  'xamzsecuritytoken',
  'xamzsignature',
  'xgoogcredential',
  'xgoogsignature',
  'xsig',
])

export async function buildCmsCustomerExport(
  source: CmsExportSource,
  { generatedAt = new Date() }: { generatedAt?: Date } = {},
): Promise<CmsCustomerExport> {
  const [sitePackage, settings, pages, collections, menus, redirects, media] = await Promise.all([
    source.getSitePackage(),
    source.getSettings(),
    source.listPages(),
    source.listCollections(),
    source.listMenus(),
    source.listRedirects(),
    source.listMedia(),
  ])

  const content = {
    formatVersion: 1 as const,
    sitePackage: {
      id: requiredString(sitePackage.id, 'sitePackage.id'),
      version: requiredString(sitePackage.version, 'sitePackage.version'),
      schemaVersion: requiredInteger(sitePackage.schemaVersion, 'sitePackage.schemaVersion'),
    },
    settings: settings === null ? null : {
      revision: requiredInteger(settings.draftRevision, 'settings.draftRevision'),
      payload: sanitizePayload(settings.draftPayload),
    },
    pages: pages.map((page) => ({
      id: requiredString(page.id, 'page.id'),
      path: requiredString(page.path, 'page.path'),
      title: requiredString(page.title, 'page.title'),
      revision: requiredInteger(page.draftRevision, 'page.draftRevision'),
      payload: sanitizePayload(page.draftPayload),
    })),
    collections: collections.map((entry) => ({
      id: requiredString(entry.id, 'collection.id'),
      type: requiredString(entry.type, 'collection.type'),
      revision: requiredInteger(entry.draftRevision, 'collection.draftRevision'),
      payload: sanitizePayload(entry.draftPayload),
    })),
    menus: menus.map((menu) => ({
      id: requiredString(menu.id, 'menu.id'),
      location: requiredString(menu.location, 'menu.location'),
      revision: requiredInteger(menu.draftRevision, 'menu.draftRevision'),
      payload: sanitizePayload(menu.draftPayload),
    })),
    redirects: redirects
      .filter((redirect) => redirect.active !== false)
      .map((redirect) => ({
        sourcePath: requiredString(redirect.sourcePath, 'redirect.sourcePath'),
        destinationPath: requiredString(redirect.destinationPath, 'redirect.destinationPath'),
      })),
    media: media.map(toPublicMediaManifestEntry),
  }

  return {
    ...content,
    metadata: {
      generatedAt: generatedAt.toISOString(),
      contentSha256: sha256(JSON.stringify(content)),
    },
  }
}

export function verifyCmsExportChecksum(input: CmsCustomerExport) {
  const { metadata, ...content } = input
  return metadata?.contentSha256 === sha256(JSON.stringify(content))
}

export async function writeCmsCustomerExport({
  source,
  outputPath,
  replace = false,
  generatedAt,
}: {
  source: CmsExportSource
  outputPath: string
  replace?: boolean
  generatedAt?: Date
}) {
  if (!outputPath.trim()) throw new Error('An explicit export output path is required')

  const exported = await buildCmsCustomerExport(source, { generatedAt })
  const serialized = `${JSON.stringify(exported, null, 2)}\n`
  let handle
  try {
    handle = await open(outputPath, replace ? 'w' : 'wx', 0o600)
    await handle.writeFile(serialized, 'utf8')
  } catch (error) {
    if (isAlreadyExists(error)) {
      throw new Error(`Export output ${outputPath} already exists; pass --replace to overwrite it`)
    }
    throw error
  } finally {
    await handle?.close()
  }
  await chmod(outputPath, 0o600)

  return {
    outputPath,
    sha256: sha256(serialized),
    byteSize: Buffer.byteLength(serialized),
    mode: 0o600,
  }
}

export function createPrismaCmsExportSource(db: DbClient): CmsExportSource {
  return {
    getSitePackage: async () => {
      const state = await db.cmsSitePackageState.findUnique({
        where: { key: 'default' },
        select: { packageId: true, packageVersion: true, schemaVersion: true },
      })
      if (state === null) throw new Error('CMS Site Package state is not initialized')
      return { id: state.packageId, version: state.packageVersion, schemaVersion: state.schemaVersion }
    },
    getSettings: () => db.cmsSiteSettings.findUnique({
      where: { key: 'default' },
      select: { draftPayload: true, draftRevision: true },
    }),
    listPages: () => db.cmsPage.findMany({
      orderBy: { path: 'asc' },
      select: { id: true, path: true, title: true, draftPayload: true, draftRevision: true },
    }),
    listCollections: () => db.cmsContentEntry.findMany({
      orderBy: [{ type: 'asc' }, { id: 'asc' }],
      select: { id: true, type: true, draftPayload: true, draftRevision: true },
    }),
    listMenus: () => db.cmsMenu.findMany({
      orderBy: { location: 'asc' },
      select: { id: true, location: true, draftPayload: true, draftRevision: true },
    }),
    listRedirects: () => db.cmsRedirect.findMany({
      where: { active: true },
      orderBy: { sourcePath: 'asc' },
      select: { sourcePath: true, destinationPath: true, active: true },
    }),
    listMedia: () => db.cmsMediaAsset.findMany({
      where: { state: 'ready' },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        contentVersion: true,
        filename: true,
        contentType: true,
        byteSize: true,
        width: true,
        height: true,
        altText: true,
        storageEtag: true,
      },
    }).then((assets) => assets.map((asset) => ({ ...asset, contentHash: asset.storageEtag }))),
  }
}

function toPublicMediaManifestEntry(media: UnknownRecord) {
  const id = requiredString(media.id, 'media.id')
  const contentVersion = requiredString(media.contentVersion, 'media.contentVersion')
  const filename = requiredString(media.filename, 'media.filename')
  const safeFilename = filename
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180) || 'asset'
  const contentHash = typeof media.contentHash === 'string' && media.contentHash.trim()
    ? media.contentHash.trim().replace(/^"|"$/g, '')
    : null

  return {
    id,
    filename,
    contentType: requiredString(media.contentType, 'media.contentType'),
    byteSize: requiredInteger(media.byteSize, 'media.byteSize'),
    width: nullableInteger(media.width, 'media.width'),
    height: nullableInteger(media.height, 'media.height'),
    altText: typeof media.altText === 'string' ? media.altText : null,
    publicPath: `/media/${id}/${contentVersion}/${safeFilename}`,
    contentHash,
  }
}

function sanitizePayload(value: unknown): unknown {
  if (typeof value === 'string' && isCredentialBearingUrl(value)) return omittedPayloadValue
  if (Array.isArray(value)) {
    return value
      .map(sanitizePayload)
      .filter((item) => item !== omittedPayloadValue)
  }
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as UnknownRecord)
      .filter(([key]) => !isForbiddenPayloadKey(key))
      .map(([key, nested]) => [key, sanitizePayload(nested)] as const)
      .filter(([, nested]) => nested !== omittedPayloadValue),
  )
}

function isCredentialBearingUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (url.username || url.password) return true

  const queryNames = [...url.searchParams.keys()].map(normalizeUrlParameter)
  const fragment = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
  const fragmentNames = fragment.includes('=')
    ? [...new URLSearchParams(fragment).keys()].map(normalizeUrlParameter)
    : []
  const names = [...queryNames, ...fragmentNames]

  if (names.some((name) => knownUrlAuthorityParameters.has(name))) return true
  if (names.some((name) => name.includes('token') || name.includes('credential'))) return true

  const hasGenericSignature = names.includes('signature') || names.includes('sig')
  const hasSignatureCompanion = names.some((name) => [
    'expires',
    'expiry',
    'keypairid',
    'se',
    'sp',
    'sv',
  ].includes(name))
  return hasGenericSignature && hasSignatureCompanion
}

function normalizeUrlParameter(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function isForbiddenPayloadKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  return forbiddenPayloadKeys.has(normalized)
    || normalized.endsWith('hash')
    || normalized.includes('token')
    || normalized.includes('secret')
    || normalized.includes('credential')
    || normalized.includes('objectkey')
    || normalized === 'privatekey'
    || normalized.endsWith('sourceurl')
    || (normalized.startsWith('signed') && normalized.endsWith('url'))
}

function requiredString(value: unknown, name: string) {
  if (typeof value !== 'string' || !value) throw new Error(`${name} must be a non-empty string`)
  return value
}

function requiredInteger(value: unknown, name: string) {
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`)
  return value as number
}

function nullableInteger(value: unknown, name: string) {
  if (value === null || value === undefined) return null
  return requiredInteger(value, name)
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

async function main(argv: string[]) {
  let outputPath = ''
  let replace = false
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--output' && argv[index + 1]) {
      outputPath = resolve(argv[index + 1])
      index += 1
    } else if (argv[index] === '--replace') {
      replace = true
    } else {
      throw new Error('Usage: bun backend/scripts/export-cms-data.ts --output <path> [--replace]')
    }
  }
  if (!outputPath) throw new Error('An explicit export output path is required via --output')
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) throw new Error('DATABASE_URL is required')

  const db = createPrisma(databaseUrl)
  try {
    const state = await db.cmsSitePackageState.findUnique({ where: { key: 'default' } })
    if (state?.packageId !== selectedSitePackageDescriptor.id) {
      throw new Error('Selected Site Package does not match the installation database')
    }
    const result = await writeCmsCustomerExport({
      source: createPrismaCmsExportSource(db),
      outputPath,
      replace,
    })
    process.stdout.write(`CMS export written to ${result.outputPath}\n`)
    process.stdout.write(`SHA-256: ${result.sha256}\n`)
    process.stdout.write(`Bytes: ${result.byteSize}\n`)
  } finally {
    await db.$disconnect()
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
