import { selectedContentBlockSchema } from '@vibe-cms/selected-site-package/contract'
import { expect, test } from 'bun:test'

import {
  addBenefitItem,
  createEditorBlock,
  duplicateEditorBlock,
  editorTextToStructuredText,
  moveEditorBlock,
  plainTextToStructuredText,
  removeEditorBlock,
  removeBenefitItem,
  structuredTextToEditorText,
  structuredTextToPlainText,
  toggleMediaSelection,
  updateBenefitItem,
} from '@/features/cms/editor-model'

test('page block helpers create selected-package schema-validated defaults', () => {
  const hero = createEditorBlock('hero', 'hero-1')
  const benefits = createEditorBlock('benefits', 'benefits-1')

  expect(selectedContentBlockSchema.safeParse(hero).success).toBe(true)
  expect(selectedContentBlockSchema.safeParse(benefits).success).toBe(true)
  expect(hero).toMatchObject({
    id: 'hero-1',
    type: 'hero',
    data: { title: 'Заголовок', primaryAction: { label: 'Подробнее', href: '/about' } },
  })
  expect(benefits).toMatchObject({ id: 'benefits-1', type: 'benefits' })
})

test('page block helpers duplicate, reorder, and protect the final section', () => {
  const hero = createEditorBlock('hero', 'hero-1')
  const cta = createEditorBlock('cta', 'cta-1')
  const copy = duplicateEditorBlock(hero, 'hero-2')

  expect(copy).toEqual({ ...hero, id: 'hero-2' })
  expect(copy.data).not.toBe(hero.data)
  expect(moveEditorBlock([hero, cta], 0, 1).map((block) => block.id)).toEqual(['cta-1', 'hero-1'])
  expect(moveEditorBlock([hero, cta], 0, -1).map((block) => block.id)).toEqual(['hero-1', 'cta-1'])
  expect(removeEditorBlock([hero], 0).map((block) => block.id)).toEqual(['hero-1'])
  expect(removeEditorBlock([hero, cta], 0).map((block) => block.id)).toEqual(['cta-1'])
})

test('toggleMediaSelection adds and removes media without duplicates', () => {
  expect(toggleMediaSelection(['one'], 'two', true)).toEqual(['one', 'two'])
  expect(toggleMediaSelection(['one', 'two'], 'one', false)).toEqual(['two'])
  expect(toggleMediaSelection(['one', 'two'], 'two', true)).toEqual(['one', 'two'])
})

test('toggleMediaSelection enforces the gallery limit', () => {
  expect(toggleMediaSelection(['one', 'two'], 'three', true, 2)).toEqual(['one', 'two'])
})

test('structured text helpers expose readable paragraphs and keep schema limits', () => {
  expect(
    structuredTextToPlainText({
      type: 'document',
      blocks: [
        { type: 'heading', level: 2, children: [{ type: 'text', text: 'Заголовок', marks: [] }] },
        {
          type: 'bulletList',
          items: [{ type: 'listItem', children: [{ type: 'link', label: 'Подробнее', href: '/about' }] }],
        },
      ],
    }),
  ).toBe('Заголовок\nПодробнее')

  expect(plainTextToStructuredText('Первая строка\n\nВторая строка')).toEqual({
    type: 'document',
    blocks: [
      { type: 'paragraph', children: [{ type: 'text', text: 'Первая строка', marks: [] }] },
      { type: 'paragraph', children: [{ type: 'text', text: 'Вторая строка', marks: [] }] },
    ],
  })
  expect(plainTextToStructuredText('   ')).toBeNull()
})

test('rich structured text editor round-trips headings, lists, quotes, marks, and safe links', () => {
  const source = [
    '## Важный раздел',
    '',
    '**Сильный** и _мягкий_ текст с [подробностями](/about)',
    '',
    '- Первый пункт',
    '- Второй пункт',
    '',
    '> Цитата клиента',
    '',
    '### Следующий шаг',
    '',
    '1. Сначала',
    '2. Затем',
  ].join('\n')

  const document = editorTextToStructuredText(source)

  expect(document).toEqual({
    type: 'document',
    blocks: [
      { type: 'heading', level: 2, children: [{ type: 'text', text: 'Важный раздел', marks: [] }] },
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: 'Сильный', marks: ['bold'] },
          { type: 'text', text: ' и ', marks: [] },
          { type: 'text', text: 'мягкий', marks: ['italic'] },
          { type: 'text', text: ' текст с ', marks: [] },
          { type: 'link', label: 'подробностями', href: '/about' },
        ],
      },
      {
        type: 'bulletList',
        items: [
          { type: 'listItem', children: [{ type: 'text', text: 'Первый пункт', marks: [] }] },
          { type: 'listItem', children: [{ type: 'text', text: 'Второй пункт', marks: [] }] },
        ],
      },
      { type: 'quote', children: [{ type: 'text', text: 'Цитата клиента', marks: [] }] },
      { type: 'heading', level: 3, children: [{ type: 'text', text: 'Следующий шаг', marks: [] }] },
      {
        type: 'numberedList',
        items: [
          { type: 'listItem', children: [{ type: 'text', text: 'Сначала', marks: [] }] },
          { type: 'listItem', children: [{ type: 'text', text: 'Затем', marks: [] }] },
        ],
      },
    ],
  })

  expect(structuredTextToEditorText(document)).toBe(source)
})

test('rich structured text editor rejects unsafe links instead of persisting them', () => {
  expect(editorTextToStructuredText('[Секрет](javascript:alert(1))')).toBeNull()
  expect(editorTextToStructuredText('[Секрет](https://user:pass@example.com/private)')).toBeNull()
})

test('benefit item helpers enforce editable bounds', () => {
  const items = [
    { title: 'Один', text: 'Текст', icon: 'check' as const },
    { title: 'Два', text: 'Текст', icon: 'star' as const },
  ]
  expect(updateBenefitItem(items, 0, { title: 'Обновлённый' })[0]).toEqual({
    title: 'Обновлённый',
    text: 'Текст',
    icon: 'check',
  })
  expect(removeBenefitItem(items, 0)).toEqual(items)
  expect(addBenefitItem(items)).toHaveLength(3)
  expect(addBenefitItem(Array.from({ length: 8 }, (_, index) => ({ title: `${index}`, text: 'Текст', icon: 'check' as const })))).toHaveLength(8)
})
