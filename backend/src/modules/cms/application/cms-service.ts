import {
  capabilitiesForRole,
  collectionEntryCreateSchema,
  collectionEntryDraftSchema,
  type CollectionEntryCreateInput,
  type CollectionEntryDraft,
  type CmsCapability,
} from '@web-app-demo/contracts'
import { z } from 'zod'

import type {
  CmsApprovalRecord,
  CmsContentEntryRecord,
  CmsControllerRecord,
  CmsLatestPublicationRecord,
  CmsMenuRecord,
  CmsPageRecord,
  CmsPageRevisionSummaryRecord,
  CmsPendingApprovalRecord,
  CmsRepository,
  CmsSettingsRecord,
} from './ports'
import { CmsSnapshotService } from './snapshot-service'
import { CmsConflictError, CmsRepositoryError } from '../domain/errors'
import { migratePagePayload } from './site-package-migration-service'
import type { CmsSitePackageMigration } from '../domain/site-package-state'

export type CmsActor = {
  id: string
  role: 'user' | 'editor' | 'owner'
  displayName?: string | null
}

export type CmsPageDraft = {
  title: string
  path: string
  navigationLabel?: string
  seo?: unknown
  blocks: unknown[]
  expectedRevision: number
}

/** The selected site package supplies these parsers at the composition root. */
export type CmsValidation = {
  pageDraftSchema: { parse(input: unknown): CmsPageDraft }
  blockDefinitions: readonly { type: string }[]
}

export type PageEditorDto = {
  id: string
  title: string
  path: string
  draftPayload: unknown
  revision: number
}

export type PageListItemDto = {
  id: string
  title: string
  path: string
  draftRevision: number
  archived: boolean
}

export type PageForEditorDto = {
  id: string
  title: string
  path: string
  draftPayload: unknown
  draftRevision: number
  archived: boolean
}

export type PageRevisionListItemDto = {
  id: string
  revision: number
  sourceDraftRevision: number
  publicationRevision: number | null
  createdAt: string
}

export type PublicationSummaryDto = {
  policy: {
    editorCanPublish: boolean
  }
  controller: {
    desiredRevision: number | null
    publishedRevision: number | null
    activeBuildId: string | null
    activeSlot: 'blue' | 'green'
    status: CmsControllerRecord['status']
    heartbeatAt: string | null
    lastError: string | null
  } | null
  latestPublication: {
    id: string
    revision: number
    artifactState: CmsLatestPublicationRecord['artifactState']
    createdAt: string
  } | null
}
export type PublicationPolicyDto = { editorCanPublish: boolean }

export type EntryEditorDto = {
  id: string
  type: CollectionEntryDraft['type']
  draftPayload: unknown
  draftRevision: number
  archived: boolean
}
export type EntryListItemDto = {
  id: string
  type: CollectionEntryDraft['type']
  name: string
  summary: string | null
  revision: number
  archived: boolean
}
export type MenuEditorDto = CmsMenuRecord & { revision: number }
export type SiteSettingsEditorDto = CmsSettingsRecord & { revision: number }
export type MenuPresentationDto = {
  id: string
  location: CmsMenuRecord['location']
  items: Array<{ label: string; href: string }>
  revision: number
}
export type SiteSettingsPresentationDto = {
  companyName: string
  revision: number
}

export const menuDraftSchema = z.object({
  items: z.array(z.object({ label: z.string().trim().min(1).max(120), href: z.string().trim().min(1).max(500) }).strict()).max(100),
  expectedRevision: z.number().int().nonnegative(),
}).strict()
export const siteSettingsDraftSchema = z.object({
  companyName: z.string().trim().min(1).max(160),
  expectedRevision: z.number().int().nonnegative(),
}).strict()
const menuPresentationPayloadSchema = z.object({
  items: z.array(z.object({ label: z.string().trim().min(1).max(120), href: z.string().trim().min(1).max(500) }).strip()).max(100),
}).strip()
const siteSettingsPresentationPayloadSchema = z.object({
  companyName: z.string().trim().min(1).max(160),
}).strip()
type MenuDraft = z.infer<typeof menuDraftSchema>
type SiteSettingsDraft = z.infer<typeof siteSettingsDraftSchema>

