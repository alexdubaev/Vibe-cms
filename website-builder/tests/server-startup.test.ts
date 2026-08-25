import { expect, test } from 'bun:test'
import { createServer } from 'node:net'
import { resolve } from 'node:path'

import { builderSmokeEnvironment } from '../../scripts/docker-smoke-site-package-config'

const builderRoot = resolve(import.meta.dir, '..')

test('boots the builder composition root with the Docker smoke environment', async () => {
  const port = await findOpenPort()
  const server = Bun.spawn([process.execPath, 'run', 'src/server.ts'], {
    cwd: builderRoot,
    env: {
      ...process.env,
      ...builderSmokeEnvironment,
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
