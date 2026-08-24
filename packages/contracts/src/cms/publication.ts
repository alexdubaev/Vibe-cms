import { z } from 'zod'

import { contentBlockSchema, contentPathSchema, seoSchema } from './content'
import { publicMediaDescriptorSchema } from './media'

const publicSettingsSchema = z
  .object({
    companyName: z.string().trim().min(1).max(160),
    logo: publicMediaDescriptorSchema.optional(),
    defaultSeo: seoSchema.optional(),
  })
  .strict()

const publicPageSchema = z
  .object({
    id: z.uuid(),
    title: z.string().trim().min(1).max(120),
    path: contentPathSchema,
    navigationLabel: z.string().trim().min(1).max(60).optional(),
    seo: seoSchema.optional(),
    blocks: z.array(contentBlockSchema).min(1).max(60),
  })
  .strict()

const publicCollectionSchema = z
  .object({
    id: z.uuid(),
    type: z.enum(['service', 'review', 'teamMember', 'faq', 'case']),
    name: z.string().trim().min(1).max(160),
    summary: z.string().trim().max(500).optional(),
  })
  .strict()

const publicMenuSchema = z
  .object({
    location: z.enum(['header', 'footer']),
    items: z
      .array(
        z
          .object({ label: z.string().trim().min(1).max(120), href: z.union([contentPathSchema, z.url()]) })
          .strict(),
      )
      .max(100),
  })
  .strict()

const publicRedirectSchema = z
  .object({ source: contentPathSchema, destination: contentPathSchema })
  .strict()

export const publicationSnapshotSchema = z
  .object({
    revision: z.number().int().positive(),
    generatedAt: z.string().datetime(),
    settings: publicSettingsSchema,
    pages: z.array(publicPageSchema),
    collections: z.array(publicCollectionSchema),
    menus: z.array(publicMenuSchema),
    redirects: z.array(publicRedirectSchema),
    media: z.array(publicMediaDescriptorSchema),
  })
  .strict()

export const publicationStateSchema = z.enum(['queued', 'building', 'published', 'failed'])

export const cmsConflictSchema = z
  .object({
    code: z.literal('CMS_CONFLICT'),
    message: z.string().trim().min(1).max(500),
    currentRevision: z.number().int().nonnegative(),
  })
  .strict()

export type PublicationSnapshot = z.infer<typeof publicationSnapshotSchema>
export type CmsConflict = z.infer<typeof cmsConflictSchema>
