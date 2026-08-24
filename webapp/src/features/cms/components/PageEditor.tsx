import { pageDraftSchema, type ContentBlock, type MediaAsset, type PageDraft } from '@web-app-demo/contracts'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Checkbox } from '@/components/ui/checkbox'
import { Typography } from '@/components/typography'
import type { CmsCollectionEntry, CmsPageEditor } from '../api'
import { createSerializedAutosave, type AutosaveSnapshot } from '../editor'
import { useCmsEntriesQuery, useCmsMediaQuery, useSaveCmsPageMutation } from '../queries'
import {
  addBenefitItem,
  plainTextToStructuredText,
  removeBenefitItem,
  structuredTextToPlainText,
  toggleMediaSelection,
  updateBenefitItem,
  type BenefitIcon,
  type BenefitItem,
} from '../editor-model'

const blockLabels: Record<string, string> = {
  hero: 'Первый экран',
  textImage: 'Текст и изображение',
  benefits: 'Преимущества',
  serviceSelection: 'Услуги',
  caseSelection: 'Кейсы',
  testimonialSelection: 'Отзывы',
  faqSelection: 'Вопросы и ответы',
  gallery: 'Галерея',
  cta: 'Призыв к действию',
  contacts: 'Контакты',
  formPlaceholder: 'Форма заявки',
}

type PageEditorProps = { page: CmsPageEditor }

export function PageEditor({ page }: PageEditorProps) {
  const initialDraft = readDraft(page)
  if (!initialDraft) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Черновик нельзя открыть</AlertTitle>
        <AlertDescription>Структура страницы устарела или содержит неподдерживаемые поля.</AlertDescription>
      </Alert>
    )
  }
  return <PageEditorForm initialDraft={initialDraft} page={page} />
}

