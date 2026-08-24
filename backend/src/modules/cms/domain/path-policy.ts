import { contentPathSchema } from '@web-app-demo/contracts'

import { CmsPathPolicyError } from './errors'

export function normalizeCmsPath(path: string) {
  try {
    return contentPathSchema.parse(path)
  } catch (error) {
    throw new CmsPathPolicyError(path, error)
  }
}

export function assertDistinctCmsPath(path: string, existingPaths: Iterable<string>) {
  const normalized = normalizeCmsPath(path)
  const existing = new Set([...existingPaths].map(normalizeCmsPath))
  if (existing.has(normalized)) throw new CmsPathPolicyError(path, new Error('Path already exists'))
  return normalized
}
