import {
  collectionEntryCreateSchema,
  collectionEntryDraftSchema,
  collectionTypeSchema,
  mediaAssetSchema,
  previewGrantResponseSchema,
  type CollectionEntryCreateInput,
  type CollectionEntryDraft,
  uploadTicketSchema,
} from '@web-app-demo/contracts'
import {
  selectedPageDraftSchema,
  type SelectedPageDraft,
} from '@vibe-cms/selected-site-package/contract'
import { z } from 'zod'

import type { AuthenticatedTransport } from '@/platform/api'

const cmsPageListItemSchema = z
  .object({
    id: z.uuid(),
    title: z.string().trim().min(1).max(120),
    path: z.string().trim().min(1).max(180),
    draftRevision: z.number().int().nonnegative(),
    archived: z.boolean(),
  })
  .strict()

const cmsPageEditorSchema = z
  .object({
    id: z.uuid(),
    title: z.string().trim().min(1).max(120),
    path: z.string().trim().min(1).max(180),
    draftPayload: z.unknown(),
    draftRevision: z.number().int().nonnegative(),
    archived: z.boolean(),
  })
  .strict()

const cmsCollectionEntrySchema = z
  .object({
    id: z.uuid(),
    type: collectionTypeSchema,
    name: z.string().trim().min(1).max(160),
    summary: z.string().trim().max(500).nullable(),
    revision: z.number().int().nonnegative(),
    archived: z.boolean(),
  })
  .strict()

const cmsCollectionEntryEditorSchema = z
  .object({
    id: z.uuid(),
    type: collectionTypeSchema,
    draftPayload: z.unknown(),
    draftRevision: z.number().int().nonnegative(),
    archived: z.boolean(),
  })
  .strict()

const cmsPageRevisionSchema = z
  .object({
    id: z.uuid(),
    revision: z.number().int().positive(),
    sourceDraftRevision: z.number().int().nonnegative(),
    publicationRevision: z.number().int().positive().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict()

export const cmsPageSaveResponseSchema = z
  .object({
    id: z.uuid(),
    title: z.string().trim().min(1).max(120),
    path: z.string().trim().min(1).max(180),
    draftPayload: z.unknown(),
    revision: z.number().int().nonnegative(),
  })
  .strict()

const cmsPublicationControllerSchema = z
  .object({
    desiredRevision: z.number().int().nonnegative().nullable(),
    publishedRevision: z.number().int().nonnegative().nullable(),
    activeBuildId: z.string().trim().min(1).nullable(),
    activeSlot: z.enum(['blue', 'green']),
    status: z.enum(['queued', 'building', 'published', 'failed']),
    heartbeatAt: z.string().datetime().nullable(),
    lastError: z.string().trim().min(1).nullable(),
  })
  .strict()

const cmsPublicationSummarySchema = z
  .object({
    policy: z.object({ editorCanPublish: z.boolean() }).strict(),
    controller: cmsPublicationControllerSchema.nullable(),
    latestPublication: z
      .object({
        id: z.uuid(),
        revision: z.number().int().positive(),
        artifactState: z.enum(['missing', 'uploading', 'ready']),
        createdAt: z.string().datetime(),
      })
      .strict()
      .nullable(),
  })
  .strict()
const cmsPublicationPolicySchema = z.object({ editorCanPublish: z.boolean() }).strict()
const cmsPublicationRetrySchema = z.object({ retried: z.literal(true) }).strict()

const cmsPendingApprovalSchema = z
  .object({
    id: z.uuid(),
    status: z.literal('pending'),
    requesterUserId: z.uuid(),
    createdAt: z.string().datetime().optional(),
  })
  .strict()

const cmsApprovalMutationResponseSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(['pending', 'approved', 'rejected']),
    requesterUserId: z.uuid(),
  })
  .strict()

const cmsPublicationMutationResponseSchema = z
  .object({ id: z.uuid(), revision: z.number().int().positive() })
  .strict()

const cmsMediaListSchema = z
  .object({ assets: z.array(mediaAssetSchema) })
  .strict()
const cmsMediaImageDownloadSchema = z.object({
  url: z.url(),
  expiresAt: z.string().datetime(),
}).strict()