export type ApprovalDto = {
  id: string
  status: CmsApprovalRecord['status']
  requesterUserId: string
  candidateSnapshot: unknown
}

export type PendingApprovalDto = {
  id: string
  status: 'pending'
  requesterUserId: string
  createdAt?: string
}

export type PublicationDto = {
  id: string
  revision: number
  snapshot: unknown
}

type ServiceDependencies = {
  repository: Pick<
    CmsRepository,
    | 'getPolicy'
    | 'ensurePolicy'
    | 'getPage'
    | 'listPages'
    | 'getPageForEditor'
    | 'listPageRevisions'
    | 'listContentEntries'
    | 'createContentEntry'
    | 'getController'
    | 'getLatestPublication'
    | 'listPendingApprovals'
    | 'getContentEntry'
    | 'getMenu'
    | 'listMenus'
    | 'getSiteSettings'
    | 'updatePageDraft'
    | 'updateContentEntryDraft'
    | 'updateMenuDraft'
    | 'updateSiteSettingsDraft'
    | 'createPageRevision'
    | 'createContentEntryRevision'
    | 'createApproval'
    | 'approveAndCreatePublication'
    | 'getApproval'
    | 'decideApproval'
    | 'createPublication'
    | 'getPageRevision'
  > & Partial<Pick<CmsRepository, 'retryPublication'>>
  snapshot: Pick<CmsSnapshotService, 'createCandidate'>
  validation: CmsValidation
  sitePackage?: {
    schemaVersion: number
    migrations: readonly CmsSitePackageMigration[]
  }
  clock?: { now(): Date }
}

export class CmsService {
  private readonly clock: { now(): Date }

  constructor(private readonly dependencies: ServiceDependencies) {
    this.clock = dependencies.clock ?? { now: () => new Date() }
  }

  async listPages(actor: CmsActor): Promise<PageListItemDto[]> {
    this.requireCapability(actor, 'cms:read')
    const pages = await this.dependencies.repository.listPages()
    return pages.map(toPageListItemDto)
  }

  async getPageForEditor(actor: CmsActor, pageId: string): Promise<PageForEditorDto> {
    this.requireCapability(actor, 'cms:read')
    const page = await this.dependencies.repository.getPageForEditor(pageId)
    if (!page) throw new CmsRepositoryError('Page was not found', 'NOT_FOUND')
    return toPageForEditorDto(page)
  }

  async listEntries(actor: CmsActor, type?: CollectionEntryDraft['type']): Promise<EntryListItemDto[]> {
    this.requireCapability(actor, 'cms:read')
    const entries = await this.dependencies.repository.listContentEntries(type)
    return entries.flatMap((entry) => {
      const payload = entry.draftPayload && typeof entry.draftPayload === 'object' && !Array.isArray(entry.draftPayload)
        ? entry.draftPayload
        : {}
      const parsed = collectionEntryDraftSchema.safeParse({
        ...(payload as Record<string, unknown>),
        type: entry.type,
        expectedRevision: entry.draftRevision,
      })
      if (!parsed.success) return []
      return [{
        id: entry.id,
        type: parsed.data.type,
        name: parsed.data.name,
        summary: parsed.data.summary ?? null,
        revision: entry.draftRevision,
        archived: Boolean(entry.archivedAt),
      }]
    })
  }

  async getEntry(actor: CmsActor, entryId: string): Promise<EntryEditorDto> {
    this.requireCapability(actor, 'cms:read')
    const entry = await this.dependencies.repository.getContentEntry(entryId)
    if (!entry) throw new CmsRepositoryError('Collection entry was not found', 'NOT_FOUND')
    return toEntryEditorDto(entry)
  }

  async getMenu(actor: CmsActor, menuId: string): Promise<MenuPresentationDto> {
    this.requireCapability(actor, 'cms:read')
    const menu = await this.dependencies.repository.getMenu(menuId)
    if (!menu) throw new CmsRepositoryError('Menu was not found', 'NOT_FOUND')
    const payload = menuPresentationPayloadSchema.parse(menu.draftPayload)
    return toMenuPresentationDto(menu, payload)
  }

