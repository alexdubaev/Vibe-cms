import { useForm } from '@tanstack/react-form'
import { Link } from '@tanstack/react-router'
import { passwordResetRequestSchema } from '@web-app-demo/contracts'
import { useId, useState } from 'react'

import { Typography } from '@/components/typography'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ApiRequestError } from '@/platform/api'
import { useAuth } from '../use-auth'
import { FormAlert } from './form-errors'
import type { FieldErrors } from './form-model'
import { clearFieldError, errorId, hasErrors, toFieldErrors } from './form-validation'

export function ForgotPasswordForm() {
  const auth = useAuth()
  const emailId = useId()
  const emailErrorId = useId()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(false)
  const form = useForm({
    defaultValues: { email: '' },
    onSubmit: async ({ value }) => {
      setFormError(null)
      const result = passwordResetRequestSchema.safeParse(value)
      if (!result.success) {
        setFieldErrors(toFieldErrors(result.error.issues))
        return
      }

      setFieldErrors({})
      try {
        await auth.requestPasswordReset(result.data)
        setAccepted(true)
      } catch (caughtError) {
        setFormError(
          caughtError instanceof ApiRequestError
            ? caughtError.message
            : 'Не удалось запросить восстановление пароля',
        )
      }
    },
  })

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <FieldGroup>
        <div className="flex flex-col items-center gap-1 text-center">
          <Typography as="h1" variant="h3" balance>
            Восстановление пароля
          </Typography>
          <Typography variant="bodySm" tone="muted" balance>
            Укажите email — если учётная запись существует, мы отправим инструкции.
          </Typography>
        </div>

        <form.Field name="email" children={(field) => (
          <Field data-invalid={hasErrors(fieldErrors.email)}>
            <FieldLabel htmlFor={emailId}>Электронная почта</FieldLabel>
            <Input
              aria-describedby={errorId(fieldErrors.email, emailErrorId)}
              aria-invalid={hasErrors(fieldErrors.email)}
              autoComplete="email"
              className="bg-background"
              id={emailId}
              inputMode="email"
              name={field.name}
              onBlur={field.handleBlur}
              onChange={(event) => {
                field.handleChange(event.target.value)
                clearFieldError('email', setFieldErrors)
                setFormError(null)
                setAccepted(false)
              }}
              placeholder="m@example.com"
              type="email"
              value={field.state.value}
            />
            <FieldError id={emailErrorId} errors={fieldErrors.email} />
          </Field>
        )} />

        {accepted ? (
          <Alert>
            <AlertTitle>Проверьте почту</AlertTitle>
            <AlertDescription>
              Если для этого адреса есть учётная запись, инструкции уже отправлены.
            </AlertDescription>
          </Alert>
        ) : null}
        <FormAlert message={formError} title="Запрос не выполнен" />

        <Field>
          <form.Subscribe selector={(state) => state.isSubmitting} children={(isSubmitting) => (
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting ? 'Отправляем…' : 'Отправить инструкции'}
            </Button>
          )} />
        </Field>

        <Typography align="center" variant="bodySm">
          <Link className="underline underline-offset-4" search={{ returnTo: undefined }} to="/login">
            Вернуться ко входу
          </Link>
        </Typography>
      </FieldGroup>
    </form>
  )
}
