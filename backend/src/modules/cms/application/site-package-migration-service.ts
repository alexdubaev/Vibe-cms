import type {
  CmsMutableSitePackageDrafts,
  CmsSitePackageMigration,
  CmsSitePackageMigrationRepository,
  CmsSitePackageState,
  CmsSitePackageValidation,
  SelectedSitePackageDescriptor,
} from '../domain/site-package-state'

type Dependencies = {
  repository: CmsSitePackageMigrationRepository
  adoptionValidation: CmsSitePackageValidation
  validation: CmsSitePackageValidation
  clock?: { now(): Date }
}

export class CmsSitePackageMigrationService {
  private readonly clock: { now(): Date }

  constructor(private readonly dependencies: Dependencies) {
    this.clock = dependencies.clock ?? { now: () => new Date() }
  }

  migrateSelectedPackage(
    selected: SelectedSitePackageDescriptor,
    migrations: readonly CmsSitePackageMigration[],
  ): Promise<CmsSitePackageState> {
    validateMigrationDefinitions(migrations)
    return this.dependencies.repository.transaction(async (repository) => {
      const existingState = await repository.getState()
      if (existingState && existingState.packageId !== selected.id) {
        throw new Error(
          `Selected site package ID ${selected.id} does not match persisted package ID ${existingState.packageId}`,
        )
      }
      if (existingState && existingState.schemaVersion > selected.schemaVersion) {
        throw new Error(
          `Site package schema downgrade from ${existingState.schemaVersion} to ${selected.schemaVersion} is not supported`,
        )
      }

      const sourceVersion = existingState?.schemaVersion ?? 1
      const drafts = await repository.readMutableDrafts()
      if (!existingState) {
        try {
          validateDrafts(drafts, this.dependencies.adoptionValidation)
        } catch (cause) {
          throw new Error('Cannot adopt mutable CMS content as site package schema version 1', { cause })
        }
      }

      const migratedDrafts = migrateMutableDrafts(
        drafts,
        sourceVersion,
        selected.schemaVersion,
        migrations,
      )
      validateDrafts(migratedDrafts, this.dependencies.validation)

      if (sourceVersion !== selected.schemaVersion) {
        await repository.replaceMutableDrafts(incrementDraftRevisions(migratedDrafts))
      }
      const state = {
        packageId: selected.id,
        packageVersion: selected.version,
        schemaVersion: selected.schemaVersion,
        migratedAt: this.clock.now(),
      }
      await repository.setState(state)
      return state
    })
  }
}

export function migratePagePayload(
  payload: unknown,
  fromSchemaVersion: number,
  selectedSchemaVersion: number,
  migrations: readonly CmsSitePackageMigration[],
) {
  validateMigrationDefinitions(migrations)
  return migrationsForRange(fromSchemaVersion, selectedSchemaVersion, migrations)
    .reduce((current, migration) => migration.migratePage?.(current) ?? current, payload)
}

function migrateMutableDrafts(
  drafts: CmsMutableSitePackageDrafts,
  fromSchemaVersion: number,
  selectedSchemaVersion: number,
  migrations: readonly CmsSitePackageMigration[],
): CmsMutableSitePackageDrafts {
  let current = structuredClone(drafts)
  for (const migration of migrationsForRange(fromSchemaVersion, selectedSchemaVersion, migrations)) {
    current = {
      settings: current.settings.map((draft) => ({
        ...draft,
        payload: migration.migrateSettings?.(draft.payload) ?? draft.payload,
      })),
      pages: current.pages.map((draft) => ({
        ...draft,
        payload: migration.migratePage?.(draft.payload) ?? draft.payload,
      })),
      entries: current.entries.map((draft) => ({
        ...draft,
        payload: migration.migrateContentEntry?.(draft.payload, draft.type) ?? draft.payload,
      })),
      menus: current.menus.map((draft) => ({
        ...draft,
        payload: migration.migrateMenu?.(draft.payload, draft.location) ?? draft.payload,
      })),
    }
  }
  return current
}

function migrationsForRange(
  fromSchemaVersion: number,
  selectedSchemaVersion: number,
  migrations: readonly CmsSitePackageMigration[],
) {
  if (fromSchemaVersion > selectedSchemaVersion) {
    throw new Error(`Site package schema downgrade from ${fromSchemaVersion} to ${selectedSchemaVersion} is not supported`)
  }
  const bySource = new Map(migrations.map((migration) => [migration.from, migration]))
  const result: CmsSitePackageMigration[] = []
  for (let version = fromSchemaVersion; version < selectedSchemaVersion; version += 1) {
    const migration = bySource.get(version)
    if (!migration || migration.to !== version + 1) {
      throw new Error(`Missing contiguous site package migration from ${version} to ${version + 1}`)
    }
    result.push(migration)
  }
  return result
}

function validateMigrationDefinitions(migrations: readonly CmsSitePackageMigration[]) {
  let previousFrom = 0
  for (const migration of migrations) {
    if (!Number.isInteger(migration.from) || migration.from < 1 || migration.to !== migration.from + 1) {
      throw new Error(`Invalid site package migration from ${migration.from} to ${migration.to}`)
    }
    if (migration.from <= previousFrom) {
      throw new Error('Site package migrations must be strictly ordered by source schema version')
    }
    previousFrom = migration.from
  }
}

function validateDrafts(drafts: CmsMutableSitePackageDrafts, validation: CmsSitePackageValidation) {
  for (const draft of drafts.settings) validation.validateSettings(draft.payload, draft.draftRevision)
  for (const draft of drafts.pages) validation.validatePage(draft.payload, draft.draftRevision)
  for (const draft of drafts.entries) {
    validation.validateContentEntry(draft.payload, draft.type, draft.draftRevision)
  }
  for (const draft of drafts.menus) validation.validateMenu(draft.payload, draft.location, draft.draftRevision)
}

function incrementDraftRevisions(drafts: CmsMutableSitePackageDrafts): CmsMutableSitePackageDrafts {
  return {
    settings: drafts.settings.map(incrementDraftRevision),
    pages: drafts.pages.map(incrementDraftRevision),
    entries: drafts.entries.map(incrementDraftRevision),
    menus: drafts.menus.map(incrementDraftRevision),
  }
}

function incrementDraftRevision<Draft extends { draftRevision: number }>(draft: Draft): Draft {
  return { ...draft, draftRevision: draft.draftRevision + 1 }
}
