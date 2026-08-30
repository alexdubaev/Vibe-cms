import type { RegisteredContentBlock } from '@web-app-demo/contracts'
import { ArrowDown01Icon, ArrowUp01Icon, Copy01Icon, Delete02Icon, Settings02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { selectedPageDraftSchema, type SelectedPageDraft } from '@vibe-cms/selected-site-package/contract'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Typography } from '@/components/typography'
import type { CmsPageEditor } from '../api'
import { createSerializedAutosave, type AutosaveSnapshot } from '../editor'
import { useCmsEntriesQuery, useCmsMediaQuery, useSaveCmsPageMutation } from '../queries'
import {
  createEditorBlock,
  duplicateEditorBlock,
  moveEditorBlock,
  removeEditorBlock,
} from '../editor-model'
import { resolveCmsWorkflowState } from '../model'
import { WorkflowStatus } from './WorkflowStatus'
import {
  getAdminBlockRegistration,
  getAdminBlockRegistrations,
  type AdminBlockRegistration,
  type BlockEditorProps,
} from '../site-package/registry'

type PageEditorProps = { actions?: ReactNode; page: CmsPageEditor }

export function PageEditor({ actions, page }: PageEditorProps) {
  const initialDraft = readDraft(page)
  if (!initialDraft) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Черновик нельзя открыть</AlertTitle>
        <AlertDescription>Структура страницы устарела или содержит неподдерживаемые поля.</AlertDescription>
      </Alert>
    )
  }
  return <PageEditorForm actions={actions} initialDraft={initialDraft} page={page} />
}

