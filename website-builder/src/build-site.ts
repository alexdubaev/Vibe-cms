import {
  sitePackageDescriptorSchema,
  type CmsSitePackageDescriptor,
} from '@web-app-demo/contracts'
import {
  selectedPublicationSnapshotSchema,
  selectedSitePackageDescriptor,
} from '@vibe-cms/selected-site-package/contract'
import type { FetchLike } from './backend-client'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { z } from 'zod'

const builderPublicationSnapshotSchema = selectedPublicationSnapshotSchema.extend({
  sitePackage: sitePackageDescriptorSchema,
})

export type BuilderPublicationSnapshot = z.output<typeof builderPublicationSnapshotSchema>

export type SnapshotArtifact = {
  url: string
  expiresAt: string
  etag: string
}

export type SnapshotDownloader = (artifact: SnapshotArtifact) => Promise<BuilderPublicationSnapshot>

export type SiteBuildResult = {
  outputDirectory: string
  marker: string
  publicationRevision: number
  redirects?: BuilderPublicationSnapshot['redirects']
}

export type SiteBuildRunner = (input: {
  buildId: string
  publicationRevision: number
  slot: 'blue' | 'green'
  snapshot: BuilderPublicationSnapshot
}) => Promise<SiteBuildResult>

export type BuildProcessRunner = (input: {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
}) => Promise<void>

export class BuildProcessExitError extends Error {
  constructor(
    readonly command: string,
    readonly exitCode: number,
    readonly diagnostics: string,
  ) {
    super(`Astro build failed (${exitCode}): ${diagnostics.trim().slice(0, 500)}`)
    this.name = 'BuildProcessExitError'
  }
}

export function createSnapshotDownloader(options: {
  fetchImpl?: FetchLike
  maxBytes?: number
} = {}): SnapshotDownloader {
  const fetchImpl = options.fetchImpl ?? fetch
  const maxBytes = options.maxBytes ?? 16 * 1024 * 1024

  return async (artifact) => {
    const response = await fetchImpl(artifact.url, { headers: { 'cache-control': 'no-store' } })
    if (!response.ok) throw new Error(`Snapshot download failed with HTTP ${response.status}`)
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim()
    if (contentType !== 'application/json') throw new Error('Snapshot artifact must be application/json')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) throw new Error('Snapshot artifact exceeds the builder limit')
    const receivedEtag = response.headers.get('etag')
    if (receivedEtag && receivedEtag !== artifact.etag) throw new Error('Snapshot artifact ETag changed during download')
    let decoded: unknown
    try {
      decoded = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    } catch {
      throw new Error('Snapshot artifact is not valid JSON')
    }
    return builderPublicationSnapshotSchema.parse(decoded)
  }
}

export function assertSelectedSitePackage(
  snapshot: Pick<BuilderPublicationSnapshot, 'sitePackage'>,
  descriptor: CmsSitePackageDescriptor = selectedSitePackageDescriptor,
): void {
  const selected = snapshot.sitePackage
  if (
    selected.id !== descriptor.id
    || selected.version !== descriptor.version
    || selected.schemaVersion !== descriptor.schemaVersion
  ) {
    throw new Error(
      `Snapshot Site Package ${selected.id}@${selected.version} does not match builder ${descriptor.id}@${descriptor.version}`,
    )
  }
}

export function publicationMarker(revision: number): string {
  return `vibe-publication:${revision}`
}

/** Runs Astro against one immutable snapshot in an isolated temporary output directory. */
export function createAstroSiteRunner(options: {
  descriptor?: CmsSitePackageDescriptor
  websiteDirectory: string
  publicWebsiteUrl: string
  tempDirectory?: string
  run?: BuildProcessRunner
}): SiteBuildRunner {
  const run = options.run ?? runBuildProcess
  return async ({ buildId, publicationRevision, slot, snapshot }) => {
    assertSelectedSitePackage(snapshot, options.descriptor)
    const workDirectory = await mkdtemp(join(options.tempDirectory ?? tmpdir(), 'vibe-site-build-'))
    const snapshotFile = join(workDirectory, 'snapshot.json')
    const outputDirectory = join(workDirectory, 'dist')
    await Bun.write(snapshotFile, JSON.stringify(snapshot))
    await run({
      command: 'bun',
      args: ['x', 'astro', 'build', '--outDir', outputDirectory],
      cwd: options.websiteDirectory,
      env: {
        CMS_SNAPSHOT_FILE: snapshotFile,
        CMS_PUBLICATION_REVISION: String(publicationRevision),
        CMS_PUBLICATION_SLOT: slot,
        CMS_BUILD_ID: buildId,
        PUBLIC_WEBSITE_URL: options.publicWebsiteUrl,
      },
    })
    return { outputDirectory, marker: publicationMarker(publicationRevision), publicationRevision, redirects: snapshot.redirects }
  }
}

export const runBuildProcess: BuildProcessRunner = async (input) => {
  const child = Bun.spawn([input.command, ...input.args], {
    cwd: input.cwd,
    env: { ...process.env, ...input.env } as Record<string, string>,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const exitCode = await child.exited
  if (exitCode !== 0) {
    const stderr = child.stderr ? await new Response(child.stderr).text() : ''
    throw new BuildProcessExitError(input.command, exitCode, stderr)
  }
}
