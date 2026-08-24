import { ShieldKeyIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Typography } from '@/components/typography'

import { useCmsPublicationSummaryQuery, useSaveCmsPublicationPolicyMutation } from '../queries'

export function PublicationPolicyPanel() {
  const publication = useCmsPublicationSummaryQuery()
  const save = useSaveCmsPublicationPolicyMutation()

  if (publication.isLoading) return <Card className="min-h-40 animate-pulse bg-muted/35" aria-label="Загружаем правила публикации" />
  if (publication.isError || !publication.data) {
    return <Card><CardHeader><Typography as="h2" variant="h6">Права на публикацию</Typography><CardDescription>Не удалось загрузить правило публикации.</CardDescription></CardHeader></Card>
  }

  const enabled = publication.data.policy.editorCanPublish
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2"><HugeiconsIcon aria-hidden className="text-primary" icon={ShieldKeyIcon} strokeWidth={2} /><Typography as="h2" variant="h6">Права на публикацию</Typography></div>
        <CardDescription>Определите, может ли редактор выпускать изменения сам или сначала отправляет их на согласование.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/20 p-3">
          <div className="grid gap-1">
            <Typography as="label" htmlFor="editor-can-publish" variant="bodySmMedium">Редактор может публиковать сам</Typography>
            <Typography tone="muted" variant="caption">{enabled ? 'Изменения редактора можно сразу выпускать на сайт.' : 'Редактор отправляет изменения владельцу на согласование.'}</Typography>
          </div>
          <Switch checked={enabled} disabled={save.isPending} id="editor-can-publish" onCheckedChange={(checked) => save.mutate(checked)} />
        </div>
        {save.isError && <Typography role="alert" tone="destructive" variant="bodyXs">Не удалось обновить правило. Повторите попытку.</Typography>}
      </CardContent>
    </Card>
  )
}
