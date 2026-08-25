import type { Page } from '@playwright/test'
import { e2ePassword, expect, test, uniqueEmail } from '../helpers/test'

test('registers, restores the session, opens protected UI, and logs out', async ({ page }) => {
  const email = uniqueEmail()
  const displayName = 'Web E2E User'

  await page.goto('/signup')

  await expect(page.getByRole('heading', { level: 1, name: 'Создайте учётную запись' })).toBeVisible()
  const signupPassword = page.getByLabel('Пароль', { exact: true })
  const signupPasswordDescriptions = await signupPassword.getAttribute('aria-describedby')
  expect(signupPasswordDescriptions).toBeTruthy()
  const [signupPasswordRequirementId] = signupPasswordDescriptions!.split(/\s+/)
  await expect(page.locator(`[id="${signupPasswordRequirementId}"]`)).toHaveText(
    'Не менее 8 символов.',
  )
  await page.getByRole('button', { name: 'Создать учётную запись' }).click()
  await expect(page.getByText('Введите корректный адрес электронной почты.')).toBeVisible()
  await expect(page.getByText('Пароль должен содержать не менее 8 символов.')).toBeVisible()

  await page.getByLabel('Имя').fill('A')
  await page.getByLabel('Электронная почта').fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await expect(signupPassword).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Показать введённый пароль' }).click()
  await expect(signupPassword).toHaveAttribute('type', 'text')
  await expect(signupPassword).toHaveValue(e2ePassword)
  await page.getByRole('button', { name: 'Скрыть введённый пароль' }).click()
  await expect(signupPassword).toHaveAttribute('type', 'password')
  await page.getByLabel('Повторите пароль').fill(e2ePassword)
  await page.getByRole('link', { name: 'Войти' }).click()
  await expect(page.getByLabel('Имя')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Войти' })).toBeEnabled()

  await page.getByRole('link', { name: 'Зарегистрироваться' }).click()
  await page.getByLabel('Имя').fill(displayName)
  await page.getByLabel('Электронная почта').fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.getByLabel('Повторите пароль').fill(e2ePassword)
  await page.getByRole('button', { name: 'Создать учётную запись' }).click()

  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: `Здравствуйте, ${displayName}` })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Обзор' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Доступ и команда' })).toHaveCount(0)
  await expect(page.getByRole('main').getByText(email, { exact: true })).toBeVisible()
  await expect(page.getByRole('main').getByText('Участник с', { exact: true })).toBeVisible()
  await expect
    .poll(async () =>
      (await page.context().cookies()).some(
        (cookie) => cookie.name === 'web_app_demo_refresh' && cookie.httpOnly,
      ),
    )
    .toBe(true)

  const refreshAfterReload = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/auth/refresh') && response.request().method() === 'POST',
  )
  const meAfterReload = page.waitForResponse(
    (response) => response.url().endsWith('/api/auth/me') && response.request().method() === 'GET',
  )

  await page.reload()

  await expect((await refreshAfterReload).status()).toBe(200)
  await expect((await meAfterReload).status()).toBe(200)
  await expect(page.getByRole('heading', { name: `Здравствуйте, ${displayName}` })).toBeVisible()

  await page.getByRole('link', { name: 'Профиль' }).click()
  await expect(page.getByLabel('Электронная почта')).toHaveAttribute('readonly', '')
  await page.getByLabel('Отображаемое имя').fill(' A ')
  await expect(page.getByText('Имя должно содержать не менее 2 символов.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Сохранить профиль' })).toBeDisabled()
  await page.getByLabel('Отображаемое имя').fill('  Updated Web User  ')
  await page.getByRole('button', { name: 'Сохранить профиль' }).click()
  await expect(page.getByText('Профиль сохранён')).toBeVisible()
  await expect(page.getByLabel('Отображаемое имя')).toHaveValue('Updated Web User')
  await page.reload()
  await expect(page.getByLabel('Отображаемое имя')).toHaveValue('Updated Web User')

  await page.getByRole('link', { name: 'Настройки' }).click()

  await page.route('**/api/auth/logout', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'UNAVAILABLE', message: 'Temporary logout failure' },
      }),
    })
  })
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page.getByRole('alert')).toContainText('Сеанс всё ещё активен')
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeEnabled()
  await page.unroute('**/api/auth/logout')

  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()
  await page.getByLabel('Электронная почта').fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/app\/settings$/)

  await page.getByRole('link', { name: 'Профиль' }).click()

  await logoutFromAccountMenu(page)
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()
  await page.getByLabel('Электронная почта').fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill('wrong-password')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByText('Invalid email or password')).toBeVisible()

  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/app\/profile$/)
  await expect(page.getByLabel('Отображаемое имя')).toHaveValue('Updated Web User')
})

