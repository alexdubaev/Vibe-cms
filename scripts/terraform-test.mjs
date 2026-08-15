#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const roots = [
  'infra/digitalocean/bootstrap',
  'infra/digitalocean/production',
  'infra/digitalocean/runtime',
  'infra/digitalocean/static',
  'infra/yandex/bootstrap',
  'infra/yandex/production',
  'infra/yandex/migration',
  'infra/yandex/runtime',
]

const testDirectory = mkdtempSync(
  resolve(tmpdir(), 'vibecoding-terraform-test-'),
)
const pluginCacheDirectory = resolve(testDirectory, 'plugin-cache')
mkdirSync(pluginCacheDirectory)

try {
  for (const [index, relativeRoot] of roots.entries()) {
    const dataDirectory = resolve(testDirectory, `root-${index}`)
    mkdirSync(dataDirectory)
    const environment = {
      ...process.env,
      CHECKPOINT_DISABLE: '1',
      TF_DATA_DIR: dataDirectory,
      TF_IN_AUTOMATION: '1',
      TF_INPUT: '0',
      TF_PLUGIN_CACHE_DIR: pluginCacheDirectory,
    }
    run(['init', '-backend=false', '-input=false'], relativeRoot, environment)
    run(['validate'], relativeRoot, environment)
    run(['test'], relativeRoot, environment)
  }
} finally {
  rmSync(testDirectory, { recursive: true, force: true })
}

function run(args, relativeRoot, env) {
  console.log(`[terraform-test] ${relativeRoot}: terraform ${args.join(' ')}`)
  const result = spawnSync('terraform', args, {
    cwd: resolve(repoRoot, relativeRoot),
    env,
    stdio: 'inherit',
  })
  if (result.error?.code === 'ENOENT') {
    throw new Error('terraform is not installed or is not available on PATH')
  }
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${relativeRoot}: terraform ${args[0]} failed with status ${result.status ?? 1}`,
    )
  }
}
