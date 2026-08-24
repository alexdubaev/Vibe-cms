import { createBuilderBackendClient } from './backend-client'
import { createAstroSiteRunner, createSnapshotDownloader } from './build-site'
import { createBuilderHttpHandler, createBuilderWorker } from './index'

const backend = process.env.CMS_BACKEND_INTERNAL_BASE_URL
const hmacSecret = process.env.CMS_BUILDER_HMAC_SECRET

if (!backend || !hmacSecret) {
  throw new Error('CMS_BACKEND_INTERNAL_BASE_URL and CMS_BUILDER_HMAC_SECRET are required')
}

const worker = createBuilderWorker({
  backend: createBuilderBackendClient({ baseUrl: backend, hmacSecret }),
  buildSite: createAstroSiteRunner({ websiteDirectory: process.env.CMS_WEBSITE_DIRECTORY ?? '/app/website' }),
  downloadSnapshot: createSnapshotDownloader(),
  publishRelease: async () => {
    throw new Error('Website release adapter is not configured')
  },
})

const port = Number.parseInt(process.env.PORT ?? '3000', 10)
Bun.serve({
  port,
  fetch: createBuilderHttpHandler(worker),
})

console.log(`Website builder listening on ${port}`)
