export const CMS_CAPABILITIES = [
  'cms:read',
  'cms:edit',
  'cms:approve',
  'cms:publish',
  'cms:manage-users',
  'cms:manage-policy',
  'cms:manage-media',
] as const

export type CmsCapability = (typeof CMS_CAPABILITIES)[number]
export type CmsRole = 'user' | 'editor' | 'owner'

export type CmsCapabilityPolicy = { editorCanPublish: boolean }

export const capabilitiesForRole = (role: CmsRole, policy: CmsCapabilityPolicy): CmsCapability[] => {
  if (role === 'user') return []
  if (role === 'owner') return [...CMS_CAPABILITIES]
  const capabilities: CmsCapability[] = ['cms:read', 'cms:edit', 'cms:manage-media']
  if (policy.editorCanPublish) capabilities.push('cms:publish')
  return capabilities
}

export * from './content'
export * from './media'
export * from './preview'
export * from './publication'
export * from './site-package'
