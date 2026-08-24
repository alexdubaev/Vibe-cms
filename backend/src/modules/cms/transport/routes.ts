import { collectionEntryCreateSchema, collectionEntryDraftSchema, collectionTypeSchema, pageDraftSchema } from '@web-app-demo/contracts'
import { OpenAPIHono } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'
import { z } from 'zod'

import { validationErrorHook } from '../../../http/errors'
import type { AuthHttpEnv } from '../../auth'
import type { CmsService } from '../application/cms-service'
import { menuDraftSchema, siteSettingsDraftSchema } from '../application/cms-service'
import type { CmsPreviewService } from '../application/preview-service'
import { executeCms } from './errors'

const pageIdParams = z.object({ pageId: z.uuid() }).strict()
const pageRevisionParams = z.object({ pageId: z.uuid(), revisionId: z.uuid() }).strict()
const approvalIdParams = z.object({ approvalId: z.uuid() }).strict()
const revisionBody = z.object({ revision: z.number().int().positive() }).strict()
const rejectBody = z.object({ note: z.string().trim().min(1).max(2_000) }).strict()
const previewBody = z.object({ pageId: z.uuid() }).strict()
const previewExchangeBody = z.object({ token: z.string().min(43).max(256) }).strict()
const entryIdParams = z.object({ entryId: z.uuid() }).strict()
const menuIdParams = z.object({ menuId: z.uuid() }).strict()

type CreateCmsRoutesOptions = {
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  requireCmsAccess: MiddlewareHandler<AuthHttpEnv>
  mutationRateLimit?: MiddlewareHandler<AuthHttpEnv>
  service: CmsService
  preview: CmsPreviewService
}

export function createCmsRoutes({
  requireAuth,
  requireCmsAccess,
  mutationRateLimit,
  service,
  preview,
}: CreateCmsRoutesOptions) {
  const routes = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })
  routes.use('*', requireAuth)
  routes.use('*', requireCmsAccess)
  routes.use('*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store')
    await next()
  })
  if (mutationRateLimit) routes.use('*', mutationRateLimit)

  routes.get('/publication', async (c) => {
    const result = await executeCms(() => service.getPublicationSummary(c.var.user))
    return c.json(result, 200)
  })

  routes.get('/approvals/pending', async (c) => {
    const result = await executeCms(() => service.listPendingApprovals(c.var.user))
    return c.json(result, 200)
  })

  routes.get('/pages', async (c) => {
    const result = await executeCms(() => service.listPages(c.var.user))
    return c.json(result, 200)
  })

  routes.get('/pages/:pageId', async (c) => {
    const pageId = pageIdParams.parse(c.req.param())
    const result = await executeCms(() => service.getPageForEditor(c.var.user, pageId.pageId))
    return c.json(result, 200)
  })

  routes.get('/pages/:pageId/revisions', async (c) => {
    const params = pageIdParams.parse(c.req.param())
    const result = await executeCms(() => service.listPageRevisions(c.var.user, params.pageId))
    return c.json(result.map(toSafePageRevision), 200)
  })

  routes.post('/pages/:pageId/revisions/:revisionId/restore', async (c) => {
    const params = pageRevisionParams.parse(c.req.param())
    const result = await executeCms(() => service.restorePage(c.var.user, params.revisionId, params.pageId))
    return c.json(result, 200)
  })

  routes.patch('/pages/:pageId', async (c) => {
    const pageId = pageIdParams.parse(c.req.param())
    const body = pageDraftSchema.parse(await c.req.json())
    const result = await executeCms(() => service.savePage(c.var.user, pageId.pageId, body))
    return c.json(result, 200)
  })

  routes.get('/entries', async (c) => {
    const rawType = c.req.query('type')?.trim()
    const type = rawType ? collectionTypeSchema.parse(rawType) : undefined
    const result = await executeCms(() => service.listEntries(c.var.user, type))
    return c.json(result.map(toSafeEntry), 200)
  })

  routes.get('/entries/:entryId', async (c) => {
    const params = entryIdParams.parse(c.req.param())
    const result = await executeCms(() => service.getEntry(c.var.user, params.entryId))
    return c.json(toSafeEntryEditor(result), 200)
  })

  routes.post('/entries', async (c) => {
    const body = collectionEntryCreateSchema.parse(await c.req.json())
    const result = await executeCms(() => service.createEntry(c.var.user, body))
    return c.json(toSafeEntryEditor(result), 201)
  })

  routes.patch('/entries/:entryId', async (c) => {
    const params = entryIdParams.parse(c.req.param())
    const body = collectionEntryDraftSchema.parse(await c.req.json())
    const result = await executeCms(() => service.saveEntry(c.var.user, params.entryId, body))
    return c.json(toSafeEntryEditor(result), 200)
  })

  routes.patch('/menus/:menuId', async (c) => {
    const params = menuIdParams.parse(c.req.param())
    const body = menuDraftSchema.parse(await c.req.json())
    const result = await executeCms(() => service.saveMenu(c.var.user, params.menuId, body))
    return c.json(result, 200)
  })

  routes.patch('/settings', async (c) => {
    const body = siteSettingsDraftSchema.parse(await c.req.json())
    const result = await executeCms(() => service.saveSettings(c.var.user, body))
    return c.json(result, 200)
  })

  routes.post('/approvals', async (c) => {
    const body = revisionBody.parse(await c.req.json())
    const result = await executeCms(() => service.submitForApproval(c.var.user, body.revision))
    return c.json(toSafeApproval(result), 201)
  })

  routes.post('/approvals/:approvalId/approve', async (c) => {
    const params = approvalIdParams.parse(c.req.param())
    const result = await executeCms(() => service.approve(c.var.user, params.approvalId))
    return c.json(toSafePublication(result), 201)
  })

  routes.post('/approvals/:approvalId/reject', async (c) => {
    const params = approvalIdParams.parse(c.req.param())
    const body = rejectBody.parse(await c.req.json())
    const result = await executeCms(() => service.reject(c.var.user, params.approvalId, body.note))
    return c.json(toSafeApproval(result), 200)
  })

  routes.post('/publish', async (c) => {
    const body = revisionBody.parse(await c.req.json())
    const result = await executeCms(() => service.publishCurrent(c.var.user, body.revision))
    return c.json(toSafePublication(result), 201)
  })

  routes.post('/preview/grants', async (c) => {
    const body = previewBody.parse(await c.req.json())
    const result = await executeCms(() => preview.issueGrant(c.var.user, body.pageId))
    return c.json(result, 201)
  })

  return routes
}

