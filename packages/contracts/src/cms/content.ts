import { z } from 'zod'

const controlCharacterPattern = /[\u0000-\u001f\u007f]/

const safeText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !controlCharacterPattern.test(value), 'Control characters are not allowed')

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !controlCharacterPattern.test(value), 'Control characters are not allowed')
    .optional()

const uuidSchema = z.uuid()

const reservedPathPrefixes = [
  '/api',
  '/admin',
  '/app',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/__preview',
  '/.well-known',
  '/_astro',
  '/media',
] as const

const normalisePath = (input: string) => {
  let value = input.normalize('NFC').trim()
  if (!value) throw new Error('Path cannot be empty')
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) throw new Error('Absolute URLs are not content paths')
  if (/[\\?#\u0000-\u001f\u007f]/.test(value)) throw new Error('Path contains forbidden characters')
  if (/%(?:2f|2F|5c|5C)/.test(value)) throw new Error('Encoded path separators are not allowed')
  try {
    value = decodeURI(value)
  } catch {
    throw new Error('Path contains malformed percent encoding')
  }
  if (/[\\?#\u0000-\u001f\u007f]/.test(value) || /%(?:2f|2F|5c|5C)/.test(value)) {
    throw new Error('Path contains forbidden characters')
  }
  if (!value.startsWith('/')) value = `/${value}`
  value = value.replace(/\/+/g, '/')
  const segments = value.split('/')
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Dot segments are not allowed')
  }
  if (value.length > 1) value = value.replace(/\/+$/, '')
  value = value.toLowerCase()
  if (reservedPathPrefixes.some((prefix) => value === prefix || value.startsWith(`${prefix}/`))) {
    throw new Error('Path is reserved')
  }
  return value
}

export const contentPathSchema = z
  .string()
  .max(180)
  .refine((value) => {
    try {
      normalisePath(value)
      return true
    } catch {
      return false
    }
  }, 'Invalid content path')
  .transform(normalisePath)

const safeHttpsUrlSchema = z
  .url()
  .refine((value) => {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash
  }, 'Only credential-free HTTPS URLs are allowed')

const samePageAnchorSchema = z.string().regex(/^#[A-Za-z][A-Za-z0-9_-]{0,79}$/, 'Invalid anchor')

export const actionSchema = z
  .object({
    label: safeText(200),
    href: z.union([contentPathSchema, samePageAnchorSchema, safeHttpsUrlSchema]),
  })
  .strict()

const inlineMarkSchema = z.enum(['bold', 'italic'])

const inlineTextSchema = z
  .object({
    type: z.literal('text'),
    text: z
      .string()
      .min(1)
      .max(2_000)
      .refine((value) => value.trim().length > 0, 'Inline text cannot be blank')
      .refine((value) => !controlCharacterPattern.test(value), 'Control characters are not allowed'),
    marks: z.array(inlineMarkSchema).max(2).default([]),
  })
  .strict()

const inlineLinkSchema = z
  .object({
    type: z.literal('link'),
    label: safeText(200),
    href: z.union([contentPathSchema, samePageAnchorSchema, safeHttpsUrlSchema]),
  })
  .strict()

const inlineNodeSchema = z.union([inlineTextSchema, inlineLinkSchema])

const paragraphSchema = z
  .object({ type: z.literal('paragraph'), children: z.array(inlineNodeSchema).min(1).max(40) })
  .strict()
const headingSchema = z
  .object({
    type: z.literal('heading'),
    level: z.union([z.literal(2), z.literal(3)]),
    children: z.array(inlineNodeSchema).min(1).max(20),
  })
  .strict()
const listItemSchema = z
  .object({ type: z.literal('listItem'), children: z.array(inlineNodeSchema).min(1).max(40) })
  .strict()
const listSchema = z
  .object({
    type: z.union([z.literal('bulletList'), z.literal('numberedList')]),
    items: z.array(listItemSchema).min(1).max(30),
  })
  .strict()
const quoteSchema = z
  .object({ type: z.literal('quote'), children: z.array(inlineNodeSchema).min(1).max(40) })
  .strict()

const structuredBlockSchema = z.discriminatedUnion('type', [
  paragraphSchema,
  headingSchema,
  listSchema,
  quoteSchema,
])

const visibleCharacters = (value: unknown): number => {
  if (!value || typeof value !== 'object') return 0
  if (Array.isArray(value)) return value.reduce((total, item) => total + visibleCharacters(item), 0)
  return Object.entries(value).reduce((total, [key, item]) => {
    if (key === 'text' || key === 'label') return total + (typeof item === 'string' ? item.length : 0)
    return total + visibleCharacters(item)
  }, 0)
}

export const structuredTextDocumentSchema = z
  .object({
    type: z.literal('document'),
    blocks: z.array(structuredBlockSchema).min(1).max(80),
  })
  .strict()
  .superRefine((value, context) => {
    if (visibleCharacters(value) > 10_000) {
      context.addIssue({ code: 'custom', message: 'Structured text exceeds 10,000 visible characters' })
    }
  })

const heroDataSchema = z
  .object({
    eyebrow: optionalText(80),
    title: safeText(160),
    text: safeText(2_000),
    primaryAction: actionSchema,
    secondaryAction: actionSchema.optional(),
    mediaId: uuidSchema.optional(),
  })
  .strict()

const textImageDataSchema = z
  .object({
    title: optionalText(160),
    content: structuredTextDocumentSchema,
    mediaId: uuidSchema.optional(),
    imageSide: z.enum(['left', 'right']).default('right'),
  })
  .strict()

const benefitsDataSchema = z
  .object({
    title: optionalText(160),
    items: z
      .array(
        z
          .object({ title: safeText(120), text: safeText(500), icon: z.enum(['check', 'star', 'shield', 'spark']) })
          .strict(),
      )
      .min(2)
      .max(8),
  })
  .strict()

const selectionData = (max: number) =>
  z
    .object({ title: safeText(160), entryIds: z.array(uuidSchema).min(1).max(max) })
    .strict()

const galleryDataSchema = z
  .object({ title: optionalText(160), mediaIds: z.array(uuidSchema).min(1).max(20) })
  .strict()

const ctaDataSchema = z
  .object({ title: safeText(160), text: optionalText(1_000), primaryAction: actionSchema, secondaryAction: actionSchema.optional() })
  .strict()

const contactsDataSchema = z
  .object({
    title: safeText(160),
    showAddress: z.boolean(),
    showHours: z.boolean(),
    showContacts: z.boolean(),
    showSocials: z.boolean(),
    showMap: z.boolean(),
  })
  .strict()

const formPlaceholderDataSchema = z
  .object({ title: safeText(160), text: safeText(1_000), contactMethod: z.enum(['phone', 'email', 'messenger']) })
  .strict()

const blockDataByType = {
  hero: heroDataSchema,
  textImage: textImageDataSchema,
  benefits: benefitsDataSchema,
  serviceSelection: selectionData(12),
  caseSelection: selectionData(12),
  testimonialSelection: selectionData(12),
  faqSelection: selectionData(20),
  gallery: galleryDataSchema,
  cta: ctaDataSchema,
  contacts: contactsDataSchema,
  formPlaceholder: formPlaceholderDataSchema,
} as const

export const contentBlockSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().trim().min(1).max(64), type: z.literal('hero'), data: heroDataSchema }).strict(),
  z.object({ id: z.string().trim().min(1).max(64), type: z.literal('textImage'), data: textImageDataSchema }).strict(),
  z.object({ id: z.string().trim().min(1).max(64), type: z.literal('benefits'), data: benefitsDataSchema }).strict(),
  z.object({ id: z.string().trim().min(1).max(64), type: z.literal('serviceSelection'), data: selectionData(12) }).strict(),
  z.object({ id: z.string().trim().min(1).max(64), type: z.literal('caseSelection'), data: selectionData(12) }).strict(),
  z.object({ id: z.string().trim().min(1).max(64), type: z.literal('testimonialSelection'), data: selectionData(12) }).strict(),
  z.object({ id: z.string().trim().min(1).max(64), type: z.literal('faqSelection'), data: selectionData(20) }).strict(),
  z.object({ id: z.string().trim().min(1).max(64), type: z.literal('gallery'), data: galleryDataSchema }).strict(),
  z.object({ id: z.string().trim().min(1).max(64), type: z.literal('cta'), data: ctaDataSchema }).strict(),
  z.object({ id: z.string().trim().min(1).max(64), type: z.literal('contacts'), data: contactsDataSchema }).strict(),
  z.object({ id: z.string().trim().min(1).max(64), type: z.literal('formPlaceholder'), data: formPlaceholderDataSchema }).strict(),
])

