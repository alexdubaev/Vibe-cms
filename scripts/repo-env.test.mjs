import { afterEach, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  assertTestDatabaseUrl,
  defaultTestDatabaseUrl,
  postgresPortFromDatabaseUrl,
  repositoryRoot,
} from './repo-env.mjs'

const envKeys = ['TEST_ALLOW_NON_TEST_DATABASE']
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of envKeys) {
    const value = originalEnv[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

test('defaultTestDatabaseUrl builds the documented postgres test URL', () => {
  expect(defaultTestDatabaseUrl('55432')).toBe(
    'postgresql://superuser:superpassword@localhost:55432/web_app_demo_test?schema=public',
  )
})

test('postgresPortFromDatabaseUrl returns explicit ports and postgres defaults', () => {
  expect(
    postgresPortFromDatabaseUrl(
      'postgresql://superuser:superpassword@localhost:55432/web_app_demo_test?schema=public',
    ),
  ).toBe('55432')
  expect(
    postgresPortFromDatabaseUrl(
      'postgresql://superuser:superpassword@localhost/web_app_demo_test?schema=public',
    ),
  ).toBe('5432')
})

test('assertTestDatabaseUrl accepts test databases and rejects development databases', () => {
  expect(() =>
    assertTestDatabaseUrl(
      'postgresql://superuser:superpassword@localhost:55432/web_app_demo_test?schema=public',
    ),
  ).not.toThrow()

  expect(() =>
    assertTestDatabaseUrl(
      'postgresql://superuser:superpassword@localhost:54329/web_app_demo?schema=public',
    ),
  ).toThrow(/Refusing to run tests against non-test database "web_app_demo"/)
})

test('assertTestDatabaseUrl accepts non-test databases with an intentional override', () => {
  process.env.TEST_ALLOW_NON_TEST_DATABASE = '1'

  expect(() =>
    assertTestDatabaseUrl(
      'postgresql://superuser:superpassword@localhost:54329/web_app_demo?schema=public',
    ),
  ).not.toThrow()
})

test('every email credential the backend refuses is neutralised where it would surface badly', async () => {
  // Two places have to know this list, and both failures are opaque. A key missing from the
  // deploy generator is dropped from the spec, so the deployed install accepts password-reset
  // requests and sends nothing. A key missing from the Playwright env is inherited from the
  // developer's shell, refused at startup under EMAIL_DELIVERY=disabled, and shows up as a
  // 120-second webServer timeout with nothing pointing at email.
  const { emailProviderKeys } = await import('../backend/src/env.ts')
  const [generator, playwright] = await Promise.all([
    readFile(resolve(repositoryRoot, 'scripts/prepare-do-specs.mjs'), 'utf8'),
    readFile(resolve(repositoryRoot, 'webapp/playwright.config.ts'), 'utf8'),
  ])

  for (const name of Object.values(emailProviderKeys).flat()) {
    expect({
      name,
      inDeploySpec: generator.includes(`'${name}'`),
      blankedForE2E: new RegExp(`${name}:\\s*''`).test(playwright),
    }).toEqual({ name, inDeploySpec: true, blankedForE2E: true })
  }
})