function toSafeApproval(input: { id: string; status: string; requesterUserId: string }) {
  return {
    id: input.id,
    status: input.status,
    requesterUserId: input.requesterUserId,
  }
}

function toSafeEntryEditor(input: {
  id: string
  type: string
  draftPayload: unknown
  draftRevision: number
  archived: boolean
}) {
  return {
    id: input.id,
    type: input.type,
    draftPayload: input.draftPayload,
    draftRevision: input.draftRevision,
    archived: input.archived,
  }
}

function toSafePublication(input: { id: string; revision: number }) {
  return {
    id: input.id,
    revision: input.revision,
  }
}

function toSafePageRevision(input: {
  id: string
  revision: number
  sourceDraftRevision: number
  publicationRevision: number | null
  createdAt: string
}) {
  return {
    id: input.id,
    revision: input.revision,
    sourceDraftRevision: input.sourceDraftRevision,
    publicationRevision: input.publicationRevision,
    createdAt: input.createdAt,
  }
}

function toSafeEntry(input: {
  id: string
  type: string
  name: string
  summary: string | null
  revision: number
  archived: boolean
}) {
  return {
    id: input.id,
    type: input.type,
    name: input.name,
    summary: input.summary,
    revision: input.revision,
    archived: input.archived,
  }
}

/** The one-time code exchange is intentionally separate from authenticated editor routes. */
export function createCmsPreviewExchangeRoutes(preview: CmsPreviewService) {
  const routes = new OpenAPIHono({ defaultHook: validationErrorHook })
  routes.use('*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store')
    await next()
  })
  routes.post('/exchange', async (c) => {
    const body = previewExchangeBody.parse(await c.req.json())
    const session = await executeCms(() => preview.exchangeGrant(body.token))
    c.header(
      'Set-Cookie',
      `cms_preview_session=${encodeURIComponent(session.sessionToken)}; Path=/__preview; HttpOnly; SameSite=Lax; Secure; Max-Age=900`,
    )
    return c.json(session, 200)
  })
  return routes
}
