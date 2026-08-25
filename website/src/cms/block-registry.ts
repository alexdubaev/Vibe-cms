import { coreBlockContractDefinitions } from '@web-app-demo/contracts'
import {
  selectedBlockDefinitions,
  selectedSitePackageDescriptor,
} from '@vibe-cms/selected-site-package/contract'
import { selectedSitePackageWebsite } from '@vibe-cms/selected-site-package/website'
import type { WebsitePublicPage } from './snapshot'

export type PublicPage = WebsitePublicPage
export type PublicBlock = PublicPage['blocks'][number]

type SitePackageDescriptor = { id: string; schemaVersion: number; version: string }
type PackageWebsite = {
  descriptor: SitePackageDescriptor
  renderers: Readonly<Record<string, unknown>>
}

type CreateBlockRendererResolverOptions = {
  blockTypes: readonly string[]
  contractDescriptor: SitePackageDescriptor
  coreBlockTypes: readonly string[]
  website: PackageWebsite
}

const descriptorsMatch = (left: SitePackageDescriptor, right: SitePackageDescriptor) =>
  left.id === right.id && left.version === right.version && left.schemaVersion === right.schemaVersion

export function createBlockRendererResolver({
  blockTypes: registeredBlockTypes,
  contractDescriptor,
  coreBlockTypes,
  website,
}: CreateBlockRendererResolverOptions) {
  if (!descriptorsMatch(contractDescriptor, website.descriptor)) {
    throw new Error('Site Package website descriptor does not match its contract descriptor')
  }

  const registeredTypes = new Set(registeredBlockTypes)
  const coreTypes = new Set(coreBlockTypes)
  for (const type of Object.keys(website.renderers)) {
    if (!registeredTypes.has(type)) throw new Error(`Unknown CMS block renderer: ${type}`)
  }
  for (const type of registeredTypes) {
    if (!coreTypes.has(type) && !website.renderers[type]) throw new Error(`Missing CMS block renderer: ${type}`)
  }

  return (type: string) => {
    if (!registeredTypes.has(type)) throw new Error(`Unknown CMS block renderer: ${type}`)
    const Component = website.renderers[type]
    if (Component) return { Component, kind: 'package' as const }
    if (coreTypes.has(type)) return { kind: 'core' as const }
    throw new Error(`Unknown CMS block renderer: ${type}`)
  }
}

/** The registry is intentionally closed and generated from the staged package contract. */
export const blockTypes = selectedBlockDefinitions.map(({ type }) => type)

export const resolveBlockRenderer = createBlockRendererResolver({
  blockTypes,
  contractDescriptor: selectedSitePackageDescriptor,
  coreBlockTypes: coreBlockContractDefinitions.map(({ type }) => type),
  website: selectedSitePackageWebsite,
})

export function isKnownBlock(block: PublicBlock) {
  return blockTypes.includes(block.type)
}
