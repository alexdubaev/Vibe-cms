import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'

import {
  assertBackendStartupFailedClosed,
  builderSmokeEnvironment,
} from './docker-smoke-site-package-config.ts'

const packageId = process.argv[2]
if (!packageId) throw new Error('Usage: bun scripts/docker-smoke-site-package.mjs <site-package-id>')
if (!/^[a-z][a-z0-9-]{1,62}$/.test(packageId)) throw new Error('Invalid Site Package ID')

const suffix = `${process.pid}-${Date.now()}`
const images = {
  backend: `vibe-cms-backend-site-package-smoke:${suffix}`,
  builder: `vibe-cms-builder-site-package-smoke:${suffix}`,
  webapp: `vibe-cms-webapp-site-package-smoke:${suffix}`,
  preview: `vibe-cms-preview-site-package-smoke:${suffix}`,
}
const containers = {
  backend: `vibe-cms-backend-site-package-smoke-${suffix}`,
  builder: `vibe-cms-builder-site-package-smoke-${suffix}`,
}

const run = (args, options = {}) => {
  const result = spawnSync('docker', args, {
    cwd: process.cwd(),
    encoding: options.capture ? 'utf8' : undefined,
    input: options.input,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : options.input ? ['pipe', 'inherit', 'inherit'] : 'inherit',
  })
  if (result.status !== 0) {
    const diagnostics = options.capture ? `\n${result.stderr || result.stdout}` : ''
    throw new Error(`docker ${args.join(' ')} failed with exit code ${result.status ?? 1}${diagnostics}`)
  }
  return options.capture ? result.stdout.trim() : ''
}

const captureDockerLogs = (container) => {
  const result = spawnSync('docker', ['logs', container], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    throw new Error(`docker logs ${container} failed with exit code ${result.status ?? 1}`)
  }
  return `${result.stdout}\n${result.stderr}`
}

const archive = spawnSync('git', ['archive', '--format=tar', 'HEAD'], {
  cwd: process.cwd(),
  encoding: null,
  maxBuffer: 128 * 1024 * 1024,
})
if (archive.status !== 0 || !archive.stdout) throw new Error('git archive HEAD failed')

const buildImage = (dockerfile, image) => run([
  'build',
  '--build-arg', `CMS_SITE_PACKAGE_ID=${packageId}`,
  '-f', dockerfile,
  '-t', image,
  '-',
], { input: archive.stdout })

const assertSelectedDescriptor = (image) => {
  const descriptor = JSON.parse(run([
    'run', '--rm', '--entrypoint', 'bun', image,
    '--eval',
    "const contract = await import('/app/packages/selected-site-package/src/contract.ts'); console.log(JSON.stringify(contract.selectedSitePackageDescriptor))",
  ], { capture: true }))
  if (descriptor.id !== packageId) {
    throw new Error(`Runtime image contains Site Package ${descriptor.id}, expected ${packageId}`)
  }
}

const assertNoPackageSourceLeak = (image) => run([
  'run', '--rm', '--entrypoint', 'sh', image, '-ceu',
  [
    'test ! -e /app/site-packages',
    'test ! -e /app/packages/vibe-core',
    'test ! -e /app/packages/customer-b',
    'test ! -e /app/customer-b',
  ].join('; '),
])

const assertStaticOnlyWebapp = (image) => run([
  'run', '--rm', '--entrypoint', 'sh', image, '-ceu',
  [
    'test ! -e /app/site-packages',
    'test ! -e /app/packages',
    "test -z \"$(find /usr/share/nginx/html -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.astro' \\) -print -quit)\"",
  ].join('; '),
])

const assertCompiledPackage = (image, directory) => run([
  'run', '--rm', '--entrypoint', 'sh', image, '-ceu',
  `grep -R -F ${JSON.stringify(packageId)} ${directory} >/dev/null`,
])

const findOpenPort = () => new Promise((resolve, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    server.close(() => address && typeof address === 'object'
      ? resolve(address.port)
      : reject(new Error('Could not allocate a Docker smoke port')))
  })
})

const waitForHttp = async (url, acceptedStatuses) => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(url)
      if (acceptedStatuses.includes(response.status)) return
    } catch {
      // The container may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

const smokeBuilderHealth = async () => {
  const port = await findOpenPort()
  run([
    'run', '-d', '--name', containers.builder,
    '-p', `127.0.0.1:${port}:3000`,
    '-e', 'PORT=3000',
    ...Object.entries(builderSmokeEnvironment).flatMap(([name, value]) => ['-e', `${name}=${value}`]),
    images.builder,
  ])
  await waitForHttp(`http://127.0.0.1:${port}/`, [405])
}

const smokeBackendFailClosedStartup = async () => {
  run([
    'run', '-d', '--name', containers.backend,
    '-e', 'PORT=3000',
    '-e', 'DATABASE_URL=postgresql://smoke:smoke@127.0.0.1:1/vibe_cms_task8_test',
    '-e', `JWT_SECRET=${'0123456789abcdef'.repeat(4)}`,
    '-e', 'CORS_ORIGINS=https://web.example.com',
    '-e', 'COOKIE_SECURE=true',
    '-e', 'PRIVATE_STORAGE_DRIVER=s3',
    '-e', 'PRIVATE_STORAGE_REGION=us-east-1',
    '-e', 'PRIVATE_STORAGE_BUCKET=backend-smoke-bucket',
    '-e', 'PRIVATE_STORAGE_ENDPOINT=https://storage.invalid',
    '-e', 'PRIVATE_STORAGE_ACCESS_KEY_ID=backend-smoke-key',
    '-e', 'PRIVATE_STORAGE_SECRET_ACCESS_KEY=backend-smoke-secret',
    '-e', 'PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT=true',
    images.backend,
  ])

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const state = JSON.parse(run([
      'container', 'inspect', '--format', '{{json .State}}', containers.backend,
    ], { capture: true }))
    if (!state.Running) {
      const diagnostics = captureDockerLogs(containers.backend)
      assertBackendStartupFailedClosed(state, diagnostics)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error('Backend remained running without passing its startup database gate')
}

try {
  buildImage('website-builder/Dockerfile', images.builder)
  assertSelectedDescriptor(images.builder)
  assertNoPackageSourceLeak(images.builder)

  buildImage('backend/Dockerfile', images.backend)
  assertSelectedDescriptor(images.backend)
  assertNoPackageSourceLeak(images.backend)

  buildImage('webapp/Dockerfile', images.webapp)
  assertStaticOnlyWebapp(images.webapp)
  assertCompiledPackage(images.webapp, '/usr/share/nginx/html')

  buildImage('website/Dockerfile.preview', images.preview)
  assertNoPackageSourceLeak(images.preview)
  assertCompiledPackage(images.preview, '/app/website/dist')

  await smokeBuilderHealth()
  await smokeBackendFailClosedStartup()
  process.stdout.write(`Selected Site Package Docker smoke passed: ${packageId}\n`)
} catch (error) {
  for (const container of Object.values(containers)) {
    const exists = spawnSync('docker', ['container', 'inspect', container], { stdio: 'ignore' })
    if (exists.status === 0) spawnSync('docker', ['logs', container], { stdio: 'inherit' })
  }
  throw error
} finally {
  for (const container of Object.values(containers)) {
    spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' })
  }
  for (const image of Object.values(images)) {
    spawnSync('docker', ['image', 'rm', '-f', image], { stdio: 'ignore' })
  }
}
