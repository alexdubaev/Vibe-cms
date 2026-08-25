import { expect, test } from 'bun:test'

import { CmsRepositoryError } from '../domain/errors'
import { assertSnapshotMatchesSelectedSitePackage } from './cms-repository'

const selected = { id: 'reference-calculator', version: '2.0.0', schemaVersion: 2 }

test('accepts only a current positive-revision frozen package snapshot', () => {
  expect(() => assertSnapshotMatchesSelectedSitePackage({
    revision: 7,
    sitePackage: selected,
  }, selected)).not.toThrow()

  for (const snapshot of [
    { revision: 7 },
    { revision: 7, sitePackage: { ...selected, version: '1.0.0' } },
    { revision: 7, sitePackage: { ...selected, schemaVersion: 1 } },
    { revision: 0, sitePackage: selected },
  ]) {
    expect(() => assertSnapshotMatchesSelectedSitePackage(snapshot, selected, 'CMS_APPROVAL_STALE'))
      .toThrow(CmsRepositoryError)
  }
})
