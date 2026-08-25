import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { createPrisma, type DbClient } from '../../../backend/src/db'
import type { BuilderPublicationSnapshot } from '../../../website-builder/src/build-site'
import { createAstroSiteRunner } from '../../../website-builder/src/build-site'
import { publishBuiltRelease } from '../../../website-builder/src/release-pipeline'
import { e2eAdminEmail, e2eAdminPassword } from '../env'
import { expect, test } from '../helpers/test'

const databaseUrl = process.env.TEST_DATABASE_URL
const backendOrigin = process.env.E2E_BACKEND_URL
const configuredPreviewOrigin = process.env.E2E_PREVIEW_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for the Site Package E2E')
if (!backendOrigin) throw new Error('E2E_BACKEND_URL is required for the Site Package E2E')
if (!configuredPreviewOrigin) throw new Error('E2E_PREVIEW_URL is required for the Site Package E2E')

const repositoryRoot = resolve(import.meta.dirname, '../../..')
const websiteDirectory = join(repositoryRoot, 'website')
const pageDraft = {
  title: 'Калькулятор ремонта',
  path: '/calculator',
  navigationLabel: 'Калькулятор',
  seo: {
    title: 'Расчёт стоимости ремонта',
    description: 'Рассчитайте предварительную стоимость ремонта по площади помещения.',
    canonicalMode: 'self' as const,
    noIndex: false,
  },
  blocks: [{
    id: 'intro',
    type: 'hero' as const,
    data: {
      title: 'Ремонт с понятной сметой',
      text: 'Укажите площадь и сразу получите предварительный расчёт.',
      primaryAction: { label: 'Рассчитать', href: '#estimate' },
    },
  }],
}

let db: DbClient
let cmsPageId: string
let previewRuntime: ChildProcess | undefined
let previewOrigin: string
const temporaryDirectories: string[] = []

test.beforeAll(async () => {
  db = createPrisma(databaseUrl)
  const previewParent = join(repositoryRoot, '.scratch')
  await mkdir(previewParent, { recursive: true })
  const previewWorkspace = await mkdtemp(join(previewParent, 'site-package-preview-'))
  temporaryDirectories.push(previewWorkspace)
  const isolatedWebsiteDirectory = join(previewWorkspace, 'website')
  await cp(websiteDirectory, isolatedWebsiteDirectory, {
    recursive: true,
    filter: (source) => !['dist', 'node_modules'].includes(source.split(/[\\/]/).at(-1) ?? ''),
  })
  const previewPort = Number(new URL(configuredPreviewOrigin).port)
  previewOrigin = configuredPreviewOrigin
  await runCommand('bun', ['x', 'astro', 'build'], isolatedWebsiteDirectory, {
    CMS_BACKEND_ORIGIN: backendOrigin,
  })
  previewRuntime = spawn(
    'bun',
    [join(isolatedWebsiteDirectory, 'dist/server/entry.mjs')],
    {
      cwd: isolatedWebsiteDirectory,
      env: {
        ...process.env,
        CMS_BACKEND_ORIGIN: backendOrigin,
        HOST: '127.0.0.1',
        PORT: String(previewPort),
      },
      stdio: 'ignore',
      windowsHide: true,
    },
  )
  await waitForHttp(previewOrigin, previewRuntime)
})

test.beforeEach(async () => {
  await db.cmsPreviewSession.deleteMany()
  await db.cmsPreviewGrant.deleteMany()
  await db.cmsPublicationBuild.deleteMany()
  await db.cmsPublicationController.deleteMany()
  await db.cmsPublication.deleteMany()
  await db.cmsApprovalRequest.deleteMany()
  await db.cmsPageRevision.deleteMany()
  await db.cmsPage.deleteMany()
  await db.taskOutbox.deleteMany({ where: { type: 'website:rebuild:wakeup' } })
  await db.user.update({ where: { email: e2eAdminEmail }, data: { role: 'owner' } })
  const cmsPage = await db.cmsPage.create({
    data: {
      path: pageDraft.path,
      title: pageDraft.title,
      draftPayload: pageDraft,
    },
  })
  cmsPageId = cmsPage.id
})

