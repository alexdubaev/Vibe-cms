export type MediaCopyRequest = {
  sourceUrl: string
  destinationPath: string
  contentType: string
}

export type MediaCopyPort = {
  copyFromSignedUrl(input: MediaCopyRequest): Promise<void>
}

/** Media is copied by URL, never by sending a private object key in a queue command. */
export async function copyPublicationMedia(port: MediaCopyPort, requests: MediaCopyRequest[]) {
  for (const request of requests) {
    if (!request.sourceUrl.startsWith('https://') && !request.sourceUrl.startsWith('http://')) {
      throw new Error('Media source must be a signed HTTP URL')
    }
    if (!/^\/media\/[a-z0-9-]+\/[a-z0-9-]+\/[A-Za-z0-9._-]+$/.test(request.destinationPath)) {
      throw new Error('Media destination path is invalid')
    }
    await port.copyFromSignedUrl(request)
  }
}
