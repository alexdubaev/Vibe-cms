import { z } from 'zod'

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

export type PreviewGrantResponse = z.infer<typeof previewGrantResponseSchema>
export type PreviewSessionResponse = z.infer<typeof previewSessionResponseSchema>