test.afterAll(async () => {
  await stopChild(previewRuntime)
  await db?.$disconnect()
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test('owner edits, previews, publishes, and uses the selected calculator package without the CMS API', async ({ context, page }) => {
  test.setTimeout(180_000)

  await page.goto('/login')
  await page.getByLabel('Электронная почта').fill(e2eAdminEmail)
  await page.getByLabel('Пароль', { exact: true }).fill(e2eAdminPassword)
  await page.getByRole('button', { name: 'Войти' }).click()

  await expect(page).toHaveURL(/\/admin$/)
  await page.getByRole('link', { name: 'Страницы' }).click()
  await page.getByRole('link', { name: pageDraft.title }).click()

  await page.getByRole('button', { name: 'Калькулятор стоимости', exact: true }).click()
  await page.getByLabel('Заголовок', { exact: true }).last().fill('Точный расчёт ремонта')
  await page.getByLabel('Описание', { exact: true }).last().fill('Стоимость считается в браузере по сохранённым параметрам.')
  await page.getByLabel('Цена за м²').fill('2475')
  await page.getByLabel('Минимальная стоимость').fill('30000')
  await page.getByLabel('Минимальная площадь').fill('10')
  await page.getByLabel('Максимальная площадь').fill('500')
  await page.getByRole('button', { name: 'Сохранить сейчас' }).click()
  await expect.poll(async () => {
    const saved = await db.cmsPage.findFirstOrThrow({ where: { path: pageDraft.path } })
    const payload = saved.draftPayload as { blocks?: Array<{ type?: string; data?: { unitPrice?: number } }> }
    return payload.blocks?.find((block) => block.type === 'estimateCalculator')?.data?.unitPrice
  }).toBe(2475)

  await page.getByRole('link', { name: 'Страницы' }).click()
  await page.getByRole('link', { name: pageDraft.title }).click()
  const savedCalculator = page.getByRole('button', { name: /2\. Калькулятор стоимости/ })
  await expect(savedCalculator).toBeVisible()
  await savedCalculator.click()
  await expect(page.getByLabel('Цена за м²')).toHaveValue('2475')
  await expect(page.getByLabel('Минимальная стоимость')).toHaveValue('30000')
  await expect(page.getByLabel('Минимальная площадь')).toHaveValue('10')
  await expect(page.getByLabel('Максимальная площадь')).toHaveValue('500')
  await assertResponsiveSurface(page)

  const previewGrantRequest = page.waitForRequest((request) =>
    request.method() === 'POST' && request.url() === `${backendOrigin}/api/cms/preview/grants`,
  )
  await page.getByRole('button', { name: 'Предпросмотр' }).click()
  const previewAuthorization = await (await previewGrantRequest).headerValue('authorization')
  expect(previewAuthorization).toBeTruthy()
  const grantUrl = await page.getByTitle('Защищённый предпросмотр страницы').getAttribute('src')
  expect(grantUrl).toBeTruthy()
  const grant = new URL(grantUrl!)
  expect(grant.origin).toBe(previewOrigin)
  expect(grant.pathname.split('/').at(-1)).toBe(cmsPageId)
  await expect(page.frameLocator('iframe[title="Защищённый предпросмотр страницы"]').getByText('Точно по вашим параметрам')).toBeVisible()

  const directGrantResponse = await page.request.post(`${backendOrigin}/api/cms/preview/grants`, {
    data: { pageId: cmsPageId },
    headers: { Authorization: previewAuthorization! },
  })
  expect(directGrantResponse.ok()).toBe(true)
  const directGrant = await directGrantResponse.json() as { previewUrl: string }
  expect(new URL(directGrant.previewUrl).origin).toBe(previewOrigin)
  const previewPage = await context.newPage()
  await previewPage.goto(directGrant.previewUrl)
  await expect(previewPage.getByText('Точно по вашим параметрам')).toBeVisible()
  await expect(previewPage.getByRole('heading', { level: 2, name: 'Точный расчёт ремонта' })).toBeVisible()
  await expect(previewPage.getByText('2 475 ₽ / м²')).toBeVisible()
  await previewPage.emulateMedia({ reducedMotion: 'reduce' })
  await assertResponsiveSurface(previewPage, { documentContract: { noIndex: true }, reload: true })
  await previewPage.close()

  await page.getByRole('button', { name: 'Отправить на согласование' }).click()
  await expect.poll(async () => db.cmsApprovalRequest.count({ where: { status: 'pending' } })).toBe(1)
  await page.getByRole('link', { name: 'Публикации' }).click()
  await page.getByRole('button', { name: 'Согласовать' }).click()
  await expect.poll(async () => db.cmsPublication.count()).toBe(1)

  const publication = await db.cmsPublication.findFirstOrThrow({ orderBy: { revision: 'desc' } })
  const fakeS3 = await createFakeS3Destination()
  try {
    const outputRoot = await mkdtemp(join(tmpdir(), 'vibe-site-package-e2e-'))
    temporaryDirectories.push(outputRoot)
    const buildSite = createAstroSiteRunner({
      websiteDirectory,
      publicWebsiteUrl: fakeS3.origin,
      tempDirectory: outputRoot,
    })
    const buildId = crypto.randomUUID()
    const output = await buildSite({
      buildId,
      publicationRevision: publication.revision,
      slot: 'green',
      snapshot: publication.snapshot as BuilderPublicationSnapshot,
    })

    await publishBuiltRelease({
      build: {
        buildId,
        publicationRevision: publication.revision,
        slot: 'green',
        snapshotArtifact: {
          url: 'https://fake-s3.invalid/snapshot.json',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          etag: 'e2e-snapshot',
        },
        media: [],
      },
      outputDirectory: output.outputDirectory,
      redirects: output.redirects,
      copyMedia: { copyFromSignedUrl: async () => undefined },
      uploader: fakeS3.uploader,
      promotion: fakeS3.promotion,
    })

    await expect.poll(() => fakeS3.marker()).toBe(`vibe-publication:${publication.revision}`)
    const publicPage = await context.newPage()
    let cmsApiRequests = 0
    await publicPage.route('**/api/cms/**', async (route) => {
      cmsApiRequests += 1
      await route.abort('connectionrefused')
    })
    await publicPage.goto(`${fakeS3.origin}/calculator/`)
    await expect(publicPage.getByRole('heading', { level: 2, name: 'Точный расчёт ремонта' })).toBeVisible()
    const calculatorInput = publicPage.getByLabel('Площадь помещения, м²')
    await calculatorInput.fill('125')
    await expect.poll(async () => (await publicPage.getByRole('status').textContent())?.replace(/\s/g, '')).toBe('309375₽')
    await publicPage.emulateMedia({ reducedMotion: 'reduce' })
    await assertResponsiveSurface(publicPage, { documentContract: { noIndex: false }, reload: true })
    await assertKeyboardCalculatorNavigation(publicPage)
    expect(cmsApiRequests).toBe(0)
    await publicPage.close()
  } finally {
    await fakeS3.close()
  }
})

async function assertResponsiveSurface(
  page: import('@playwright/test').Page,
  options: { documentContract?: { noIndex: boolean }; reload?: boolean } = {},
) {
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    if (options.reload) await page.reload()
    const diagnostics = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      layout: [...document.querySelectorAll<HTMLElement>('.estimate, .estimate > *, main, [data-site-package]')]
        .map((element) => {
          const bounds = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          return {
            className: element.className,
            display: style.display,
            gridTemplateColumns: style.gridTemplateColumns,
            left: Math.round(bounds.left),
            minWidth: style.minWidth,
            padding: style.padding,
            right: Math.round(bounds.right),
            tagName: element.tagName,
            width: style.width,
          }
        }),
      elements: [...document.querySelectorAll<HTMLElement>('body *')]
        .map((element) => {
          const bounds = element.getBoundingClientRect()
          return { bounds, element }
        })
        .filter(({ bounds }) => bounds.right > document.documentElement.clientWidth + 1 || bounds.left < -1)
        .slice(0, 8)
        .map(({ bounds, element }) => ({
          className: element.className,
          left: Math.round(bounds.left),
          right: Math.round(bounds.right),
          tagName: element.tagName,
        })),
    }))
    expect(
      diagnostics.overflow,
      `horizontal overflow at ${width}px: ${JSON.stringify({ elements: diagnostics.elements, layout: diagnostics.layout })}`,
    ).toBeLessThanOrEqual(1)
    if (options.documentContract) await assertPackageDocumentContract(page, options.documentContract)
  }
}

