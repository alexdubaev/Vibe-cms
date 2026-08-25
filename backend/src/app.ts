import { OpenAPIHono } from '@hono/zod-openapi'
import {
  selectedBlockDefinitions,
  selectedPageDraftSchema,
  selectedPublicationSnapshotSchema,
  selectedSitePackageDescriptor,
  selectedSitePackageMigrations,
} from '@vibe-cms/selected-site-package/contract'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { z } from 'zod'

import { createBackgroundTasks, type TaskDeferrer } from './background-tasks'
import type { DbClient } from './db'
import { disabledEmailDelivery, type EmailDelivery } from './email'
import type { AppEnv } from './env'
import { errorResponse, handleError, validationErrorHook } from './http/errors'
import { createAuthSecurity, createFixedWindowRateLimit } from './http/security'
import { createAuthModule, type AuthHttpEnv } from './modules/auth'
import {
  CmsPreviewService,
  CmsService,
  CmsSnapshotService,
  createCmsPreviewExchangeRoutes,
  createCmsPreviewRuntimeRoutes,
  createCmsPreviewStore,
  createCmsRepository,
  createCmsRoutes,
  toPublicMediaDescriptor,
} from './modules/cms'
import { createMediaModule } from './modules/media'
import {
  createBuilderNonceStore,
  createBuilderRequestVerifier,
  createPublicationInternalRoutes,
  PublicationMediaCopyInputService,
  PublicationArtifactService,
  createPublicationRepository,
} from './modules/publication'
import { createUploadsModule } from './modules/uploads'
import { createUsersModule } from './modules/users'
import {
  apiCorsAllowedHeaders,
  browserUploadExposedHeaders,
  createPrivateStorage,
  type PrivateStorageRuntime,
} from './storage'
import { createHash, randomBytes } from 'node:crypto'

type CreateAppOptions = {
  backgroundTasks?: TaskDeferrer
  emailDelivery?: EmailDelivery
  env: AppEnv
  prisma: DbClient
  /**
   * Storage is never absent: the filesystem driver always works. Injectable so tests can point
   * it at a temporary directory instead of the configured root.
   */
  privateStorage?: PrivateStorageRuntime
}

