import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { stageSitePackage } from './stage-site-package.mjs'

const temporaryRoots: string[] = []

const createFixtureRepository = async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'vibe-site-package-'))
  temporaryRoots.push(repositoryRoot)

  for (const packageId of ['vibe-core', 'customer-b']) {
    const sourceDirectory = join(repositoryRoot, 'site-packages', packageId, 'src')
    await mkdir(sourceDirectory, { recursive: true })
    await writeFile(
      join(sourceDirectory, 'contract.ts'),
      `export const selectedSitePackageDescriptor = { id: '${packageId}', version: '1.0.0', schemaVersion: 1 }\n`,
    )
    await writeFile(join(sourceDirectory, 'admin.ts'), 'export {}\n')
    await writeFile(join(sourceDirectory, 'website.ts'), 'export {}\n')
    await writeFile(join(sourceDirectory, 'marker.txt'), packageId)
    await writeFile(join(repositoryRoot, 'site-packages', packageId, 'package.json'), JSON.stringify({ name: packageId }))
  }

  return {
    repositoryRoot,
    outputDirectory: join(repositoryRoot, 'packages', 'selected-site-package'),
  }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('stageSitePackage', () => {
  test('stages one selected package without merging files from an earlier selection', async () => {
    const { repositoryRoot, outputDirectory } = await createFixtureRepository()
    await mkdir(outputDirectory, { recursive: true })
    await writeFile(join(outputDirectory, 'obsolete.txt'), 'do not retain')

    const stagedPackage = await stageSitePackage({ repositoryRoot, packageId: 'vibe-core', outputDirectory })
    expect(stagedPackage).toEqual({
      id: 'vibe-core',
      outputDirectory,
    })

    expect(await readFile(join(outputDirectory, 'src', 'marker.txt'), 'utf8')).toBe('vibe-core')
    expect(await Bun.file(join(outputDirectory, 'obsolete.txt')).exists()).toBeFalse()
    expect(await Bun.file(join(repositoryRoot, 'site-packages', 'customer-b', 'src', 'marker.txt')).exists()).toBeTrue()
    expect(await Bun.file(join(repositoryRoot, 'packages', 'selected-site-package', 'src', 'marker.txt')).exists()).toBeTrue()
  })

  test('rejects traversal package IDs before selecting a source package', async () => {
    const { repositoryRoot, outputDirectory } = await createFixtureRepository()

    await expect(stageSitePackage({ repositoryRoot, packageId: '../customer-b', outputDirectory })).rejects.toThrow(
      'Invalid Site Package ID',
    )
    expect(await Bun.file(outputDirectory).exists()).toBeFalse()
  })

  test('preserves an existing selected package when the requested package is missing or unsafe', async () => {
    const { repositoryRoot, outputDirectory } = await createFixtureRepository()
    await mkdir(outputDirectory, { recursive: true })
    await writeFile(join(outputDirectory, 'selected.txt'), 'previous selection')

    await expect(stageSitePackage({ repositoryRoot, packageId: 'missing-package', outputDirectory })).rejects.toThrow(
      'Site Package not found',
    )
    await expect(stageSitePackage({ repositoryRoot, packageId: '../vibe-core', outputDirectory })).rejects.toThrow(
      'Invalid Site Package ID',
    )

    expect(await readFile(join(outputDirectory, 'selected.txt'), 'utf8')).toBe('previous selection')
  })
})
