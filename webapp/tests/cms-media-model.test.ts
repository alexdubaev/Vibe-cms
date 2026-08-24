import { expect, test } from 'bun:test'

import { formatMediaBytes, mediaStateLabel } from '@/features/cms/media-model'

test('formatMediaBytes uses readable units for the media library', () => {
  expect(formatMediaBytes(850)).toBe('850 Б')
  expect(formatMediaBytes(1_536)).toBe('1.5 КБ')
  expect(formatMediaBytes(2_500_000)).toBe('2.5 МБ')
})

test('mediaStateLabel keeps processing states understandable', () => {
  expect(mediaStateLabel('pending')).toBe('Обрабатывается')
  expect(mediaStateLabel('ready')).toBe('Готово')
  expect(mediaStateLabel('deleting')).toBe('Удаляется')
  expect(mediaStateLabel('deleted')).toBe('Удалено')
})
