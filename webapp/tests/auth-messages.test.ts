import { describe, expect, test } from 'bun:test'
import { loginRequestSchema } from '@web-app-demo/contracts'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { FormAlert } from '@/features/auth/components/form-errors'
import { toFieldErrors } from '@/features/auth/components/form-validation'

describe('auth validation messages', () => {
  test('presents contract validation issues in Russian', () => {
    const issues = loginRequestSchema.safeParse({ email: 'invalid', password: 'short' })

    expect(issues.success).toBe(false)
    if (issues.success) return

    expect(toFieldErrors(issues.error.issues)).toEqual({
      email: [{ message: 'Введите корректный адрес электронной почты.' }],
      password: [{ message: 'Пароль должен содержать не менее 8 символов.' }],
    })
  })

  test('uses a Russian default title for generic form failures', () => {
    const html = renderToStaticMarkup(
      React.createElement(FormAlert, { message: 'Сервер временно недоступен' }),
    )

    expect(html).toContain('Не удалось выполнить действие')
    expect(html).not.toContain('Authentication failed')
  })
})
