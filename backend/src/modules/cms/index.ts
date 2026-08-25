import type { DbClient } from '../../db'
import { selectedSitePackageDescriptor } from '@vibe-cms/selected-site-package/contract'

import { createCmsRepository } from './infrastructure/cms-repository'

export { createCmsRepository, assertSelectedSitePackageState, withSelectedSitePackageLock } from './infrastructure/cms-repository'
export { createCmsSitePackageMigrationRepository } from './infrastructure/site-package-repository'
export { createCmsPreviewStore } from './infrastructure/cms-repository'
export {
  CmsService,
  menuDraftSchema,
  siteSettingsDraftSchema,
  type PageForEditorDto,
  type PageListItemDto,
} from './application/cms-service'
export { CmsPreviewService } from './application/preview-service'
export { CmsSnapshotService } from './application/snapshot-service'
export { CmsSitePackageMigrationService, migratePagePayload } from './application/site-package-migration-service'
export { toPublicMediaDescriptor } from './domain/media-descriptor'
export { createCmsRoutes } from './transport/routes'
export { createCmsPreviewExchangeRoutes } from './transport/routes'
export { createCmsPreviewRuntimeRoutes } from './transport/routes'
export * from './application/ports'
export * from './domain/errors'
export * from './domain/path-policy'
export * from './domain/registry'
export * from './domain/site-package-state'

export function createCmsModule(db: DbClient) {
  return { repository: createCmsRepository(db, selectedSitePackageDescriptor) }
}
