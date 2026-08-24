import type { UserDto } from '@web-app-demo/contracts'
import { useId, useState, type FormEvent } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Typography } from '@/components/typography'
import { useUpdateProfileMutation } from './queries'

export function ProfilePanel({ user }: { user: UserDto }) {
  const displayNameErrorId = useId()
  const [displayName, setDisplayName] = useState(user.displayName ?? '')
  const mutation = useUpdateProfileMutation()
  const displayNameInvalid = displayName.trim().length === 1

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalized = displayName.trim()
    mutation.mutate(normalized === '' ? null : normalized, {
      onSuccess: (response) => setDisplayName(response.user.displayName ?? ''),
    })
  }

  return (
    <Card>
      <CardHeader>
        <Typography as="h2" variant="h6">
          Данные профиля
        </Typography>
        <CardDescription>
          Обновите имя, которое отображается в рабочем пространстве. Адрес электронной почты изменяется отдельно.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-5" noValidate onSubmit={submit}>
          <FieldGroup>
            <Field data-invalid={displayNameInvalid}>
              <FieldLabel htmlFor="profile-display-name">Отображаемое имя</FieldLabel>
              <Input
                aria-describedby={displayNameInvalid ? displayNameErrorId : undefined}
                aria-invalid={displayNameInvalid}
                autoComplete="name"
                disabled={mutation.isPending}
                id="profile-display-name"
                maxLength={80}
                onChange={(event) => {
                  setDisplayName(event.target.value)
                  mutation.reset()
                }}
                placeholder="Ваше имя"
                value={displayName}
              />
              <FieldDescription>Оставьте пустым, чтобы вместо имени использовать email.</FieldDescription>
              {displayNameInvalid && (
                <FieldError id={displayNameErrorId}>
                  Имя должно содержать не менее 2 символов.
                </FieldError>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-email">Email</FieldLabel>
              <Input
                aria-readonly="true"
                id="profile-email"
                readOnly
                value={user.email}
              />
              <FieldDescription>Изменение email пока недоступно.</FieldDescription>
            </Field>
          </FieldGroup>

          {mutation.isError && (
            <Alert variant="destructive">
              <AlertTitle>Не удалось сохранить профиль</AlertTitle>
              <AlertDescription>{mutation.error.message}</AlertDescription>
            </Alert>
          )}
          {mutation.isSuccess && (
            <Alert>
              <AlertTitle>Профиль сохранён</AlertTitle>
              <AlertDescription>Отображаемое имя обновлено.</AlertDescription>
            </Alert>
          )}

          <div>
            <Button
              disabled={mutation.isPending || displayNameInvalid}
              type="submit"
            >
              {mutation.isPending ? 'Сохраняем…' : 'Сохранить профиль'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
