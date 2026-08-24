import { AppError } from '../../../http/errors'
import { CmsRepositoryError } from '../domain/errors'

const statusByCode: Record<string, 400 | 403 | 404 | 409> = {
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CMS_CONFLICT: 409,
  CMS_APPROVAL_STALE: 409,
  CMS_PREVIEW_INVALID: 400,
}

export async function executeCms<T>(operation: () => Promise<T>) {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof CmsRepositoryError) {
      throw new AppError(statusByCode[error.code] ?? 400, error.code as never, error.message, {
        ...(error instanceof Error && 'currentRevision' in error
          ? { currentRevision: (error as { currentRevision?: number }).currentRevision }
          : {}),
      })
    }
    throw error
  }
}
