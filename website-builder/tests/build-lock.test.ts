import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createFlockBuildProcessRunner } from '../src/build-lock'
import { runBuildProcess } from '../src/build-site'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('createFlockBuildProcessRunner', () => {
  test('wraps the Astro command with the shared flock while preserving cwd and env', async () => {
    const calls: unknown[] = []
    const run = mock(async (input) => { calls.push(input) })
    const lockedRun = createFlockBuildProcessRunner({
      lockFile: '/var/lock/vibe-cms/astro-build.lock',
      waitSeconds: 600,
      run,
    })
    const env = { CMS_SNAPSHOT_FILE: '/tmp/snapshot.json' }

    await lockedRun({
      command: 'bun',
      args: ['x', 'astro', 'build', '--outDir', '/tmp/output'],
      cwd: '/app/website',
      env,
    })

    expect(calls).toEqual([{
      command: 'flock',
      args: [
        '--wait',
        '600',
        '/var/lock/vibe-cms/astro-build.lock',
        'bun',
        'x',
        'astro',
        'build',
        '--outDir',
        '/tmp/output',
      ],
      cwd: '/app/website',
      env,
    }])
  })

  test('rejects a relative lock path before a build can start', () => {
    expect(() => createFlockBuildProcessRunner({
      lockFile: 'var/lock/vibe-cms/astro-build.lock',
      waitSeconds: 600,
      run: async () => undefined,
    })).toThrow('Astro build lock file must be an absolute path')
  })

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a non-positive or non-finite wait value %p before a build can start',
    (waitSeconds) => {
      expect(() => createFlockBuildProcessRunner({
        lockFile: '/var/lock/vibe-cms/astro-build.lock',
        waitSeconds,
        run: async () => undefined,
      })).toThrow('Astro build lock wait must be a positive finite number of seconds')
    },
  )

  test.skipIf(process.platform === 'win32')('serialises concurrent commands that use the same lock file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-build-lock-'))
    temporaryRoots.push(root)
    const logFile = join(root, 'builds.log')
    const commandFile = join(root, 'fake-build.ts')
    await writeFile(commandFile, [
      "import { appendFile } from 'node:fs/promises'",
      'const [logFile, label, duration] = process.argv.slice(2)',
      "await appendFile(logFile!, `${label}:start:${Date.now()}\\n`)",
      'await Bun.sleep(Number(duration))',
      "await appendFile(logFile!, `${label}:end:${Date.now()}\\n`)",
    ].join('\n'))

    const run = async (input: {
      command: string
      args: string[]
      cwd: string
      env: Record<string, string>
    }) => {
      const child = Bun.spawn([input.command, ...input.args], {
        cwd: input.cwd,
        env: { ...process.env, ...input.env },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const exitCode = await child.exited
      if (exitCode !== 0) {
        const diagnostics = child.stderr ? await new Response(child.stderr).text() : ''
        throw new Error(`Process ${input.command} exited ${exitCode}: ${diagnostics}`)
      }
    }
    const lockedRun = createFlockBuildProcessRunner({
      lockFile: join(root, 'astro-build.lock'),
      waitSeconds: 2,
      run,
    })

    const first = lockedRun({
      command: process.execPath,
      args: [commandFile, logFile, 'first', '150'],
      cwd: root,
      env: {},
    })
    await waitForLine(logFile, 'first:start:')
    const second = lockedRun({
      command: process.execPath,
      args: [commandFile, logFile, 'second', '10'],
      cwd: root,
      env: {},
    })
    await Promise.all([first, second])

    const events = (await readFile(logFile, 'utf8')).trim().split('\n').map((line) => {
      const [label, phase, timestamp] = line.split(':')
      return { label, phase, timestamp: Number(timestamp) }
    })
    expect(events.map(({ label, phase }) => `${label}:${phase}`)).toEqual([
      'first:start',
      'first:end',
      'second:start',
      'second:end',
    ])
    expect(events[2]!.timestamp).toBeGreaterThanOrEqual(events[1]!.timestamp)
  })

  test.skipIf(process.platform === 'win32')('reports a lock timeout separately from an Astro command failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-build-lock-timeout-'))
    temporaryRoots.push(root)
    const lockFile = join(root, 'astro-build.lock')
    const readyFile = join(root, 'holder-ready')
    const holderFile = join(root, 'hold-lock.ts')
    await writeFile(holderFile, [
      "await Bun.write(process.argv[2]!, 'held')",
      'await Bun.sleep(250)',
    ].join('\n'))
    const holder = createFlockBuildProcessRunner({ lockFile, waitSeconds: 2, run: runBuildProcess })({
      command: process.execPath,
      args: [holderFile, readyFile],
      cwd: root,
      env: {},
    })
    await waitForLine(readyFile, 'held')
    const contender = createFlockBuildProcessRunner({ lockFile, waitSeconds: 0.05, run: runBuildProcess })({
      command: process.execPath,
      args: ['--eval', 'process.exit(0)'],
      cwd: root,
      env: {},
    })

    await expect(contender).rejects.toThrow('Astro build lock timed out after 0.05 seconds')
    await holder
  })
})

async function waitForLine(file: string, prefix: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await readFile(file, 'utf8')).split('\n').some((line) => line.startsWith(prefix))) return
    } catch {
      // The fake command has not created its log yet.
    }
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for ${prefix}`)
}
