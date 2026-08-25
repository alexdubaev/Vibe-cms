import type { z } from 'zod'

import type { FieldErrors, FieldName, FormError } from './form-model'

export function toFieldErrors(issues: z.ZodIssue[]): FieldErrors {
  return issues.reduce<FieldErrors>((errors, issue) => {
    const field = issue.path[0]
    if (!isFieldName(field)) return errors

    errors[field] = [
      ...(errors[field] ?? []),
      { message: localizeAuthValidationMessage(issue.message) },
    ]
    return errors
  }, {})
}

function localizeAuthValidationMessage(message: string) {
  switch (message) {
    case 'Invalid email address':
      return 'Введите корректный адрес электронной почты.'
    case 'Password must be at least 8 characters':
      return 'Пароль должен содержать не менее 8 символов.'
    case 'Password must be at most 128 characters':
      return 'Пароль должен содержать не более 128 символов.'
    default:
      return message
  }
}

export function clearFieldError(
  field: FieldName,
  setFieldErrors: (updater: (errors: FieldErrors) => FieldErrors) => void,
) {
  setFieldErrors((currentErrors) => {
    if (!currentErrors[field]?.length) return currentErrors
    const nextErrors = { ...currentErrors }
    delete nextErrors[field]
    return nextErrors
  })
}

export function hasErrors(errors: FormError[] | undefined) {
  return Boolean(errors?.length)
}

export function errorId(errors: FormError[] | undefined, id: string) {
  return hasErrors(errors) ? id : undefined
}

function isFieldName(field: unknown): field is FieldName {
  return (
    field === 'confirmPassword' ||
    field === 'displayName' ||
    field === 'email' ||
    field === 'password'
  )
}
