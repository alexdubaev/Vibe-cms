import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

import { createBackendDockerSmokeIdentity } from './docker-smoke-config.mjs'

test('a conflicting integration package fixture cannot share the backend smoke database lifecycle', () => {
  const integrationComposeProjectName = 'vibecoding-template-aaaaaaaaaaaa'
  const identity = createBackendDockerSmokeIdentity({
    integrationComposeProjectName,
    repositoryHash: 'aaaaaaaaaaaa',
    processId: 4242,
  })

  expect(identity.composeProjectName).not.toBe(integrationComposeProjectName)
  expect(identity.postgresVolumeName).not.toBe(`${integrationComposeProjectName}_postgres_18_test_data`)
  expect(identity.networkName).toBe(`${identity.composeProjectName}_default`)
  expect(identity.postgresVolumeName).toBe(`${identity.composeProjectName}_postgres_18_test_data`)
})

test('backend smoke refuses an invalid or colliding Compose project identity before cleanup', () => {
  expect(() => createBackendDockerSmokeIdentity({
    integrationComposeProjectName: 'anything',
    repositoryHash: '../unsafe',
    processId: 1,
  })).toThrow('repository hash')

  const ownedProjectName = 'vibecoding-template-backend-smoke-aaaaaaaaaaaa-4242'
  expect(() => createBackendDockerSmokeIdentity({
    integrationComposeProjectName: ownedProjectName,
    repositoryHash: 'aaaaaaaaaaaa',
    processId: 4242,
  })).toThrow('must not reuse')
})

test('backend Docker smoke selects and migrates the package before asserting API health', async () => {
  const source = await readFile(new URL('./docker-smoke.mjs', import.meta.url), 'utf8')

  expect(source).toContain("'--build-arg'")
  expect(source).toContain('CMS_SITE_PACKAGE_ID=')
  expect(source).toContain("'db:deploy'")
  expect(source.indexOf("'db:deploy'")).toBeLessThan(source.indexOf('await waitForHealth()'))
  expect(source).toContain("'down', '--volumes', '--remove-orphans'")
})
