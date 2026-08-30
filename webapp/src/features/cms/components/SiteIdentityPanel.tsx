import { SaveIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Typography } from '@/components/typography'

import { useCmsSiteSettingsQuery, useSaveCmsSiteSettingsMutation } from '../queries'

export function SiteIdentityPanel() {
  const settings = useCmsSiteSettingsQuery()
  const save = useSaveCmsSiteSettingsMutation()
  const [draftName, setDraftName] = useState<string | null>(null)

  if (settings.isLoading) return <SiteIdentityPanelSkeleton />
  if (settings.isError || !settings.data) return <SiteIdentityPanelError />

  const companyName = draftName ?? settings.data.companyName
  const trimmedName = companyName.trim()
  const unchanged = trimmedName === settings.data.companyName
  const invalid = trimmedName.length === 0 || trimmedName.length > 160

  return (
    <Card className="shadow-none">
      <CardHeader>
        <Typography as="h2" variant="h6">Название сайта</Typography>
        <CardDescription>
          Отображается в меню рабочего пространства и помогает команде сразу понимать, над каким сайтом она работает.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (invalid || unchanged) return
            save.mutate({ companyName: trimmedName, expectedRevision: settings.data.revision })
          }}
        >
          <Field>
            <FieldLabel htmlFor="site-company-name">Название</FieldLabel>
            <Input
              aria-describedby="site-company-name-hint"
              id="site-company-name"
              maxLength={160}
              onChange={(event) => setDraftName(event.target.value)}
              value={companyName}
            />
            <FieldDescription id="site-company-name-hint">
              Используйте короткое название, знакомое вашей команде и посетителям.
            </FieldDescription>
          </Field>
          {save.isError && (
            <Typography role="alert" tone="destructive" variant="bodyXs">
              Не удалось сохранить название. Проверьте подключение и повторите попытку.
            </Typography>
          )}
          {save.isSuccess && unchanged && (
            <Typography aria-live="polite" className="text-emerald-700 dark:text-emerald-400" variant="bodyXs">
              Название сайта сохранено.
            </Typography>
          )}
          <div>
            <Button disabled={invalid || unchanged || save.isPending} type="submit">
              <HugeiconsIcon aria-hidden icon={SaveIcon} strokeWidth={2} />
              {save.isPending ? 'Сохраняем…' : 'Сохранить название'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function SiteIdentityPanelSkeleton() {
  return <Card className="min-h-64 animate-pulse bg-muted/35" aria-label="Загружаем настройки сайта" />
}

function SiteIdentityPanelError() {
  return (
    <Card>
      <CardHeader>
        <Typography as="h2" variant="h6">Название сайта</Typography>
        <CardDescription>Не удалось загрузить настройки сайта. Обновите страницу и попробуйте ещё раз.</CardDescription>
      </CardHeader>
    </Card>
  )
}
