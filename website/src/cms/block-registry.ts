import type { PublicationSnapshot } from '@web-app-demo/contracts'

export type PublicPage = PublicationSnapshot['pages'][number]
export type PublicBlock = PublicPage['blocks'][number]

/** The registry is intentionally closed: unknown block types cannot enter the public renderer. */
export const blockTypes = [
  'hero',
  'textImage',
  'benefits',
  'serviceSelection',
  'caseSelection',
  'testimonialSelection',
  'faqSelection',
  'gallery',
  'cta',
  'contacts',
  'formPlaceholder',
] as const

export function isKnownBlock(block: PublicBlock) {
  return blockTypes.includes(block.type as (typeof blockTypes)[number])
}
