import { expect, test } from 'bun:test'

import {
  addBenefitItem,
  plainTextToStructuredText,
  removeBenefitItem,
  structuredTextToPlainText,
  toggleMediaSelection,
  updateBenefitItem,
} from '@/features/cms/editor-model'

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
