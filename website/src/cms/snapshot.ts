import { readFile } from 'node:fs/promises'

import {
  selectedPublicationSnapshotSchema,
  selectedSitePackageDescriptor,
} from '@vibe-cms/selected-site-package/contract'
import { selectedSitePackageWebsite } from '@vibe-cms/selected-site-package/website'
import { z } from 'zod'

const selectedWebsiteSnapshotSchema = selectedPublicationSnapshotSchema.extend({
  sitePackage: z.object({
    id: z.literal(selectedSitePackageDescriptor.id),
    version: z.literal(selectedSitePackageDescriptor.version),
    schemaVersion: z.literal(selectedSitePackageDescriptor.schemaVersion),
  }).strict(),
})

export type WebsitePublicationSnapshot = z.output<typeof selectedWebsiteSnapshotSchema>
export type WebsitePublicPage = WebsitePublicationSnapshot['pages'][number]

if (
  selectedSitePackageWebsite.descriptor.id !== selectedSitePackageDescriptor.id
  || selectedSitePackageWebsite.descriptor.version !== selectedSitePackageDescriptor.version
  || selectedSitePackageWebsite.descriptor.schemaVersion !== selectedSitePackageDescriptor.schemaVersion
) {
  throw new Error('Site Package website descriptor does not match its contract descriptor')
}

export function parsePublicationSnapshot(input: unknown): WebsitePublicationSnapshot {
  return selectedWebsiteSnapshotSchema.parse(input)
}

/** Reads one immutable build input. A normal template build keeps the existing landing page. */
export async function loadPublicationSnapshot(path = import.meta.env.CMS_SNAPSHOT_FILE): Promise<WebsitePublicationSnapshot | null> {
  if (!path) return null
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    throw new Error(`CMS snapshot file could not be read: ${path}`, { cause: error })
  }
  return parsePublicationSnapshot(JSON.parse(raw))
}

export function pageForPath(snapshot: WebsitePublicationSnapshot, pathname: string) {
  const normalised = pathname === '/' ? '/' : pathname.replace(/\/+$/, '').toLowerCase()
  return snapshot.pages.find((page) => page.path === normalised)
}

/** Turns the immutable publication input into Astro's build-time redirect map. */
export function redirectsForSnapshot(snapshot: WebsitePublicationSnapshot): Record<string, string> {
  return Object.fromEntries(snapshot.redirects.map(({ source, destination }) => [source, destination]))
}

export function resolvePageMetadata(
  snapshot: WebsitePublicationSnapshot,
  page: WebsitePublicPage,
  websiteOrigin?: string,
) {
  const pageSeo = page.seo
  const defaultSeo = snapshot.settings.defaultSeo
  const canonicalMode = pageSeo?.canonicalMode ?? defaultSeo?.canonicalMode ?? 'self'
  const socialImageId = pageSeo?.socialImageId ?? defaultSeo?.socialImageId
  const socialAsset = snapshot.media.find((asset) => asset.id === socialImageId)
  const absoluteUrl = (path: string) => websiteOrigin ? new URL(path, websiteOrigin).toString() : path

  return {
    title: pageSeo?.title ?? defaultSeo?.title ?? page.title,
    description: pageSeo?.description ?? defaultSeo?.description ?? page.title,
    noIndex: pageSeo?.noIndex ?? defaultSeo?.noIndex ?? false,
    canonicalUrl: canonicalMode === 'custom'
      ? pageSeo?.canonicalUrl ?? defaultSeo?.canonicalUrl
      : websiteOrigin
        ? new URL(page.path, websiteOrigin).toString()
        : undefined,
    socialImage: socialAsset ? {
      alt: socialAsset.alt ?? socialAsset.filename,
      height: socialAsset.height,
      url: absoluteUrl(socialAsset.publicPath),
      width: socialAsset.width,
    } : undefined,
  }
}
