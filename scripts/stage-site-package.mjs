import { cp, lstat, mkdir, mkdtemp, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

import { sitePackageDescriptorSchema } from '../packages/contracts/src/cms/site-package.ts'

const sitePackageIdPattern = /^[a-z][a-z0-9-]{1,62}$/

const stagedPackageManifest = {
  name: '@vibe-cms/selected-site-package',
  private: true,
  type: 'module',
  exports: {
    './contract': './src/contract.ts',
    './admin': './src/admin.ts',
    './website': './src/website.ts',
  },
  dependencies: {
    '@web-app-demo/contracts': 'workspace:*',
    zod: '^4.1.13',
  },
}

const isWithin = (parentDirectory, childPath) => {
  const pathFromParent = relative(parentDirectory, childPath)
  return pathFromParent !== '' && !pathFromParent.startsWith(`..${sep}`) && pathFromParent !== '..'
}

const createSiblingTemporaryDirectory = async (outputDirectory) => {
  const outputParentDirectory = dirname(outputDirectory)
  await mkdir(outputParentDirectory, { recursive: true })
  return mkdtemp(join(outputParentDirectory, '.selected-site-package-'))
}

const readStagedDescriptor = async (stagedDirectory) => {
  const contractUrl = pathToFileURL(join(stagedDirectory, 'src', 'contract.ts'))
  const validationProcess = Bun.spawn({
    cmd: [
      process.execPath,
      '--eval',
      'const contract = await import(process.argv[1]); console.log(JSON.stringify(contract.selectedSitePackageDescriptor))',
      contractUrl.href,
    ],
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const exitCode = await validationProcess.exited
  if (exitCode !== 0) {
    const errorOutput = await new Response(validationProcess.stderr).text()
    throw new Error(`Site Package contract could not be loaded: ${errorOutput.trim()}`)
  }
  return sitePackageDescriptorSchema.parse(JSON.parse(await new Response(validationProcess.stdout).text()))
}

const replaceSelectedPackage = async (temporaryDirectory, outputDirectory) => {
  let previousDirectory
  try {
    await lstat(outputDirectory)
    previousDirectory = `${outputDirectory}.previous-${crypto.randomUUID()}`
    await rename(outputDirectory, previousDirectory)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  try {
    await rename(temporaryDirectory, outputDirectory)
  } catch (error) {
    if (previousDirectory) await rename(previousDirectory, outputDirectory)
    throw error
  }

  if (previousDirectory) await rm(previousDirectory, { recursive: true, force: true })
}

export async function stageSitePackage({ repositoryRoot, packageId, outputDirectory = join(repositoryRoot, 'packages', 'selected-site-package') }) {
  if (!sitePackageIdPattern.test(packageId)) throw new Error('Invalid Site Package ID')

  const resolvedRepositoryRoot = resolve(repositoryRoot)
  const sourceRoot = resolve(resolvedRepositoryRoot, 'site-packages')
  const sourceDirectory = resolve(sourceRoot, packageId)
  const destinationDirectory = resolve(outputDirectory)

  if (!isWithin(sourceRoot, sourceDirectory)) throw new Error('Invalid Site Package ID')

  let resolvedSourceDirectory
  try {
    resolvedSourceDirectory = await realpath(sourceDirectory)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('Site Package not found')
    throw error
  }

  const resolvedSourceRoot = await realpath(sourceRoot)
  if (!isWithin(resolvedSourceRoot, resolvedSourceDirectory)) throw new Error('Invalid Site Package ID')

  const temporaryDirectory = await createSiblingTemporaryDirectory(destinationDirectory)
  try {
    const sourceEntries = await readdir(resolvedSourceDirectory)
    await Promise.all(
      sourceEntries.map((entry) =>
        cp(join(resolvedSourceDirectory, entry), join(temporaryDirectory, entry), { recursive: true, force: false }),
      ),
    )
    await writeFile(join(temporaryDirectory, 'package.json'), `${JSON.stringify(stagedPackageManifest, null, 2)}\n`)

    const descriptor = await readStagedDescriptor(temporaryDirectory)
    if (descriptor.id !== packageId) throw new Error('Site Package descriptor ID does not match requested package')

    await replaceSelectedPackage(temporaryDirectory, destinationDirectory)
    return { id: descriptor.id, outputDirectory: destinationDirectory }
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true })
    throw error
  }
}

if (import.meta.main) {
  const packageId = process.argv[2] ?? (process.env.NODE_ENV === 'production' ? undefined : 'vibe-core')
  if (!packageId) throw new Error('Site Package ID is required')
  const stagedPackage = await stageSitePackage({ repositoryRoot: process.cwd(), packageId })
  console.log(`Staged Site Package: ${stagedPackage.id}`)
}
