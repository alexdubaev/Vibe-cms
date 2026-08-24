import type { CmsCollectionEntry, CmsPageEditor } from './api'
import type { CollectionEntryDraft } from '@web-app-demo/contracts'

export type CmsQueryState = {
  isError: boolean
  isPending: boolean
  itemCount?: number
}

export function cmsCollectionViewState({
  isError,
  isPending,
  itemCount,
}: CmsQueryState): 'loading' | 'error' | 'empty' | 'ready' {
  if (isPending) return 'loading'
  if (isError) return 'error'
  return itemCount === 0 ? 'empty' : 'ready'
}

export type CmsDraftSummary = {
  blockCount: number
  blockTypes: string[]
  hasSeo: boolean
  navigationLabel: string | null
}

export function summarizeCmsDraft(page: CmsPageEditor): CmsDraftSummary {
  const payload = asRecord(page.draftPayload)
  const blocks = Array.isArray(payload.blocks) ? payload.blocks : []
  const blockTypes = blocks
    .map((block) => asRecord(block).type)
    .filter((type): type is string => typeof type === 'string')

  return {
    blockCount: blocks.length,
    blockTypes,
    hasSeo: isNonEmptyRecord(payload.seo),
    navigationLabel:
      typeof payload.navigationLabel === 'string' && payload.navigationLabel.trim().length > 0
        ? payload.navigationLabel
        : null,
  }
}

export function cmsPublicationStatusLabel(
  status: 'queued' | 'building' | 'published' | 'failed' | null | undefined,
) {
  switch (status) {
    case 'queued':
      return 'В очереди'
    case 'building':
      return 'Собирается'
    case 'published':
      return 'Опубликовано'
    case 'failed':
      return 'Ошибка'
    default:
      return 'Нет данных'
  }
}

const collectionEntryLabels: Record<CmsCollectionEntry['type'], string> = {
  service: 'Услуги',
  review: 'Отзывы',
  teamMember: 'Команда',
  faq: 'Вопросы и ответы',
  case: 'Проекты',
}

export function collectionEntryTypeLabel(type: CmsCollectionEntry['type']) {
  return collectionEntryLabels[type]
}

export function emptyCollectionEntryDraft(
  type: CollectionEntryDraft['type'],
): CollectionEntryDraft {
  return { type, name: '', summary: '', expectedRevision: 0 }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function isNonEmptyRecord(value: unknown) {
  return Object.keys(asRecord(value)).length > 0
}
