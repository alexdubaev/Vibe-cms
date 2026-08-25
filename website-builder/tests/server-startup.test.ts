import { expect, test } from 'bun:test'
import { createServer } from 'node:net'
import { resolve } from 'node:path'

import { builderSmokeEnvironment } from '../../scripts/docker-smoke-site-package-config'

const builderRoot = resolve(import.meta.dir, '..')
const builderQueueSmokeEnvironment = {
  CMS_BUILDER_QUEUE_URL: 'https://message-queue.invalid/customer/client-auto',
  CMS_BUILDER_YMQ_ENDPOINT: 'https://127.0.0.1:9',
  CMS_BUILDER_YMQ_REGION: 'ru-central1',
  CMS_BUILDER_YMQ_CONSUMER_ACCESS_KEY_ID: 'consumer-smoke-key',
  CMS_BUILDER_YMQ_CONSUMER_SECRET_ACCESS_KEY: 'consumer-smoke-secret',
}

test('boots the builder composition root with the Docker smoke environment', async () => {
  const port = await findOpenPort()
  const server = Bun.spawn([process.execPath, 'run', 'src/server.ts'], {
    cwd: builderRoot,
    env: {
      ...process.env,
      ...builderSmokeEnvironment,
      CMS_BUILDER_RUNTIME_MODE: 'local',
      CMS_ASTRO_BUILD_LOCK_FILE: '',
      PORT: String(port),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  try {
    const response = await waitForHttp(`http://127.0.0.1:${port}/`, server)
    expect(response.status).toBe(405)
  } finally {
    server.kill()
    await server.exited
  }
}, 15_000)

test('rejects a configured relative Astro build lock path before startup', async () => {
  const server = Bun.spawn([process.execPath, 'run', 'src/server.ts'], {
    cwd: builderRoot,
    env: {
      ...process.env,
      ...builderSmokeEnvironment,
      CMS_BUILDER_RUNTIME_MODE: 'studio-production',
      CMS_ASTRO_BUILD_LOCK_FILE: 'var/lock/vibe-cms/astro-build.lock',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  try {
    const exitCode = await Promise.race([
      server.exited,
      Bun.sleep(1_000).then(() => null),
    ])
    expect(exitCode).not.toBeNull()
    const diagnostics = await new Response(server.stderr).text()
    expect(exitCode).not.toBe(0)
    expect(diagnostics).toContain('Astro build lock file must be an absolute path')
  } finally {
    server.kill()
    await server.exited
  }
})

test('boots in explicit serverless mode without a shared lock', async () => {
  const port = await findOpenPort()
  const server = Bun.spawn([process.execPath, 'run', 'src/server.ts'], {
    cwd: builderRoot,
    env: {
      ...process.env,
      ...builderSmokeEnvironment,
      CMS_BUILDER_RUNTIME_MODE: 'serverless',
      CMS_ASTRO_BUILD_LOCK_FILE: '',
      PORT: String(port),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  try {
    const response = await waitForHttp(`http://127.0.0.1:${port}/`, server)
    expect(response.status).toBe(405)
  } finally {
    server.kill()
    await server.exited
  }
}, 15_000)

test('rejects studio-production startup without a shared lock file', async () => {
  const server = Bun.spawn([process.execPath, 'run', 'src/server.ts'], {
    cwd: builderRoot,
    env: {
      ...process.env,
      ...builderSmokeEnvironment,
      CMS_BUILDER_RUNTIME_MODE: 'studio-production',
      CMS_ASTRO_BUILD_LOCK_FILE: '',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  try {
    const exitCode = await Promise.race([
      server.exited,
      Bun.sleep(1_000).then(() => null),
    ])
    expect(exitCode).not.toBeNull()
    const diagnostics = await new Response(server.stderr).text()
    expect(exitCode).not.toBe(0)
    expect(diagnostics).toContain(
      'CMS_ASTRO_BUILD_LOCK_FILE is required when CMS_BUILDER_RUNTIME_MODE=studio-production',
    )
  } finally {
    server.kill()
    await server.exited
  }
})

test('boots in studio-production mode with an absolute shared lock file', async () => {
  const port = await findOpenPort()
  const server = Bun.spawn([process.execPath, 'run', 'src/server.ts'], {
    cwd: builderRoot,
    env: {
      ...process.env,
      ...builderSmokeEnvironment,
      ...builderQueueSmokeEnvironment,
      CMS_BUILDER_RUNTIME_MODE: 'studio-production',
      CMS_ASTRO_BUILD_LOCK_FILE: '/var/lock/vibe-cms/astro-build.lock',
      PORT: String(port),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  try {
    const response = await waitForHttp(`http://127.0.0.1:${port}/`, server)
    expect(response.status).toBe(405)
  } finally {
    server.kill()
    await server.exited
  }
}, 15_000)

test('rejects studio-production startup without the private queue consumer credentials', async () => {
  const server = Bun.spawn([process.execPath, 'run', 'src/server.ts'], {
    cwd: builderRoot,
    env: {
      ...process.env,
      ...builderSmokeEnvironment,
      CMS_BUILDER_RUNTIME_MODE: 'studio-production',
      CMS_ASTRO_BUILD_LOCK_FILE: '/var/lock/vibe-cms/astro-build.lock',
      CMS_BUILDER_QUEUE_URL: '',
      CMS_BUILDER_YMQ_ENDPOINT: '',
      CMS_BUILDER_YMQ_REGION: '',
      CMS_BUILDER_YMQ_CONSUMER_ACCESS_KEY_ID: '',
      CMS_BUILDER_YMQ_CONSUMER_SECRET_ACCESS_KEY: '',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  try {
    const exitCode = await Promise.race([
      server.exited,
      Bun.sleep(1_000).then(() => null),
    ])
    expect(exitCode).not.toBeNull()
    const diagnostics = await new Response(server.stderr).text()
    expect(exitCode).not.toBe(0)
    expect(diagnostics).toContain('CMS_BUILDER_QUEUE_URL')
    expect(diagnostics).toContain('CMS_BUILDER_YMQ_CONSUMER_SECRET_ACCESS_KEY')
  } finally {
    server.kill()
    await server.exited
  }
})

function findOpenPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') resolvePort(address.port)
        else reject(new Error('Could not allocate a builder startup test port'))
      })
    })
  })
}

async function waitForHttp(url: string, server: Bun.Subprocess<'ignore', 'pipe', 'pipe'>) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (server.exitCode !== null) {
      const diagnostics = await new Response(server.stderr).text()
      throw new Error(`Builder exited before startup: ${diagnostics}`)
    }
    try {
      return await fetch(url)
    } catch {
      await Bun.sleep(100)
    }
  }
  throw new Error(`Timed out waiting for ${url}`)
}
