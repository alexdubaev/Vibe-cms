import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'

import { builderSmokeEnvironment } from './docker-smoke-site-package-config.ts'

const packageId = process.argv[2]
if (!packageId) throw new Error('Usage: bun scripts/docker-smoke-site-package.mjs <site-package-id>')

const suffix = `${process.pid}-${Date.now()}`
const images = {
  backend: `vibe-cms-backend-site-package-smoke:${suffix}`,
  builder: `vibe-cms-builder-site-package-smoke:${suffix}`,
  webapp: `vibe-cms-webapp-site-package-smoke:${suffix}`,
}
const containers = {
  backend: `vibe-cms-backend-site-package-smoke-${suffix}`,
  builder: `vibe-cms-builder-site-package-smoke-${suffix}`,
}

const run = (args, options = {}) => {
  const result = spawnSync('docker', args, {
    cwd: process.cwd(),
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
  if (result.status !== 0) {
    const diagnostics = options.capture ? `\n${result.stderr || result.stdout}` : ''
    throw new Error(`docker ${args.join(' ')} failed with exit code ${result.status ?? 1}${diagnostics}`)
  }
  return options.capture ? result.stdout.trim() : ''
}

const buildImage = (dockerfile, image) => run([
  'build',
  '--build-arg', `CMS_SITE_PACKAGE_ID=${packageId}`,
  '-f', dockerfile,
  '-t', image,
  '.',
])

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

const smokeBackendHealth = async () => {
  const port = await findOpenPort()
  run([
    'run', '-d', '--name', containers.backend,
    '-p', `127.0.0.1:${port}:3000`,
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
  await waitForHttp(`http://127.0.0.1:${port}/health/live`, [200])
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

  await smokeBuilderHealth()
  await smokeBackendHealth()
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
