import { createPrisma, type DbClient } from '../../../backend/src/db'
import { e2eAdminEmail, e2eAdminPassword } from '../env'
import { expect, test } from '../helpers/test'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for the CMS E2E smoke')

const pageDraft = {
  title: 'О компании',
  path: '/about',
  blocks: [
    {
      id: 'hero',
      type: 'hero' as const,
      data: {
        title: 'Понятный сайт без лишней суеты',
        text: 'Редактируйте контент в спокойном рабочем пространстве.',
        primaryAction: { label: 'Связаться', href: '/contacts' },
      },
    },
    {
      id: 'story',
      type: 'textImage' as const,
      data: {
        title: 'Текст рядом с изображением',
        content: {
          type: 'document' as const,
          blocks: [
            {
              type: 'heading' as const,
              level: 2 as const,
              children: [{ type: 'text' as const, text: 'Редактируйте с уверенностью', marks: [] }],
            },
            {
              type: 'paragraph' as const,
              children: [{ type: 'text' as const, text: 'Первый абзац с жирным акцентом.' }],
            },
          ],
        },
        imageSide: 'right' as const,
      },
    },
  ],
}

let db: DbClient

test.beforeAll(() => {
  db = createPrisma(databaseUrl)
})

test.beforeEach(async () => {
  await db.cmsPage.deleteMany()
  await db.cmsPage.create({
    data: {
      path: pageDraft.path,
      title: pageDraft.title,
      draftPayload: pageDraft,
    },
  })
})

test.afterAll(async () => {
  await db.$disconnect()
})

test('owner opens a CMS page and saves structured text without raw JSON', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Электронная почта').fill(e2eAdminEmail)
  await page.getByLabel('Пароль', { exact: true }).fill(e2eAdminPassword)
  await page.getByRole('button', { name: 'Войти' }).click()

  await expect(page).toHaveURL(/\/admin$/)
  await page.getByRole('link', { name: 'Страницы' }).click()
  await expect(page).toHaveURL(/\/admin\/pages$/)
  await page.getByRole('link', { name: 'О компании' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'О компании' })).toBeVisible()
  await expect(page.getByText('Редактор страницы')).toBeVisible()
  await expect(page.getByText('draftPayload')).toHaveCount(0)

  await page.getByRole('button', { name: /2\. Текст и изображение/ }).click()
  const editor = page.getByRole('textbox', { name: 'Добавьте текст или начните строку с ##, -, >' })
  await expect(editor).toHaveValue(/## Редактируйте с уверенностью/)

  const editedText = [
    '## Обновлённый текст',
    '',
    'Абзац с **жирным акцентом** и [контактом](/contacts).',
    '',
    '- Первый пункт',
    '- Второй пункт',
  ].join('\n')
  await editor.fill(editedText)
  await expect(page.getByText('Есть несохранённые изменения')).toBeVisible()
  await page.getByRole('button', { name: 'Сохранить сейчас' }).click()
  await expect(page.getByText('Сохранение не завершено')).toHaveCount(0)
  await expect(page.getByText('Нет несохранённых изменений')).toBeVisible({ timeout: 15_000 })

  await page.reload()
  await page.getByRole('button', { name: /2\. Текст и изображение/ }).click()
  await expect(page.getByRole('textbox', { name: 'Добавьте текст или начните строку с ##, -, >' })).toHaveValue(editedText)
})

test('owner opens the default content collection without a router error', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Электронная почта').fill(e2eAdminEmail)
  await page.getByLabel('Пароль', { exact: true }).fill(e2eAdminPassword)
  await page.getByRole('button', { name: 'Войти' }).click()

  await expect(page).toHaveURL(/\/admin$/)
  await page.getByRole('link', { name: 'Контент' }).click()

  await expect(page).toHaveURL(/\/admin\/content\/service$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Контент' })).toBeVisible()
  await expect(page.getByText('Something went wrong!')).toHaveCount(0)
  await expect(page.getByText('Раздел не найден')).toHaveCount(0)
})

test('media library fits a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/login')
  await page.getByLabel('Электронная почта').fill(e2eAdminEmail)
  await page.getByLabel('Пароль', { exact: true }).fill(e2eAdminPassword)
  await page.getByRole('button', { name: 'Войти' }).click()

  await expect(page).toHaveURL(/\/admin$/)
  await page.goto('/admin/media')
  await expect(page).toHaveURL(/\/admin\/media$/)

  const width = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(width.scrollWidth).toBeLessThanOrEqual(width.clientWidth)
})
