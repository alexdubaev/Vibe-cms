import type { MediaAsset } from '@web-app-demo/contracts'
import { useState, type FormEvent } from 'react'

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
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { PageContainer, PageHeader } from '@/components/PageLayout'
import { Typography } from '@/components/typography'
import { useAuth } from '@/features/auth'
import {
  useCmsMediaQuery,
  useDeleteCmsMediaMutation,
  useUploadCmsMediaMutation,
  useUpdateCmsMediaAltMutation,
} from '../queries'
import { formatMediaBytes, mediaDimensionsLabel, mediaStateLabel } from '../media-model'

export function MediaLibraryPage() {
  const auth = useAuth()
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const query = useCmsMediaQuery(search)
  const upload = useUploadCmsMediaMutation()
  const canDelete = auth.user?.role === 'owner'

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSearch(searchInput.trim())
  }

  return (
    <PageContainer>
      <PageHeader
        description="Управляйте файлами сайта и описаниями для доступности. Ссылки на закрытое хранилище здесь не показываются."
        title="Медиатека"
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <form className="flex gap-2" onSubmit={submitSearch}>
              <Input
                aria-label="Поиск медиафайлов"
                className="sm:w-64"
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Поиск по имени"
                type="search"
                value={searchInput}
              />
              <Button type="submit" variant="outline">
                Найти
              </Button>
            </form>
            <MediaUploadControl isPending={upload.isPending} onFile={upload.mutate} />
          </div>
        }
      />
      {upload.isError && <MediaError text="Не удалось загрузить файл. Проверьте формат и соединение." />}
      {query.isPending && <MediaLoading />}
      {query.isError && <MediaError />}
      {query.data && query.data.assets.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center">
            <Typography tone="muted">
              {search ? 'По вашему запросу ничего не найдено.' : 'Медиафайлов пока нет.'}
            </Typography>
          </CardContent>
        </Card>
      )}
      {query.data && query.data.assets.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {query.data.assets.map((asset) => (
            <MediaAssetCard asset={asset} canDelete={canDelete} key={asset.id} />
          ))}
        </div>
      )}
    </PageContainer>
  )
}

function MediaAssetCard({ asset, canDelete }: { asset: MediaAsset; canDelete: boolean }) {
  const updateAlt = useUpdateCmsMediaAltMutation()
  const remove = useDeleteCmsMediaMutation()
  const [alt, setAlt] = useState(asset.alt ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isAltDirty = alt !== (asset.alt ?? '')

  function saveAlt() {
    updateAlt.mutate({ assetId: asset.id, alt: alt.trim() || null })
  }

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate" title={asset.filename}>
              {asset.filename}
            </CardTitle>
            <CardDescription>{asset.mimeType}</CardDescription>
          </div>
          <Badge variant={asset.state === 'ready' ? 'secondary' : 'outline'}>
            {mediaStateLabel(asset.state)}
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MediaMeta label="Размер" value={formatMediaBytes(asset.byteSize)} />
          <MediaMeta label="Размеры" value={mediaDimensionsLabel(asset)} />
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <label className="grid gap-1.5">
          <Typography as="span" variant="caption" tone="muted">
            Alt-текст
          </Typography>
          <Input
            aria-label={`Alt-текст для ${asset.filename}`}
            maxLength={200}
            onChange={(event) => setAlt(event.target.value)}
            placeholder="Кратко опишите изображение"
            value={alt}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!isAltDirty || updateAlt.isPending} onClick={saveAlt} size="sm">
            {updateAlt.isPending ? 'Сохраняем…' : 'Сохранить alt'}
          </Button>
          {canDelete && asset.state !== 'deleted' && (
            <DeleteControl
              confirmDelete={confirmDelete}
              isPending={remove.isPending}
              onCancel={() => setConfirmDelete(false)}
              onConfirm={() => remove.mutate(asset.id)}
              onStart={() => setConfirmDelete(true)}
            />
          )}
        </div>
        {updateAlt.isError && <ActionError text="Не удалось сохранить alt-текст." />}
        {remove.isError && <ActionError text="Не удалось удалить файл. Возможно, он используется на сайте." />}
      </CardContent>
    </Card>
  )
}

function DeleteControl({
  confirmDelete,
  isPending,
  onCancel,
  onConfirm,
  onStart,
}: {
  confirmDelete: boolean
  isPending: boolean
  onCancel: () => void
  onConfirm: () => void
  onStart: () => void
}) {
  if (!confirmDelete) {
    return (
      <Button onClick={onStart} size="sm" variant="destructive">
        Удалить
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-destructive/30 p-1">
      <Typography as="span" tone="destructive" variant="caption">
        Удалить файл?
      </Typography>
      <Button disabled={isPending} onClick={onConfirm} size="xs" variant="destructive">
        {isPending ? 'Удаляем…' : 'Да'}
      </Button>
      <Button disabled={isPending} onClick={onCancel} size="xs" variant="ghost">
        Нет
      </Button>
    </div>
  )
}

function MediaMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/40 px-2.5 py-2">
      <Typography as="span" variant="caption" tone="muted">
        {label}
      </Typography>
      <Typography as="span" variant="bodySmMedium" wrap="break">
        {value}
      </Typography>
    </div>
  )
}

function ActionError({ text }: { text: string }) {
  return (
    <Alert className="py-2" variant="destructive">
      <AlertTitle>Действие не выполнено</AlertTitle>
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  )
}

function MediaLoading() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

function MediaUploadControl({
  isPending,
  onFile,
}: {
  isPending: boolean
  onFile: (file: File) => void
}) {
  return (
    <>
      <Button asChild disabled={isPending}>
        <label htmlFor="cms-media-upload">
          <Typography as="span" variant="control">
            {isPending ? 'Загружаем…' : 'Загрузить файл'}
          </Typography>
        </label>
      </Button>
      <Input
        accept=".avif,.jpg,.jpeg,.mp4,.pdf,.png,.webp,image/avif,image/jpeg,image/png,image/webp,video/mp4,application/pdf"
        className="sr-only"
        id="cms-media-upload"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.currentTarget.value = ''
          if (file) onFile(file)
        }}
        type="file"
      />
    </>
  )
}

function MediaError({ text = 'Проверьте соединение и повторите попытку.' }: { text?: string }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Не удалось загрузить медиатеку</AlertTitle>
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  )
}
