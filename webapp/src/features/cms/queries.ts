import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CollectionEntryCreateInput, CollectionEntryDraft, PageDraft } from '@web-app-demo/contracts'

import { useAuth } from '@/features/auth'
import {
  createCmsEntry,
  createCmsPreviewGrant,
  getCmsPage,
  getCmsEntry,
  getCmsPageRevisions,
  getCmsEntries,
  getCmsPages,
  getCmsPendingApprovals,
  getCmsPublicationSummary,
  submitCmsApproval,
  deleteCmsMedia,
  createCmsMediaUpload,
  finalizeCmsMediaUpload,
  getCmsMedia,
  getCmsMediaImageDownload,
  getCmsMenu,
  getCmsMenus,
  getCmsSiteSettings,
  saveCmsSiteSettings,
  saveCmsMenu,
  approveCmsApproval,
  publishCmsCurrent,
  rejectCmsApproval,
  saveCmsPage,
  saveCmsEntry,
  restoreCmsPageRevision,
  updateCmsMediaAlt,
} from './api'
import { describeMediaFile, uploadMediaObject } from './media-upload'

export const cmsQueryKeys = {
  all: ['session', 'cms'] as const,
  pages: () => [...cmsQueryKeys.all, 'pages'] as const,
  page: (pageId: string) => [...cmsQueryKeys.pages(), pageId] as const,
  revisions: (pageId: string) => [...cmsQueryKeys.page(pageId), 'revisions'] as const,
  entries: (type = '') => [...cmsQueryKeys.all, 'entries', type] as const,
  entry: (entryId: string) => [...cmsQueryKeys.all, 'entry', entryId] as const,
  publication: () => [...cmsQueryKeys.all, 'publication'] as const,
  pendingApprovals: () => [...cmsQueryKeys.all, 'approvals', 'pending'] as const,
  mediaRoot: () => [...cmsQueryKeys.all, 'media'] as const,
  media: (query = '') => [...cmsQueryKeys.mediaRoot(), query] as const,
  mediaImageDownload: (assetId: string) => [...cmsQueryKeys.mediaRoot(), 'download', assetId] as const,
  menu: (menuId: string) => [...cmsQueryKeys.all, 'menu', menuId] as const,
  menus: () => [...cmsQueryKeys.all, 'menus'] as const,
  settings: () => [...cmsQueryKeys.all, 'settings'] as const,
}

export function useCmsPagesQuery() {
  const auth = useAuth()
  return useQuery({
    queryKey: cmsQueryKeys.pages(),
    queryFn: () => getCmsPages(auth.transport),
  })
}

export function useCmsPageQuery(pageId: string) {
  const auth = useAuth()
  return useQuery({
    queryKey: cmsQueryKeys.page(pageId),
    queryFn: () => getCmsPage(auth.transport, pageId),
    enabled: Boolean(pageId),
  })
}

export function useCmsEntriesQuery(type?: Parameters<typeof getCmsEntries>[1]) {
  const auth = useAuth()
  return useQuery({
    queryKey: cmsQueryKeys.entries(type ?? ''),
    queryFn: () => getCmsEntries(auth.transport, type),
  })
}

export function useCmsEntryQuery(entryId: string) {
  const auth = useAuth()
  return useQuery({
    queryKey: cmsQueryKeys.entry(entryId),
    queryFn: () => getCmsEntry(auth.transport, entryId),
    enabled: Boolean(entryId),
  })
}

export function useCreateCmsEntryMutation() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (draft: CollectionEntryCreateInput) => createCmsEntry(auth.transport, draft),
    onSuccess: async (entry) => {
      await queryClient.invalidateQueries({ queryKey: cmsQueryKeys.entries(entry.type) })
      queryClient.setQueryData(cmsQueryKeys.entry(entry.id), entry)
    },
  })
}

export function useSaveCmsEntryMutation() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ entryId, draft }: { entryId: string; draft: CollectionEntryDraft }) =>
      saveCmsEntry(auth.transport, entryId, draft),
    onSuccess: async (entry, variables) => {
      await queryClient.invalidateQueries({ queryKey: cmsQueryKeys.entries(entry.type) })
      queryClient.setQueryData(cmsQueryKeys.entry(variables.entryId), entry)
    },
  })
}

export function useCmsPageRevisionsQuery(pageId: string) {
  const auth = useAuth()
  return useQuery({
    queryKey: cmsQueryKeys.revisions(pageId),
    queryFn: () => getCmsPageRevisions(auth.transport, pageId),
    enabled: Boolean(pageId),
  })
}

export function useSaveCmsPageMutation() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ pageId, draft }: { pageId: string; draft: PageDraft }) =>
      saveCmsPage(auth.transport, pageId, draft),
    onSuccess: async (saved, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: cmsQueryKeys.pages() }),
        queryClient.invalidateQueries({ queryKey: cmsQueryKeys.page(variables.pageId) }),
      ])
      queryClient.setQueryData(cmsQueryKeys.page(variables.pageId), (current: unknown) => {
        if (!current || typeof current !== 'object') return current
        return {
          ...(current as Record<string, unknown>),
          title: saved.title,
          path: saved.path,
          draftPayload: saved.draftPayload,
          draftRevision: saved.revision,
        }
      })
    },
  })
}

