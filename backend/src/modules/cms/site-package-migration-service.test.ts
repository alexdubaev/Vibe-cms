import { describe, expect, test } from 'bun:test'

import { CmsSitePackageMigrationService } from './application/site-package-migration-service'
import type {
  CmsMutableSitePackageDrafts,
  CmsSitePackageMigration,
  CmsSitePackageMigrationRepository,
  CmsSitePackageState,
} from './domain/site-package-state'

const descriptor = {
  id: 'reference-calculator',
  version: '1.2.0',
  schemaVersion: 3,
} as const

const migrations = [
  {
    from: 1,
    to: 2,
    migratePage: (payload) => renameField(payload, 'price', 'unitPrice'),
  },
  {
    from: 2,
    to: 3,
    migratePage: (payload) => ({ ...asRecord(payload), currency: 'RUB' }),
  },
] satisfies CmsSitePackageMigration[]

describe('selected site-package content migration', () => {
  test('adopts schema-one content, applies every contiguous migration, and persists package state', async () => {
    const repository = new MemoryMigrationRepository({
      pages: [{ id: 'page-1', draftRevision: 4, payload: { price: 125 } }],
    })
    const service = createService(repository)

    await service.migrateSelectedPackage(descriptor, migrations)

    expect(repository.state()).toEqual({
      packageId: 'reference-calculator',
      packageVersion: '1.2.0',
      schemaVersion: 3,
      migratedAt: new Date('2026-08-25T12:00:00.000Z'),
    })
    expect(repository.drafts().pages).toEqual([
      { id: 'page-1', draftRevision: 5, payload: { unitPrice: 125, currency: 'RUB' } },
    ])
  })

  test('rejects adoption before mutation when schema-one mutable content is invalid', async () => {
    const repository = new MemoryMigrationRepository({
      pages: [{ id: 'page-1', draftRevision: 1, payload: { invalid: true } }],
    })
    const service = createService(repository)

    await expect(service.migrateSelectedPackage(descriptor, migrations)).rejects.toThrow(
      'schema version 1',
    )
    expect(repository.state()).toBeNull()
    expect(repository.drafts().pages[0]?.payload).toEqual({ invalid: true })
  })

  test('rolls back all mutable payloads and state when a later migration throws', async () => {
    const initialState: CmsSitePackageState = {
      packageId: descriptor.id,
      packageVersion: '1.0.0',
      schemaVersion: 1,
      migratedAt: new Date('2026-08-24T12:00:00.000Z'),
    }
    const repository = new MemoryMigrationRepository(
      { pages: [{ id: 'page-1', draftRevision: 7, payload: { price: 125 } }] },
      initialState,
    )
    const service = createService(repository)
    const failingMigrations = [
      migrations[0]!,
      { from: 2, to: 3, migratePage: () => { throw new Error('broken migration') } },
    ] satisfies CmsSitePackageMigration[]

    await expect(service.migrateSelectedPackage(descriptor, failingMigrations)).rejects.toThrow(
      'broken migration',
    )
    expect(repository.state()).toEqual(initialState)
    expect(repository.drafts().pages).toEqual([
      { id: 'page-1', draftRevision: 7, payload: { price: 125 } },
    ])
  })

  test('fails closed for package mismatch, downgrade, and a missing migration step', async () => {
    const mismatch = new MemoryMigrationRepository({}, {
      packageId: 'another-package',
      packageVersion: '1.0.0',
      schemaVersion: 1,
      migratedAt: new Date('2026-08-24T12:00:00.000Z'),
    })
    await expect(createService(mismatch).migrateSelectedPackage(descriptor, migrations)).rejects.toThrow(
      'package ID',
    )

    const downgrade = new MemoryMigrationRepository({}, {
      packageId: descriptor.id,
      packageVersion: '2.0.0',
      schemaVersion: 4,
      migratedAt: new Date('2026-08-24T12:00:00.000Z'),
    })
    await expect(createService(downgrade).migrateSelectedPackage(descriptor, migrations)).rejects.toThrow(
      'downgrade',
    )

    const gap = new MemoryMigrationRepository({}, {
      packageId: descriptor.id,
      packageVersion: '1.0.0',
      schemaVersion: 1,
      migratedAt: new Date('2026-08-24T12:00:00.000Z'),
    })
    await expect(createService(gap).migrateSelectedPackage(descriptor, [migrations[1]!])).rejects.toThrow(
      '1 to 2',
    )
  })
})

function createService(repository: CmsSitePackageMigrationRepository) {
  return new CmsSitePackageMigrationService({
    repository,
    adoptionValidation: {
      validateSettings: requireObject,
      validatePage(payload) {
        requireObject(payload)
        if (typeof payload.price !== 'number' || 'unitPrice' in payload || 'currency' in payload) {
          throw new Error('not a schema-one page')
        }
      },
      validateContentEntry: requireObject,
      validateMenu: requireObject,
    },
    validation: {
      validateSettings: requireObject,
      validatePage(payload) {
        requireObject(payload)
        if (typeof payload.unitPrice !== 'number' || payload.currency !== 'RUB' || 'price' in payload) {
          throw new Error('not a selected-schema page')
        }
      },
      validateContentEntry: requireObject,
      validateMenu: requireObject,
    },
    clock: { now: () => new Date('2026-08-25T12:00:00.000Z') },
  })
}

class MemoryMigrationRepository implements CmsSitePackageMigrationRepository {
  private currentDrafts: CmsMutableSitePackageDrafts
  private currentState: CmsSitePackageState | null

  constructor(
    drafts: Partial<CmsMutableSitePackageDrafts>,
    state: CmsSitePackageState | null = null,
  ) {
    this.currentDrafts = cloneDrafts({ settings: [], pages: [], entries: [], menus: [], ...drafts })
    this.currentState = state ? structuredClone(state) : null
  }

  async transaction<Result>(operation: (transaction: {
    getState(): Promise<CmsSitePackageState | null>
    readMutableDrafts(): Promise<CmsMutableSitePackageDrafts>
    replaceMutableDrafts(drafts: CmsMutableSitePackageDrafts): Promise<void>
    setState(state: CmsSitePackageState): Promise<void>
  }) => Promise<Result>): Promise<Result> {
    const draftSnapshot = cloneDrafts(this.currentDrafts)
    const stateSnapshot = this.currentState ? structuredClone(this.currentState) : null
    try {
      return await operation({
        getState: async () => this.currentState ? structuredClone(this.currentState) : null,
        readMutableDrafts: async () => cloneDrafts(this.currentDrafts),
        replaceMutableDrafts: async (drafts) => { this.currentDrafts = cloneDrafts(drafts) },
        setState: async (state) => { this.currentState = structuredClone(state) },
      })
    } catch (error) {
      this.currentDrafts = draftSnapshot
      this.currentState = stateSnapshot
      throw error
    }
  }

  state() {
    return this.currentState ? structuredClone(this.currentState) : null
  }

  drafts() {
    return cloneDrafts(this.currentDrafts)
  }
}

function requireObject(payload: unknown): asserts payload is Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('payload must be an object')
  }
}

function asRecord(payload: unknown) {
  requireObject(payload)
  return payload
}

function renameField(payload: unknown, from: string, to: string) {
  const record = { ...asRecord(payload) }
  record[to] = record[from]
  delete record[from]
  return record
}

function cloneDrafts(drafts: CmsMutableSitePackageDrafts): CmsMutableSitePackageDrafts {
  return structuredClone(drafts)
}
