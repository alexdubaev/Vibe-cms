import type { CmsSitePackageDescriptor } from '@web-app-demo/contracts'

export type CmsSitePackageState = {
  packageId: string
  packageVersion: string
  schemaVersion: number
  migratedAt: Date
}

export type CmsMutableDraft<Metadata extends object = object> = Metadata & {
  id: string
  draftRevision: number
  payload: unknown
}

export type CmsMutableSitePackageDrafts = {
  settings: CmsMutableDraft[]
  pages: CmsMutableDraft[]
  entries: CmsMutableDraft<{ type: string }>[]
  menus: CmsMutableDraft<{ location: string }>[]
}

export type CmsSitePackageMigration = {
  from: number
  to: number
  migrateSettings?(payload: unknown): unknown
  migratePage?(payload: unknown): unknown
  migrateContentEntry?(payload: unknown, type: string): unknown
  migrateMenu?(payload: unknown, location: string): unknown
}

export type CmsSitePackageMigrationTransaction = {
  getState(): Promise<CmsSitePackageState | null>
  readMutableDrafts(): Promise<CmsMutableSitePackageDrafts>
  replaceMutableDrafts(drafts: CmsMutableSitePackageDrafts): Promise<void>
  setState(state: CmsSitePackageState): Promise<void>
}

export type CmsSitePackageMigrationRepository = {
  transaction<Result>(
    operation: (transaction: CmsSitePackageMigrationTransaction) => Promise<Result>,
  ): Promise<Result>
}

export type CmsSitePackageValidation = {
  validateSettings(payload: unknown, draftRevision: number): void
  validatePage(payload: unknown, draftRevision: number): void
  validateContentEntry(payload: unknown, type: string, draftRevision: number): void
  validateMenu(payload: unknown, location: string, draftRevision: number): void
}

export type SelectedSitePackageDescriptor = CmsSitePackageDescriptor
