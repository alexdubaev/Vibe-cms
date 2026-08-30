import { expect, test } from 'bun:test'

import {
  collectionEntryTypeLabel,
  emptyCollectionEntryDraft,
  filterCmsCollectionEntries,
  cmsCollectionViewState,
  cmsPublicationStatusLabel,
  summarizeCmsDraft,
} from '../src/features/cms/model'

const page = {
  id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10',
  title: 'Главная',
  path: '/',
  draftPayload: {
    navigationLabel: 'Начало',
    seo: { title: 'Главная страница' },
    blocks: [{ type: 'hero' }, { type: 'benefits' }, { type: 7 }],
  },
  draftRevision: 4,
  archived: false,
} as const

test('CMS collection state has explicit loading, error, empty, and ready states', () => {
  expect(cmsCollectionViewState({ isPending: true, isError: false })).toBe('loading')
  expect(cmsCollectionViewState({ isPending: false, isError: true })).toBe('error')
  expect(cmsCollectionViewState({ isPending: false, isError: false, itemCount: 0 })).toBe('empty')
  expect(cmsCollectionViewState({ isPending: false, isError: false, itemCount: 1 })).toBe('ready')
})

test('content search matches names and summaries without case sensitivity', () => {
  const entries = [
    { id: 'one', name: 'Аудит сайта', summary: 'Техническая проверка' },
    { id: 'two', name: 'Поддержка', summary: 'Регулярные работы' },
  ]

  expect(filterCmsCollectionEntries(entries, 'аудит').map((entry) => entry.id)).toEqual(['one'])
  expect(filterCmsCollectionEntries(entries, 'РАБОТЫ').map((entry) => entry.id)).toEqual(['two'])
  expect(filterCmsCollectionEntries(entries, '   ')).toEqual(entries)
})

test('draft summary exposes safe editorial fields, not raw payload', () => {
  expect(summarizeCmsDraft(page)).toEqual({
    blockCount: 3,
    blockTypes: ['hero', 'benefits'],
    hasSeo: true,
    navigationLabel: 'Начало',
  })
})

test('publication status labels stay user-facing and Russian', () => {
  expect(cmsPublicationStatusLabel('queued')).toBe('В очереди')
  expect(cmsPublicationStatusLabel('building')).toBe('Собирается')
  expect(cmsPublicationStatusLabel('published')).toBe('Опубликовано')
  expect(cmsPublicationStatusLabel('failed')).toBe('Ошибка')
  expect(cmsPublicationStatusLabel(null)).toBe('Нет данных')
})

test('collection editor model exposes Russian type labels and a blank optimistic draft', () => {
  expect(collectionEntryTypeLabel('teamMember')).toBe('Команда')
  expect(collectionEntryTypeLabel('faq')).toBe('Вопросы и ответы')
  expect(emptyCollectionEntryDraft('service')).toEqual({
    type: 'service',
    name: '',
    summary: '',
    expectedRevision: 0,
  })
})
