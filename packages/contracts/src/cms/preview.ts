import { z } from 'zod'

import { contentPathSchema } from './content'

export const previewGrantResponseSchema = z
  .object({
    token: z.string().min(43).max(256),
    expiresAt: z.string().datetime(),
    previewUrl: z
      .url()
      .refine((value) => new URL(value).protocol === 'https:', 'Preview URL must use HTTPS')
      .refine((value) => new URL(value).pathname.startsWith('/__preview/'), 'Invalid preview path'),
  })
  .strict()

export const previewSessionResponseSchema = z
  .object({
    sessionToken: z.string().min(43).max(256),
    expiresAt: z.string().datetime(),
  })
  .strict()

const previewMediaMimeTypeSchema = z.enum([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'video/mp4',
  'application/pdf',
])

const previewDownloadUrlSchema = z
  .url()
  .refine((value) => {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash
  }, 'Preview download URL must be a credential-free HTTP(S) URL')

/** Safe draft page envelope returned only after a valid preview session. */
export const previewPageResponseSchema = z
  .object({
    id: z.uuid(),
    title: z.string().trim().min(1).max(120),
    path: contentPathSchema,
    draftPayload: z.unknown(),
    draftRevision: z.number().int().nonnegative(),
    archived: z.boolean(),
  })
  .strict()

/** The website follows this URL server-side; object keys never cross the boundary. */
export const previewMediaResponseSchema = z
  .object({
    id: z.uuid(),
    mimeType: previewMediaMimeTypeSchema,
    downloadUrl: previewDownloadUrlSchema,
    expiresAt: z.string().datetime(),
  })
  .strict()

export type PreviewGrantResponse = z.infer<typeof previewGrantResponseSchema>
export type PreviewSessionResponse = z.infer<typeof previewSessionResponseSchema>
export type PreviewPageResponse = z.infer<typeof previewPageResponseSchema>
export type PreviewMediaResponse = z.infer<typeof previewMediaResponseSchema>
