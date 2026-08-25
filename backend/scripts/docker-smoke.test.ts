import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

test('backend Docker smoke selects and migrates the package before asserting API health', async () => {
  const source = await readFile(new URL('./docker-smoke.mjs', import.meta.url), 'utf8')

  expect(source).toContain("'--build-arg'")
  expect(source).toContain('CMS_SITE_PACKAGE_ID=')
  expect(source).toContain("'db:deploy'")
  expect(source.indexOf("'db:deploy'")).toBeLessThan(source.indexOf('await waitForHealth()'))
})