  async listMenus(actor: CmsActor): Promise<MenuPresentationDto[]> {
    this.requireCapability(actor, 'cms:read')
    const menus = await this.dependencies.repository.listMenus()
    return menus.map((menu) => toMenuPresentationDto(menu, menuPresentationPayloadSchema.parse(menu.draftPayload)))
  }

  async getSiteSettings(actor: CmsActor): Promise<SiteSettingsPresentationDto> {
    this.requireCapability(actor, 'cms:read')
    const settings = await this.dependencies.repository.getSiteSettings()
    if (!settings) throw new CmsRepositoryError('Site settings were not initialised', 'NOT_FOUND')
    const payload = siteSettingsPresentationPayloadSchema.parse(settings.draftPayload)
    return {
      companyName: payload.companyName,
      revision: settings.draftRevision,
    }
  }

  async createEntry(actor: CmsActor, input: CollectionEntryCreateInput): Promise<EntryEditorDto> {
    this.requireCapability(actor, 'cms:edit')
    const draft = collectionEntryCreateSchema.parse(input)
    const entry = await this.dependencies.repository.createContentEntry({
      type: draft.type,
      payload: draft,
    })
    await this.dependencies.repository.createContentEntryRevision({
      entryId: entry.id,
      sourceDraftRevision: entry.draftRevision,
      sourcePayload: draft,
      publicPayload: draft,
      authorUserId: actor.id,
      sitePackageSchemaVersion: this.selectedSchemaVersion,
    })
    return toEntryEditorDto(entry)
  }

  async listPageRevisions(actor: CmsActor, pageId: string): Promise<PageRevisionListItemDto[]> {
    this.requireCapability(actor, 'cms:read')
    await this.requirePage(pageId)
    const revisions = await this.dependencies.repository.listPageRevisions(pageId)
    return revisions.map(toPageRevisionListItemDto)
  }

  async getPublicationSummary(actor: CmsActor): Promise<PublicationSummaryDto> {
    this.requireCapability(actor, 'cms:read')
    const [policy, controller, latestPublication] = await Promise.all([
      this.dependencies.repository.getPolicy(),
      this.dependencies.repository.getController(),
      this.dependencies.repository.getLatestPublication(),
    ])

    return {
      policy: { editorCanPublish: policy?.editorCanPublish ?? false },
      controller: controller ? toPublicationControllerDto(controller) : null,
      latestPublication: latestPublication ? toLatestPublicationDto(latestPublication) : null,
    }
  }

  async retryPublication(actor: CmsActor): Promise<{ retried: true }> {
    if (actor.role === 'editor') {
      const policy = await this.dependencies.repository.getPolicy()
      if (!policy?.editorCanPublish) {
        throw new CmsRepositoryError('Editor publishing is disabled by the owner', 'FORBIDDEN')
      }
    } else {
      this.requireCapability(actor, 'cms:publish')
    }
    if (!this.dependencies.repository.retryPublication) {
      throw new CmsRepositoryError('Publication retry is not configured', 'CMS_RETRY_UNAVAILABLE')
    }
    const retried = await this.dependencies.repository.retryPublication()
    if (!retried) throw new CmsRepositoryError('No failed publication is available to retry', 'CMS_RETRY_NOT_AVAILABLE')
    return { retried: true }
  }

  async savePublicationPolicy(actor: CmsActor, input: PublicationPolicyDto): Promise<PublicationPolicyDto> {
    if (actor.role !== 'owner') {
      throw new CmsRepositoryError('Only an owner can change publication policy', 'FORBIDDEN')
    }
    const policy = await this.dependencies.repository.ensurePolicy({
      editorCanPublish: z.boolean().parse(input.editorCanPublish),
      updatedByUserId: actor.id,
    })
    return { editorCanPublish: policy.editorCanPublish }
  }

  async listPendingApprovals(actor: CmsActor): Promise<PendingApprovalDto[]> {
    this.requireCapability(actor, 'cms:read')
    const approvals = await this.dependencies.repository.listPendingApprovals()
    return approvals.map(toPendingApprovalDto)
  }

