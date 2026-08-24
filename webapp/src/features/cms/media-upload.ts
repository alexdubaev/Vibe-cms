import type { MediaAsset, UploadTicket } from '@web-app-demo/contracts'

export type MediaMimeType = MediaAsset['mimeType']
export type MediaUploadFailure = 'type' | 'too-small' | 'too-large'

export class MediaUploadError extends Error {
  readonly reason: 'size-changed' | 'transfer-failed'

  constructor(reason: 'size-changed' | 'transfer-failed', message: string) {
    super(message)
    this.name = 'MediaUploadError'
    this.reason = reason
  }
}

const limits: Record<MediaMimeType, [number, number]> = {
  'image/jpeg': [100, 15 * 1024 * 1024],
  'image/png': [100, 15 * 1024 * 1024],
  'image/webp': [100, 15 * 1024 * 1024],
  'image/avif': [100, 15 * 1024 * 1024],
  'video/mp4': [1_024, 100 * 1024 * 1024],
  'application/pdf': [100, 25 * 1024 * 1024],
}

const extensionTypes: Record<string, MediaMimeType> = {
  avif: 'image/avif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
  png: 'image/png',
  webp: 'image/webp',
}

export function resolveMediaMimeType(file: File): MediaMimeType | null {
  if (file.type in limits) return file.type as MediaMimeType
  const extension = file.name.toLowerCase().split('.').pop()
  return extension ? extensionTypes[extension] ?? null : null
}

export function describeMediaFile(file: File) {
  const mimeType = resolveMediaMimeType(file)
  if (!mimeType) return { ok: false as const, reason: 'type' as const }

  const [minimum, maximum] = limits[mimeType]
  if (file.size < minimum) return { ok: false as const, reason: 'too-small' as const }
  if (file.size > maximum) return { ok: false as const, reason: 'too-large' as const }

  return { ok: true as const, filename: file.name, mimeType, byteSize: file.size }
}

export async function uploadMediaObject(ticket: UploadTicket, file: File) {
  if (file.size !== ticket.contentLength) {
    throw new MediaUploadError('size-changed', 'Файл изменился до завершения загрузки.')
  }

  let response: Response
  try {
    response = await fetch(ticket.url, {
      method: ticket.method,
      headers: ticket.headers,
      body: file,
      credentials: 'omit',
      mode: 'cors',
    })
  } catch {
    throw new MediaUploadError('transfer-failed', 'Хранилище недоступно. Проверьте соединение.')
  }

  if (!response.ok && response.status !== 412) {
    throw new MediaUploadError('transfer-failed', 'Хранилище отклонило загрузку.')
  }
}
