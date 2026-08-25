import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { performance } from 'node:perf_hooks'

export async function runCapacitySmoke({
  outputPath,
  memoryCeilingBytes,
  diskCeilingBytes,
  fakeArtifactBytes = 256 * 1024,
  fakeBuildDelayMs = 20,
  now = () => new Date(),
} = {}) {
  requirePositiveInteger(memoryCeilingBytes, 'memory ceiling')
  requirePositiveInteger(diskCeilingBytes, 'disk ceiling')
  requirePositiveInteger(fakeArtifactBytes, 'fake artifact bytes')
  if (!Number.isInteger(fakeBuildDelayMs) || fakeBuildDelayMs < 0) {
    throw new Error('fake build delay must be a non-negative integer')
  }
  if (!outputPath?.trim()) throw new Error('An explicit capacity report output path is required')

  const startedAt = now().toISOString()
  const queuedAt = performance.now()
  const workspace = await mkdtemp(join(tmpdir(), 'vibe-cms-capacity-'))
  const requests = []
  try {
    for (let index = 1; index <= 3; index += 1) {
      const requestStarted = performance.now()
      const queueWaitMs = requestStarted - queuedAt
      const beforeRss = process.memoryUsage.rss()
      const artifactPath = join(workspace, `fake-publish-${index}.html`)
      const buildStarted = performance.now()
      await delay(fakeBuildDelayMs)
      await writeFile(artifactPath, Buffer.alloc(fakeArtifactBytes, index))
      const builtBytes = (await stat(artifactPath)).size
      const buildDurationMs = performance.now() - buildStarted
      const afterRss = process.memoryUsage.rss()
      requests.push({
        requestId: `fake-publish-${index}`,
        destination: `local-fake://publish-${index}`,
        peakRssBytes: Math.max(beforeRss, afterRss),
        buildDurationMs: roundMilliseconds(buildDurationMs),
        queueWaitMs: roundMilliseconds(queueWaitMs),
        temporaryDiskBytes: builtBytes,
      })
    }

    const peakRssBytes = Math.max(...requests.map(({ peakRssBytes }) => peakRssBytes))
    const peakTemporaryDiskBytes = Math.max(...requests.map(({ temporaryDiskBytes }) => temporaryDiskBytes))
    const failures = []
    if (peakRssBytes > memoryCeilingBytes) {
      failures.push(`peak RSS ${peakRssBytes} bytes exceeded ceiling ${memoryCeilingBytes} bytes`)
    }
    if (peakTemporaryDiskBytes > diskCeilingBytes) {
      failures.push(`temporary disk ${peakTemporaryDiskBytes} bytes exceeded ceiling ${diskCeilingBytes} bytes`)
    }

    const report = {
      formatVersion: 1,
      mode: 'controlled-fake-publish',
      startedAt,
      finishedAt: now().toISOString(),
      ceilings: { memoryBytes: memoryCeilingBytes, temporaryDiskBytes: diskCeilingBytes },
      peaks: { rssBytes: peakRssBytes, temporaryDiskBytes: peakTemporaryDiskBytes },
      requests,
      withinCeilings: failures.length === 0,
      failures,
      interpretation: 'Evidence from three controlled fake publishes; this report does not establish an installation-count limit.',
    }

    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    await chmod(outputPath, 0o600)
    return { report, failures, withinCeilings: failures.length === 0, outputPath }
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

function requirePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

function roundMilliseconds(value) {
  return Math.round(value * 1000) / 1000
}

function parseByteOption(argv, name, fallback) {
  const prefix = `--${name}=`
  const argument = argv.find((value) => value.startsWith(prefix))
  if (!argument) return fallback
  const value = Number(argument.slice(prefix.length))
  requirePositiveInteger(value, name.replaceAll('-', ' '))
  return value
}

async function main(argv) {
  if (!argv.includes('--dry-run')) {
    throw new Error('Capacity smoke accepts controlled fake work only; pass --dry-run')
  }
  const now = new Date()
  const defaultOutput = resolve(
    '.scratch',
    'studio-capacity',
    `capacity-${now.toISOString().replace(/[:.]/g, '-')}.json`,
  )
  const outputArgument = argv.find((value) => value.startsWith('--output='))
  const outputPath = outputArgument ? resolve(outputArgument.slice('--output='.length)) : defaultOutput
  const result = await runCapacitySmoke({
    outputPath,
    memoryCeilingBytes: parseByteOption(argv, 'memory-ceiling-bytes', 1024 * 1024 * 1024),
    diskCeilingBytes: parseByteOption(argv, 'disk-ceiling-bytes', 64 * 1024 * 1024),
    fakeArtifactBytes: parseByteOption(argv, 'fake-artifact-bytes', 256 * 1024),
    fakeBuildDelayMs: 20,
    now: () => now,
  })
  process.stdout.write(`Capacity evidence: ${result.outputPath}\n`)
  process.stdout.write(`Controlled fake publishes: ${result.report.requests.length}\n`)
  process.stdout.write(`Peak RSS bytes: ${result.report.peaks.rssBytes}\n`)
  process.stdout.write(`Peak temporary disk bytes: ${result.report.peaks.temporaryDiskBytes}\n`)
  if (!result.withinCeilings) {
    process.stderr.write(`${result.failures.join('\n')}\n`)
    process.exitCode = 1
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