  async savePage(actor: CmsActor, pageId: string, input: unknown): Promise<PageEditorDto> {
    this.requireCapability(actor, 'cms:edit')
    const pageDraft = this.parsePageDraft(input)
    const page = await this.requirePage(pageId)
    const result = await this.dependencies.repository.updatePageDraft(pageId, pageDraft.expectedRevision, {
      title: pageDraft.title,
      path: pageDraft.path,
      navigationLabel: pageDraft.navigationLabel,
      seo: pageDraft.seo,
      blocks: pageDraft.blocks,
    })
    if (!result.updated) {
      throw new CmsConflictError(pageId, result.conflict.currentRevision)
    }
    await this.dependencies.repository.createPageRevision({
      pageId,
      sourceDraftRevision: result.revision,
      sourcePayload: {
        title: pageDraft.title,
        path: pageDraft.path,
        navigationLabel: pageDraft.navigationLabel,
        seo: pageDraft.seo,
        blocks: pageDraft.blocks,
      },
      publicPayload: {
        id: page.id,
        title: pageDraft.title,
        path: pageDraft.path,
        ...(pageDraft.navigationLabel ? { navigationLabel: pageDraft.navigationLabel } : {}),
        ...(pageDraft.seo ? { seo: pageDraft.seo } : {}),
        blocks: pageDraft.blocks,
      },
      authorUserId: actor.id,
      sitePackageSchemaVersion: this.selectedSchemaVersion,
    })

    return {
      id: page.id,
      title: pageDraft.title,
      path: pageDraft.path,
      draftPayload: {
        title: pageDraft.title,
        path: pageDraft.path,
        navigationLabel: pageDraft.navigationLabel,
        seo: pageDraft.seo,
        blocks: pageDraft.blocks,
      },
      revision: result.revision,
    }
  }

  async saveEntry(actor: CmsActor, entryId: string, input: CollectionEntryDraft): Promise<EntryEditorDto> {
    this.requireCapability(actor, 'cms:edit')
    const draft = collectionEntryDraftSchema.parse(input)
    const entry = await this.dependencies.repository.getContentEntry(entryId)
    if (!entry) throw new CmsRepositoryError('Collection entry was not found', 'NOT_FOUND')
    const { expectedRevision, ...payload } = draft
    const result = await this.dependencies.repository.updateContentEntryDraft(entryId, expectedRevision, payload)
    if (!result.updated) throw new CmsConflictError(entryId, result.conflict.currentRevision)
    await this.dependencies.repository.createContentEntryRevision({
      entryId,
      sourceDraftRevision: result.revision,
      sourcePayload: payload,
      publicPayload: payload,
      authorUserId: actor.id,
      sitePackageSchemaVersion: this.selectedSchemaVersion,
    })
    return {
      ...toEntryEditorDto(entry),
      draftPayload: payload,
      draftRevision: result.revision,
    }
  }

  async saveMenu(actor: CmsActor, menuId: string, input: MenuDraft): Promise<MenuEditorDto> {
    this.requireCapability(actor, 'cms:edit')
    const draft = menuDraftSchema.parse(input)
    const menu = await this.dependencies.repository.getMenu(menuId)
    if (!menu) throw new CmsRepositoryError('Menu was not found', 'NOT_FOUND')
    const result = await this.dependencies.repository.updateMenuDraft(menuId, draft.expectedRevision, { items: draft.items })
    if (!result.updated) throw new CmsConflictError(menuId, result.conflict.currentRevision)
    return { ...menu, draftPayload: { items: draft.items }, revision: result.revision }
  }

  async saveSettings(actor: CmsActor, input: SiteSettingsDraft): Promise<SiteSettingsEditorDto> {
    this.requireCapability(actor, 'cms:edit')
    const draft = siteSettingsDraftSchema.parse(input)
    const settings = await this.dependencies.repository.getSiteSettings()
    if (!settings) throw new CmsRepositoryError('Site settings were not initialised', 'NOT_FOUND')
    const result = await this.dependencies.repository.updateSiteSettingsDraft(draft.expectedRevision, {
      companyName: draft.companyName,
    })
    if (!result.updated) throw new CmsConflictError(settings.key, result.conflict.currentRevision)
    return { ...settings, draftPayload: { companyName: draft.companyName }, revision: result.revision }
  }

