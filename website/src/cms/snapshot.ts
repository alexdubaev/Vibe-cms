import { readFile } from 'node:fs/promises'

import { publicationSnapshotSchema, type PublicationSnapshot } from '@web-app-demo/contracts'

/** Reads one immutable build input. A normal template build keeps the existing landing page. */
export async function loadPublicationSnapshot(path = import.meta.env.CMS_SNAPSHOT_FILE): Promise<PublicationSnapshot | null> {
  if (!path) return null
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    throw new Error(`CMS snapshot file could not be read: ${path}`, { cause: error })
  }
  return publicationSnapshotSchema.parse(JSON.parse(raw))
}

export function pageForPath(snapshot: PublicationSnapshot, pathname: string) {
  const normalised = pathname === '/' ? '/' : pathname.replace(/\/+$/, '').toLowerCase()
  return snapshot.pages.find((page) => page.path === normalised)
}
