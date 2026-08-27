import type { Page } from '@playwright/test'

import { createPrisma, type DbClient } from '../../../backend/src/db'
import { e2eAdminEmail, e2eAdminPassword } from '../env'
import { expect, test } from '../helpers/test'
import { pngImage } from '../helpers/images'

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
  await db.cmsApprovalRequest.deleteMany()
  await db.taskOutbox.deleteMany({ where: { type: 'website:rebuild:wakeup' } })
  await db.cmsMediaUsage.deleteMany()
  await db.cmsMediaAsset.deleteMany()
  await db.cmsPageRevision.deleteMany()
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

async function signInAsOwner(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Электронная почта').fill(e2eAdminEmail)
  await page.getByLabel('Пароль', { exact: true }).fill(e2eAdminPassword)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/admin$/)
}

test('owner opens a CMS page and saves structured text without raw JSON', async ({ page }) => {
  await signInAsOwner(page)
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
  await signInAsOwner(page)
  await page.getByRole('link', { name: 'Контент' }).click()

  await expect(page).toHaveURL(/\/admin\/content\/service$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Контент' })).toBeVisible()
  await expect(page.getByText('Something went wrong!')).toHaveCount(0)
  await expect(page.getByText('Раздел не найден')).toHaveCount(0)
})

test('media library fits a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await signInAsOwner(page)
  await page.goto('/admin/media')
  await expect(page).toHaveURL(/\/admin\/media$/)

  const width = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(width.scrollWidth).toBeLessThanOrEqual(width.clientWidth)
})