const cmsSiteSettingsSchema = z.object({ companyName: z.string().trim().min(1).max(160), revision: z.number().int().nonnegative() }).strict()
const cmsSiteSettingsDraftSchema = z.object({
  companyName: z.string().trim().min(1).max(160),
  expectedRevision: z.number().int().nonnegative(),
}).strict()
const cmsMenuSchema = z.object({
  id: z.uuid(),
  location: z.enum(['header', 'footer']),
  items: z.array(z.object({ label: z.string().trim().min(1).max(120), href: z.string().trim().min(1).max(500) }).strict()).max(100),
  revision: z.number().int().nonnegative(),
}).strict()
const cmsMenuDraftSchema = z.object({
  items: z.array(z.object({ label: z.string().trim().min(1).max(120), href: z.string().trim().min(1).max(500) }).strict()).max(100),
  expectedRevision: z.number().int().nonnegative(),
}).strict()

const cmsMediaUpdateSchema = z
  .object({ asset: mediaAssetSchema })
  .strict()

const cmsMediaDeleteSchema = z
  .object({ deleted: z.literal(true) })
  .strict()

const cmsMediaAltSchema = z
  .object({ alt: z.string().trim().max(200).nullable() })
  .strict()

const cmsMediaUploadInputSchema = z
  .object({
    filename: z.string().trim().min(1).max(180),
    mimeType: z.enum([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/avif',
      'video/mp4',
      'application/pdf',
    ]),
    byteSize: z.number().int().positive(),
  })
  .strict()

const cmsMediaUploadSchema = z
  .object({ asset: mediaAssetSchema, upload: uploadTicketSchema })
  .strict()

export const cmsPagesResponseSchema = z.array(cmsPageListItemSchema)
export const cmsPageEditorResponseSchema = cmsPageEditorSchema
export const cmsEntriesResponseSchema = z.array(cmsCollectionEntrySchema)
export const cmsEntryEditorResponseSchema = cmsCollectionEntryEditorSchema
export const cmsPageRevisionsResponseSchema = z.array(cmsPageRevisionSchema)
export const cmsPublicationSummaryResponseSchema = cmsPublicationSummarySchema
export const cmsPendingApprovalsResponseSchema = z.array(cmsPendingApprovalSchema)
export const cmsMediaResponseSchema = cmsMediaListSchema
export const cmsMediaUpdateResponseSchema = cmsMediaUpdateSchema
export const cmsMediaDeleteResponseSchema = cmsMediaDeleteSchema
export const cmsMediaUploadResponseSchema = cmsMediaUploadSchema

export type CmsPageListItem = z.infer<typeof cmsPageListItemSchema>
export type CmsPageEditor = z.infer<typeof cmsPageEditorSchema>
export type CmsCollectionEntry = z.infer<typeof cmsCollectionEntrySchema>
export type CmsEntryEditor = z.infer<typeof cmsCollectionEntryEditorSchema>
export type CmsPageRevision = z.infer<typeof cmsPageRevisionSchema>
export type CmsPageSaveResponse = z.infer<typeof cmsPageSaveResponseSchema>
export type CmsPublicationSummary = z.infer<typeof cmsPublicationSummarySchema>
export type CmsPendingApproval = z.infer<typeof cmsPendingApprovalSchema>
export type CmsApprovalMutationResponse = z.infer<typeof cmsApprovalMutationResponseSchema>
export type CmsPublicationMutationResponse = z.infer<typeof cmsPublicationMutationResponseSchema>
export type CmsPublicationRetryResponse = z.infer<typeof cmsPublicationRetrySchema>
export type CmsMediaResponse = z.infer<typeof cmsMediaListSchema>
export type CmsMediaImageDownload = z.infer<typeof cmsMediaImageDownloadSchema>
export type CmsMediaUpdateResponse = z.infer<typeof cmsMediaUpdateSchema>
export type CmsMediaDeleteResponse = z.infer<typeof cmsMediaDeleteSchema>
export type CmsMediaUploadResponse = z.infer<typeof cmsMediaUploadSchema>
export type CmsPreviewGrantResponse = z.infer<typeof previewGrantResponseSchema>
export type CmsSiteSettings = z.infer<typeof cmsSiteSettingsSchema>
export type CmsMenu = z.infer<typeof cmsMenuSchema>

