import type { BuildInput } from './backend-client'
import { promotePublication, type PublicationPromotionPort } from './yandex-promotion'
import { collectStaticObjects, uploadStaticRelease, type StaticUploadPort } from './static-upload'

export async function publishBuiltRelease(input: {
  build: BuildInput
  outputDirectory: string
  uploader: StaticUploadPort
  promotion: PublicationPromotionPort
}): Promise<{ markerVerified: boolean }> {
  const objects = await collectStaticObjects({ outputDirectory: input.outputDirectory, slot: input.build.slot })
  await uploadStaticRelease({
    port: input.uploader,
    slot: input.build.slot,
    objects,
    revision: input.build.publicationRevision,
  })
  await promotePublication(input.promotion, {
    slot: input.build.slot,
    revision: input.build.publicationRevision,
  })
  return { markerVerified: true }
}
