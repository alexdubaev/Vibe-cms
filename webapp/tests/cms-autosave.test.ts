import { expect, test } from 'bun:test'

import { createSerializedAutosave } from '@/features/cms/editor'

type Draft = { title: string; expectedRevision: number }
type Saved = { draftRevision: number }

test('serialized autosave coalesces edits and advances the expected revision', async () => {
  const calls: Draft[] = []
  let releaseFirst!: () => void
  const firstSave = new Promise<Saved>((resolve) => {
    releaseFirst = () => resolve({ draftRevision: 2 })
  })
  const save = async (draft: Draft) => {
    calls.push(draft)
    return calls.length === 1 ? firstSave : { draftRevision: 3 }
  }
  const autosave = createSerializedAutosave<Draft, Saved>({ save })

  autosave.enqueue({ title: 'Первый вариант', expectedRevision: 1 })
  const firstFlush = autosave.flush()
  autosave.enqueue({ title: 'Последний вариант', expectedRevision: 1 })
  releaseFirst()
  await firstFlush
  await autosave.flush()

  expect(calls).toEqual([
    { title: 'Первый вариант', expectedRevision: 1 },
    { title: 'Последний вариант', expectedRevision: 2 },
  ])
  expect(autosave.snapshot()).toMatchObject({ status: 'saved', revision: 3 })
})

test('a conflict stops retrying and preserves the local draft for recovery', async () => {
  const draft = { title: 'Локальное изменение', expectedRevision: 4 }
  const autosave = createSerializedAutosave<Draft, Saved>({
    save: async () => {
      throw Object.assign(new Error('Draft changed on the server'), { code: 'CMS_CONFLICT', status: 409 })
    },
  })

  autosave.enqueue(draft)
  await autosave.flush()

  expect(autosave.snapshot()).toMatchObject({
    status: 'conflict',
    conflictDraft: draft,
  })
})