export function getCmsPages(transport: AuthenticatedTransport) {
  return transport.request('/api/cms/pages', cmsPagesResponseSchema)
}

export function getCmsPage(transport: AuthenticatedTransport, pageId: string) {
  return transport.request(
    `/api/cms/pages/${encodeURIComponent(pageId)}`,
    cmsPageEditorResponseSchema,
  )
}

export function getCmsEntries(
  transport: AuthenticatedTransport,
  type?: CmsCollectionEntry['type'],
) {
  const parsedType = type ? collectionTypeSchema.parse(type) : undefined
  const path = parsedType ? `/api/cms/entries?type=${encodeURIComponent(parsedType)}` : '/api/cms/entries'
  return transport.request(path, cmsEntriesResponseSchema)
}

export function getCmsEntry(transport: AuthenticatedTransport, entryId: string) {
  return transport.request(
    `/api/cms/entries/${encodeURIComponent(entryId)}`,
    cmsCollectionEntryEditorSchema,
  )
}

export function createCmsEntry(
  transport: AuthenticatedTransport,
  input: CollectionEntryCreateInput,
) {
  return transport.request('/api/cms/entries', cmsCollectionEntryEditorSchema, {
    method: 'POST',
    body: collectionEntryCreateSchema.parse(input),
  })
}

export function saveCmsEntry(
  transport: AuthenticatedTransport,
  entryId: string,
  input: CollectionEntryDraft,
) {
  return transport.request(
    `/api/cms/entries/${encodeURIComponent(entryId)}`,
    cmsCollectionEntryEditorSchema,
    {
      method: 'PATCH',
      body: collectionEntryDraftSchema.parse(input),
    },
  )
}

export function getCmsPageRevisions(transport: AuthenticatedTransport, pageId: string) {
  return transport.request(
    `/api/cms/pages/${encodeURIComponent(pageId)}/revisions`,
    cmsPageRevisionsResponseSchema,
  )
}

export function restoreCmsPageRevision(
  transport: AuthenticatedTransport,
  pageId: string,
  revisionId: string,
) {
  return transport.request(
    `/api/cms/pages/${encodeURIComponent(pageId)}/revisions/${encodeURIComponent(revisionId)}/restore`,
    cmsPageSaveResponseSchema,
    { method: 'POST' },
  )
}

export function saveCmsPage(
  transport: AuthenticatedTransport,
  pageId: string,
  input: SelectedPageDraft,
) {
  return transport.request(
    `/api/cms/pages/${encodeURIComponent(pageId)}`,
    cmsPageSaveResponseSchema,
    {
      method: 'PATCH',
      body: selectedPageDraftSchema.parse(input),
    },
  )
}

export function getCmsPublicationSummary(transport: AuthenticatedTransport) {
  return transport.request('/api/cms/publication', cmsPublicationSummaryResponseSchema)
}

export function saveCmsPublicationPolicy(transport: AuthenticatedTransport, editorCanPublish: boolean) {
  return transport.request('/api/cms/publication/policy', cmsPublicationPolicySchema, {
    method: 'PATCH',
    body: { editorCanPublish: z.boolean().parse(editorCanPublish) },
  })
}

export function getCmsSiteSettings(transport: AuthenticatedTransport) {
  return transport.request('/api/cms/settings', cmsSiteSettingsSchema)
}

export function saveCmsSiteSettings(
  transport: AuthenticatedTransport,
  input: { companyName: string; expectedRevision: number },
) {
  return transport.request('/api/cms/settings', cmsSiteSettingsSchema, {
    method: 'PATCH',
    body: cmsSiteSettingsDraftSchema.parse(input),
  })
}

export function getCmsMenu(transport: AuthenticatedTransport, menuId: string) {
  return transport.request(`/api/cms/menus/${encodeURIComponent(z.uuid().parse(menuId))}`, cmsMenuSchema)
}