export function useRestoreCmsPageRevisionMutation() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ pageId, revisionId }: { pageId: string; revisionId: string }) =>
      restoreCmsPageRevision(auth.transport, pageId, revisionId),
    onSuccess: async (restored, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: cmsQueryKeys.pages() }),
        queryClient.invalidateQueries({ queryKey: cmsQueryKeys.page(variables.pageId) }),
        queryClient.invalidateQueries({ queryKey: cmsQueryKeys.revisions(variables.pageId) }),
      ])
      queryClient.setQueryData(cmsQueryKeys.page(variables.pageId), (current: unknown) => {
        if (!current || typeof current !== 'object') return current
        return {
          ...(current as Record<string, unknown>),
          title: restored.title,
          path: restored.path,
          draftPayload: restored.draftPayload,
          draftRevision: restored.revision,
        }
      })
    },
  })
}

export function useCmsPublicationSummaryQuery() {
  const auth = useAuth()
  return useQuery({
    queryKey: cmsQueryKeys.publication(),
    queryFn: () => getCmsPublicationSummary(auth.transport),
  })
}

export function useCmsPendingApprovalsQuery() {
  const auth = useAuth()
  return useQuery({
    queryKey: cmsQueryKeys.pendingApprovals(),
    queryFn: () => getCmsPendingApprovals(auth.transport),
  })
}

export function useCmsPreviewGrantMutation() {
  const auth = useAuth()
  return useMutation({
    mutationFn: (pageId: string) => createCmsPreviewGrant(auth.transport, pageId),
  })
}

export function useCmsSiteSettingsQuery(enabled = true) {
  const auth = useAuth()
  return useQuery({ queryKey: cmsQueryKeys.settings(), queryFn: () => getCmsSiteSettings(auth.transport), enabled })
}

export function useSaveCmsSiteSettingsMutation() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { companyName: string; expectedRevision: number }) =>
      saveCmsSiteSettings(auth.transport, input),
    onSuccess: (settings) => queryClient.setQueryData(cmsQueryKeys.settings(), settings),
  })
}

export function useCmsMenuQuery(menuId: string) {
  const auth = useAuth()
  return useQuery({ queryKey: cmsQueryKeys.menu(menuId), queryFn: () => getCmsMenu(auth.transport, menuId), enabled: Boolean(menuId) })
}

export function useCmsMenusQuery() {
  const auth = useAuth()
  return useQuery({ queryKey: cmsQueryKeys.menus(), queryFn: () => getCmsMenus(auth.transport) })
}

export function useSaveCmsMenuMutation() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { menuId: string; items: Array<{ label: string; href: string }>; expectedRevision: number }) =>
      saveCmsMenu(auth.transport, input.menuId, input),
    onSuccess: (menu) => {
      queryClient.setQueryData(cmsQueryKeys.menu(menu.id), menu)
      return queryClient.invalidateQueries({ queryKey: cmsQueryKeys.menus() })
    },
  })
}

export function useSubmitCmsApprovalMutation() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (revision: number) => submitCmsApproval(auth.transport, revision),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: cmsQueryKeys.pendingApprovals() }),
        queryClient.invalidateQueries({ queryKey: cmsQueryKeys.publication() }),
      ]),
  })
}

export function useCmsMediaQuery(query = '') {
  const auth = useAuth()
  return useQuery({
    queryKey: cmsQueryKeys.media(query),
    queryFn: () => getCmsMedia(auth.transport, query),
  })
}

export function useCmsMediaImageDownloadQuery(assetId: string, enabled = true) {
  const auth = useAuth()
  return useQuery({
    queryKey: cmsQueryKeys.mediaImageDownload(assetId),
    queryFn: () => getCmsMediaImageDownload(auth.transport, assetId),
    enabled: enabled && Boolean(assetId),
    staleTime: 45_000,
  })
}

export function useUpdateCmsMediaAltMutation() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ assetId, alt }: { assetId: string; alt: string | null }) =>
      updateCmsMediaAlt(auth.transport, assetId, alt),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: cmsQueryKeys.mediaRoot() }),
  })
}

export function useDeleteCmsMediaMutation() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (assetId: string) => deleteCmsMedia(auth.transport, assetId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: cmsQueryKeys.mediaRoot() }),
  })
}

export function useUploadCmsMediaMutation() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (file: File) => {
      const described = describeMediaFile(file)
      if (!described.ok) {
        throw new Error(
          described.reason === 'type'
            ? 'Поддерживаются JPG, PNG, WebP, AVIF, MP4 и PDF.'
            : described.reason === 'too-small'
              ? 'Файл слишком маленький.'
              : 'Файл превышает допустимый размер.',
        )
      }
      const { asset, upload } = await createCmsMediaUpload(auth.transport, described)
      await uploadMediaObject(upload, file)
      return finalizeCmsMediaUpload(auth.transport, asset.id)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: cmsQueryKeys.mediaRoot() }),
  })
}

function invalidatePublicationQueries(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: cmsQueryKeys.pendingApprovals() }),
    queryClient.invalidateQueries({ queryKey: cmsQueryKeys.publication() }),
  ])
}

export function useApproveCmsApprovalMutation() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (approvalId: string) => approveCmsApproval(auth.transport, approvalId),
    onSuccess: () => invalidatePublicationQueries(queryClient),
  })
}

export function useRejectCmsApprovalMutation() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ approvalId, note }: { approvalId: string; note: string }) =>
      rejectCmsApproval(auth.transport, approvalId, note),
    onSuccess: () => invalidatePublicationQueries(queryClient),
  })
}

export function usePublishCmsCurrentMutation() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (revision: number) => publishCmsCurrent(auth.transport, revision),
    onSuccess: () => invalidatePublicationQueries(queryClient),
  })
}
