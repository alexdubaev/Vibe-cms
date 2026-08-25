import { z } from 'zod'

export const sitePackageDescriptorSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  schemaVersion: z.number().int().positive(),
}).strict()

export type CmsSitePackageDescriptor = z.infer<typeof sitePackageDescriptorSchema>

export type CmsBlockEditorDescriptor = {
  kind: 'descriptor'
  fields: readonly {
    key: string
    kind: 'text' | 'number'
    label: string
    required: boolean
    min?: number
    max?: number
  }[]
}

export type CmsBlockContractDefinition = {
  type: string
  label: string
  description: string
  dataSchema: z.ZodType
  defaultData: unknown
  editor: CmsBlockEditorDescriptor
}

export type RegisteredContentBlock = {
  id: string
  type: string
  data: unknown
}

const requireUniqueDefinitions = (definitions: readonly CmsBlockContractDefinition[]) => {
  const byType = new Map<string, CmsBlockContractDefinition>()
  for (const definition of definitions) {
    if (byType.has(definition.type)) throw new Error('Duplicate CMS block type')
    byType.set(definition.type, definition)
  }
  return byType
}

export function createContentBlockSchema(definitions: readonly CmsBlockContractDefinition[]) {
  const byType = requireUniqueDefinitions(definitions)
  for (const definition of definitions) {
    try {
      definition.dataSchema.parse(definition.defaultData)
    } catch {
      throw new Error('Default data is invalid')
    }
  }
  return z.object({
    id: z.string().trim().min(1).max(64),
    type: z.string().trim().min(1).max(80),
    data: z.unknown(),
  }).strict().transform((block, context): RegisteredContentBlock => {
    const definition = byType.get(block.type)
    if (!definition) {
      context.addIssue({ code: 'custom', path: ['type'], message: 'Unknown CMS block type' })
      return z.NEVER
    }
    return { ...block, data: definition.dataSchema.parse(block.data) }
  })
}
