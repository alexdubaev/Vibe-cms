import { selectedSitePackageDescriptor } from '@vibe-cms/selected-site-package/contract'

import { createBuilderBackendClient } from './backend-client'
import { createAstroSiteRunner, createSnapshotDownloader } from './build-site'
import { createBuilderHttpHandler, createBuilderWorker } from './index'
import { publishBuiltRelease } from './release-pipeline'
import {
  createS3PublicationStorageAdapter,
  s3PublicationStorageOptionsFromEnvironment,
} from './s3-storage'
import { createHttpPublicationPromotion } from './yandex-promotion'

const requiredEnvironment = readRequiredEnvironment([
  'CMS_BACKEND_INTERNAL_BASE_URL',
  'CMS_BUILDER_HMAC_SECRET',
  'CMS_WEBSITE_PUBLIC_ORIGIN',
  'CMS_WEBSITE_SELECTOR_URL',
  'CMS_WEBSITE_PURGE_URL',
  'CMS_WEBSITE_PROMOTION_TOKEN',
])

const websiteStorage = createS3PublicationStorageAdapter({
  ...s3PublicationStorageOptionsFromEnvironment(process.env),
  slots: ['blue', 'green'],
})
const publicationPromotion = createHttpPublicationPromotion({
  storage: websiteStorage,
  publicOrigin: requiredEnvironment.CMS_WEBSITE_PUBLIC_ORIGIN,
  selectorUrl: requiredEnvironment.CMS_WEBSITE_SELECTOR_URL,
  purgeUrl: requiredEnvironment.CMS_WEBSITE_PURGE_URL,
  authToken: requiredEnvironment.CMS_WEBSITE_PROMOTION_TOKEN,
})

const worker = createBuilderWorker({
  backend: createBuilderBackendClient({
    baseUrl: requiredEnvironment.CMS_BACKEND_INTERNAL_BASE_URL,
    hmacSecret: requiredEnvironment.CMS_BUILDER_HMAC_SECRET,
  }),
  buildSite: createAstroSiteRunner({
    descriptor: selectedSitePackageDescriptor,
    publicWebsiteUrl: requiredEnvironment.CMS_WEBSITE_PUBLIC_ORIGIN,
    websiteDirectory: process.env.CMS_WEBSITE_DIRECTORY ?? '/app/website',
  }),
  downloadSnapshot: createSnapshotDownloader(),
  publishRelease: async ({ build, output }) => {
    return publishBuiltRelease({
      build,
      outputDirectory: output.outputDirectory,
      redirects: output.redirects,
      copyMedia: websiteStorage,
      uploader: websiteStorage,
      promotion: publicationPromotion,
    })
  },
})

const port = Number.parseInt(process.env.PORT ?? '3000', 10)
Bun.serve({
  port,
  fetch: createBuilderHttpHandler(worker),
})

console.log(`Website builder listening on ${port}`)

function readRequiredEnvironment(names: readonly string[]): Record<string, string> {
  const missing = names.filter((name) => !process.env[name]?.trim())
  if (missing.length > 0) throw new Error(`Required website builder environment is missing: ${missing.join(', ')}`)
  return Object.fromEntries(names.map((name) => [name, process.env[name]!.trim()]))
}