async function assertPackageDocumentContract(
  page: import('@playwright/test').Page,
  options: { noIndex: boolean },
) {
  await expect(page).toHaveTitle('Расчёт стоимости ремонта')
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    'Рассчитайте предварительную стоимость ремонта по площади помещения.',
  )
  const headings = await page.locator('h1, h2, h3, h4, h5, h6').evaluateAll((elements) => elements.map((element) => (
    `${element.tagName}:${element.textContent?.trim()}`
  )))
  expect(headings).toEqual([
    'H1:Ремонт с понятной сметой',
    'H2:Точный расчёт ремонта',
  ])
  if (options.noIndex) {
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow')
  } else {
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0)
  }
  const calculatorLink = page.getByRole('link', { name: 'Рассчитать' })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const normalTransitionMs = await transitionDurationMs(calculatorLink)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const reducedTransitionMs = await transitionDurationMs(calculatorLink)
  expect(normalTransitionMs).toBeGreaterThan(0)
  expect(reducedTransitionMs).toBeLessThanOrEqual(0.01)
  expect(reducedTransitionMs).toBeLessThan(normalTransitionMs)
}

function transitionDurationMs(locator: import('@playwright/test').Locator) {
  return locator.evaluate((element) => Math.max(...getComputedStyle(element).transitionDuration.split(',').map((duration) => {
    const value = Number.parseFloat(duration)
    return duration.trim().endsWith('ms') ? value : value * 1_000
  })))
}