function PageEditorForm({ page, initialDraft }: PageEditorProps & { initialDraft: PageDraft }) {
  const mutation = useSaveCmsPageMutation()
  const media = useCmsMediaQuery()
  const entries = useCmsEntriesQuery()
  const mutationRef = useRef(mutation)
  useEffect(() => {
    mutationRef.current = mutation
  }, [mutation])
  const [draft, setDraft] = useState(initialDraft)
  const [saveState, setSaveState] = useState<AutosaveSnapshot<PageDraft>>({ status: 'idle', revision: page.draftRevision })
  const queue = useRef<ReturnType<typeof createSerializedAutosave<PageDraft, { draftRevision: number }>> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const controller = createSerializedAutosave<PageDraft, { draftRevision: number }>({
      save: async (next) => {
        const result = await mutationRef.current.mutateAsync({ pageId: page.id, draft: next })
        return { draftRevision: result.revision }
      },
      onStateChange: setSaveState,
    })
    queue.current = controller
    return () => {
      if (timer.current) clearTimeout(timer.current)
      controller.dispose()
      queue.current = null
    }
  }, [page.id])

  const enqueue = (next: PageDraft) => {
    setDraft(next)
    queue.current?.enqueue(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void queue.current?.flush(), 700)
  }

  const update = (patch: Partial<PageDraft>) => enqueue({ ...draft, ...patch })
  const updateSeo = (patch: { title?: string; description?: string }) => {
    const seo = { canonicalMode: 'self' as const, noIndex: false, ...draft.seo, ...patch }
    enqueue({ ...draft, seo: seo.title || seo.description ? seo : undefined })
  }
  const moveBlock = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= draft.blocks.length) return
    const blocks = [...draft.blocks]
    const [item] = blocks.splice(index, 1)
    blocks.splice(target, 0, item)
    enqueue({ ...draft, blocks })
  }

  const updateBlockData = (index: number, data: Record<string, unknown>) => {
    const blocks = draft.blocks.map((block, blockIndex) =>
      blockIndex === index ? ({ ...block, data } as ContentBlock) : block,
    )
    enqueue({ ...draft, blocks })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Редактор страницы</CardTitle>
        <CardDescription>Изменения сохраняются автоматически. Служебные данные и JSON здесь не показываются.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Заголовок" htmlFor="cms-page-title">
            <Input id="cms-page-title" value={draft.title} onChange={(event) => update({ title: event.target.value })} />
          </Field>
          <Field label="Адрес страницы" htmlFor="cms-page-path">
            <Input id="cms-page-path" value={draft.path} onChange={(event) => update({ path: event.target.value })} />
          </Field>
          <Field label="Метка в меню" htmlFor="cms-page-navigation-label">
            <Input
              id="cms-page-navigation-label"
              value={draft.navigationLabel ?? ''}
              onChange={(event) => update({ navigationLabel: event.target.value || undefined })}
            />
          </Field>
        </div>

        <div className="grid gap-4">
          <div>
            <Typography variant="bodySmMedium">SEO</Typography>
            <Typography tone="muted" variant="caption">Необязательные данные для поисковой выдачи.</Typography>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="SEO-заголовок" htmlFor="cms-page-seo-title">
              <Input
                id="cms-page-seo-title"
                value={draft.seo?.title ?? ''}
                onChange={(event) => updateSeo({ title: event.target.value })}
              />
            </Field>
            <Field label="Описание" htmlFor="cms-page-seo-description">
              <Textarea
                id="cms-page-seo-description"
                value={draft.seo?.description ?? ''}
                onChange={(event) => updateSeo({ description: event.target.value })}
              />
            </Field>
          </div>
        </div>

        <div className="grid gap-3">
          <div>
            <Typography variant="bodySmMedium">Блоки страницы</Typography>
            <Typography tone="muted" variant="caption">Порядок можно изменить кнопками. Детальные поля блоков подключаются из общего каталога.</Typography>
          </div>
          {draft.blocks.map((block, index) => (
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3" key={block.id}>
              <div className="grid min-w-0 flex-1 gap-1">
                <Typography variant="bodySmMedium">{blockLabels[block.type] ?? 'Блок'}</Typography>
                <Typography tone="muted" variant="caption">Позиция {index + 1}</Typography>
                <BlockFields
                  block={block}
                  collectionEntries={entries.data ?? []}
                  mediaAssets={media.data?.assets ?? []}
                  onChange={(data) => updateBlockData(index, data)}
                />
              </div>
              <div className="flex gap-2">
                <Button aria-label={`Поднять блок ${index + 1}`} disabled={index === 0} onClick={() => moveBlock(index, -1)} size="sm" variant="outline">Выше</Button>
                <Button aria-label={`Опустить блок ${index + 1}`} disabled={index === draft.blocks.length - 1} onClick={() => moveBlock(index, 1)} size="sm" variant="outline">Ниже</Button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <Typography tone={saveTone(saveState.status)} variant="caption">{saveLabel(saveState.status)}</Typography>
          <Button disabled={saveState.status === 'saving'} onClick={() => void queue.current?.flush()} variant="secondary">Сохранить сейчас</Button>
        </div>
        {saveState.status === 'conflict' && (
          <Alert variant="destructive">
            <AlertTitle>Черновик изменился на сервере</AlertTitle>
            <AlertDescription>Ваши изменения сохранены в этом окне. Обновите страницу и сравните версии перед повторным сохранением.</AlertDescription>
          </Alert>
        )}
        {saveState.status === 'error' && (
          <Alert variant="destructive">
            <AlertTitle>Не удалось сохранить изменения</AlertTitle>
            <AlertDescription>Проверьте соединение и повторите сохранение.</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

function BlockFields({
  block,
  collectionEntries,
  mediaAssets,
  onChange,
}: {
  block: ContentBlock
  collectionEntries: readonly CmsCollectionEntry[]
  mediaAssets: readonly MediaAsset[]
  onChange: (data: Record<string, unknown>) => void
}) {
  const data = block.data as Record<string, unknown>
  const updateText = (key: string, value: string) => onChange({ ...data, [key]: value })

  return (
    <div className="mt-3 grid gap-3 border-t pt-3">
      {block.type === 'hero' && (
        <>
          <Field label="Надзаголовок" htmlFor={`cms-block-${block.id}-eyebrow`}>
            <Input
              id={`cms-block-${block.id}-eyebrow`}
              value={stringValue(data.eyebrow)}
              onChange={(event) => updateText('eyebrow', event.target.value)}
            />
          </Field>
          <Field label="Заголовок блока" htmlFor={`cms-block-${block.id}-title`}>
            <Input
              id={`cms-block-${block.id}-title`}
              value={stringValue(data.title)}
              onChange={(event) => updateText('title', event.target.value)}
            />
          </Field>
          <Field label="Текст блока" htmlFor={`cms-block-${block.id}-text`}>
            <Textarea
              id={`cms-block-${block.id}-text`}
              value={stringValue(data.text)}
              onChange={(event) => updateText('text', event.target.value)}
            />
          </Field>
          <MediaPicker
            assets={mediaAssets}
            id={`cms-block-${block.id}-media`}
            value={stringValue(data.mediaId)}
            onChange={(mediaId) => onChange({ ...data, ...(mediaId ? { mediaId } : { mediaId: undefined }) })}
          />
          <ActionFields
            action={data.primaryAction}
            idPrefix={`cms-block-${block.id}-primary`}
            label="Основная кнопка"
            onChange={(primaryAction) => onChange({ ...data, primaryAction })}
          />
          <OptionalActionFields
            action={data.secondaryAction}
            idPrefix={`cms-block-${block.id}-secondary`}
            label="Дополнительная кнопка"
            onChange={(secondaryAction) => onChange({ ...data, secondaryAction })}
            onRemove={() => onChange({ ...data, secondaryAction: undefined })}
          />
        </>
      )}
      {block.type === 'cta' && (
        <>
          <Field label="Заголовок блока" htmlFor={`cms-block-${block.id}-title`}>
            <Input
              id={`cms-block-${block.id}-title`}
              value={stringValue(data.title)}
              onChange={(event) => updateText('title', event.target.value)}
            />
          </Field>
          <Field label="Текст блока" htmlFor={`cms-block-${block.id}-text`}>
            <Textarea
              id={`cms-block-${block.id}-text`}
              value={stringValue(data.text)}
              onChange={(event) => updateText('text', event.target.value)}
            />
          </Field>
          <ActionFields
            action={data.primaryAction}
            idPrefix={`cms-block-${block.id}-primary`}
            label="Основная кнопка"
            onChange={(primaryAction) => onChange({ ...data, primaryAction })}
          />
          <OptionalActionFields
            action={data.secondaryAction}
            idPrefix={`cms-block-${block.id}-secondary`}
            label="Дополнительная кнопка"
            onChange={(secondaryAction) => onChange({ ...data, secondaryAction })}
            onRemove={() => onChange({ ...data, secondaryAction: undefined })}
          />
        </>
      )}
      {block.type === 'textImage' && (
        <>
          <Field label="Заголовок блока" htmlFor={`cms-block-${block.id}-title`}>
            <Input
              id={`cms-block-${block.id}-title`}
              value={stringValue(data.title)}
              onChange={(event) => updateText('title', event.target.value)}
            />
          </Field>
          <div className="grid gap-2">
            <Typography as="span" variant="label">Текст блока</Typography>
            <Textarea
              defaultValue={structuredTextToPlainText(data.content)}
              id={`cms-block-${block.id}-content`}
              onChange={(event) => {
                const content = plainTextToStructuredText(event.target.value)
                if (content) onChange({ ...data, content })
              }}
              placeholder="Каждый абзац — с новой строки"
              rows={6}
            />
            <Typography tone="muted" variant="caption">
              Простое форматирование вводится абзацами. Пустые строки не сохраняются.
            </Typography>
          </div>
          <div className="grid gap-2">
            <Typography as="span" variant="label">Положение изображения</Typography>
            <div className="flex gap-2">
              {(['left', 'right'] as const).map((side) => (
                <Button
                  key={side}
                  onClick={() => onChange({ ...data, imageSide: side })}
                  size="sm"
                  variant={data.imageSide === side ? 'secondary' : 'outline'}
                >
                  {side === 'left' ? 'Слева' : 'Справа'}
                </Button>
              ))}
            </div>
          </div>
          <MediaPicker
            assets={mediaAssets}
            id={`cms-block-${block.id}-media`}
            value={stringValue(data.mediaId)}
            onChange={(mediaId) => onChange({ ...data, ...(mediaId ? { mediaId } : { mediaId: undefined }) })}
          />
        </>
      )}
      {block.type === 'gallery' && (
        <GalleryMediaPicker
          assets={mediaAssets}
          selectedIds={stringArrayValue(data.mediaIds)}
          onChange={(mediaIds) => onChange({ ...data, mediaIds })}
        />
      )}
      {block.type === 'benefits' && (
        <>
          <Field label="Заголовок блока" htmlFor={`cms-block-${block.id}-title`}>
            <Input
              id={`cms-block-${block.id}-title`}
              value={stringValue(data.title)}
              onChange={(event) => updateText('title', event.target.value)}
            />
          </Field>
          <BenefitItemsEditor
            items={benefitItemsValue(data.items)}
            idPrefix={`cms-block-${block.id}`}
            onChange={(items) => onChange({ ...data, items })}
          />
        </>
      )}
      {(['serviceSelection', 'caseSelection', 'testimonialSelection', 'faqSelection'] as readonly string[]).includes(block.type) && (
        <>
          <Field label="Заголовок блока" htmlFor={`cms-block-${block.id}-title`}>
            <Input
              id={`cms-block-${block.id}-title`}
              value={stringValue(data.title)}
              onChange={(event) => updateText('title', event.target.value)}
            />
          </Field>
          <SelectionEntryPicker
            entries={collectionEntries}
            entryType={selectionEntryType(block.type)}
            maximum={block.type === 'faqSelection' ? 20 : 12}
            onChange={(entryIds) => onChange({ ...data, entryIds })}
            selectedIds={stringArrayValue(data.entryIds)}
          />
        </>
      )}
      {block.type === 'contacts' && (
        <Field label="Заголовок блока" htmlFor={`cms-block-${block.id}-title`}>
          <Input
            id={`cms-block-${block.id}-title`}
            value={stringValue(data.title)}
            onChange={(event) => updateText('title', event.target.value)}
          />
        </Field>
      )}
      {block.type === 'contacts' && (
        <ContactsOptions
          data={data}
          idPrefix={`cms-block-${block.id}`}
          onChange={onChange}
        />
      )}
      {block.type === 'formPlaceholder' && (
        <>
          <Field label="Заголовок блока" htmlFor={`cms-block-${block.id}-title`}>
            <Input
              id={`cms-block-${block.id}-title`}
              value={stringValue(data.title)}
              onChange={(event) => updateText('title', event.target.value)}
            />
          </Field>
          <Field label="Текст блока" htmlFor={`cms-block-${block.id}-text`}>
            <Textarea
              id={`cms-block-${block.id}-text`}
              value={stringValue(data.text)}
              onChange={(event) => updateText('text', event.target.value)}
            />
          </Field>
          <Field label="Предпочтительный способ связи" htmlFor={`cms-block-${block.id}-contact-method`}>
            <NativeSelect
              id={`cms-block-${block.id}-contact-method`}
              onChange={(event) => onChange({ ...data, contactMethod: event.target.value })}
              value={stringValue(data.contactMethod)}
            >
              <NativeSelectOption value="phone">Телефон</NativeSelectOption>
              <NativeSelectOption value="email">Электронная почта</NativeSelectOption>
              <NativeSelectOption value="messenger">Мессенджер</NativeSelectOption>
            </NativeSelect>
          </Field>
        </>
      )}
    </div>
  )
}

const benefitIconLabels: Record<BenefitIcon, string> = {
  check: 'Галочка',
  star: 'Звезда',
  shield: 'Щит',
  spark: 'Искра',
}

function BenefitItemsEditor({
  idPrefix,
  items,
  onChange,
}: {
  idPrefix: string
  items: readonly BenefitItem[]
  onChange: (items: BenefitItem[]) => void
}) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Typography as="span" variant="label">Карточки преимуществ</Typography>
          <Typography tone="muted" variant="caption">От двух до восьми карточек.</Typography>
        </div>
        <Button
          disabled={items.length >= 8}
          onClick={() => onChange(addBenefitItem(items))}
          size="sm"
          type="button"
          variant="outline"
        >
          Добавить карточку
        </Button>
      </div>
      {items.map((item, index) => (
        <div className="grid gap-3 rounded-md border p-3" key={`${idPrefix}-benefit-${index}`}>
          <div className="flex items-center justify-between gap-2">
            <Typography variant="bodySmMedium">Карточка {index + 1}</Typography>
            <Button
              aria-label={`Удалить карточку ${index + 1}`}
              disabled={items.length <= 2}
              onClick={() => onChange(removeBenefitItem(items, index))}
              size="sm"
              type="button"
              variant="ghost"
            >
              Удалить
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Заголовок" htmlFor={`${idPrefix}-benefit-${index}-title`}>
              <Input
                id={`${idPrefix}-benefit-${index}-title`}
                value={item.title}
                onChange={(event) => onChange(updateBenefitItem(items, index, { title: event.target.value }))}
              />
            </Field>
            <Field label="Иконка" htmlFor={`${idPrefix}-benefit-${index}-icon`}>
              <NativeSelect
                id={`${idPrefix}-benefit-${index}-icon`}
                onChange={(event) => onChange(updateBenefitItem(items, index, { icon: event.target.value as BenefitIcon }))}
                value={item.icon}
              >
                {Object.entries(benefitIconLabels).map(([value, label]) => (
                  <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Описание" htmlFor={`${idPrefix}-benefit-${index}-text`}>
            <Textarea
              id={`${idPrefix}-benefit-${index}-text`}
              value={item.text}
              onChange={(event) => onChange(updateBenefitItem(items, index, { text: event.target.value }))}
            />
          </Field>
        </div>
      ))}
    </div>
  )
}

function ContactsOptions({
  data,
  idPrefix,
  onChange,
}: {
  data: Record<string, unknown>
  idPrefix: string
  onChange: (data: Record<string, unknown>) => void
}) {
  const options = [
    ['showAddress', 'Адрес'],
    ['showHours', 'Часы работы'],
    ['showContacts', 'Телефон и почта'],
    ['showSocials', 'Социальные сети'],
    ['showMap', 'Карта'],
  ] as const
  return (
    <div className="grid gap-2">
      <Typography as="span" variant="label">Показывать на странице</Typography>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map(([key, label]) => (
          <label className="flex items-center gap-2 rounded-md border p-2" htmlFor={`${idPrefix}-${key}`} key={key}>
            <Checkbox
              checked={data[key] === true}
              id={`${idPrefix}-${key}`}
              onCheckedChange={(checked) => onChange({ ...data, [key]: checked === true })}
            />
            <Typography as="span" variant="bodySm">{label}</Typography>
          </label>
        ))}
      </div>
    </div>
  )
}

function SelectionEntryPicker({
  entries,
  entryType,
  maximum,
  onChange,
  selectedIds,
}: {
  entries: readonly CmsCollectionEntry[]
  entryType: CmsCollectionEntry['type']
  maximum: number
  onChange: (entryIds: string[]) => void
  selectedIds: readonly string[]
}) {
  const available = entries.filter((entry) => entry.type === entryType && !entry.archived)
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Typography as="span" variant="label">Записи каталога</Typography>
        <Typography tone="muted" variant="caption">Выбрано {selectedIds.length} из {maximum}</Typography>
      </div>
      {available.length === 0 && (
        <Typography tone="muted" variant="caption">Подходящих опубликованных записей пока нет.</Typography>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {available.map((entry) => {
          const checked = selectedIds.includes(entry.id)
          return (
            <label className="flex items-start gap-2 rounded-md border p-2" key={entry.id}>
              <Checkbox
                aria-label={`Добавить запись ${entry.name}`}
                checked={checked}
                onCheckedChange={(next) => onChange(toggleMediaSelection(selectedIds, entry.id, next === true, maximum))}
              />
              <span className="grid min-w-0 gap-1">
                <Typography as="span" variant="bodySm" wrap="break">{entry.name}</Typography>
                {entry.summary && <Typography as="span" tone="muted" variant="caption" wrap="break">{entry.summary}</Typography>}
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

function MediaPicker({
  assets,
  id,
  onChange,
  value,
}: {
  assets: readonly MediaAsset[]
  id: string
  onChange: (value: string) => void
  value: string
}) {
  const images = assets.filter((asset) => asset.state === 'ready' && asset.mimeType.startsWith('image/'))
  return (
    <Field label="Изображение" htmlFor={id}>
      <NativeSelect
        className="w-full"
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <NativeSelectOption value="">Без изображения</NativeSelectOption>
        {images.map((asset) => (
          <NativeSelectOption key={asset.id} value={asset.id}>
            {asset.filename}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  )
}

function GalleryMediaPicker({
  assets,
  onChange,
  selectedIds,
}: {
  assets: readonly MediaAsset[]
  onChange: (mediaIds: string[]) => void
  selectedIds: readonly string[]
}) {
  const images = assets.filter((asset) => asset.state === 'ready' && asset.mimeType.startsWith('image/'))
  return (
    <div className="grid gap-2">
      <Typography as="span" variant="label">Изображения галереи</Typography>
      {images.length === 0 && <Typography tone="muted" variant="caption">Готовых изображений пока нет.</Typography>}
      <div className="grid gap-2 sm:grid-cols-2">
        {images.map((asset) => {
          const checked = selectedIds.includes(asset.id)
          return (
            <label className="flex items-center gap-2 rounded-md border p-2" key={asset.id}>
              <Checkbox
                aria-label={`Добавить ${asset.filename} в галерею`}
                checked={checked}
                onCheckedChange={(next) => onChange(toggleMediaSelection(selectedIds, asset.id, next === true))}
              />
              <Typography as="span" variant="bodySm" wrap="break">{asset.filename}</Typography>
            </label>
          )
        })}
      </div>
    </div>
  )
}

function ActionFields({
  action,
  idPrefix,
  label,
  onRemove,
  onChange,
}: {
  action: unknown
  idPrefix: string
  label: string
  onChange: (action: Record<string, unknown>) => void
  onRemove?: () => void
}) {
  const current = asRecord(action)
  return (
    <div className="grid gap-3 rounded-md bg-muted/30 p-3">
      <Typography variant="bodySmMedium">{label}</Typography>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Текст кнопки" htmlFor={`${idPrefix}-label`}>
          <Input
            id={`${idPrefix}-label`}
            value={stringValue(current.label)}
            onChange={(event) => onChange({ ...current, label: event.target.value })}
          />
        </Field>
        <Field label="Ссылка" htmlFor={`${idPrefix}-href`}>
          <Input
            id={`${idPrefix}-href`}
            value={stringValue(current.href)}
            onChange={(event) => onChange({ ...current, href: event.target.value })}
          />
        </Field>
      </div>
      {onRemove && (
        <Button onClick={onRemove} size="sm" type="button" variant="ghost">
          Убрать дополнительную кнопку
        </Button>
      )}
    </div>
  )
}

function OptionalActionFields({
  action,
  idPrefix,
  label,
  onChange,
  onRemove,
}: {
  action: unknown
  idPrefix: string
  label: string
  onChange: (action: Record<string, unknown>) => void
  onRemove: () => void
}) {
  if (!action) {
    return (
      <Button
        onClick={() => onChange({ label: 'Подробнее', href: '/contact' })}
        size="sm"
        type="button"
        variant="outline"
      >
        Добавить дополнительную кнопку
      </Button>
    )
  }
  return <ActionFields action={action} idPrefix={idPrefix} label={label} onChange={onChange} onRemove={onRemove} />
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

function readDraft(page: CmsPageEditor): PageDraft | null {
  const payload = page.draftPayload && typeof page.draftPayload === 'object' && !Array.isArray(page.draftPayload)
    ? page.draftPayload
    : {}
  const result = pageDraftSchema.safeParse({ ...payload, expectedRevision: page.draftRevision })
  return result.success ? result.data : null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function stringArrayValue(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function benefitItemsValue(value: unknown): BenefitItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const record = asRecord(item)
    const icon = record.icon
    if (
      typeof record.title !== 'string' ||
      typeof record.text !== 'string' ||
      (icon !== 'check' && icon !== 'star' && icon !== 'shield' && icon !== 'spark')
    ) {
      return []
    }
    return [{ title: record.title, text: record.text, icon }]
  })
}

function selectionEntryType(blockType: ContentBlock['type']): CmsCollectionEntry['type'] {
  if (blockType === 'serviceSelection') return 'service'
  if (blockType === 'caseSelection') return 'case'
  if (blockType === 'testimonialSelection') return 'review'
  return 'faq'
}

function saveLabel(status: AutosaveSnapshot<PageDraft>['status']) {
  return {
    idle: 'Нет несохранённых изменений',
    dirty: 'Есть несохранённые изменения',
    saving: 'Сохраняем…',
    saved: 'Сохранено',
    conflict: 'Нужна проверка конфликта',
    error: 'Сохранение не завершено',
  }[status]
}

function saveTone(status: AutosaveSnapshot<PageDraft>['status']) {
  if (status === 'conflict' || status === 'error') return 'destructive' as const
  if (status === 'saved') return 'primary' as const
  return 'muted' as const
}