export const seoSchema = z
  .object({
    title: safeText(70).optional(),
    description: safeText(200).optional(),
    socialImageId: uuidSchema.optional(),
    canonicalMode: z.enum(['self', 'custom']).default('self'),
    canonicalUrl: safeHttpsUrlSchema.optional(),
    noIndex: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.canonicalMode === 'custom' && !value.canonicalUrl) {
      context.addIssue({ code: 'custom', path: ['canonicalUrl'], message: 'Custom canonical URL is required' })
    }
    if (value.canonicalMode === 'self' && value.canonicalUrl) {
      context.addIssue({ code: 'custom', path: ['canonicalUrl'], message: 'Self canonical mode cannot include a custom URL' })
    }
  })

export const pageDraftSchema = z
  .object({
    title: safeText(120),
    path: contentPathSchema,
    navigationLabel: optionalText(60),
    seo: seoSchema.optional(),
    blocks: z.array(contentBlockSchema).min(1).max(60),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict()

export const collectionTypeSchema = z.enum(['service', 'review', 'teamMember', 'faq', 'case'])

export const collectionEntryDraftSchema = z
  .object({
    type: collectionTypeSchema,
    name: safeText(160),
    summary: optionalText(500),
    description: structuredTextDocumentSchema.optional(),
    imageId: uuidSchema.optional(),
    action: actionSchema.optional(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict()

export const collectionEntryCreateSchema = collectionEntryDraftSchema.omit({ expectedRevision: true })

export type ContentPath = z.output<typeof contentPathSchema>
export type StructuredTextDocument = z.infer<typeof structuredTextDocumentSchema>
export type ContentBlock = z.infer<typeof contentBlockSchema>
export type PageDraft = z.infer<typeof pageDraftSchema>
export type CollectionEntryDraft = z.infer<typeof collectionEntryDraftSchema>
export type CollectionEntryCreateInput = z.infer<typeof collectionEntryCreateSchema>

export { blockDataByType }