async function assertKeyboardCalculatorNavigation(page: import('@playwright/test').Page) {
  const calculator = page.locator('#estimate')
  const skipLink = page.getByRole('link', { name: 'Перейти к содержанию' })
  const brandLink = page.getByRole('link', { name: /: на главную$/ })
  const calculatorLink = page.getByRole('link', { name: 'Рассчитать' })
  await expect(calculator).toHaveCount(1)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Tab')
  await expect(skipLink).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(brandLink).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(calculatorLink).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#estimate$/)
  await expect(calculator).toBeInViewport()
}

async function waitForHttp(origin: string, process: ChildProcess) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (process.exitCode !== null) throw new Error('Website preview runtime exited before it became ready')
    try {
      const response = await fetch(origin)
      if (response.ok) return
    } catch {
      // The preview runtime is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error('Timed out waiting for the website preview runtime')
}

async function runCommand(command: string, args: string[], cwd: string, extraEnv: Record<string, string>) {
  const process = spawn(command, args, {
    cwd,
    env: { ...globalThis.process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  process.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk))
  process.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))
  const exitCode = await new Promise<number | null>((resolveExit, reject) => {
    process.once('error', reject)
    process.once('exit', resolveExit)
  })
  if (exitCode !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${exitCode})\n${Buffer.concat(stdout)}\n${Buffer.concat(stderr)}`)
  }
}

async function createFakeS3Destination() {
  const objects = new Map<string, { body: Uint8Array; contentType: string; redirectLocation?: string }>()
  let activeSlot: 'blue' | 'green' = 'blue'
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://fake-s3.invalid').pathname
    const objectPath = pathname.endsWith('/') ? `${pathname.slice(1)}index.html` : pathname.slice(1)
    const object = objects.get(`${activeSlot}/${objectPath}`)
      ?? (pathname.endsWith('/') ? objects.get(`${activeSlot}/${pathname.slice(1, -1)}.html`) : undefined)
    if (!object) {
      response.writeHead(404).end('Not Found')
      return
    }
    if (object.redirectLocation) {
      response.writeHead(302, { Location: object.redirectLocation }).end()
      return
    }
    response.writeHead(200, { 'Content-Type': object.contentType })
    response.end(object.body)
  })
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not start the fake S3 destination')

  const readMarker = (slot = activeSlot) => {
    const marker = objects.get(`${slot}/__publication_revision.txt`)
    return marker ? new TextDecoder().decode(marker.body) : null
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    uploader: {
      async deleteInactivePrefix(prefix: string) {
        for (const key of objects.keys()) if (key.startsWith(prefix)) objects.delete(key)
      },
      async putImmutable(object: { key: string; body: Uint8Array; contentType: string; redirectLocation?: string }) {
        objects.set(object.key, {
          body: object.body,
          contentType: object.contentType,
          redirectLocation: object.redirectLocation,
        })
      },
    },
    promotion: {
      async verifyInactiveMarker(input: { slot: 'blue' | 'green'; revision: number }) {
        return readMarker(input.slot) === `vibe-publication:${input.revision}`
      },
      async switchActiveSlot(slot: 'blue' | 'green') {
        activeSlot = slot
      },
      async purgePublicPaths() {},
      async verifyPublicMarker(revision: number) {
        return readMarker() === `vibe-publication:${revision}`
      },
    },
    marker: () => readMarker(),
    close: () => closeServer(server),
  }
}

function closeServer(server: Server) {
  return new Promise<void>((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose())
  })
}

async function stopChild(process: ChildProcess | undefined) {
  if (!process || process.exitCode !== null) return
  const exited = new Promise<void>((resolveExit) => process.once('exit', () => resolveExit()))
  process.kill()
  await Promise.race([
    exited,
    new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
  ])
}
