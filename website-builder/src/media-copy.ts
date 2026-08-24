import { publicationMediaCopySchema, type PublicationMediaCopy } from '@web-app-demo/contracts'

export type MediaCopyRequest = PublicationMediaCopy

export type MediaCopyPort = {
  copyFromSignedUrl(input: MediaCopyRequest): Promise<void>
}

/** Media is copied by URL, never by sending a private object key in a queue command. */
export async function copyPublicationMedia(port: MediaCopyPort, requests: MediaCopyRequest[]) {
  for (const request of requests) {
    const parsed = publicationMediaCopySchema.safeParse(request)
    if (!parsed.success) throw new Error('Media copy request is invalid')
    await port.copyFromSignedUrl(parsed.data)
  }
}
