import { Link, useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PageContainer, PageHeader } from '@/components/PageLayout'
import { Typography } from '@/components/typography'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/features/auth'
import {
  useCmsEntriesQuery,
  useCmsEntryQuery,
  useCmsPageQuery,
  useCmsPageRevisionsQuery,
  useCmsPagesQuery,
  useCmsPendingApprovalsQuery,
  useCmsPublicationSummaryQuery,
  useCmsPreviewGrantMutation,
  useApproveCmsApprovalMutation,
  usePublishCmsCurrentMutation,
  useRetryCmsPublicationMutation,
  useRejectCmsApprovalMutation,
  useSubmitCmsApprovalMutation,
  useRestoreCmsPageRevisionMutation,
} from './queries'
import { cmsCollectionViewState, cmsPublicationStatusLabel, resolveCmsWorkflowState, summarizeCmsDraft } from './model'
import { PageEditor } from './components/PageEditor'
import { CollectionEditor } from './components/CollectionEditor'
import { CollectionList } from './components/CollectionList'
import { WorkflowStatus } from './components/WorkflowStatus'
import type { CmsPageRevision } from './api'
import { collectionTypeSchema } from '@web-app-demo/contracts'

export function CmsPagesPage() {
  const query = useCmsPagesQuery()
  const state = cmsCollectionViewState({
    isError: query.isError,
    isPending: query.isPending,
    itemCount: query.data?.length,
  })

  return (
    <PageContainer>
      <PageHeader
        description="Выберите страницу, чтобы продолжить работу над содержанием и проверить готовность к публикации."
        title="Страницы"
      />
      {state === 'loading' && <CmsLoading />}
      {state === 'error' && <CmsError />}
      {state === 'empty' && <CmsEmpty title="Страниц пока нет" />}
      {state === 'ready' && query.data && (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>Страницы сайта · {query.data.length}</CardTitle>
            <CardDescription>Откройте страницу, чтобы изменить её секции, проверить черновик и отправить его на согласование.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Название</TableHead>
                  <TableHead>Путь</TableHead>
                  <TableHead>Версия</TableHead>
                  <TableHead className="text-right">Состояние</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((page) => (
                  <TableRow className="group" key={page.id}>
                    <TableCell>
                      <Typography asChild tone="primary" variant="bodySmMedium">
                        <Link
                          className="inline-flex min-h-9 items-center underline-offset-4 group-hover:underline"
                          params={{ pageId: page.id }}
                          to="/admin/pages/$pageId"
                        >
                          {page.title}
                        </Link>
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="codeXs">{page.path}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="bodySm">Черновик {page.draftRevision}</Typography>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={page.archived ? 'outline' : 'secondary'}>
                        {page.archived ? 'В архиве' : 'В работе'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  )
}

export function CmsContentPage() {
  // This screen is mounted by both the dynamic collection route and the explicit
  // `/admin/content/service` entry route. Read the shared param set without pinning
  // the component to only one of those sibling matches.
  const { type: rawType } = useParams({ strict: false })
  const parsedType = collectionTypeSchema.safeParse(rawType ?? 'service')
  const type = parsedType.success ? parsedType.data : 'service'
  const entries = useCmsEntriesQuery(type)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const selected = entries.data?.find((entry) => entry.id === selectedId) ?? (!creating ? entries.data?.[0] : undefined)
  const editor = useCmsEntryQuery(selected?.id ?? '')

  return (
    <PageContainer>
      <PageHeader
        description="Создавайте и редактируйте записи, которые используются в блоках услуг, проектов, отзывов и FAQ."
        title="Контент"
        actions={
          <Button onClick={() => { setCreating(true); setSelectedId(null) }}>
            Новая запись
          </Button>
        }
      />
      {!parsedType.success && (
        <Alert>
          <AlertTitle>Раздел не найден</AlertTitle>
          <AlertDescription>Показан раздел услуг.</AlertDescription>
        </Alert>
      )}
      {entries.isError && <CmsError />}
      <div className="grid gap-4 xl:grid-cols-[minmax(19rem,0.72fr)_minmax(0,1.28fr)] xl:items-start">
        <CollectionList
          entries={entries.data}
          isPending={entries.isPending}
          selectedId={selected?.id ?? null}
          type={type}
          onSelect={(id) => { setCreating(false); setSelectedId(id) }}
        />
        {creating && (
          <CollectionEditor
            key={`new:${type}`}
            type={type}
            onCreated={(created) => { setCreating(false); setSelectedId(created.id) }}
            onSaved={(saved) => { setSelectedId(saved.id) }}
          />
        )}
        {!creating && selected && editor.isPending && <Skeleton className="h-96 w-full" />}
        {!creating && selected && editor.isError && <CmsError />}
        {!creating && selected && editor.data && (
          <CollectionEditor
            entry={editor.data}
            key={`${selected.id}:${editor.data.draftRevision}`}
            type={type}
            onCreated={(created) => { setCreating(false); setSelectedId(created.id) }}
            onSaved={(saved) => { setSelectedId(saved.id) }}
          />
        )}
        {!creating && !selected && !entries.isPending && !entries.isError && (
          <Card>
            <CardContent className="py-12 text-center">
              <Typography tone="muted">Выберите запись или создайте новую.</Typography>
            </CardContent>
          </Card>
        )}
      </div>
    </PageContainer>
  )
}

export function CmsPageDetailPage() {
  const { pageId } = useParams({ from: '/adminWorkspace/admin/pages/$pageId' })
  const query = useCmsPageQuery(pageId)
  const revisions = useCmsPageRevisionsQuery(pageId)
  const submit = useSubmitCmsApprovalMutation()
  const restore = useRestoreCmsPageRevisionMutation()
  const preview = useCmsPreviewGrantMutation()
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  return (
    <PageContainer>
      <PageHeader
        description="Редактируйте содержимое без показа служебных идентификаторов и сырого JSON."
        title={query.data?.title ?? 'Страница'}
      />
      {query.isPending && <CmsLoading />}
      {query.isError && <CmsError />}
      {submit.isError && <CmsActionError />}
      {preview.isError && <CmsPreviewError />}
      {query.data && !query.isPending && !query.isError && (
        <div className={previewUrl ? 'grid gap-6 2xl:grid-cols-[minmax(0,1fr)_minmax(23rem,0.8fr)]' : 'grid gap-6'}>
          <div className="grid gap-6">
            <PageEditor
              actions={(
                <>
                  <Button
                    disabled={preview.isPending}
                    onClick={() => preview.mutate(pageId, { onSuccess: (grant) => setPreviewUrl(grant.previewUrl) })}
                    size="sm"
                    variant="outline"
                  >
                    {preview.isPending ? 'Открываем…' : 'Предпросмотр'}
                  </Button>
                  <Button
                    disabled={submit.isPending}
                    onClick={() => submit.mutate(query.data!.draftRevision)}
                    size="sm"
                  >
                    {submit.isPending ? 'Отправляем…' : 'Отправить на согласование'}
                  </Button>
                </>
              )}
              key={`${query.data.id}:${query.data.draftRevision}`}
              page={query.data}
            />
            <CmsDraftSummaryCard page={query.data} />
            <RevisionHistoryCard
              error={revisions.isError || restore.isError}
              isPending={revisions.isPending}
              revisions={revisions.data}
              restoringId={restore.isPending ? restore.variables?.revisionId : undefined}
              onRestore={(revisionId) => restore.mutate({ pageId, revisionId })}
            />
          </div>
          {previewUrl && <CmsPreviewPanel onClose={() => setPreviewUrl(null)} previewUrl={previewUrl} />}
        </div>
      )}
    </PageContainer>
  )
}

export function CmsPublicationsPage() {
  const auth = useAuth()
  const publication = useCmsPublicationSummaryQuery()
  const approvals = useCmsPendingApprovalsQuery()
  const approve = useApproveCmsApprovalMutation()
  const reject = useRejectCmsApprovalMutation()
  const publish = usePublishCmsCurrentMutation()
  const retry = useRetryCmsPublicationMutation()
  const [rejectionNotice, setRejectionNotice] = useState<string | null>(null)
  const canApprove = auth.user?.role === 'owner'
  const canPublish = canApprove || Boolean(publication.data?.policy.editorCanPublish)
  const actionError = approve.error ?? reject.error ?? publish.error ?? retry.error

  return (
    <PageContainer>
      <PageHeader
        description="Следите за текущей публикацией и заявками на согласование."
        title="Публикации"
      />
      {publication.isPending && <CmsLoading />}
      {publication.isError && <CmsError />}
      {publication.data && (
        <PublicationStatusCard
          canPublish={canPublish}
          data={publication.data}
          isPublishing={publish.isPending}
          isRetrying={retry.isPending}
          onPublish={(revision) => publish.mutate(revision)}
          onRetry={() => retry.mutate()}
        />
      )}
      {actionError && <CmsActionError />}
      {rejectionNotice && (
        <Alert>
          <AlertTitle>Заявка отклонена</AlertTitle>
          <AlertDescription>Отклонено: {rejectionNotice}</AlertDescription>
        </Alert>
      )}
      <PendingApprovalsCard
        approvals={approvals.data}
        canApprove={canApprove}
        isApproving={approve.isPending}
        isError={approvals.isError}
        isPending={approvals.isPending}
        isRejecting={reject.isPending}
        onApprove={(approvalId) => approve.mutate(approvalId)}
        onReject={(approvalId, note) => reject.mutate(
          { approvalId, note },
          { onSuccess: (approval) => setRejectionNotice(approval.decisionNote ?? note.trim()) },
        )}
      />
    </PageContainer>
  )
}

function CmsDraftSummaryCard({ page }: { page: Parameters<typeof summarizeCmsDraft>[0] }) {
  const summary = summarizeCmsDraft(page)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Готовность страницы</CardTitle>
        <CardDescription>Быстрая проверка перед предпросмотром и согласованием.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <SummaryItem label="Путь" value={page.path} />
        <SummaryItem label="Секций" value={String(summary.blockCount)} />
        <SummaryItem label="SEO" value={summary.hasSeo ? 'Заполнено' : 'Не заполнено'} />
        <SummaryItem label="Метка навигации" value={summary.navigationLabel ?? 'Не задана'} />
        <SummaryItem label="Содержание" value={summary.blockTypes.length > 0 ? `${summary.blockTypes.length} типов секций` : 'Нет секций'} />
      </CardContent>
    </Card>
  )
}

function RevisionHistoryCard({
  error,
  isPending,
  revisions,
  restoringId,
  onRestore,
}: {
  error: boolean
  isPending: boolean
  revisions: readonly CmsPageRevision[] | undefined
  restoringId: string | undefined
  onRestore: (revisionId: string) => void
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null)

  return (
    <Card>
      <CardHeader>
        <CardTitle>История версий</CardTitle>
        <CardDescription>Сохраняйте текущий черновик перед восстановлением старой версии.</CardDescription>
      </CardHeader>
      <CardContent>
        {isPending && <Skeleton className="h-10 w-full" />}
        {error && <Typography tone="destructive">Историю версий загрузить не удалось.</Typography>}
        {!isPending && !error && revisions?.length === 0 && (
          <Typography tone="muted">Сохранённых версий пока нет.</Typography>
        )}
        {!isPending && !error && revisions && revisions.length > 0 && (
          <div className="grid gap-2">
            {revisions.map((revision) => (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3" key={revision.id}>
                <div className="grid gap-1">
                  <Typography variant="bodySmMedium">Сохранённая версия</Typography>
                  <Typography tone="muted" variant="caption">
                    {new Date(revision.createdAt).toLocaleString('ru-RU')}
                  </Typography>
                  {revision.publicationRevision && (
                    <Badge variant="secondary">Была опубликована</Badge>
                  )}
                </div>
                {confirmId === revision.id ? (
                  <div className="flex items-center gap-2">
                    <Typography as="span" tone="destructive" variant="caption">Восстановить?</Typography>
                    <Button
                      disabled={Boolean(restoringId)}
                      onClick={() => {
                        onRestore(revision.id)
                        setConfirmId(null)
                      }}
                      size="sm"
                      variant="destructive"
                    >
                      Да
                    </Button>
                    <Button onClick={() => setConfirmId(null)} size="sm" variant="ghost">Нет</Button>
                  </div>
                ) : (
                  <Button disabled={Boolean(restoringId)} onClick={() => setConfirmId(revision.id)} size="sm" variant="outline">
                    Восстановить
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function PublicationStatusCard({
  data,
  canPublish,
  isPublishing,
  isRetrying,
  onPublish,
  onRetry,
}: {
  data: Awaited<ReturnType<typeof import('./api').getCmsPublicationSummary>>
  canPublish: boolean
  isPublishing: boolean
  isRetrying: boolean
  onPublish: (revision: number) => void
  onRetry: () => void
}) {
  const status = data.controller?.status
  return (
    <Card className="shadow-none">
      <CardHeader className="border-b pb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <CardTitle>Путь изменений на сайт</CardTitle>
            <CardDescription>Черновик проходит проверку и безопасную сборку, прежде чем его увидят посетители.</CardDescription>
          </div>
          <WorkflowStatus state={resolveCmsWorkflowState({ publicationStatus: status })} />
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 pt-1">
        <PublicationTimeline status={status} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryItem label="Статус" value={cmsPublicationStatusLabel(status)} />
        <SummaryItem
          label="На сайте сейчас"
          value={data.controller?.publishedRevision ? 'Актуальная версия опубликована' : 'Пока не опубликовано'}
        />
        <SummaryItem
          label="Изменения"
          value={data.controller?.desiredRevision && data.controller.desiredRevision !== data.controller.publishedRevision ? 'Ждут публикации' : 'Синхронизированы'}
        />
        <SummaryItem
          label="Подготовка"
          value={publicationArtifactLabel(data.latestPublication?.artifactState)}
        />
        </div>
        {data.controller?.lastError && (
          <div>
            <Alert variant="destructive">
              <AlertTitle>Сборка завершилась с ошибкой</AlertTitle>
              <AlertDescription>{data.controller.lastError}</AlertDescription>
            </Alert>
          </div>
        )}
        {canPublish && data.controller?.desiredRevision && status !== 'failed' && (
          <div className="flex justify-end border-t pt-4">
            <Button disabled={isPublishing} onClick={() => onPublish(data.controller!.desiredRevision!)}>
              {isPublishing ? 'Публикуем…' : 'Опубликовать изменения'}
            </Button>
          </div>
        )}
        {canPublish && status === 'failed' && (
          <div className="grid gap-2 border-t pt-4">
            <Typography tone="muted" variant="caption">Предыдущая попытка не завершилась. Повторный запуск использует тот же проверенный черновик.</Typography>
            <div><Button disabled={isRetrying} onClick={onRetry}>{isRetrying ? 'Запускаем повторно…' : 'Повторить публикацию'}</Button></div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function PublicationTimeline({ status }: { status: 'queued' | 'building' | 'published' | 'failed' | null | undefined }) {
  const activeIndex = status === 'published' ? 3 : status === 'building' ? 2 : status === 'queued' ? 1 : 0
  const steps = ['Черновик', 'В очереди', 'Сборка', 'На сайте']
  return (
    <ol aria-label="Этапы публикации" className="grid gap-2 sm:grid-cols-4">
      {steps.map((step, index) => {
        const completed = index <= activeIndex && status !== 'failed'
        return (
          <li className="flex items-center gap-2 rounded-lg border bg-muted/15 px-3 py-2.5" key={step}>
            <Typography asChild variant="controlXs">
              <span className={`flex size-6 items-center justify-center rounded-full ${completed ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                {index + 1}
              </span>
            </Typography>
            <Typography as="span" tone={completed ? 'default' : 'muted'} variant="bodySmMedium">{step}</Typography>
          </li>
        )
      })}
    </ol>
  )
}

function PendingApprovalsCard({
  approvals,
  canApprove,
  isApproving,
  isRejecting,
  isError,
  isPending,
  onApprove,
  onReject,
}: {
  approvals:
    | ReadonlyArray<{ id: string; status: 'pending'; requesterUserId: string; createdAt?: string }>
    | undefined
  isError: boolean
  isPending: boolean
  canApprove: boolean
  isApproving: boolean
  isRejecting: boolean
  onApprove: (approvalId: string) => void
  onReject: (approvalId: string, note: string) => void
}) {
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>Заявки на согласование</CardTitle>
        <CardDescription>Ожидающие решения заявки собраны в одном месте.</CardDescription>
      </CardHeader>
      <CardContent>
        {isPending && <Skeleton className="h-10 w-full" />}
        {isError && <Typography tone="destructive">Не удалось загрузить заявки.</Typography>}
        {!isPending && !isError && approvals?.length === 0 && (
          <Typography tone="muted">Ожидающих заявок нет.</Typography>
        )}
        {!isPending && !isError && approvals && approvals.length > 0 && (
          <div className="grid gap-3">
            {approvals.map((approval) => (
              <ApprovalCard
                approval={approval}
                canApprove={canApprove}
                isApproving={isApproving}
                isRejecting={isRejecting}
                key={approval.id}
                onApprove={onApprove}
                onReject={onReject}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ApprovalCard({
  approval,
  canApprove,
  isApproving,
  isRejecting,
  onApprove,
  onReject,
}: {
  approval: { id: string; status: 'pending'; requesterUserId: string; createdAt?: string }
  canApprove: boolean
  isApproving: boolean
  isRejecting: boolean
  onApprove: (approvalId: string) => void
  onReject: (approvalId: string, note: string) => void
}) {
  const [note, setNote] = useState('')

  return (
    <div className="grid gap-3 rounded-lg border bg-muted/10 p-4">
      <div className="flex items-center justify-between gap-4">
                <div className="grid gap-1">
                  <Typography variant="bodySmMedium">Новая заявка</Typography>
                  <Typography tone="muted" variant="caption">
                    {approval.createdAt ? new Date(approval.createdAt).toLocaleString('ru-RU') : 'Дата не указана'}
                  </Typography>
                </div>
                <Badge variant="outline">Ожидает решения</Badge>
      </div>
      {canApprove ? (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <Input aria-label="Причина отклонения" placeholder="Причина отклонения (необязательно)" value={note} onChange={(event) => setNote(event.target.value)} />
          <Button disabled={isApproving} onClick={() => onApprove(approval.id)} size="sm">Согласовать</Button>
          <Button disabled={isRejecting || !note.trim()} onClick={() => onReject(approval.id, note)} size="sm" variant="outline">Отклонить</Button>
        </div>
      ) : (
        <Typography tone="muted" variant="caption">Решение по заявке принимает владелец.</Typography>
      )}
    </div>
  )
}

function CmsActionError() {
  return (
    <Alert variant="destructive">
      <AlertTitle>Действие не выполнено</AlertTitle>
      <AlertDescription>Проверьте соединение и повторите попытку.</AlertDescription>
    </Alert>
  )
}

function CmsPreviewError() {
  return (
    <Alert variant="destructive">
      <AlertTitle>Предпросмотр недоступен</AlertTitle>
      <AlertDescription>Не удалось открыть защищённый предпросмотр. Сохраните изменения и повторите попытку.</AlertDescription>
    </Alert>
  )
}

function CmsPreviewPanel({ onClose, previewUrl }: { onClose: () => void; previewUrl: string }) {
  return (
    <aside className="sticky top-20 grid h-fit gap-3 rounded-xl border bg-card p-3 shadow-sm" aria-label="Предпросмотр страницы">
      <div className="flex items-start justify-between gap-3 px-1">
        <div className="grid gap-1">
          <Typography variant="bodySmMedium">Предпросмотр</Typography>
          <Typography tone="muted" variant="caption">Показывает последнюю сохранённую версию и доступен только вам.</Typography>
        </div>
        <Button onClick={onClose} size="sm" type="button" variant="ghost">Закрыть</Button>
      </div>
      <iframe
        className="min-h-[42rem] w-full rounded-lg border bg-background"
        referrerPolicy="no-referrer"
        sandbox="allow-forms allow-popups allow-same-origin allow-scripts"
        src={previewUrl}
        title="Защищённый предпросмотр страницы"
      />
    </aside>
  )
}

function publicationArtifactLabel(state: 'missing' | 'uploading' | 'ready' | undefined) {
  if (state === 'ready') return 'Готово к публикации'
  if (state === 'uploading') return 'Подготавливается'
  if (state === 'missing') return 'Готовится'
  return 'Нет данных'
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-lg border bg-muted/20 p-3">
      <Typography variant="caption" tone="muted">{label}</Typography>
      <Typography variant="bodySmMedium" wrap="break">{value}</Typography>
    </div>
  )
}

function CmsLoading() {
  return <Skeleton className="h-48 w-full" />
}

function CmsError() {
  return (
    <Alert variant="destructive">
      <AlertTitle>Не удалось загрузить данные</AlertTitle>
      <AlertDescription>Проверьте соединение и повторите попытку.</AlertDescription>
    </Alert>
  )
}

function CmsEmpty({ title }: { title: string }) {
  return (
    <Card>
      <CardContent className="py-10 text-center">
        <Typography tone="muted">{title}</Typography>
      </CardContent>
    </Card>
  )
}
