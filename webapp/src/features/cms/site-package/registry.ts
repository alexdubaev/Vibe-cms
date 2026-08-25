import {
  coreBlockContractDefinitions,
  type CmsBlockContractDefinition,
  type CmsBlockEditorDescriptor,
  type CmsSitePackageDescriptor,
  type MediaAsset,
  type RegisteredContentBlock,
} from '@web-app-demo/contracts'
import {
  selectedBlockDefinitions,
  selectedSitePackageDescriptor,
} from '@vibe-cms/selected-site-package/contract'
import { selectedSitePackageAdmin } from '@vibe-cms/selected-site-package/admin'
import { createElement, type ComponentType } from 'react'

import type { CmsCollectionEntry } from '../api'
import { CoreBlockEditor } from './CoreBlockEditor'
import { DescriptorBlockEditor } from './DescriptorBlockEditor'

export type BlockEditorProps = {
  block: RegisteredContentBlock
  mediaAssets: readonly MediaAsset[]
  entries: readonly CmsCollectionEntry[]
  onChange(data: unknown): void
}

export type AdminBlockRegistration = {
  type: string
  label: string
  description: string
  create(id: string): RegisteredContentBlock
  Editor: ComponentType<BlockEditorProps>
}

type CustomEditorDescriptor = { kind: 'custom' }

export type AdminBlockContractDefinition = Omit<CmsBlockContractDefinition, 'editor'> & {
  editor: CmsBlockEditorDescriptor | CustomEditorDescriptor
}

export type SitePackageAdminRegistration = {
  descriptor: CmsSitePackageDescriptor
  customEditors: Readonly<Record<string, ComponentType<BlockEditorProps>>>
}

type CreateAdminBlockRegistryInput = {
  descriptor: CmsSitePackageDescriptor
  blockDefinitions: readonly AdminBlockContractDefinition[]
  admin: SitePackageAdminRegistration
}

export type AdminBlockRegistry = {
  registrations: readonly AdminBlockRegistration[]
  create(type: string, id: string): RegisteredContentBlock
  get(type: string): AdminBlockRegistration | undefined
}

const coreBlockTypes = new Set(coreBlockContractDefinitions.map((definition) => definition.type))

export function createAdminBlockRegistry({
  descriptor,
  blockDefinitions,
  admin,
}: CreateAdminBlockRegistryInput): AdminBlockRegistry {
  if (!descriptorsMatch(descriptor, admin.descriptor)) {
    throw new Error('Selected Site Package admin descriptor does not match its contract')
  }

  const byType = new Map<string, AdminBlockRegistration>()
  for (const definition of blockDefinitions) {
    if (byType.has(definition.type)) throw new Error(`Duplicate CMS admin block type: ${definition.type}`)

    const defaultData = definition.dataSchema.parse(structuredClone(definition.defaultData))
    let Editor: ComponentType<BlockEditorProps>
    if (definition.editor.kind === 'custom') {
      const customEditor = admin.customEditors[definition.type]
      if (!customEditor) throw new Error(`Missing custom CMS editor for ${definition.type}`)
      Editor = customEditor
    } else if (coreBlockTypes.has(definition.type)) {
      Editor = CoreBlockEditor
    } else {
      const descriptorDefinition = definition as CmsBlockContractDefinition
      Editor = (props) => createElement(DescriptorBlockEditor, { ...props, definition: descriptorDefinition })
      Editor.displayName = `DescriptorBlockEditor(${definition.type})`
    }

    const registration: AdminBlockRegistration = {
      type: definition.type,
      label: definition.label,
      description: definition.description,
      create: (id) => ({
        id,
        type: definition.type,
        data: definition.dataSchema.parse(structuredClone(defaultData)),
      }),
      Editor,
    }
    byType.set(definition.type, registration)
  }

  const registrations = [...byType.values()]
  return {
    registrations,
    create(type, id) {
      const registration = byType.get(type)
      if (!registration) throw new Error(`Unknown CMS admin block type: ${type}`)
      return registration.create(id)
    },
    get: (type) => byType.get(type),
  }
}

let selectedRegistry: AdminBlockRegistry | undefined

function getSelectedAdminBlockRegistry() {
  selectedRegistry ??= createAdminBlockRegistry({
    descriptor: selectedSitePackageDescriptor,
    blockDefinitions: selectedBlockDefinitions,
    admin: selectedSitePackageAdmin,
  })
  return selectedRegistry
}

export function createAdminBlock(type: string, id: string) {
  return getSelectedAdminBlockRegistry().create(type, id)
}

export function getAdminBlockRegistration(type: string) {
  return getSelectedAdminBlockRegistry().get(type)
}

export function getAdminBlockRegistrations() {
  return getSelectedAdminBlockRegistry().registrations
}

function descriptorsMatch(left: CmsSitePackageDescriptor, right: CmsSitePackageDescriptor) {
  return left.id === right.id && left.version === right.version && left.schemaVersion === right.schemaVersion
}
