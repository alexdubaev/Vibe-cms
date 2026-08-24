import { useForm } from '@tanstack/react-form'
import { Link } from '@tanstack/react-router'
import { passwordResetConfirmRequestSchema } from '@web-app-demo/contracts'
import { useId, useState } from 'react'

import { Typography } from '@/components/typography'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { ApiRequestError } from '@/platform/api'
import { useAuth } from '../use-auth'
import { FormAlert } from './form-errors'
import type { FieldErrors } from './form-model'
import { clearFieldError, errorId, hasErrors, toFieldErrors } from './form-validation'
import { PasswordInput } from './PasswordInput'

export function ResetPasswordForm({ token }: { token: string }) {
  const auth = useAuth()
  const tokenIsValid = passwordResetConfirmRequestSchema.shape.token.safeParse(token).success
  const passwordId = useId()
  const passwordDescriptionId = useId()
  const passwordErrorId = useId()
  const confirmPasswordId = useId()
  const confirmPasswordErrorId = useId()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(
    tokenIsValid ? null : 'Ссылка для восстановления недействительна или неполна.',
  )
  const [completed, setCompleted] = useState(false)
  const form = useForm({
    defaultValues: { password: '', confirmPassword: '' },
    onSubmit: async ({ value }) => {
      if (!tokenIsValid) return
      setFormError(null)
      const result = passwordResetConfirmRequestSchema.safeParse({
        token,
        password: value.password,
      })
      const nextErrors = result.success ? {} : toFieldErrors(result.error.issues)
      if (value.password !== value.confirmPassword) {
        nextErrors.confirmPassword = [{ message: 'Пароли не совпадают' }]
      }
      if (!result.success || hasErrors(nextErrors.confirmPassword)) {
        setFieldErrors(nextErrors)
        return
      }

      setFieldErrors({})
      try {
        await auth.confirmPasswordReset(result.data)
        setCompleted(true)
      } catch (caughtError) {
        setFormError(
          caughtError instanceof ApiRequestError
            ? caughtError.message
            : 'Не удалось обновить пароль',
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
            Придумайте новый пароль
          </Typography>
          <Typography variant="bodySm" tone="muted" balance>
            После смены пароля все активные сеансы будут завершены.
          </Typography>
        </div>

        {completed ? (
          <Alert>
            <AlertTitle>Пароль обновлён</AlertTitle>
            <AlertDescription>Теперь войдите с новым паролем.</AlertDescription>
          </Alert>
        ) : (
          <>
            <form.Field name="password" children={(field) => (
              <Field data-invalid={hasErrors(fieldErrors.password)}>
                <FieldLabel htmlFor={passwordId}>Новый пароль</FieldLabel>
                <PasswordInput
                  aria-describedby={[
                    passwordDescriptionId,
                    errorId(fieldErrors.password, passwordErrorId),
                  ].filter(Boolean).join(' ')}
                  aria-invalid={hasErrors(fieldErrors.password)}
                  autoComplete="new-password"
                  className="bg-background"
                  id={passwordId}
                  name={field.name}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.target.value)
                    clearFieldError('password', setFieldErrors)
                    clearFieldError('confirmPassword', setFieldErrors)
                    setFormError(
                      tokenIsValid ? null : 'Ссылка для восстановления недействительна или неполна.',
                    )
                  }}
                  value={field.state.value}
                  visibilityLabel="новый пароль"
                />
                <FieldDescription id={passwordDescriptionId}>
                  Не менее 8 символов.
                </FieldDescription>
                <FieldError id={passwordErrorId} errors={fieldErrors.password} />
              </Field>
            )} />

            <form.Field name="confirmPassword" children={(field) => (
              <Field data-invalid={hasErrors(fieldErrors.confirmPassword)}>
                <FieldLabel htmlFor={confirmPasswordId}>Повторите пароль</FieldLabel>
                <PasswordInput
                  aria-describedby={errorId(fieldErrors.confirmPassword, confirmPasswordErrorId)}
                  aria-invalid={hasErrors(fieldErrors.confirmPassword)}
                  autoComplete="new-password"
                  className="bg-background"
                  id={confirmPasswordId}
                  name={field.name}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.target.value)
                    clearFieldError('confirmPassword', setFieldErrors)
                    setFormError(
                      tokenIsValid ? null : 'Ссылка для восстановления недействительна или неполна.',
                    )
                  }}
                  value={field.state.value}
                  visibilityLabel="подтверждение пароля"
                />
                <FieldError id={confirmPasswordErrorId} errors={fieldErrors.confirmPassword} />
              </Field>
            )} />

            <FormAlert message={formError} title="Не удалось обновить пароль" />

            <Field>
              <form.Subscribe selector={(state) => state.isSubmitting} children={(isSubmitting) => (
                <Button disabled={isSubmitting || !tokenIsValid} type="submit">
                  {isSubmitting ? 'Обновляем…' : 'Обновить пароль'}
                </Button>
              )} />
            </Field>
          </>
        )}

        <Typography align="center" variant="bodySm">
          <Link className="underline underline-offset-4" search={{ returnTo: undefined }} to="/login">
            Вернуться ко входу
          </Link>
        </Typography>
      </FieldGroup>
    </form>
  )
}