function PageEditorForm({ actions, page, initialDraft }: PageEditorProps & { initialDraft: SelectedPageDraft }) {
  const mutation = useSaveCmsPageMutation()
  const media = useCmsMediaQuery()
  const entries = useCmsEntriesQuery()
  const mutationRef = useRef(mutation)
  useEffect(() => {
    mutationRef.current = mutation
  }, [mutation])
  const [draft, setDraft] = useState(initialDraft)
  const [selectedBlockId, setSelectedBlockId] = useState(initialDraft.blocks[0]?.id ?? '')
  const [saveState, setSaveState] = useState<AutosaveSnapshot<SelectedPageDraft>>({ status: 'idle', revision: page.draftRevision })
  const queue = useRef<ReturnType<typeof createSerializedAutosave<SelectedPageDraft, { draftRevision: number }>> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const controller = createSerializedAutosave<SelectedPageDraft, { draftRevision: number }>({
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

  const enqueue = (next: SelectedPageDraft) => {
    setDraft(next)
    queue.current?.enqueue(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void queue.current?.flush(), 700)
  }

  const update = (patch: Partial<SelectedPageDraft>) => enqueue({ ...draft, ...patch })
  const updateSeo = (patch: { title?: string; description?: string }) => {
    const seo = { canonicalMode: 'self' as const, noIndex: false, ...draft.seo, ...patch }
    enqueue({ ...draft, seo: seo.title || seo.description ? seo : undefined })
  }
  const moveBlock = (index: number, direction: -1 | 1) => {
    enqueue({ ...draft, blocks: moveEditorBlock(draft.blocks, index, direction) })
  }

  const addBlock = (type: string) => {
    const block = createEditorBlock(type, `block-${crypto.randomUUID()}`)
    enqueue({ ...draft, blocks: [...draft.blocks, block] })
    setSelectedBlockId(block.id)
  }

  const duplicateBlock = (block: RegisteredContentBlock) => {
    const copy = duplicateEditorBlock(block, `block-${crypto.randomUUID()}`)
    const index = draft.blocks.findIndex((item) => item.id === block.id)
    const blocks = [...draft.blocks]
    blocks.splice(index + 1, 0, copy)
    enqueue({ ...draft, blocks })
    setSelectedBlockId(copy.id)
  }

  const removeBlock = (block: RegisteredContentBlock) => {
    const index = draft.blocks.findIndex((item) => item.id === block.id)
    const blocks = removeEditorBlock(draft.blocks, index)
    if (blocks.length === draft.blocks.length) return
    enqueue({ ...draft, blocks })
    setSelectedBlockId(blocks[Math.min(index, blocks.length - 1)]?.id ?? '')
  }

  const updateBlockData = (index: number, data: unknown) => {
    const blocks = draft.blocks.map((block, blockIndex) =>
      blockIndex === index ? ({ ...block, data } as RegisteredContentBlock) : block,
    )
    enqueue({ ...draft, blocks })
  }

  const registrations = getAdminBlockRegistrations()

  return (
    <Card className="overflow-visible py-0">
      <CardHeader className="sticky top-[3.75rem] z-10 grid gap-3 rounded-t-xl border-b bg-card/96 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/90 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:px-5">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <CardTitle>Редактор страницы</CardTitle>
          <WorkflowStatus state={{ ...resolveCmsWorkflowState({ saveStatus: saveState.status }), label: saveLabel(saveState.status) }} />
          <CardDescription className="w-full">Работайте с одной секцией за раз — изменения сохраняются автоматически.</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={saveState.status === 'saving'} onClick={() => void queue.current?.flush()} size="sm" variant="outline">
            Сохранить сейчас
          </Button>
          <>{actions}</>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 px-4 py-5 sm:px-5">
        <details className="group rounded-lg border bg-muted/15 open:bg-card">
          <Typography asChild variant="label">
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 [&::-webkit-details-marker]:hidden">
              <HugeiconsIcon aria-hidden className="size-4 text-muted-foreground" icon={Settings02Icon} strokeWidth={1.8} />
              Настройки страницы и SEO
              <Typography as="span" className="ml-auto" tone="muted" variant="caption">{draft.path}</Typography>
            </summary>
          </Typography>
          <div className="grid gap-5 border-t px-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="SEO-заголовок" htmlFor="cms-page-seo-title">
                <Input
                  id="cms-page-seo-title"
                  value={draft.seo?.title ?? ''}
                  onChange={(event) => updateSeo({ title: event.target.value })}
                />
              </Field>
              <Field label="Описание для поисковой выдачи" htmlFor="cms-page-seo-description">
                <Textarea
                  id="cms-page-seo-description"
                  value={draft.seo?.description ?? ''}
                  onChange={(event) => updateSeo({ description: event.target.value })}
                />
              </Field>
            </div>
          </div>
        </details>

        <div className="grid gap-4 border-t pt-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <Typography variant="bodySmMedium">Секции страницы</Typography>
              <Typography tone="muted" variant="caption">Выберите секцию слева, чтобы редактировать её в фокусе. Порядок меняется без потери данных.</Typography>
            </div>
            <Typography tone="muted" variant="caption">{draft.blocks.length} {draft.blocks.length === 1 ? 'секция' : 'секции'}</Typography>
          </div>
          <div className="grid gap-4 lg:grid-cols-[14.5rem_minmax(0,1fr)]">
            <nav aria-label="Секции страницы" className="grid content-start gap-1 rounded-xl border bg-muted/25 p-2 lg:sticky lg:top-[10.5rem] lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto">
              {draft.blocks.map((block, index) => (
                <Button
                  aria-current={selectedBlockId === block.id ? 'step' : undefined}
                  className="h-auto min-h-12 justify-start whitespace-normal border-l-2 border-transparent px-3 py-2 text-left data-[active=true]:border-primary"
                  data-active={selectedBlockId === block.id}
                  key={block.id}
                  onClick={() => setSelectedBlockId(block.id)}
                  type="button"
                  variant={selectedBlockId === block.id ? 'secondary' : 'ghost'}
                >
                  <span className="grid gap-0.5">
                    <Typography as="span" variant="bodySmMedium">{index + 1}. {getAdminBlockRegistration(block.type)?.label ?? 'Неподдерживаемая секция'}</Typography>
                    <Typography as="span" tone="muted" variant="caption">Нажмите, чтобы открыть</Typography>
                  </span>
                </Button>
              ))}
            </nav>
            {draft.blocks.map((block, index) => selectedBlockId === block.id && (
              <div className="grid gap-5 rounded-xl border bg-card p-4 shadow-xs sm:p-5" key={block.id}>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
                  <div className="grid gap-1">
                    <Typography variant="bodySmMedium">{getAdminBlockRegistration(block.type)?.label ?? 'Неподдерживаемая секция'}</Typography>
                    <Typography tone="muted" variant="caption">Секция {index + 1} из {draft.blocks.length}</Typography>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button aria-label="Переместить секцию выше" disabled={index === 0} onClick={() => moveBlock(index, -1)} size="icon-sm" title="Выше" type="button" variant="outline"><HugeiconsIcon aria-hidden icon={ArrowUp01Icon} strokeWidth={1.8} /></Button>
                    <Button aria-label="Переместить секцию ниже" disabled={index === draft.blocks.length - 1} onClick={() => moveBlock(index, 1)} size="icon-sm" title="Ниже" type="button" variant="outline"><HugeiconsIcon aria-hidden icon={ArrowDown01Icon} strokeWidth={1.8} /></Button>
                    <Button aria-label="Дублировать секцию" onClick={() => duplicateBlock(block)} size="icon-sm" title="Дублировать" type="button" variant="outline"><HugeiconsIcon aria-hidden icon={Copy01Icon} strokeWidth={1.8} /></Button>
                    <Button aria-label="Удалить секцию" disabled={draft.blocks.length <= 1} onClick={() => removeBlock(block)} size="icon-sm" title="Удалить" type="button" variant="ghost"><HugeiconsIcon aria-hidden icon={Delete02Icon} strokeWidth={1.8} /></Button>
                  </div>
                </div>
                <RegisteredBlockEditor
                  block={block}
                  entries={entries.data ?? []}
                  mediaAssets={media.data?.assets ?? []}
                  onChange={(data) => updateBlockData(index, data)}
                />
              </div>
            ))}
          </div>
          <SitePackageBlockAddMenu onAdd={addBlock} registrations={registrations} />
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

function RegisteredBlockEditor({
  block,
  entries,
  mediaAssets,
  onChange,
}: BlockEditorProps) {
  const registration = getAdminBlockRegistration(block.type)
  if (!registration) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Секцию нельзя редактировать</AlertTitle>
        <AlertDescription>
          <Typography as="span" variant="bodySm">
            Тип секции «{block.type}» не поддерживается выбранным пакетом сайта. Публикация заблокирована.
          </Typography>
        </AlertDescription>
      </Alert>
    )
  }

  const Editor = registration.Editor
  return <Editor block={block} entries={entries} mediaAssets={mediaAssets} onChange={onChange} />
}

export function SitePackageBlockAddMenu({
  onAdd,
  registrations,
}: {
  onAdd(type: string): void
  registrations: readonly AdminBlockRegistration[]
}) {
  return (
    <div className="grid gap-2 rounded-xl border border-dashed bg-muted/20 p-4">
      <Typography variant="bodySmMedium">Добавить секцию</Typography>
      <Typography tone="muted" variant="caption">
        Новая секция появится внизу страницы, а затем её можно переместить.
      </Typography>
      <div className="flex flex-wrap gap-2">
        {registrations.map((block) => (
          <Button aria-label={block.label} key={block.type} onClick={() => onAdd(block.type)} size="sm" type="button" variant="outline">
            + {block.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

function readDraft(page: CmsPageEditor): SelectedPageDraft | null {
  const payload = page.draftPayload && typeof page.draftPayload === 'object' && !Array.isArray(page.draftPayload)
    ? page.draftPayload
    : {}
  const result = selectedPageDraftSchema.safeParse({ ...payload, expectedRevision: page.draftRevision })
  return result.success ? result.data : null
}

function saveLabel(status: AutosaveSnapshot<SelectedPageDraft>['status']) {
  return {
    idle: 'Нет несохранённых изменений',
    dirty: 'Есть несохранённые изменения',
    saving: 'Сохраняем…',
    saved: 'Сохранено',
    conflict: 'Нужна проверка конфликта',
    error: 'Сохранение не завершено',
  }[status]
}
