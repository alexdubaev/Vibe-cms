import { collectionEntryCreateSchema, collectionEntryDraftSchema } from '@web-app-demo/contracts'
import { useState, type FormEvent } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Typography } from '@/components/typography'

import type { CmsCollectionEntry, CmsEntryEditor } from '../api'
import { plainTextToStructuredText, structuredTextToPlainText } from '../editor-model'
import { collectionEntryTypeLabel } from '../model'
import { useCreateCmsEntryMutation, useSaveCmsEntryMutation } from '../queries'

export function CollectionEditor({
  entry,
  type,
  onCreated,
  onSaved,
}: {
  entry?: CmsEntryEditor
  type: CmsCollectionEntry['type']
  onCreated: (entry: CmsEntryEditor) => void
  onSaved: (entry: CmsEntryEditor) => void
}) {
  const payload = asRecord(entry?.draftPayload)
  const [name, setName] = useState(readString(payload.name))
  const [summary, setSummary] = useState(readString(payload.summary))
  const [description, setDescription] = useState(
    structuredTextToPlainText(payload.description),
  )
  const [validationError, setValidationError] = useState<string | null>(null)
  const create = useCreateCmsEntryMutation()
  const save = useSaveCmsEntryMutation()
  const isPending = create.isPending || save.isPending

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      setValidationError('Укажите название записи.')
      return
    }
    setValidationError(null)

    const candidate: Record<string, unknown> = {
      ...payload,
      type,
      name: trimmedName,
      expectedRevision: entry?.draftRevision ?? 0,
    }
    if (summary.trim()) candidate.summary = summary.trim()
    else delete candidate.summary
    const structuredDescription = plainTextToStructuredText(description)
    if (structuredDescription) candidate.description = structuredDescription
    else delete candidate.description

    if (entry) {
      const draft = collectionEntryDraftSchema.parse(candidate)
      save.mutate(
        { entryId: entry.id, draft },
        { onSuccess: onSaved },
      )
      return
    }

    delete candidate.expectedRevision
    const draft = collectionEntryCreateSchema.parse(candidate)
    create.mutate(draft, { onSuccess: onCreated })
  }

  return (
    <Card className="shadow-none">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <CardTitle>{entry ? 'Редактирование записи' : 'Новая запись'}</CardTitle>
            <CardDescription>{collectionEntryTypeLabel(type)}</CardDescription>
          </div>
          {entry && <Badge variant={entry.archived ? 'outline' : 'secondary'}>{entry.archived ? 'Архив' : 'Черновик'}</Badge>}
        </div>
      </CardHeader>
      <CardContent>
        <form className="grid gap-5" onSubmit={submit}>
          <label className="grid gap-2">
            <Typography as="span" variant="bodySmMedium">Название</Typography>
            <Input
              aria-label="Название записи"
              maxLength={160}
              onChange={(event) => setName(event.target.value)}
              placeholder="Например, Аудит сайта"
              value={name}
            />
          </label>
          <label className="grid gap-2">
            <Typography as="span" variant="bodySmMedium">Краткое описание</Typography>
            <Textarea
              aria-label="Краткое описание записи"
              className="min-h-24"
              maxLength={500}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="Коротко опишите запись для списка и карточки."
              value={summary}
            />
          </label>
          <label className="grid gap-2">
            <Typography as="span" variant="bodySmMedium">Подробное описание</Typography>
            <Textarea
              aria-label="Подробное описание записи"
              className="min-h-40"
              maxLength={10_000}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Каждый абзац — с новой строки. Форматирование сохраняется безопасно."
              value={description}
            />
            <Typography as="span" tone="muted" variant="caption">
              Текст сохраняется как структурированные абзацы, а не как HTML.
            </Typography>
          </label>
          {validationError && <Typography tone="destructive">{validationError}</Typography>}
          {(create.isError || save.isError) && (
            <Alert variant="destructive">
              <AlertTitle>Не удалось сохранить запись</AlertTitle>
              <AlertDescription>Проверьте соединение или обновите страницу при конфликте версий.</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={isPending} type="submit">
              {isPending ? 'Сохраняем…' : entry ? 'Сохранить запись' : 'Создать запись'}
            </Button>
            {entry && <Typography tone="muted" variant="caption">Изменения сохраняются только после нажатия кнопки.</Typography>}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : ''
}
