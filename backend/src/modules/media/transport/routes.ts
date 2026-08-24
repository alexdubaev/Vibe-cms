import { OpenAPIHono } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'
import { z } from 'zod'

import { validationErrorHook } from '../../../http/errors'
import type { AuthHttpEnv } from '../../auth'
import type { MediaService } from '../application/media-service'
import { executeMedia } from './errors'

const assetParams = z.object({ assetId: z.uuid() }).strict()
const uploadBody = z.object({ filename: z.string().trim().min(1).max(180), mimeType: z.string(), byteSize: z.number().int().positive() }).strict()
const altBody = z.object({ alt: z.string().trim().max(200).nullable() }).strict()

export function createMediaRoutes(requireCmsAccess: MiddlewareHandler<AuthHttpEnv>, service: MediaService) {
  const routes = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })
  routes.use('*', requireCmsAccess)
  routes.use('*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store')
    await next()
  })

  routes.post('/uploads', async (c) => {
    const body = uploadBody.parse(await c.req.json())
    const result = await executeMedia(() => service.createUpload(c.var.user, body))
    return c.json(result, 201)
  })
  routes.post('/:assetId/finalize', async (c) => {
    const params = assetParams.parse(c.req.param())
    const result = await executeMedia(() => service.finalize(c.var.user, params.assetId))
    return c.json(result, 200)
  })
  routes.get('/', async (c) => {
    return c.json(await executeMedia(() => service.list(c.var.user, c.req.query('q'))), 200)
  })
  routes.patch('/:assetId', async (c) => {
    const params = assetParams.parse(c.req.param())
    const body = altBody.parse(await c.req.json())
    return c.json(await executeMedia(() => service.updateAlt(c.var.user, params.assetId, body.alt)), 200)
  })
  routes.delete('/:assetId', async (c) => {
    const params = assetParams.parse(c.req.param())
    return c.json(await executeMedia(() => service.remove(c.var.user, params.assetId)), 200)
  })
  return routes
}