  async submitForApproval(actor: CmsActor, revision: number): Promise<ApprovalDto> {
    this.requireCapability(actor, 'cms:edit')
    const candidate = await this.dependencies.snapshot.createCandidate(revision)
    const approval = await this.dependencies.repository.createApproval({
      revisionMap: candidate.revisionMap,
      candidateSnapshot: candidate.snapshot,
      requesterUserId: actor.id,
    })
    return toApprovalDto(approval)
  }

  async approve(actor: CmsActor, approvalId: string): Promise<PublicationDto> {
    this.requireCapability(actor, 'cms:approve')
    const publication = await this.dependencies.repository.approveAndCreatePublication({
      approvalId,
      reviewerUserId: actor.id,
      actorRole: publicationActorRole(actor),
    })
    if (!publication) throw new CmsRepositoryError('Approval is no longer pending', 'CMS_APPROVAL_STALE')
    return toPublicationDto(publication)
  }

  async reject(actor: CmsActor, approvalId: string, note: string): Promise<ApprovalDto> {
    this.requireCapability(actor, 'cms:approve')
    const approval = await this.requireApproval(approvalId)
    if (approval.status !== 'pending') throw new CmsRepositoryError('Approval is no longer pending', 'CMS_APPROVAL_STALE')
    const decided = await this.dependencies.repository.decideApproval({
      approvalId,
      expectedStatus: 'pending',
      status: 'rejected',
      reviewerUserId: actor.id,
      decisionNote: note.trim(),
    })
    if (!decided) throw new CmsRepositoryError('Approval is no longer pending', 'CMS_APPROVAL_STALE')
    return toApprovalDto(decided)
  }

  async publishCurrent(actor: CmsActor, revision: number): Promise<PublicationDto> {
    if (actor.role === 'editor') {
      const policy = await this.dependencies.repository.getPolicy()
      if (!policy?.editorCanPublish) {
        throw new CmsRepositoryError('Editor publishing is disabled by the owner', 'FORBIDDEN')
      }
    } else {
      this.requireCapability(actor, 'cms:publish')
    }
    const candidate = await this.dependencies.snapshot.createCandidate(revision)
    const publication = await this.dependencies.repository.createPublication({
      revision,
      snapshot: candidate.snapshot,
      actorUserId: actor.id,
      actorRole: publicationActorRole(actor),
    })
    return toPublicationDto(publication)
  }

  async restorePage(actor: CmsActor, pageRevisionId: string, expectedPageId?: string): Promise<PageEditorDto> {
    this.requireCapability(actor, 'cms:edit')
    const revision = await this.dependencies.repository.getPageRevision(pageRevisionId)
    if (!revision) throw new CmsRepositoryError('Page revision was not found', 'NOT_FOUND')
    if (expectedPageId && revision.pageId !== expectedPageId) {
      throw new CmsRepositoryError('Page revision was not found', 'NOT_FOUND')
    }
    const page = await this.requirePage(revision.pageId)
    const migratedSource = migratePagePayload(
      revision.sourcePayload,
      revision.sitePackageSchemaVersion ?? 1,
      this.selectedSchemaVersion,
      this.dependencies.sitePackage?.migrations ?? [],
    )
    const source = this.parsePageDraft({
      ...(migratedSource as Record<string, unknown>),
      expectedRevision: page.draftRevision,
    })
    return this.savePage(actor, page.id, source)
  }

  private get selectedSchemaVersion() {
    return this.dependencies.sitePackage?.schemaVersion ?? 1
  }

  private async requirePage(pageId: string): Promise<CmsPageRecord> {
    const page = await this.dependencies.repository.getPage(pageId)
    if (!page || page.archivedAt) throw new CmsRepositoryError('Page was not found', 'NOT_FOUND')
    return page
  }

