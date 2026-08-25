import { e2eAdminEmail, e2eAdminPassword } from '../env'
import { e2ePassword, expect, test, uniqueEmail } from '../helpers/test'

test('keeps user and administrator workspaces separate', async ({ browser, page }) => {
  const userEmail = uniqueEmail('web-e2e-rbac-user')

  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fadmin%2Fusers$/)
  await page.getByRole('link', { name: 'Зарегистрироваться' }).click()
  await page.getByLabel('Электронная почта').fill(userEmail)
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.getByLabel('Повторите пароль').fill(e2ePassword)
  await page.getByRole('button', { name: 'Создать учётную запись' }).click()

  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByRole('link', { name: 'Главная' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Обзор' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Профиль' }).click()
  await expect(page).toHaveURL(/\/app\/profile$/)
  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/app$/)

  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  await adminPage.goto('/login')
  await adminPage.getByLabel('Электронная почта').fill(e2eAdminEmail)
  await adminPage.getByLabel('Пароль', { exact: true }).fill(e2eAdminPassword)
  await adminPage.getByRole('button', { name: 'Войти' }).click()

  await expect(adminPage).toHaveURL(/\/admin$/)
  await expect(adminPage.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
  await expect(adminPage.getByRole('heading', { level: 1, name: 'Обзор' })).toBeVisible()
  await expect(adminPage.getByRole('link', { name: 'Главная' })).toHaveCount(0)
  await adminPage.goto('/app/profile')
  await expect(adminPage).toHaveURL(/\/admin$/)

  await adminContext.close()
})

test('admin data surfaces recover from errors and expose safe directory states', async ({
  page,
}) => {
  let dashboardRequests = 0
  await page.route('**/api/admin/dashboard', async (route) => {
    dashboardRequests += 1
    if (dashboardRequests === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'INTERNAL_ERROR', message: 'Dashboard temporarily unavailable' },
        }),
      })
      return
    }
    await route.continue()
  })

  await page.goto('/login')
  await page.getByLabel('Электронная почта').fill(e2eAdminEmail)
  await page.getByLabel('Пароль', { exact: true }).fill(e2eAdminPassword)
  await page.getByRole('button', { name: 'Войти' }).click()

  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('alert')).toContainText('Dashboard temporarily unavailable')
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByText('Всего участников', { exact: true })).toBeVisible()
  await expect(page.getByText('Владельцы', { exact: true })).toBeVisible()
  await expect(page.getByText('Новые за 7 дней', { exact: true })).toBeVisible()

  let directoryRequests = 0
  await page.route('**/api/admin/users?*', async (route) => {
    directoryRequests += 1
    if (directoryRequests === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'INTERNAL_ERROR', message: 'Directory temporarily unavailable' },
        }),
      })
      return
    }
    await route.continue()
  })
  await page.getByRole('link', { name: 'Доступ и команда' }).click()
  await expect(page.getByRole('alert')).toContainText('Directory temporarily unavailable')
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByText(/Страница 1 из \d+ · участников: \d+/)).toBeVisible()

  await page.getByLabel('Поиск участников').fill(e2eAdminEmail)
  await page.getByRole('button', { name: 'Найти' }).click()
  await page.getByLabel(`Роль для ${e2eAdminEmail}`).click()
  await expect(page.getByRole('option', { name: 'Участник' })).toBeDisabled()
  await page.keyboard.press('Escape')

  await page.getByLabel('Поиск участников').fill(`missing-${Date.now()}@example.com`)
  await page.getByRole('button', { name: 'Найти' }).click()
  await expect(page.getByText('Участники не найдены', { exact: true })).toBeVisible()
  await expect(page.getByText('Попробуйте другое имя или email.')).toBeVisible()
})

