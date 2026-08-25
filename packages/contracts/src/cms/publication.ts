import { z } from 'zod'

import { contentBlockSchema, contentPathSchema, seoSchema } from './content'
import { mediaMimeTypeSchema, publicMediaDescriptorSchema } from './media'

const publicSettingsSchema = z
  .object({
    companyName: z.string().trim().min(1).max(160),
    logo: publicMediaDescriptorSchema.optional(),
    defaultSeo: seoSchema.optional(),
  })
  .strict()

const createPublicPageSchema = (blockSchema: z.ZodType) => z
  .object({
    id: z.uuid(),
    title: z.string().trim().min(1).max(120),
    path: contentPathSchema,
    navigationLabel: z.string().trim().min(1).max(60).optional(),
    seo: seoSchema.optional(),
    blocks: z.array(blockSchema).min(1).max(60),
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

export const createPublicationSnapshotSchema = (blockSchema: z.ZodType) => z
  .object({
    revision: z.number().int().positive(),
    generatedAt: z.string().datetime(),
    settings: publicSettingsSchema,
    pages: z.array(createPublicPageSchema(blockSchema)),
    collections: z.array(publicCollectionSchema),
    menus: z.array(publicMenuSchema),
    redirects: z.array(publicRedirectSchema),
    media: z.array(publicMediaDescriptorSchema),
  })
  .strict()

export const publicationSnapshotSchema = createPublicationSnapshotSchema(contentBlockSchema)

const signedMediaUrlSchema = z
  .url()
  .refine((value) => {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash
  }, 'Media source must be a credential-free HTTPS URL without a fragment')

export const publicationMediaCopySchema = z
  .object({
    sourceUrl: signedMediaUrlSchema,
    destinationPath: z.string().regex(/^\/(blue|green)\/media\/[a-z0-9-]+\/[a-z0-9-]+\/[A-Za-z0-9._-]+$/),
    contentType: mediaMimeTypeSchema,
  })
  .strict()

export const publicationBuildInputSchema = z
  .object({
    buildId: z.uuid(),
    publicationRevision: z.number().int().positive(),
    slot: z.enum(['blue', 'green']),
    snapshotArtifact: z
      .object({ url: z.url(), expiresAt: z.string().datetime(), etag: z.string().min(1) })
      .strict(),
    media: z.array(publicationMediaCopySchema).max(500),
  })
  .strict()
  .superRefine((value, context) => {
    for (const [index, media] of value.media.entries()) {
      if (!media.destinationPath.startsWith(`/${value.slot}/`)) {
        context.addIssue({
          code: 'custom',
          path: ['media', index, 'destinationPath'],
          message: 'Media destination must belong to the assigned build slot',
        })
      }
    }
  })

export const publicationStateSchema = z.enum(['queued', 'building', 'published', 'failed'])

export const cmsConflictSchema = z
  .object({
    code: z.literal('CMS_CONFLICT'),
    message: z.string().trim().min(1).max(500),
    currentRevision: z.number().int().nonnegative(),
  })
  .strict()

export type PublicationSnapshot = z.infer<typeof publicationSnapshotSchema>
export type PublicationMediaCopy = z.infer<typeof publicationMediaCopySchema>
export type PublicationBuildInput = z.infer<typeof publicationBuildInputSchema>
export type CmsConflict = z.infer<typeof cmsConflictSchema>
