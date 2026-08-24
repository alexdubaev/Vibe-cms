import assert from 'node:assert/strict'
import { test } from 'node:test'

import { blockTypes } from '../src/cms/block-registry'
import { pageForPath } from '../src/cms/snapshot'
import type { PublicationSnapshot } from '@web-app-demo/contracts'

const snapshot = {
  revision: 7,
  generatedAt: '2026-08-24T10:00:00.000Z',
  settings: { companyName: 'Vibe' },
  pages: [
    { id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10', title: 'Home', path: '/', blocks: [] },
    { id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a11', title: 'About', path: '/about', blocks: [] },
  ],
  collections: [],
  menus: [],
  redirects: [],
  media: [],
} as unknown as PublicationSnapshot

test('CMS renderer resolves normalised paths from one immutable snapshot', () => {
  assert.equal(pageForPath(snapshot, '/'), snapshot.pages[0])
  assert.equal(pageForPath(snapshot, '/ABOUT/'), snapshot.pages[1])
  assert.equal(pageForPath(snapshot, '/missing'), undefined)
})

test('CMS block registry is closed and public-safe', () => {
  assert.deepEqual(blockTypes, [
    'hero', 'textImage', 'benefits', 'serviceSelection', 'caseSelection', 'testimonialSelection',
    'faqSelection', 'gallery', 'cta', 'contacts', 'formPlaceholder',
  ])
})