test('workspace account menu keeps a failed logout visible and retryable', async ({ page }) => {
  const userEmail = uniqueEmail('web-e2e-sidebar-logout')
  await page.goto('/signup')
  await page.getByLabel('Электронная почта').fill(userEmail)
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.getByLabel('Повторите пароль').fill(e2ePassword)
  await page.getByRole('button', { name: 'Создать учётную запись' }).click()
  await expect(page).toHaveURL(/\/app$/)

  await page.route('**/api/auth/logout', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'UNAVAILABLE', message: 'Temporary logout failure' },
      }),
    })
  })

  await page.getByRole('button', { name: 'Открыть меню аккаунта' }).click()
  await page.getByRole('menuitem', { name: 'Выйти' }).click()

  await expect(page.getByRole('alert')).toHaveText('Не удалось выйти из аккаунта. Повторите попытку.')
  await expect(page).toHaveURL(/\/app$/)
  await page.getByRole('button', { name: 'Открыть меню аккаунта' }).click()
  await expect(page.getByRole('menuitem', { name: 'Выйти' })).toBeEnabled()
})

test('role mutation failures are announced inside the confirmation dialog', async ({
  browser,
  page,
}) => {
  const userEmail = uniqueEmail('web-e2e-role-error')
  await page.goto('/signup')
  await page.getByLabel('Электронная почта').fill(userEmail)
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.getByLabel('Повторите пароль').fill(e2ePassword)
  await page.getByRole('button', { name: 'Создать учётную запись' }).click()
  await expect(page).toHaveURL(/\/app$/)

  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  await adminPage.goto('/login')
  await adminPage.getByLabel('Электронная почта').fill(e2eAdminEmail)
  await adminPage.getByLabel('Пароль', { exact: true }).fill(e2eAdminPassword)
  await adminPage.getByRole('button', { name: 'Войти' }).click()
  await adminPage.getByRole('link', { name: 'Доступ и команда' }).click()
  await adminPage.getByLabel('Поиск участников').fill(userEmail)
  await adminPage.getByRole('button', { name: 'Найти' }).click()
  await adminPage.route('**/api/admin/users/*/role', async (route) => {
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'CONFLICT',
          message: 'The requested role change conflicts with administrator policy',
        },
      }),
    })
  })

  await adminPage.getByLabel(`Роль для ${userEmail}`).click()
  await adminPage.getByRole('option', { name: 'Владелец' }).click()
  const dialog = adminPage.getByRole('alertdialog')
  await adminPage.getByRole('button', { name: 'Изменить роль' }).click()

  await expect(dialog).toContainText('Не удалось изменить роль')
  await expect(dialog).toContainText('administrator policy')
  await adminContext.close()
})

test('promoting a user revokes the old session and opens the admin workspace after login', async ({
  browser,
  page,
}) => {
  const userEmail = uniqueEmail('web-e2e-promoted-user')

  await page.goto('/signup')
  await page.getByLabel('Электронная почта').fill(userEmail)
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.getByLabel('Повторите пароль').fill(e2ePassword)
  await page.getByRole('button', { name: 'Создать учётную запись' }).click()
  await expect(page).toHaveURL(/\/app$/)

  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  await adminPage.goto('/login')
  await adminPage.getByLabel('Электронная почта').fill(e2eAdminEmail)
  await adminPage.getByLabel('Пароль', { exact: true }).fill(e2eAdminPassword)
  await adminPage.getByRole('button', { name: 'Войти' }).click()
  await adminPage.getByRole('link', { name: 'Доступ и команда' }).click()

  await adminPage.getByLabel('Поиск участников').fill(userEmail)
  await adminPage.getByRole('button', { name: 'Найти' }).click()
  const roleSelect = adminPage.getByLabel(`Роль для ${userEmail}`)
  await expect(roleSelect).toBeVisible()
  await roleSelect.click()
  await adminPage.getByRole('option', { name: 'Владелец' }).click()
  await expect(adminPage.getByRole('alertdialog')).toContainText(userEmail)
  await adminPage.getByRole('button', { name: 'Изменить роль' }).click()
  await expect(adminPage.getByText('Роль изменена')).toBeVisible()

  await page.reload()
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()
  await page.getByLabel('Электронная почта').fill(userEmail)
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.getByRole('button', { name: 'Войти' }).click()

  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('link', { name: 'Обзор' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Главная' })).toHaveCount(0)

  await adminContext.close()
})