  private async requireApproval(approvalId: string): Promise<CmsApprovalRecord> {
    const approval = await this.dependencies.repository.getApproval(approvalId)
    if (!approval) throw new CmsRepositoryError('Approval was not found', 'NOT_FOUND')
    return approval
  }

  private parsePageDraft(input: unknown): CmsPageDraft {
    try {
      return this.dependencies.validation.pageDraftSchema.parse(input)
    } catch (cause) {
      throw new CmsRepositoryError('CMS page draft does not match the selected site package', 'CMS_VALIDATION', { cause })
    }
  }

  private requireCapability(actor: CmsActor, capability: CmsCapability) {
    const policy = { editorCanPublish: false }
    if (!capabilitiesForRole(actor.role, policy).includes(capability)) {
      throw new CmsRepositoryError('You do not have permission to access this resource', 'FORBIDDEN')
    }
  }
}

function toApprovalDto(approval: CmsApprovalRecord): ApprovalDto {
  return {
    id: approval.id,
    status: approval.status,
    requesterUserId: approval.requesterUserId,
    candidateSnapshot: approval.candidateSnapshot,
  }
}

function toPageListItemDto(page: CmsPageRecord): PageListItemDto {
  return {
    id: page.id,
    title: page.title,
    path: page.path,
    draftRevision: page.draftRevision,
    archived: Boolean(page.archivedAt),
  }
}

function toMenuPresentationDto(
  menu: CmsMenuRecord,
  payload: z.infer<typeof menuPresentationPayloadSchema>,
): MenuPresentationDto {
  return {
    id: menu.id,
    location: menu.location,
    items: payload.items.map(({ label, href }) => ({ label, href })),
    revision: menu.draftRevision,
  }
}

function toEntryEditorDto(entry: CmsContentEntryRecord): EntryEditorDto {
  return {
    id: entry.id,
    type: entry.type,
    draftPayload: entry.draftPayload,
    draftRevision: entry.draftRevision,
    archived: Boolean(entry.archivedAt),
  }
}

function toPageForEditorDto(page: CmsPageRecord): PageForEditorDto {
  return {
    id: page.id,
    title: page.title,
    path: page.path,
    draftPayload: page.draftPayload,
    draftRevision: page.draftRevision,
    archived: Boolean(page.archivedAt),
  }
}

function toPageRevisionListItemDto(revision: CmsPageRevisionSummaryRecord): PageRevisionListItemDto {
  return {
    id: revision.id,
    revision: revision.revision,
    sourceDraftRevision: revision.sourceDraftRevision,
    publicationRevision: revision.publicationRevision,
    createdAt: revision.createdAt.toISOString(),
  }
}

function toPublicationDto(publication: { id: string; revision: number; snapshot: unknown }): PublicationDto {
  return { id: publication.id, revision: publication.revision, snapshot: publication.snapshot }
}

function toPublicationControllerDto(controller: CmsControllerRecord): NonNullable<PublicationSummaryDto['controller']> {
  return {
    desiredRevision: controller.desiredRevision,
    publishedRevision: controller.publishedRevision,
    activeBuildId: controller.activeBuildId,
    activeSlot: controller.activeSlot,
    status: controller.status,
    heartbeatAt: serializeDate(controller.heartbeatAt),
    lastError: controller.lastError,
  }
}

function toLatestPublicationDto(publication: CmsLatestPublicationRecord): NonNullable<PublicationSummaryDto['latestPublication']> {
  return {
    id: publication.id,
    revision: publication.revision,
    artifactState: publication.artifactState,
    createdAt: serializeDate(publication.createdAt)!,
  }
}

function toPendingApprovalDto(approval: CmsPendingApprovalRecord): PendingApprovalDto {
  const createdAt = serializeDate(approval.createdAt)
  return {
    id: approval.id,
    status: 'pending',
    requesterUserId: approval.requesterUserId,
    ...(createdAt ? { createdAt } : {}),
  }
}

function serializeDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function publicationActorRole(actor: CmsActor): 'editor' | 'owner' | undefined {
  return actor.role === 'editor' || actor.role === 'owner' ? actor.role : undefined
}
