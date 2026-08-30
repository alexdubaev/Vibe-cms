import { expect, test } from 'bun:test'

import { resolveCmsWorkflowState } from '@/features/cms/model'

test('workflow prioritises local editing and recovery states', () => {
  expect(resolveCmsWorkflowState({ saveStatus: 'dirty' })).toMatchObject({
    stage: 'editing',
    label: 'Есть несохранённые изменения',
  })
  expect(resolveCmsWorkflowState({ saveStatus: 'saving' })).toMatchObject({
    stage: 'saving',
    label: 'Сохраняем изменения',
  })
  expect(resolveCmsWorkflowState({ saveStatus: 'conflict', publicationStatus: 'published' })).toMatchObject({
    stage: 'conflict',
    label: 'Нужно разрешить конфликт',
    tone: 'destructive',
  })
})

test('workflow translates review and publication progress into one stage', () => {
  expect(resolveCmsWorkflowState({ approvalStatus: 'pending' })).toMatchObject({
    stage: 'awaiting-review',
    label: 'Ожидает согласования',
  })
  expect(resolveCmsWorkflowState({ publicationStatus: 'building' })).toMatchObject({
    stage: 'publishing',
    label: 'Сайт обновляется',
  })
  expect(resolveCmsWorkflowState({ publicationStatus: 'published' })).toMatchObject({
    stage: 'published',
    label: 'Опубликовано',
  })
  expect(resolveCmsWorkflowState({ publicationStatus: 'failed' })).toMatchObject({
    stage: 'failed',
    label: 'Публикация не завершена',
    tone: 'destructive',
  })
})
