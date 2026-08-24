import { useForm } from '@tanstack/react-form'
import { Link } from '@tanstack/react-router'
import { registerRequestSchema, type RegisterRequest } from '@web-app-demo/contracts'
import { useId, useState } from 'react'

import { Typography } from '@/components/typography'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ApiRequestError } from '@/platform/api'
import { useAuth } from '../use-auth'
import { FormAlert } from './form-errors'
import type { FieldErrors } from './form-model'
import { clearFieldError, errorId, hasErrors, toFieldErrors } from './form-validation'
import { PasswordInput } from './PasswordInput'

export function RegisterForm({ returnTo }: { returnTo?: string }) {
  const auth = useAuth()
  const displayNameId = useId()
  const displayNameErrorId = useId()
  const emailId = useId()
  const emailErrorId = useId()
  const passwordId = useId()
  const passwordDescriptionId = useId()
  const passwordErrorId = useId()
  const confirmPasswordId = useId()
  const confirmPasswordErrorId = useId()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: { displayName: '', email: '', password: '', confirmPassword: '' },
    onSubmit: async ({ value }) => {
      setFormError(null)
      const result = registerRequestSchema.safeParse({
        displayName: value.displayName,
        email: value.email,
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
        await auth.register(result.data as RegisterRequest)
      } catch (caughtError) {
        setFormError(
          caughtError instanceof ApiRequestError ? caughtError.message : 'Неожиданная ошибка регистрации',
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
      <FieldGroup className="gap-5">
        <div className="flex flex-col items-center gap-1 text-center">
          <Typography as="h1" variant="h3" balance>
            Создайте учётную запись
          </Typography>
          <Typography variant="bodySm" tone="muted" balance>
            Заполните форму, чтобы начать работу.
          </Typography>
        </div>

        <form.Field name="displayName" children={(field) => (
          <Field data-invalid={hasErrors(fieldErrors.displayName)}>
            <FieldLabel htmlFor={displayNameId}>Имя</FieldLabel>
            <Input
              aria-describedby={errorId(fieldErrors.displayName, displayNameErrorId)}
              aria-invalid={hasErrors(fieldErrors.displayName)}
              autoComplete="name"
              className="bg-background"
              id={displayNameId}
              name={field.name}
              onBlur={field.handleBlur}
              onChange={(event) => {
                field.handleChange(event.target.value)
                clearFieldError('displayName', setFieldErrors)
                setFormError(null)
              }}
              placeholder="Иван Петров"
              type="text"
              value={field.state.value}
            />
            <FieldError id={displayNameErrorId} errors={fieldErrors.displayName} />
          </Field>
        )} />

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
              }}
              placeholder="m@example.com"
              type="email"
              value={field.state.value}
            />
            <FieldDescription>Используем её для связи и входа.</FieldDescription>
            <FieldError id={emailErrorId} errors={fieldErrors.email} />
          </Field>
        )} />

        <form.Field name="password" children={(field) => (
          <Field data-invalid={hasErrors(fieldErrors.password)}>
            <FieldLabel htmlFor={passwordId}>Пароль</FieldLabel>
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
                setFormError(null)
              }}
              value={field.state.value}
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
                setFormError(null)
              }}
              value={field.state.value}
              visibilityLabel="подтверждение пароля"
            />
            <FieldDescription>Введите пароль ещё раз.</FieldDescription>
            <FieldError id={confirmPasswordErrorId} errors={fieldErrors.confirmPassword} />
          </Field>
        )} />

        <FormAlert message={formError} />

        <Field>
          <form.Subscribe selector={(state) => state.isSubmitting} children={(isSubmitting) => (
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting ? 'Создаём…' : 'Создать учётную запись'}
            </Button>
          )} />
        </Field>

        <FieldDescription className="text-center">
          Уже есть учётная запись?{' '}
          <Link search={{ returnTo }} to="/login">
            Войти
          </Link>
        </FieldDescription>
      </FieldGroup>
    </form>
  )
}
