export class MediaError extends Error {
  constructor(
    message: string,
    readonly code: 'MEDIA_NOT_FOUND' | 'MEDIA_REJECTED' | 'CMS_MEDIA_IN_USE' | 'FORBIDDEN',
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'MediaError'
  }
}
