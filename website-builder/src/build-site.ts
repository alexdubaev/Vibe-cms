import { publicationSnapshotSchema, type PublicationSnapshot } from '@web-app-demo/contracts'
import type { FetchLike } from './backend-client'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type SnapshotArtifact = {
  url: string
  expiresAt: string
  etag: string
}

export type SnapshotDownloader = (artifact: SnapshotArtifact) => Promise<PublicationSnapshot>

export type SiteBuildResult = {
  outputDirectory: string
  marker: string
  publicationRevision: number
}

export type SiteBuildRunner = (input: {
  buildId: string
  publicationRevision: number
  slot: 'blue' | 'green'
  snapshot: PublicationSnapshot
}) => Promise<SiteBuildResult>

export type BuildProcessRunner = (input: {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
}) => Promise<void>

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
    return publicationSnapshotSchema.parse(decoded)
  }
}

export function publicationMarker(revision: number): string {
  return `vibe-publication:${revision}`
}

/** Runs Astro against one immutable snapshot in an isolated temporary output directory. */
export function createAstroSiteRunner(options: {
  websiteDirectory: string
  tempDirectory?: string
  run?: BuildProcessRunner
}): SiteBuildRunner {
  const run = options.run ?? runProcess
  return async ({ buildId, publicationRevision, slot, snapshot }) => {
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
      },
    })
    return { outputDirectory, marker: publicationMarker(publicationRevision), publicationRevision }
  }
}

async function runProcess(input: Parameters<BuildProcessRunner>[0]): Promise<void> {
  const child = Bun.spawn([input.command, ...input.args], {
    cwd: input.cwd,
    env: { ...process.env, ...input.env } as Record<string, string>,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const exitCode = await child.exited
  if (exitCode !== 0) {
    const stderr = child.stderr ? await new Response(child.stderr).text() : ''
    throw new Error(`Astro build failed (${exitCode}): ${stderr.trim().slice(0, 500)}`)
  }
}
