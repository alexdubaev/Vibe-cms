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
  useApproveCmsApprovalMutation,
  usePublishCmsCurrentMutation,
  useRejectCmsApprovalMutation,
  useSubmitCmsApprovalMutation,
  useRestoreCmsPageRevisionMutation,
} from './queries'
import { cmsCollectionViewState, cmsPublicationStatusLabel, summarizeCmsDraft } from './model'
import { PageEditor } from './components/PageEditor'
import { CollectionEditor } from './components/CollectionEditor'
import { CollectionList } from './components/CollectionList'
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
        description="Просматривайте страницы сайта и текущие версии черновиков."
        title="Страницы"
      />
      {state === 'loading' && <CmsLoading />}
      {state === 'error' && <CmsError />}
      {state === 'empty' && <CmsEmpty title="Страниц пока нет" />}
      {state === 'ready' && query.data && (
        <Card>
          <CardHeader>
            <CardTitle>Контент сайта</CardTitle>
            <CardDescription>Выберите страницу, чтобы посмотреть сводку черновика.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Название</TableHead>
                  <TableHead>Путь</TableHead>
                  <TableHead>Версия черновика</TableHead>
                  <TableHead>Статус</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((page) => (
                  <TableRow key={page.id}>
                    <TableCell>
                      <Typography asChild tone="primary" variant="bodySmMedium">
                        <Link
                          className="underline-offset-4 hover:underline"
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
                    <TableCell>{page.draftRevision}</TableCell>
                    <TableCell>
                      <Badge variant={page.archived ? 'outline' : 'secondary'}>
                        {page.archived ? 'Архив' : 'Черновик'}
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
  const { type: rawType } = useParams({ from: '/adminWorkspace/admin/content/$type' })
  const parsedType = collectionTypeSchema.safeParse(rawType)
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
      <div className="grid gap-6 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
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

  return (
    <PageContainer>
      <PageHeader
        description="Редактируйте содержимое без показа служебных идентификаторов и сырого JSON."
        title={query.data?.title ?? 'Страница'}
        actions={
          query.data ? (
            <Button
              disabled={submit.isPending}
              onClick={() => submit.mutate(query.data!.draftRevision)}
            >
              {submit.isPending ? 'Отправляем…' : 'Отправить на согласование'}
            </Button>
          ) : undefined
        }
      />
      {query.isPending && <CmsLoading />}
      {query.isError && <CmsError />}
      {submit.isError && <CmsActionError />}
      {query.data && !query.isPending && !query.isError && (
        <div className="grid gap-6">
          <PageEditor key={`${query.data.id}:${query.data.draftRevision}`} page={query.data} />
          <CmsDraftSummaryCard page={query.data} />
          <RevisionHistoryCard
            error={revisions.isError || restore.isError}
            isPending={revisions.isPending}
            revisions={revisions.data}
            restoringId={restore.isPending ? restore.variables?.revisionId : undefined}
            onRestore={(revisionId) => restore.mutate({ pageId, revisionId })}
          />
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
  const canApprove = auth.user?.role === 'owner'
  const canPublish = canApprove || Boolean(publication.data?.policy.editorCanPublish)
  const actionError = approve.error ?? reject.error ?? publish.error

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
          onPublish={(revision) => publish.mutate(revision)}
        />
      )}
      {actionError && <CmsActionError />}
      <PendingApprovalsCard
        approvals={approvals.data}
        canApprove={canApprove}
        isApproving={approve.isPending}
        isError={approvals.isError}
        isPending={approvals.isPending}
        isRejecting={reject.isPending}
        onApprove={(approvalId) => approve.mutate(approvalId)}
        onReject={(approvalId, note) => reject.mutate({ approvalId, note })}
      />
    </PageContainer>
  )
}

function CmsDraftSummaryCard({ page }: { page: Parameters<typeof summarizeCmsDraft>[0] }) {
  const summary = summarizeCmsDraft(page)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Сводка черновика</CardTitle>
        <CardDescription>Данные показаны без сырого JSON и служебных идентификаторов.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <SummaryItem label="Путь" value={page.path} />
        <SummaryItem label="Версия" value={String(page.draftRevision)} />
        <SummaryItem label="Блоки" value={String(summary.blockCount)} />
        <SummaryItem label="SEO" value={summary.hasSeo ? 'Заполнено' : 'Не заполнено'} />
        <SummaryItem label="Метка навигации" value={summary.navigationLabel ?? 'Не задана'} />
        <SummaryItem
          label="Типы блоков"
          value={summary.blockTypes.length > 0 ? summary.blockTypes.join(', ') : 'Нет блоков'}
        />
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
                  <Typography variant="bodySmMedium">Версия {revision.revision}</Typography>
                  <Typography tone="muted" variant="caption">
                    Снимок черновика {revision.sourceDraftRevision} · {new Date(revision.createdAt).toLocaleString('ru-RU')}
                  </Typography>
                  {revision.publicationRevision && (
                    <Badge variant="secondary">Публиковалась: {revision.publicationRevision}</Badge>
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
  onPublish,
}: {
  data: Awaited<ReturnType<typeof import('./api').getCmsPublicationSummary>>
  canPublish: boolean
  isPublishing: boolean
  onPublish: (revision: number) => void
}) {
  const status = data.controller?.status
  return (
    <Card>
      <CardHeader>
        <CardTitle>Состояние публикации</CardTitle>
        <CardDescription>Публикация запускается отдельным защищённым процессом сборки.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryItem label="Статус" value={cmsPublicationStatusLabel(status)} />
        <SummaryItem
          label="Опубликованная версия"
          value={String(data.controller?.publishedRevision ?? 'Нет')}
        />
        <SummaryItem
          label="Ожидаемая версия"
          value={String(data.controller?.desiredRevision ?? 'Нет')}
        />
        <SummaryItem
          label="Последний артефакт"
          value={data.latestPublication?.artifactState ?? 'Нет данных'}
        />
        {data.controller?.lastError && (
          <div className="sm:col-span-2 lg:col-span-4">
            <Alert variant="destructive">
              <AlertTitle>Сборка завершилась с ошибкой</AlertTitle>
              <AlertDescription>{data.controller.lastError}</AlertDescription>
            </Alert>
          </div>
        )}
        {canPublish && data.controller?.desiredRevision && (
          <div className="sm:col-span-2 lg:col-span-4">
            <Button disabled={isPublishing} onClick={() => onPublish(data.controller!.desiredRevision!)}>
              {isPublishing ? 'Публикуем…' : 'Опубликовать изменения'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
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
    <Card>
      <CardHeader>
        <CardTitle>Заявки на согласование</CardTitle>
        <CardDescription>Здесь отображаются только ожидающие решения заявки.</CardDescription>
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
    <div className="grid gap-3 rounded-lg border p-3">
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
