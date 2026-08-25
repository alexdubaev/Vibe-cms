import { selectedSitePackageDescriptor } from '@vibe-cms/selected-site-package/contract'

import { assertSelectedSitePackageState } from './modules/cms'
import type { BackendRuntime } from './runtime'

export function assertBackendRuntimeSitePackage(runtime: Pick<BackendRuntime, 'prisma'>) {
  return assertSelectedSitePackageState(runtime.prisma, selectedSitePackageDescriptor)
}