export function getCmsMenus(transport: AuthenticatedTransport) {
  return transport.request('/api/cms/menus', z.array(cmsMenuSchema))
}

export function saveCmsMenu(
  transport: AuthenticatedTransport,
  menuId: string,
  input: { items: Array<{ label: string; href: string }>; expectedRevision: number },
) {
  return transport.request(
    `/api/cms/menus/${encodeURIComponent(z.uuid().parse(menuId))}`,
    cmsMenuSchema,
    { method: 'PATCH', body: cmsMenuDraftSchema.parse(input) },
  )
}

export function createCmsPreviewGrant(transport: AuthenticatedTransport, pageId: string) {
  return transport.request('/api/cms/preview/grants', previewGrantResponseSchema, {
    method: 'POST',
    body: { pageId: z.uuid().parse(pageId) },
  })
}

export function getCmsPendingApprovals(transport: AuthenticatedTransport) {
  return transport.request(
    '/api/cms/approvals/pending',
    cmsPendingApprovalsResponseSchema,
  )
}

export function getCmsMedia(transport: AuthenticatedTransport, query?: string) {
  const trimmed = query?.trim()
  const path = trimmed
    ? `/api/cms/media?q=${encodeURIComponent(trimmed)}`
    : '/api/cms/media'
  return transport.request(path, cmsMediaListSchema)
}

export function getCmsMediaImageDownload(transport: AuthenticatedTransport, assetId: string) {
  return transport.request(
    `/api/cms/media/${encodeURIComponent(z.uuid().parse(assetId))}/download`,
    cmsMediaImageDownloadSchema,
  )
}

export function updateCmsMediaAlt(
  transport: AuthenticatedTransport,
  assetId: string,
  alt: string | null,
) {
  return transport.request(
    `/api/cms/media/${encodeURIComponent(assetId)}`,
    cmsMediaUpdateSchema,
    { method: 'PATCH', body: cmsMediaAltSchema.parse({ alt }) },
  )
}

export function createCmsMediaUpload(
  transport: AuthenticatedTransport,
  input: { filename: string; mimeType: string; byteSize: number },
) {
  return transport.request('/api/cms/media/uploads', cmsMediaUploadSchema, {
    method: 'POST',
    body: cmsMediaUploadInputSchema.parse(input),
  })
}

export function finalizeCmsMediaUpload(transport: AuthenticatedTransport, assetId: string) {
  return transport.request(
    `/api/cms/media/${encodeURIComponent(assetId)}/finalize`,
    cmsMediaUpdateSchema,
    { method: 'POST' },
  )
}

export function deleteCmsMedia(transport: AuthenticatedTransport, assetId: string) {
  return transport.request(
    `/api/cms/media/${encodeURIComponent(assetId)}`,
    cmsMediaDeleteSchema,
    { method: 'DELETE' },
  )
}

export function submitCmsApproval(transport: AuthenticatedTransport, revision: number) {
  return transport.request('/api/cms/approvals', cmsApprovalMutationResponseSchema, {
    method: 'POST',
    body: { revision: z.number().int().positive().parse(revision) },
  })
}

export function approveCmsApproval(transport: AuthenticatedTransport, approvalId: string) {
  return transport.request(
    `/api/cms/approvals/${encodeURIComponent(approvalId)}/approve`,
    cmsPublicationMutationResponseSchema,
    { method: 'POST' },
  )
}

export function rejectCmsApproval(transport: AuthenticatedTransport, approvalId: string, note: string) {
  return transport.request(
    `/api/cms/approvals/${encodeURIComponent(approvalId)}/reject`,
    cmsApprovalMutationResponseSchema,
    { method: 'POST', body: { note: note.trim() } },
  )
}

export function publishCmsCurrent(transport: AuthenticatedTransport, revision: number) {
  return transport.request('/api/cms/publish', cmsPublicationMutationResponseSchema, {
    method: 'POST',
    body: { revision: z.number().int().positive().parse(revision) },
  })
}

export function retryCmsPublication(transport: AuthenticatedTransport) {
  return transport.request('/api/cms/publication/retry', cmsPublicationRetrySchema, { method: 'POST' })
}