test('shows generic forgot-password success and handles an invalid reset link', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('link', { name: 'Забыли пароль?' }).click()
  await expect(page).toHaveURL(/\/forgot-password$/)

  await page.getByRole('button', { name: 'Отправить инструкции' }).click()
  await expect(page.getByText('Введите корректный адрес электронной почты.')).toBeVisible()
  await page.getByLabel('Электронная почта').fill(uniqueEmail('unknown-reset'))
  await page.getByRole('button', { name: 'Отправить инструкции' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Если для этого адреса есть учётная запись, инструкции уже отправлены.',
  )

  await page.goto('/reset-password#token=truncated')
  await expect(page.getByRole('alert')).toContainText(
    'Ссылка для восстановления недействительна или неполна.',
  )
  await expect(page.getByRole('button', { name: 'Обновить пароль' })).toBeDisabled()

  await page.goto(`/reset-password#token=${'t'.repeat(43)}`)
  await expect(page).toHaveURL(/\/reset-password$/)
  const resetPassword = page.getByRole('textbox', { name: 'Новый пароль' })
  const resetPasswordDescriptions = await resetPassword.getAttribute('aria-describedby')
  expect(resetPasswordDescriptions).toBeTruthy()
  const [resetPasswordRequirementId] = resetPasswordDescriptions!.split(/\s+/)
  await expect(page.locator(`[id="${resetPasswordRequirementId}"]`)).toHaveText(
    'Не менее 8 символов.',
  )
  await expect(page.getByRole('button', { name: 'Показать новый пароль' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Показать подтверждение пароля' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Новый пароль' }).fill('new-password-123')
  await page.getByLabel('Повторите пароль').fill('different-password-123')
  await page.getByRole('button', { name: 'Обновить пароль' }).click()
  await expect(page.getByText('Пароли не совпадают')).toBeVisible()

  await page.route('**/api/auth/password-reset/confirm', async (route) => {
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'AUTH_PASSWORD_RESET_INVALID',
          message: 'Password reset link is invalid or expired',
        },
      }),
    })
  })
  await page.getByLabel('Повторите пароль').fill('new-password-123')
  await page.getByRole('button', { name: 'Обновить пароль' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Password reset link is invalid or expired',
  )
})

