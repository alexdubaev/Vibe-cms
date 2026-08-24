import { z } from 'zod'

export const mediaMimeTypeSchema = z.enum([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'video/mp4',
  'application/pdf',
])

const mediaFilenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .refine((value) => !/[\\/\u0000-\u001f\u007f]/.test(value), 'Filename contains forbidden characters')

export const mediaStateSchema = z.enum(['pending', 'ready', 'deleting', 'deleted'])

export const mediaAssetSchema = z
  .object({
    id: z.uuid(),
    contentVersion: z.uuid(),
    filename: mediaFilenameSchema,
    mimeType: mediaMimeTypeSchema,
    byteSize: z.number().int().positive(),
    width: z.number().int().positive().nullable().optional(),
    height: z.number().int().positive().nullable().optional(),
    durationSeconds: z.number().positive().nullable().optional(),
    alt: z.string().trim().max(200).nullable(),
    state: mediaStateSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const limits: Record<z.infer<typeof mediaMimeTypeSchema>, [number, number]> = {
      'image/jpeg': [100, 15 * 1024 * 1024],
      'image/png': [100, 15 * 1024 * 1024],
      'image/webp': [100, 15 * 1024 * 1024],
      'image/avif': [100, 15 * 1024 * 1024],
      'video/mp4': [1_024, 100 * 1024 * 1024],
      'application/pdf': [100, 25 * 1024 * 1024],
    }
    const [minimum, maximum] = limits[value.mimeType]
    if (value.byteSize < minimum || value.byteSize > maximum) {
      context.addIssue({ code: 'custom', path: ['byteSize'], message: 'Media size is outside the allowed range' })
    }
    if (!value.mimeType.startsWith('image/') && (value.width || value.height)) {
      context.addIssue({ code: 'custom', path: ['width'], message: 'Only images can have dimensions' })
    }
  })

export const publicMediaDescriptorSchema = z
  .object({
    id: z.uuid(),
    contentVersion: z.uuid(),
    filename: mediaFilenameSchema,
    mimeType: mediaMimeTypeSchema,
    byteSize: z.number().int().positive(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    alt: z.string().max(200).nullable(),
    publicPath: z.string().regex(/^\/media\/[a-z0-9-]+\/[a-z0-9-]+\/[A-Za-z0-9._-]+$/),
  })
  .strict()

export type MediaAsset = z.infer<typeof mediaAssetSchema>
export type PublicMediaDescriptor = z.infer<typeof publicMediaDescriptorSchema>
