import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { selectedBlockDefinitions, selectedSitePackageDescriptor } from '@vibe-cms/selected-site-package/contract'
import { selectedSitePackageWebsite } from '@vibe-cms/selected-site-package/website'

import { createBlockRendererResolver, resolveBlockRenderer } from '../src/cms/block-registry'

const temporaryDirectories: string[] = []

after(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

test('selected package renderers override core fallback and unknown types fail closed', () => {
  assert.equal(resolveBlockRenderer('hero').kind, 'core')

  const PackageRenderer = () => null
  const resolveFixtureRenderer = createBlockRendererResolver({
    blockTypes: [...selectedBlockDefinitions.map(({ type }) => type), 'estimateCalculator'],
    coreBlockTypes: selectedBlockDefinitions.map(({ type }) => type),
    contractDescriptor: selectedSitePackageDescriptor,
    website: {
      ...selectedSitePackageWebsite,
      renderers: { estimateCalculator: PackageRenderer, hero: PackageRenderer },
    },
  })

  assert.deepEqual(resolveFixtureRenderer('hero'), { Component: PackageRenderer, kind: 'package' })
  assert.deepEqual(resolveFixtureRenderer('estimateCalculator'), { Component: PackageRenderer, kind: 'package' })
  assert.throws(() => resolveFixtureRenderer('unknown'), /Unknown CMS block renderer/)
  assert.throws(() => resolveBlockRenderer('unknown'), /Unknown CMS block renderer/)
})

test('renderer construction rejects descriptor disagreement and missing bespoke renderers', () => {
  assert.throws(() => createBlockRendererResolver({
    blockTypes: selectedBlockDefinitions.map(({ type }) => type),
    coreBlockTypes: selectedBlockDefinitions.map(({ type }) => type),
    contractDescriptor: selectedSitePackageDescriptor,
    website: {
      ...selectedSitePackageWebsite,
      descriptor: { ...selectedSitePackageWebsite.descriptor, version: '2.0.0' },
    },
  }), /Site Package website descriptor does not match/)

  assert.throws(() => createBlockRendererResolver({
    blockTypes: [...selectedBlockDefinitions.map(({ type }) => type), 'missingPackageRenderer'],
    coreBlockTypes: selectedBlockDefinitions.map(({ type }) => type),
    contractDescriptor: selectedSitePackageDescriptor,
    website: selectedSitePackageWebsite,
  }), /Missing CMS block renderer/)
})

test('CMS homepage build uses selected package shell, snapshot SEO, and stable media markup', async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vibe-website-package-'))
  temporaryDirectories.push(temporaryDirectory)
  const snapshotPath = join(temporaryDirectory, 'snapshot.json')
  const imageId = '018f8c8d-5f34-7db2-8b98-2c7bf3d80a20'
  const imageVersion = '018f8c8d-5f34-7db2-8b98-2c7bf3d80a21'
  const imagePath = `/media/${imageId}/${imageVersion}/hero.png`

  await writeFile(snapshotPath, JSON.stringify({
    revision: 8,
    generatedAt: '2026-08-25T10:00:00.000Z',
    sitePackage: selectedSitePackageDescriptor,
    settings: {
      companyName: 'Package Company',
      defaultSeo: {
        description: 'Snapshot fallback description',
        socialImageId: imageId,
        canonicalMode: 'self',
        noIndex: false,
      },
    },
    pages: [{
      id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10',
      title: 'Snapshot home',
      path: '/',
      seo: {
        title: 'Selected package title',
        canonicalMode: 'custom',
        canonicalUrl: 'https://canonical.example/package-home',
        noIndex: true,
      },
      blocks: [
        {
          id: 'hero-home',
          type: 'hero',
          data: {
            title: 'Package hero',
            text: 'Server-rendered package content',
            primaryAction: { label: 'About', href: '/about' },
            mediaId: imageId,
          },
        },
        {
          id: 'gallery-home',
          type: 'gallery',
          data: { title: 'Package gallery', mediaIds: [imageId] },
        },
      ],
    }],
    collections: [],
    menus: [
      { location: 'header', items: [{ label: 'Home', href: '/' }] },
      { location: 'footer', items: [{ label: 'Privacy', href: '/privacy' }] },
    ],
    redirects: [],
    media: [{
      id: imageId,
      contentVersion: imageVersion,
      filename: 'hero.png',
      mimeType: 'image/png',
      byteSize: 100,
      width: 1600,
      height: 900,
      alt: 'Package image',
      publicPath: imagePath,
    }],
  }), 'utf8')

  const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const build = spawnSync(process.execPath, ['run', 'build'], {
    cwd: websiteRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      CMS_SNAPSHOT_FILE: snapshotPath,
      PUBLIC_WEBSITE_URL: 'https://site.example',
    },
  })
  assert.equal(
    build.status,
    0,
    `${build.stdout}\n${build.stderr}`,
  )

  const html = await readFile(resolve(websiteRoot, 'dist', 'client', 'index.html'), 'utf8')
  assert.match(html, /<title>Selected package title<\/title>/)
  assert.match(html, /<meta name="description" content="Snapshot fallback description"/)
  assert.match(html, /<meta name="robots" content="noindex,nofollow"/)
  assert.match(html, /<link rel="canonical" href="https:\/\/canonical\.example\/package-home"/)
  assert.match(html, new RegExp(`<meta property="og:image" content="https://site\\.example${imagePath.replaceAll('/', '\\/')}"`))
  assert.match(html, new RegExp(`data-site-package="${selectedSitePackageDescriptor.id}"`))
  assert.match(html, /Server-rendered package content/)
  assert.doesNotMatch(html, /ЙЙ — шаблон для создания сайтов/)
  assert.match(html, /<img[^>]+width="1600"[^>]+height="900"[^>]+loading="eager"[^>]+fetchpriority="high"[^>]+sizes="\(min-width: 1024px\) 896px, 100vw"/)
  assert.match(html, /<img[^>]+width="1600"[^>]+height="900"[^>]+loading="lazy"[^>]+sizes="\(min-width: 1024px\) 33vw, \(min-width: 640px\) 50vw, 100vw"/)
})
