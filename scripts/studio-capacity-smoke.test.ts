import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { runCapacitySmoke } from './studio-capacity-smoke.mjs'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })))
})

describe('studio capacity smoke', () => {
  test('records three controlled fake publishes without deriving a customer-count claim', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vibe-capacity-test-'))
    temporaryDirectories.push(directory)
    const outputPath = join(directory, 'capacity.json')

    const result = await runCapacitySmoke({
      outputPath,
      memoryCeilingBytes: 1024 * 1024 * 1024,
      diskCeilingBytes: 1024 * 1024,
      fakeArtifactBytes: 1024,
      fakeBuildDelayMs: 2,
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    })

    expect(result.withinCeilings).toBe(true)
    expect(result.report.mode).toBe('controlled-fake-publish')
    expect(result.report.requests).toHaveLength(3)
    expect(result.report.requests.map((request) => request.requestId)).toEqual([
      'fake-publish-1',
      'fake-publish-2',
      'fake-publish-3',
    ])
    for (const request of result.report.requests) {
      expect(request.peakRssBytes).toBeGreaterThan(0)
      expect(request.buildDurationMs).toBeGreaterThanOrEqual(0)
      expect(request.queueWaitMs).toBeGreaterThanOrEqual(0)
    }
    expect(result.report.requests.map((request) => request.temporaryDiskBytes)).toEqual([
      1024,
      2048,
      3072,
    ])
    expect(result.report.peaks.temporaryDiskBytes).toBe(3072)

    const serialized = await readFile(outputPath, 'utf8')
    expect(serialized).not.toContain('customerCount')
    expect(serialized).not.toContain('clientCount')
    expect(JSON.parse(serialized).requests).toHaveLength(3)
  })

  test('fails the ceiling against all three simultaneously retained artifacts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vibe-capacity-test-'))
    temporaryDirectories.push(directory)

    const result = await runCapacitySmoke({
      outputPath: join(directory, 'capacity.json'),
      memoryCeilingBytes: Number.MAX_SAFE_INTEGER,
      diskCeilingBytes: 1500,
      fakeArtifactBytes: 1024,
      fakeBuildDelayMs: 0,
    })

    expect(result.withinCeilings).toBe(false)
    expect(result.report.peaks.temporaryDiskBytes).toBe(3072)
    expect(result.failures).toEqual(['temporary disk 3072 bytes exceeded ceiling 1500 bytes'])
  })
})