export function createApp({
  backgroundTasks = createBackgroundTasks(),
  emailDelivery = disabledEmailDelivery,
  env,
  prisma,
  privateStorage,
}: CreateAppOptions) {
  const storage = privateStorage ?? createPrivateStorage(env)
  const auth = createAuthModule({ db: prisma, emailDelivery, env })
  const cmsRepository = createCmsRepository(prisma)
  const cmsValidation = {
    pageDraftSchema: selectedPageDraftSchema,
    blockDefinitions: selectedBlockDefinitions,
  }
  const selectedSnapshotSchema = selectedPublicationSnapshotSchema.extend({
    sitePackage: z.object({
      id: z.literal(selectedSitePackageDescriptor.id),
      version: z.literal(selectedSitePackageDescriptor.version),
      schemaVersion: z.literal(selectedSitePackageDescriptor.schemaVersion),
    }).strict(),
  })
  const publicationRepository = createPublicationRepository(prisma)
  const publicationArtifact = new PublicationArtifactService(publicationRepository, storage.storage)
  const publicationMediaCopy = new PublicationMediaCopyInputService(publicationRepository, storage.storage)
  const publicationInternalRoutes = env.CMS_BUILDER_HMAC_ACTIVE_SECRET
    ? createPublicationInternalRoutes({
        repository: publicationRepository,
        artifact: publicationArtifact,
        media: publicationMediaCopy,
        verifier: createBuilderRequestVerifier({
          activeSecret: env.CMS_BUILDER_HMAC_ACTIVE_SECRET,
          previousSecret: env.CMS_BUILDER_HMAC_PREVIOUS_SECRET,
          nonceStore: createBuilderNonceStore(prisma),
        }),
      })
    : null
  const cmsSnapshot = new CmsSnapshotService(async () => {
    const [settings, pages, entries, menus, redirects, mediaAssets] = await Promise.all([
      prisma.cmsSiteSettings.findUnique({ where: { key: 'default' } }),
      prisma.cmsPage.findMany({ where: { archivedAt: null }, orderBy: { path: 'asc' } }),
      prisma.cmsContentEntry.findMany({ where: { archivedAt: null }, orderBy: { createdAt: 'asc' } }),
      prisma.cmsMenu.findMany({ orderBy: { location: 'asc' } }),
      prisma.cmsRedirect.findMany({ where: { active: true }, orderBy: { sourcePath: 'asc' } }),
      prisma.cmsMediaAsset.findMany({
        where: { state: 'ready' },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          contentVersion: true,
          filename: true,
          contentType: true,
          byteSize: true,
          width: true,
          height: true,
          altText: true,
        },
      }),
    ])
    const asRecord = (value: unknown): Record<string, unknown> =>
      value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
    return {
      settings: { companyName: String(asRecord(settings?.draftPayload).companyName ?? 'Vibe CMS') },
      pages: pages.map((page) => ({
        id: page.id,
        title: page.title,
        path: page.path,
        ...asRecord(page.draftPayload),
        blocks: Array.isArray(asRecord(page.draftPayload).blocks) ? asRecord(page.draftPayload).blocks : [],
      })),
      collections: entries.map((entry) => ({
        id: entry.id,
        type: entry.type,
        name: String(asRecord(entry.draftPayload).name ?? 'Без названия'),
        ...asRecord(entry.draftPayload),
      })),
      menus: menus.map((menu) => ({
        location: menu.location,
        ...asRecord(menu.draftPayload),
        items: asRecord(menu.draftPayload).items ?? [],
      })),
      redirects: redirects.map((redirect) => ({ source: redirect.sourcePath, destination: redirect.destinationPath })),
      media: mediaAssets.map(toPublicMediaDescriptor),
    }
  }, { now: () => new Date() }, {
    sitePackage: selectedSitePackageDescriptor,
    snapshotSchema: selectedSnapshotSchema,
  })
  const cmsService = new CmsService({
    repository: cmsRepository,
    snapshot: cmsSnapshot,
    validation: cmsValidation,
    sitePackage: {
      schemaVersion: selectedSitePackageDescriptor.schemaVersion,
      migrations: selectedSitePackageMigrations,
    },
  })
  const cmsPreview = new CmsPreviewService({
    store: createCmsPreviewStore(prisma),
    origin: (env.WEBAPP_ORIGIN ?? env.CORS_ORIGINS[0] ?? 'https://localhost').replace(/^http:/, 'https:'),
    randomToken: () => randomBytes(32).toString('base64url'),
    hashToken: (token) => createHash('sha256').update(token).digest('hex'),
  })
  const adminUsersReadRateLimit = createFixedWindowRateLimit<AuthHttpEnv>({
    errorMessage: 'Too many admin user directory requests',
    key: (c) => c.var.user.id,
    max: env.ADMIN_USERS_READ_RATE_LIMIT_MAX,
    windowSeconds: env.ADMIN_USERS_READ_RATE_LIMIT_WINDOW_SECONDS,
  })
  const users = createUsersModule({
    adminUsersReadRateLimit,
    db: prisma,
    requireAdmin: auth.requireAdmin,
    requireAuth: auth.requireAuth,
  })
  const uploads = createUploadsModule({
    backgroundTasks,
    db: prisma,
    requireAuth: auth.requireAuth,
    storage: storage.storage,
  })
  const media = createMediaModule({
    backgroundTasks,
    db: prisma,
    requireAuth: auth.requireAuth,
    requireCmsAccess: auth.requireCmsAccess,
    storage: storage.storage,
  })
  const cmsMutationRateLimit = createFixedWindowRateLimit<AuthHttpEnv>({
    errorMessage: 'Too many CMS mutations',
    key: (c) => c.var.user.id,
    max: env.CMS_MUTATION_RATE_LIMIT_MAX,
    windowSeconds: env.CMS_MUTATION_RATE_LIMIT_WINDOW_SECONDS,
  })
  const app = new OpenAPIHono<AuthHttpEnv>({
    defaultHook: validationErrorHook,
  })
  app.openAPIRegistry.registerComponent('securitySchemes', 'BearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  })

  app.use(secureHeaders())
  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (!origin) return env.CORS_ORIGINS[0] ?? null
        return env.CORS_ORIGINS.includes(origin) ? origin : null
      },
      // One global CORS layer, because hono answers a preflight in the first middleware that
      // matches: a second, route-scoped cors() registered later would never see an OPTIONS.
      // The upload headers therefore have to live here. They come from the same constant the
      // local S3 bucket's CORS rule uses, so both drivers allow exactly the same upload request.
      allowHeaders: apiCorsAllowedHeaders,
      exposeHeaders: browserUploadExposedHeaders,
      allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
      maxAge: 600,
    }),
  )
  for (const middleware of createAuthSecurity({
    bodyLimitBytes: env.AUTH_BODY_LIMIT_BYTES,
    rateLimitMax: env.AUTH_RATE_LIMIT_MAX,
    rateLimitWindowSeconds: env.AUTH_RATE_LIMIT_WINDOW_SECONDS,
    trustProxy: env.TRUST_PROXY,
    trustedProxyClientIpHeader: env.TRUSTED_PROXY_CLIENT_IP_HEADER,
    trustedProxyClientIpPosition: env.TRUSTED_PROXY_CLIENT_IP_POSITION,
  })) {
    app.use('/api/auth/*', middleware)
  }
  for (const middleware of createAuthSecurity({
    bodyLimitBytes: env.AUTH_BODY_LIMIT_BYTES,
    rateLimitMax: env.AUTH_RATE_LIMIT_MAX,
    rateLimitWindowSeconds: env.AUTH_RATE_LIMIT_WINDOW_SECONDS,
    trustProxy: env.TRUST_PROXY,
    trustedProxyClientIpHeader: env.TRUSTED_PROXY_CLIENT_IP_HEADER,
    trustedProxyClientIpPosition: env.TRUSTED_PROXY_CLIENT_IP_POSITION,
  })) {
    app.use('/api/users/*', middleware)
    app.use('/api/admin/*', middleware)
    app.use('/api/uploads/*', middleware)
  }
  for (const middleware of createAuthSecurity({
    bodyLimitBytes: env.CMS_BODY_LIMIT_BYTES,
    rateLimitMax: env.CMS_MUTATION_RATE_LIMIT_MAX,
    rateLimitWindowSeconds: env.CMS_MUTATION_RATE_LIMIT_WINDOW_SECONDS,
    trustProxy: env.TRUST_PROXY,
    trustedProxyClientIpHeader: env.TRUSTED_PROXY_CLIENT_IP_HEADER,
    trustedProxyClientIpPosition: env.TRUSTED_PROXY_CLIENT_IP_POSITION,
  })) {
    app.use('/api/cms/*', middleware)
  }
  app.get('/', (c) => {
    return c.json({
      name: 'web_app_demo backend',
      status: 'ok',
    })
  })

  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
    })
  })

  app.get('/health/live', (c) => {
    return c.json({
      status: 'ok',
    })
  })

  app.get('/health/ready', async (c) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      return c.json({ status: 'ok' }, 200)
    } catch {
      return c.json({ status: 'unavailable' }, 503)
    }
  })

  app.route('/api/auth', auth.routes)
  app.route('/api/users', users.userRoutes)
  app.route('/api/admin', users.adminRoutes)
  app.route('/api/uploads', uploads.routes)
  app.route('/api/cms/preview', createCmsPreviewExchangeRoutes(cmsPreview))
  app.route('/api/cms/preview', createCmsPreviewRuntimeRoutes({ preview: cmsPreview, service: cmsService, storage: storage.storage }))
  if (publicationInternalRoutes) app.route('/api/internal/cms', publicationInternalRoutes)
  app.route('/api/cms/media', media.routes)
  app.route(
    '/api/cms',
    createCmsRoutes({
      mutationRateLimit: cmsMutationRateLimit,
      preview: cmsPreview,
      requireAuth: auth.requireAuth,
      requireCmsAccess: auth.requireCmsAccess,
      service: cmsService,
    }),
  )

  // Only the filesystem driver needs the backend to serve the URLs it signs. With an S3 driver
  // the browser uploads straight to the bucket and there is nothing to mount here.
  if (storage.httpRoutes) {
    app.route('/storage', storage.httpRoutes)
  }

  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: {
      title: 'web_app_demo API',
      version: '1.0.0',
    },
  })

  app.notFound((c) => c.json(errorResponse('NOT_FOUND', 'Route not found'), 404))
  app.onError(handleError)

  return app
}

export type AppType = ReturnType<typeof createApp>