test('allows an authenticated browser to complete a password reset and clears local auth', async ({ page }) => {
  const email = uniqueEmail('authenticated-reset')
  await page.goto('/signup')
  await page.getByLabel('Электронная почта').fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.getByLabel('Повторите пароль').fill(e2ePassword)
  await page.getByRole('button', { name: 'Создать учётную запись' }).click()
  await expect(page).toHaveURL(/\/app$/)

  await page.route('**/api/auth/password-reset/confirm', async (route) => {
    await route.fulfill({ status: 204 })
  })
  await page.goto(`/reset-password#token=${'t'.repeat(43)}`)

  await expect(page).toHaveURL(/\/reset-password$/)
  await expect(page.getByRole('heading', { name: 'Придумайте новый пароль' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Новый пароль' }).fill('new-password-123')
  await page.getByLabel('Повторите пароль').fill('new-password-123')
  await page.getByRole('button', { name: 'Обновить пароль' }).click()
  await expect(page.getByRole('alert')).toContainText('Пароль обновлён')

  await page.getByRole('link', { name: 'Вернуться ко входу' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()
})

test('keeps one logical browser session active across concurrent tabs', async ({ page }) => {
  const email = uniqueEmail('web-e2e-tabs')

  await page.goto('/signup')
  await page.getByLabel('Электронная почта').fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.getByLabel('Повторите пароль').fill(e2ePassword)
  await page.getByRole('button', { name: 'Создать учётную запись' }).click()
  await expect(page).toHaveURL(/\/app$/)

  const secondPage = await page.context().newPage()
  await secondPage.goto('/')
  await expect(secondPage).toHaveURL(/\/app$/)

  await Promise.all([page.reload(), secondPage.reload()])

  await expect(page).toHaveURL(/\/app$/)
  await expect(secondPage).toHaveURL(/\/app$/)
  await expect(page.getByRole('heading', { name: `Здравствуйте, ${email}` })).toBeVisible()
  await expect(secondPage.getByRole('heading', { name: `Здравствуйте, ${email}` })).toBeVisible()

  await page.route('**/api/auth/logout', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Temporary logout failure' } }),
    })
  })
  await logoutFromAccountMenu(page)
  await expect(page.getByRole('alert')).toContainText('Не удалось выйти из аккаунта')

  await logoutFromAccountMenu(secondPage)
  await expect(secondPage.getByRole('button', { name: 'Войти' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('remote logout recovers a tab from a transient bootstrap error', async ({ page }) => {
  const email = uniqueEmail('web-e2e-bootstrap-logout')

  await page.goto('/signup')
  await page.getByLabel('Электронная почта').fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.getByLabel('Повторите пароль').fill(e2ePassword)
  await page.getByRole('button', { name: 'Создать учётную запись' }).click()
  await expect(page).toHaveURL(/\/app$/)

  const healthyPage = await page.context().newPage()
  await healthyPage.goto('/')
  await expect(healthyPage).toHaveURL(/\/app$/)

  await page.route('**/api/auth/refresh', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'UNAVAILABLE', message: 'Temporary bootstrap failure' },
      }),
    })
  })
  await page.reload()
  await expect(page.getByText('Проверка сеанса временно недоступна')).toBeVisible()

  await logoutFromAccountMenu(healthyPage)
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()
})

test('unknown routes wait for session recovery before choosing their return destination', async ({
  page,
}) => {
  const email = uniqueEmail('web-e2e-not-found')
  await page.goto('/signup')
  await page.getByLabel('Электронная почта').fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.getByLabel('Повторите пароль').fill(e2ePassword)
  await page.getByRole('button', { name: 'Создать учётную запись' }).click()
  await expect(page).toHaveURL(/\/app$/)

  let failRefresh = true
  await page.route('**/api/auth/refresh', async (route) => {
    if (!failRefresh) {
      await route.continue()
      return
    }
    failRefresh = false
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'UNAVAILABLE', message: 'Temporary bootstrap failure' },
      }),
    })
  })

  await page.goto('/missing-page')
  await expect(page.getByText('Проверка сеанса временно недоступна')).toBeVisible()
  await page.getByRole('button', { name: 'Повторить' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'Страница не найдена' })).toBeVisible()
  await page.getByRole('link', { name: 'Вернуться в рабочее пространство' }).click()
  await expect(page).toHaveURL(/\/app$/)
})

test('concurrent account changes converge every tab on the winning cookie session', async ({ page }) => {
  const firstEmail = uniqueEmail('web-e2e-account-a')
  const secondEmail = uniqueEmail('web-e2e-account-b')
  const secondPage = await page.context().newPage()

  await Promise.all([page.goto('/signup'), secondPage.goto('/signup')])
  await page.getByLabel('Электронная почта').fill(firstEmail)
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.getByLabel('Повторите пароль').fill(e2ePassword)
  await secondPage.getByLabel('Электронная почта').fill(secondEmail)
  await secondPage.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await secondPage.getByLabel('Повторите пароль').fill(e2ePassword)

  await Promise.all([
    page.getByRole('button', { name: 'Создать учётную запись' }).click(),
    secondPage.getByRole('button', { name: 'Создать учётную запись' }).click(),
  ])

  await expect(page).toHaveURL(/\/app$/)
  await expect(secondPage).toHaveURL(/\/app$/)
  let winningEmail = ''
  await expect
    .poll(async () => {
      const [firstTabText, secondTabText] = await Promise.all([
        page.locator('body').innerText(),
        secondPage.locator('body').innerText(),
      ])
      winningEmail = [firstEmail, secondEmail].find(
        (candidate) => firstTabText.includes(candidate) && secondTabText.includes(candidate),
      ) ?? ''
      return winningEmail
    })
    .not.toBe('')
})

async function logoutFromAccountMenu(page: Page) {
  await page.getByRole('button', { name: 'Открыть меню аккаунта' }).click()
  await page.getByRole('menuitem', { name: 'Выйти' }).click()
}
