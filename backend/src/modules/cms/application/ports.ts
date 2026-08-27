/** Persistence-neutral transaction boundary. Infrastructure supplies the concrete client. */
export type CmsTransaction = Record<string, unknown>

export type CmsPolicyRecord = {
  key: string
  editorCanPublish: boolean
}

export type CmsControllerRecord = {
  key: string
  desiredRevision: number | null
  publishedRevision: number | null
  activeBuildId: string | null
  activeSlot: 'blue' | 'green'
  status: 'queued' | 'building' | 'published' | 'failed'
  heartbeatAt: Date | null
  lastError: string | null
}

export type CmsPageRecord = {
  id: string
  path: string
  title: string
  draftPayload: unknown
  draftRevision: number
  archivedAt?: Date | null
}

export type CmsPageRevisionRecord = {
  id: string
  pageId: string
  revision: number
  sourcePayload: unknown
  sitePackageSchemaVersion: number
}

export type CmsPageRevisionSummaryRecord = {
  id: string
  pageId: string
  revision: number
  sourceDraftRevision: number
  publicationRevision: number | null
  createdAt: Date
}

export type CmsContentEntryRecord = {
  id: string
  type: 'service' | 'review' | 'teamMember' | 'faq' | 'case'
  draftPayload: unknown
  draftRevision: number
  archivedAt?: Date | null
}

export type CmsMenuRecord = {
  id: string
  location: 'header' | 'footer'
  draftPayload: unknown
  draftRevision: number
}

export type CmsSettingsRecord = {
  key: string
  draftPayload: unknown
  draftRevision: number
}

export type CmsContentEntryRevisionRecord = {
  id: string
  entryId: string
  revision: number
}

export type CmsMediaAssetRecord = {
  id: string
  objectKey: string
  contentVersion: string
  contentType: string
  byteSize: number
}

export type CmsPublicationRecord = {
  id: string
  revision: number
  snapshot: unknown
}

/** The publication fields that are safe and sufficient for the private CMS status view. */
export type CmsLatestPublicationRecord = {
  id: string
  revision: number
  artifactState: 'missing' | 'uploading' | 'ready'
  createdAt: Date
}

export type CmsApprovalRecord = {
  id: string
  revisionMap: unknown
  candidateSnapshot: unknown
  requesterUserId: string
  status: 'pending' | 'approved' | 'rejected' | 'superseded'
  reviewerUserId?: string | null
  decisionNote?: string | null
  createdAt?: Date
}

export type CmsPendingApprovalRecord = Pick<CmsApprovalRecord, 'id' | 'requesterUserId' | 'status'> & {
  createdAt?: Date
}

export type CmsOptimisticConflict = {
  aggregateId: string
  currentRevision?: number
}

export type CmsOptimisticResult =
  | { updated: true; revision: number }
  | { updated: false; conflict: CmsOptimisticConflict }

export type CmsRepository = {
  getPolicy(): Promise<CmsPolicyRecord | null>
  ensurePolicy(input?: { editorCanPublish?: boolean; updatedByUserId?: string }): Promise<CmsPolicyRecord>
  getController(): Promise<CmsControllerRecord | null>
  getLatestPublication(): Promise<CmsLatestPublicationRecord | null>
  retryPublication(): Promise<boolean>
  listPendingApprovals(): Promise<CmsPendingApprovalRecord[]>
  ensureController(): Promise<CmsControllerRecord>
  createPage(input: { path: string; title: string; payload: unknown }): Promise<CmsPageRecord>
  findPageByPath(path: string): Promise<CmsPageRecord | null>
  getPage(pageId: string): Promise<CmsPageRecord | null>
  listPages(): Promise<CmsPageRecord[]>
  getPageForEditor(pageId: string): Promise<CmsPageRecord | null>
  updatePageDraft(pageId: string, expectedRevision: number, payload: unknown): Promise<CmsOptimisticResult>
  createPageRevision(input: {
    pageId: string
    sourceDraftRevision: number
    sourcePayload: unknown
    publicPayload: unknown
    authorUserId?: string
    publicationRevision?: number
    sitePackageSchemaVersion: number
  }): Promise<CmsPageRevisionRecord>
  getPageRevision(revisionId: string): Promise<CmsPageRevisionRecord | null>
  listPageRevisions(pageId: string): Promise<CmsPageRevisionSummaryRecord[]>
  updatePageRevision(revisionId: string, patch: unknown): Promise<never>
  createContentEntry(input: { type: 'service' | 'review' | 'teamMember' | 'faq' | 'case'; payload: unknown }): Promise<CmsContentEntryRecord>
  listContentEntries(type?: CmsContentEntryRecord['type']): Promise<CmsContentEntryRecord[]>
  getContentEntry(entryId: string): Promise<CmsContentEntryRecord | null>
  updateContentEntryDraft(entryId: string, expectedRevision: number, payload: unknown): Promise<CmsOptimisticResult>
  createContentEntryRevision(input: {
    entryId: string
    sourceDraftRevision: number
    sourcePayload: unknown
    publicPayload: unknown
    authorUserId?: string
    publicationRevision?: number
    sitePackageSchemaVersion: number
  }): Promise<CmsContentEntryRevisionRecord>
  createMediaAsset(input: {
    filename?: string
    objectKey: string
    contentVersion?: string
    storageEtag?: string
    contentType: string
    byteSize: number
    width?: number
    height?: number
    durationMs?: number
    altText?: string
    state?: 'pending' | 'ready' | 'deleting' | 'deleted'
  }): Promise<CmsMediaAssetRecord>
  getMenu(menuId: string): Promise<CmsMenuRecord | null>
  listMenus(): Promise<CmsMenuRecord[]>
  updateMenuDraft(menuId: string, expectedRevision: number, payload: unknown): Promise<CmsOptimisticResult>
  getSiteSettings(): Promise<CmsSettingsRecord | null>
  updateSiteSettingsDraft(expectedRevision: number, payload: unknown): Promise<CmsOptimisticResult>
  replaceMediaUsage(
    owner: { ownerType: string; ownerId: string; scope: string },
    assetIds: string[],
  ): Promise<void>
  replaceContentUsage(
    owner: { ownerType: string; ownerId: string; scope: string },
    usages: Array<{ referencedType: string; referencedId: string; path: string }>,
  ): Promise<void>
  createPublication(input: {
    revision: number
    snapshot: unknown
    sourceApprovalId?: string
    actorUserId?: string
    actorRole?: 'editor' | 'owner'
  }): Promise<CmsPublicationRecord>
  createApproval(input: {
    revisionMap: unknown
    candidateSnapshot: unknown
    requesterUserId: string
  }): Promise<CmsApprovalRecord>
  approveAndCreatePublication(input: {
    approvalId: string
    reviewerUserId: string
    actorRole?: 'editor' | 'owner'
  }): Promise<CmsPublicationRecord | null>
  getApproval(approvalId: string): Promise<CmsApprovalRecord | null>
  decideApproval(input: {
    approvalId: string
    expectedStatus: 'pending'
    status: 'approved' | 'rejected'
    reviewerUserId: string
    decisionNote?: string
  }): Promise<CmsApprovalRecord | null>
}
