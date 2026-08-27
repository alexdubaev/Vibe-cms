import { collectionEntryCreateSchema, collectionEntryDraftSchema, collectionTypeSchema, previewMediaResponseSchema } from '@web-app-demo/contracts'
import { OpenAPIHono } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'
import { selectedPageDraftSchema } from '@vibe-cms/selected-site-package/contract'
import { z } from 'zod'

import { validationErrorHook } from '../../../http/errors'
import type { AuthHttpEnv } from '../../auth'
import type { CmsService } from '../application/cms-service'
import { menuDraftSchema, siteSettingsDraftSchema } from '../application/cms-service'
import type { CmsPreviewService } from '../application/preview-service'
import type { PrivateStorage } from '../../../storage'
import { executeCms } from './errors'

const pageIdParams = z.object({ pageId: z.uuid() }).strict()
const pageRevisionParams = z.object({ pageId: z.uuid(), revisionId: z.uuid() }).strict()
const approvalIdParams = z.object({ approvalId: z.uuid() }).strict()
const revisionBody = z.object({ revision: z.number().int().positive() }).strict()
const rejectBody = z.object({ note: z.string().trim().min(1).max(2_000) }).strict()
const previewBody = z.object({ pageId: z.uuid() }).strict()
const previewExchangeBody = z.object({ token: z.string().min(43).max(256) }).strict()
const publicationPolicyBody = z.object({ editorCanPublish: z.boolean() }).strict()
const entryIdParams = z.object({ entryId: z.uuid() }).strict()
const menuIdParams = z.object({ menuId: z.uuid() }).strict()
const assetIdParams = z.object({ assetId: z.uuid() }).strict()
const siteSettingsResponsePayloadSchema = z.object({ companyName: z.string().trim().min(1).max(160) }).strip()
const previewSessionHeader = 'x-cms-preview-session'

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
  if (mutationRateLimit) {
    routes.use('*', async (c, next) => {
      if (c.req.method === 'GET') return next()
      return mutationRateLimit(c, next)
    })
  }

  routes.get('/publication', async (c) => {
    const result = await executeCms(() => service.getPublicationSummary(c.var.user))
    return c.json(result, 200)
  })

  routes.post('/publication/retry', async (c) => {
    const result = await executeCms(() => service.retryPublication(c.var.user))
    return c.json(result, 202)
  })

  routes.patch('/publication/policy', async (c) => {
    const body = publicationPolicyBody.parse(await c.req.json())
    const result = await executeCms(() => service.savePublicationPolicy(c.var.user, body))
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
    const body = selectedPageDraftSchema.parse(await c.req.json())
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

  routes.get('/menus/:menuId', async (c) => {
    const params = menuIdParams.parse(c.req.param())
    const result = await executeCms(() => service.getMenu(c.var.user, params.menuId))
    return c.json(toSafeMenuPresentation(result), 200)
  })

  routes.get('/menus', async (c) => {
    const result = await executeCms(() => service.listMenus(c.var.user))
    return c.json(result.map(toSafeMenuPresentation), 200)
  })

  routes.get('/settings', async (c) => {
    const result = await executeCms(() => service.getSiteSettings(c.var.user))
    return c.json(toSafeSettingsPresentation(result), 200)
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
    return c.json(toSafeMenuPresentation({
      id: result.id,
      location: result.location,
      items: menuResponsePayloadSchema.parse(result.draftPayload).items,
      revision: result.revision,
    }), 200)
  })

  routes.patch('/settings', async (c) => {
    const body = siteSettingsDraftSchema.parse(await c.req.json())
    const result = await executeCms(() => service.saveSettings(c.var.user, body))
    return c.json(toSafeSettingsPresentation({
      companyName: siteSettingsResponsePayloadSchema.parse(result.draftPayload).companyName,
      revision: result.revision,
    }), 200)
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

function toSafeApproval(input: { id: string; status: string; requesterUserId: string; decisionNote?: string | null }) {
  return {
    id: input.id,
    status: input.status,
    requesterUserId: input.requesterUserId,
    decisionNote: input.decisionNote ?? null,
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

const menuResponsePayloadSchema = z.object({
  items: z.array(z.object({ label: z.string().trim().min(1).max(120), href: z.string().trim().min(1).max(500) }).strip()).max(100),
}).strip()

function toSafeMenuPresentation(input: {
  id: string
  location: 'header' | 'footer'
  items: Array<{ label: string; href: string }>
  revision: number
}) {
  return {
    id: input.id,
    location: input.location,
    items: input.items.map(({ label, href }) => ({ label, href })),
    revision: input.revision,
  }
}

function toSafeSettingsPresentation(input: { companyName: string; revision: number }) {
  return {
    companyName: input.companyName,
    revision: input.revision,
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

/** Request-time preview endpoints. They intentionally return the same generic 404 for every failure. */
export function createCmsPreviewRuntimeRoutes(input: {
  preview: CmsPreviewService
  service: CmsService
  storage: Pick<PrivateStorage, 'createDownloadUrl'>
}) {
  const routes = new OpenAPIHono({ defaultHook: validationErrorHook })
  routes.use('*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store')
    c.header('X-Robots-Tag', 'noindex, nofollow')
    await next()
  })

  routes.get('/pages/:pageId', async (c) => {
    try {
      const pageId = pageIdParams.parse(c.req.param()).pageId
      const token = c.req.header(previewSessionHeader)
      if (!token) return previewNotFound(c)
      const session = await input.preview.authorizeSession(token, pageId)
      const page = await input.service.getPageForEditor(session.actor, pageId)
      return c.json({ ...page }, 200)
    } catch {
      return previewNotFound(c)
    }
  })

  routes.get('/media/:assetId', async (c) => {
    try {
      const assetId = assetIdParams.parse(c.req.param()).assetId
      const token = c.req.header(previewSessionHeader)
      if (!token) return previewNotFound(c)
      const media = await input.preview.getMedia(token, assetId)
      const download = await input.storage.createDownloadUrl({ key: media.objectKey, expiresInSeconds: 60 })
      return c.json(previewMediaResponseSchema.parse({
        id: media.id,
        mimeType: media.contentType,
        downloadUrl: download.url,
        expiresAt: download.expiresAt,
      }), 200)
    } catch {
      return previewNotFound(c)
    }
  })

  return routes
}

function previewNotFound(c: { text(body: string, status: 404): Response }) {
  return c.text('Not Found', 404)
}
