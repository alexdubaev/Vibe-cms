import { AppError } from '../../../http/errors'
import { MediaError } from '../domain/errors'

export async function executeMedia<T>(operation: () => Promise<T>) {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof MediaError) {
      const status = error.code === 'FORBIDDEN' ? 403 : error.code === 'MEDIA_NOT_FOUND' ? 404 : error.code === 'CMS_MEDIA_IN_USE' ? 409 : 400
      const code = error.code === 'MEDIA_NOT_FOUND' ? 'NOT_FOUND' : error.code === 'MEDIA_REJECTED' ? 'BAD_REQUEST' : error.code
      throw new AppError(status, code, error.message, error.details)
    }
    throw error
  }
}
