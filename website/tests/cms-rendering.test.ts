import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  selectedBlockDefinitions,
  selectedSitePackageDescriptor,
} from '@vibe-cms/selected-site-package/contract'
import { selectedSitePackageWebsite } from '@vibe-cms/selected-site-package/website'

import { blockTypes } from '../src/cms/block-registry'
import { pageForPath, parsePublicationSnapshot, resolvePageMetadata } from '../src/cms/snapshot'

const snapshot = {
  revision: 7,
  generatedAt: '2026-08-24T10:00:00.000Z',
  sitePackage: selectedSitePackageDescriptor,
  settings: {
    companyName: 'Vibe',
    defaultSeo: {
      title: 'Default title',
      description: 'Default description',
      socialImageId: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a20',
      canonicalMode: 'self',
      noIndex: false,
    },
  },
  pages: [
    {
      id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10',
      title: 'Home',
      path: '/',
      seo: {
        title: 'Page title',
        canonicalMode: 'custom',
        canonicalUrl: 'https://canonical.example/home',
        noIndex: true,
      },
      blocks: [{
        id: 'hero-home',
        type: 'hero',
        data: { title: 'Hero', text: 'Text', primaryAction: { label: 'More', href: '/about' } },
      }],
    },
    {
      id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a11',
      title: 'About',
      path: '/about',
      blocks: [{
        id: 'hero-about',
        type: 'hero',
        data: { title: 'About', text: 'Text', primaryAction: { label: 'Home', href: '/' } },
      }],
    },
  ],
  collections: [],
  menus: [],
  redirects: [],
  media: [{
    id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a20',
    contentVersion: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a21',
    filename: 'social.png',
    mimeType: 'image/png',
    byteSize: 100,
    width: 1200,
    height: 630,
    alt: 'Social image',
    publicPath: '/media/018f8c8d-5f34-7db2-8b98-2c7bf3d80a20/018f8c8d-5f34-7db2-8b98-2c7bf3d80a21/social.png',
  }],
}

const parsedSnapshot = parsePublicationSnapshot(snapshot)

test('CMS renderer resolves normalised paths from one immutable snapshot', () => {
  assert.equal(pageForPath(parsedSnapshot, '/'), parsedSnapshot.pages[0])
  assert.equal(pageForPath(parsedSnapshot, '/ABOUT/'), parsedSnapshot.pages[1])
  assert.equal(pageForPath(parsedSnapshot, '/missing'), undefined)
})

test('CMS block registry is closed and public-safe', () => {
  assert.deepEqual(blockTypes, selectedBlockDefinitions.map(({ type }) => type))
})

test('publication snapshot is validated against the build-selected package', () => {
  assert.equal(selectedSitePackageWebsite.descriptor.id, parsedSnapshot.sitePackage.id)
  assert.throws(
    () => parsePublicationSnapshot({ ...snapshot, sitePackage: { ...snapshot.sitePackage, version: '2.0.0' } }),
    /Invalid input/,
  )
})

test('page metadata combines page and default SEO without treating the snapshot as package selection', () => {
  assert.deepEqual(resolvePageMetadata(parsedSnapshot, parsedSnapshot.pages[0], 'https://site.example'), {
    canonicalUrl: 'https://canonical.example/home',
    description: 'Default description',
    noIndex: true,
    socialImage: {
      alt: 'Social image',
      height: 630,
      url: 'https://site.example/media/018f8c8d-5f34-7db2-8b98-2c7bf3d80a20/018f8c8d-5f34-7db2-8b98-2c7bf3d80a21/social.png',
      width: 1200,
    },
    title: 'Page title',
  })
})
