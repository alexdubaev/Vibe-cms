/**
 * The registry is deliberately small at the persistence layer. Application
 * services will attach the strict contract validators and public materialisers
 * in Task 3; repositories only need to know which aggregate types are valid.
 */
export const CMS_CONTENT_ENTRY_TYPES = ['service', 'review', 'teamMember', 'faq', 'case'] as const
export type CmsContentEntryType = (typeof CMS_CONTENT_ENTRY_TYPES)[number]

export const CMS_MENU_LOCATIONS = ['header', 'footer'] as const
export type CmsMenuLocation = (typeof CMS_MENU_LOCATIONS)[number]

export function isCmsContentEntryType(value: string): value is CmsContentEntryType {
  return (CMS_CONTENT_ENTRY_TYPES as readonly string[]).includes(value)
}

export function isCmsMenuLocation(value: string): value is CmsMenuLocation {
  return (CMS_MENU_LOCATIONS as readonly string[]).includes(value)
}