test('autosave persists edits and a competing save surfaces the conflict UI', async ({ page }) => {
  test.setTimeout(120_000)
  await signInAsOwner(page)
  await page.getByRole('link', { name: 'Страницы' }).click()
  await page.getByRole('link', { name: 'О компании' }).click()
  await page.getByRole('button', { name: /2\. Текст и изображение/ }).click()
  const editor = page.getByRole('textbox', { name: 'Добавьте текст или начните строку с ##, -, >' })

  // The access token lives in browser memory only, so capture the Authorization header
  // while the autosave itself is still in flight - a plain page.request has just cookies.
  let authorization: string | undefined
  page.on('request', (request) => {
    const header = request.headers()['authorization']
    if (header && request.url().includes('/api/cms/pages/')) authorization = header
  })

  // Type and walk away: the debounced autosave must land in the database on its own.
  const autosavedText = '## Автосохранённый текст\n\nАбзац без нажатия кнопок.'
  await editor.fill(autosavedText)
  await expect.poll(async () => {
    const saved = await db.cmsPage.findFirstOrThrow({ where: { path: pageDraft.path } })
    const payload = saved.draftPayload as typeof pageDraft
    return payload.blocks[1]?.type === 'textImage'
      ? payload.blocks[1].data.content.blocks[0]?.children[0]?.text
      : undefined
  }, { timeout: 15_000 }).toBe('Автосохранённый текст')

  const pageRow = await db.cmsPage.findFirstOrThrow({ where: { path: pageDraft.path } })
  const backendOrigin = process.env.E2E_BACKEND_URL
  if (!backendOrigin) throw new Error('E2E_BACKEND_URL is required for the conflict E2E flow')
  const competing = await page.request.patch(`${backendOrigin}/api/cms/pages/${pageRow.id}`, {
    headers: { authorization: authorization! },
    data: { ...pageRow.draftPayload, expectedRevision: pageRow.draftRevision },
  })
  if (!competing.ok()) {
    throw new Error(`competing save failed: ${competing.status()} ${await competing.text()}`)
  }

  // The next debounced save now hits a 409 and the editor must say so instead of pretending.
  if (!(await editor.isVisible())) {
    await page.getByRole('button', { name: /2. Текст и изображение/ }).click()
  }
  await editor.fill('## Правка поверх конфликта')
  await expect(page.getByText('Нужна проверка конфликта')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Черновик изменился на сервере')).toBeVisible()
})

test('owner rejects an approval with a decision note and no publication appears', async ({ page }) => {
  test.setTimeout(120_000)
  await signInAsOwner(page)
  await page.getByRole('link', { name: 'Страницы' }).click()
  await page.getByRole('link', { name: 'О компании' }).click()

  await page.getByRole('button', { name: 'Отправить на согласование' }).click()
  await expect.poll(async () => db.cmsApprovalRequest.count()).toBe(1)

  await page.getByRole('link', { name: 'Публикации' }).click()
  await expect(page.getByText('Заявки на согласование')).toBeVisible()

  // The decision needs a reason: reject stays disabled until the note is filled in.
  const rejectButton = page.getByRole('button', { name: 'Отклонить' })
  await expect(rejectButton).toBeDisabled()
  await page.getByLabel('Причина отклонения').fill('Переделать заголовок')
  await expect(rejectButton).toBeEnabled()
  await rejectButton.click()

  await expect(page.getByText('Ожидающих заявок нет.')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Отклонено: Переделать заголовок')).toBeVisible()
  const stored = await db.cmsApprovalRequest.findFirstOrThrow()
  expect(stored.status).toBe('rejected')
  expect(stored.decisionNote).toBe('Переделать заголовок')
  expect(await db.cmsPublication.count()).toBe(0)
})

test('owner uploads media through the file input', async ({ page }) => {
  test.setTimeout(120_000)
  await signInAsOwner(page)
  await page.goto('/admin/media')
  const paddedPng = Buffer.concat([pngImage.buffer, Buffer.alloc(64, 0x00)])

  await page.locator('#cms-media-upload').setInputFiles({
    name: 'hero.png',
    mimeType: 'image/png',
    buffer: paddedPng,
  })

  await expect(page.getByText('Не удалось загрузить файл. Проверьте формат и соединение.')).toHaveCount(0)
  await expect(page.getByText('hero.png').first()).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => {
    const asset = await db.cmsMediaAsset.findFirst({ where: { filename: 'hero.png' } })
    return asset?.state
  }, { timeout: 30_000 }).toBe('ready')
})

test('a media asset added via the API shows in the library, persists alt text, and enters deleting state', async ({ page }) => {
  test.setTimeout(120_000)
  // The access token lives in browser memory only: capture it while the first authenticated
  // page load is still in flight, then reuse it for direct API calls.
  let authorization: string | undefined
  page.on('request', (request) => {
    const header = request.headers()['authorization']
    if (header) authorization = header
  })
  await signInAsOwner(page)
  await page.goto('/admin/media')

  // The CMS media minimum is 100 bytes: pad the real 1x1 PNG with trailing bytes the
  // signature check never reads.
  const paddedPng = {
    ...pngImage,
    name: 'hero.png',
    buffer: Buffer.concat([pngImage.buffer, Buffer.alloc(64, 0x00)]),
  }
  // Drive the real backend + storage stack through the API the UI itself uses, then check
  // the library renders the result. (The file-input path currently fails in the browser
  // before any network request - reported separately; see the commit message.)
  await expect(page.getByText('hero.png')).toHaveCount(0)

  const backendOrigin = process.env.E2E_BACKEND_URL
  if (!backendOrigin) throw new Error('E2E_BACKEND_URL is required for the media E2E flow')
  const authHeaders = { authorization: authorization! }
  const ticketResponse = await page.request.post(`${backendOrigin}/api/cms/media/uploads`, {
    headers: authHeaders,
    data: { filename: 'hero.png', mimeType: 'image/png', byteSize: paddedPng.buffer.byteLength },
  })
  expect(ticketResponse.ok()).toBeTruthy()
  const ticket = await ticketResponse.json()
  const putResponse = await page.request.fetch(ticket.upload.url, {
    method: ticket.upload.method,
    headers: { ...ticket.upload.headers, 'content-type': 'image/png' },
    data: paddedPng.buffer,
  })
  expect(putResponse.ok()).toBeTruthy()
  const finalizeResponse = await page.request.post(
    `${backendOrigin}/api/cms/media/${ticket.asset.id}/finalize`,
    { headers: authHeaders },
  )
  expect(finalizeResponse.ok()).toBeTruthy()

  await page.reload()
  await expect(page.getByText('hero.png').first()).toBeVisible()

  const altInput = page.getByLabel('Alt-текст для hero.png')
  await altInput.fill('Главный баннер страницы')
  await page.getByRole('button', { name: 'Сохранить alt' }).click()
  await expect
    .poll(async () => {
      const asset = await db.cmsMediaAsset.findFirst({ where: { filename: 'hero.png' } })
      return asset?.altText
    })
    .toBe('Главный баннер страницы')

  await page.reload()
  await expect(page.getByLabel('Alt-текст для hero.png')).toHaveValue('Главный баннер страницы')

  await page.getByRole('button', { name: 'Удалить', exact: true }).click()
  await page.getByRole('button', { name: 'Да', exact: true }).click()
  await expect
    .poll(async () => {
      const asset = await db.cmsMediaAsset.findFirst({ where: { filename: 'hero.png' } })
      return asset?.state
    }, { timeout: 30_000 })
    .toBe('deleting')
  // The durable handoff runs outside the request, so the UI honestly reports the transition
  // instead of the file vanishing instantly.
  await page.reload()
  await expect(page.getByText('Удаляется')).toBeVisible({ timeout: 15_000 })
  expect(await db.cmsMediaAsset.count({ where: { state: 'deleting' } })).toBe(1)
})
