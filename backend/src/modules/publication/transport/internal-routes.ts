import { OpenAPIHono } from '@hono/zod-openapi'
import { z } from 'zod'
import { publicationBuildInputSchema } from '@web-app-demo/contracts'

import { AppError, validationErrorHook } from '../../../http/errors'
import {
  BuilderRequestAuthError,
  type BuilderRequestVerifier,
} from '../application/build-request-auth'
import type { PublicationCallbackRepository } from '../application/rebuild-controller'
import type { PublicationArtifactService } from '../application/artifact-service'
import type { PublicationMediaCopyInputService } from '../application/media-copy-input'

const buildParams = z.object({ buildId: z.uuid() }).strict()
const heartbeatBody = z.object({}).strict()
const resultBody = z
  .object({
    status: z.enum(['succeeded', 'failed']),
    markerVerified: z.boolean(),
    diagnostics: z.string().trim().max(500).optional(),
  })
  .strict()

const timestampHeader = 'x-cms-builder-timestamp'
const nonceHeader = 'x-cms-builder-nonce'
const signatureHeader = 'x-cms-builder-signature'

export function createPublicationInternalRoutes(options: {
  repository: Pick<PublicationCallbackRepository, 'heartbeat' | 'recordResult'> &
    Partial<Pick<PublicationCallbackRepository, 'getBuildForInput'>>
  verifier: BuilderRequestVerifier
  artifact?: Pick<PublicationArtifactService, 'ensureArtifact' | 'createArtifactDownload'>
  media?: Pick<PublicationMediaCopyInputService, 'createForBuild'>
  now?: () => Date
}) {
  const routes = new OpenAPIHono({ defaultHook: validationErrorHook })
  const now = options.now ?? (() => new Date())

  routes.use('*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store')
    await next()
  })

  routes.post('/builds/:buildId/heartbeat', async (c) => {
    const { buildId } = buildParams.parse(c.req.param())
    const body = await readSignedBody(c, buildId, options.verifier)
    heartbeatBody.parse(body)

    if (!(await options.repository.heartbeat(buildId, now()))) {
      throw new AppError(409, 'CONFLICT', 'Builder callback is stale')
    }
    return c.json({ accepted: true }, 202)
  })

  routes.post('/builds/:buildId/result', async (c) => {
    const { buildId } = buildParams.parse(c.req.param())
    const body = resultBody.parse(await readSignedBody(c, buildId, options.verifier))
    const outcome = await options.repository.recordResult({ ...body, buildId, now: now() })
    if (outcome === 'stale') throw new AppError(409, 'CONFLICT', 'Builder callback is stale')
    return c.json({ accepted: true }, 202)
  })

  if (options.artifact && options.repository.getBuildForInput) {
    routes.post('/builds/:buildId/input', async (c) => {
      const { buildId } = buildParams.parse(c.req.param())
      const body = await readSignedBody(c, buildId, options.verifier)
      heartbeatBody.parse(body)
      const build = await options.repository.getBuildForInput!(buildId)
      if (!build || !['queued', 'running'].includes(build.state)) {
        throw new AppError(409, 'CONFLICT', 'Builder callback is stale')
      }

      await options.artifact!.ensureArtifact(build.publicationRevision)
      const artifact = await options.artifact!.createArtifactDownload(build.publicationRevision, 300)
      const input = publicationBuildInputSchema.parse({
        buildId,
        publicationRevision: build.publicationRevision,
        slot: build.slot,
        snapshotArtifact: {
          url: artifact.url,
          expiresAt: artifact.expiresAt,
          etag: artifact.etag,
        },
        media: options.media ? await options.media.createForBuild(build.publicationRevision, build.slot) : [],
      })
      return c.json(input)
    })
  }

  return routes
}

async function readSignedBody(
  c: { req: { text(): Promise<string>; header(name: string): string | undefined; method: string; url: string } },
  buildId: string,
  verifier: BuilderRequestVerifier,
) {
  const rawBody = await c.req.text()
  const timestamp = c.req.header(timestampHeader)
  const nonce = c.req.header(nonceHeader)
  const signature = c.req.header(signatureHeader)
  if (!timestamp || !nonce || !signature) {
    throw new AppError(401, 'UNAUTHORIZED', 'Builder request authentication failed')
  }

  try {
    await verifier.verify(
      {
        method: c.req.method,
        path: requestPath(c.req.url),
        timestamp: Number(timestamp),
        nonce,
        buildId,
        body: rawBody,
      },
      signature,
    )
  } catch (error) {
    if (error instanceof BuilderRequestAuthError && error.code === 'replay') {
      throw new AppError(409, 'CONFLICT', 'Builder request has already been consumed')
    }
    throw new AppError(401, 'UNAUTHORIZED', 'Builder request authentication failed')
  }

  try {
    return JSON.parse(rawBody) as unknown
  } catch {
    throw new AppError(400, 'BAD_REQUEST', 'Builder request body is invalid JSON')
  }
}

function requestPath(url: string): string {
  const parsed = new URL(url)
  return `${parsed.pathname}${parsed.search}`
}
