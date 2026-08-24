import type { DbClient } from '../../db'

import { createCmsRepository } from './infrastructure/cms-repository'

export { createCmsRepository }
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
export { createCmsRoutes } from './transport/routes'
export { createCmsPreviewExchangeRoutes } from './transport/routes'
export * from './application/ports'
export * from './domain/errors'
export * from './domain/path-policy'
export * from './domain/registry'

export function createCmsModule(db: DbClient) {
  return { repository: createCmsRepository(db) }
}
