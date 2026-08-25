import { isAbsolute } from 'node:path'

import { BuildProcessExitError, type BuildProcessRunner } from './build-site'

export type BuilderRuntimeMode = 'local' | 'serverless' | 'studio-production'

export function createBuildProcessRunnerFromEnvironment(
  environment: Record<string, string | undefined>,
  run: BuildProcessRunner,
): BuildProcessRunner {
  const configuredMode = environment.CMS_BUILDER_RUNTIME_MODE?.trim() || 'local'
  if (!isBuilderRuntimeMode(configuredMode)) {
    throw new Error('CMS_BUILDER_RUNTIME_MODE must be local, serverless, or studio-production')
  }
  if (configuredMode !== 'studio-production') return run

  const lockFile = environment.CMS_ASTRO_BUILD_LOCK_FILE?.trim()
  if (!lockFile) {
    throw new Error(
      'CMS_ASTRO_BUILD_LOCK_FILE is required when CMS_BUILDER_RUNTIME_MODE=studio-production',
    )
  }
  return createFlockBuildProcessRunner({ lockFile, waitSeconds: 600, run })
}

export function createFlockBuildProcessRunner(options: {
  lockFile: string
  waitSeconds: number
  run: BuildProcessRunner
}): BuildProcessRunner {
  if (!isAbsolute(options.lockFile)) {
    throw new Error('Astro build lock file must be an absolute path')
  }
  if (!Number.isFinite(options.waitSeconds) || options.waitSeconds <= 0) {
    throw new Error('Astro build lock wait must be a positive finite number of seconds')
  }

  return async (input) => {
    try {
      await options.run({
        command: 'flock',
        args: [
          '--wait',
          String(options.waitSeconds),
          options.lockFile,
          input.command,
          ...input.args,
        ],
        cwd: input.cwd,
        env: input.env,
      })
    } catch (error) {
      if (
        error instanceof BuildProcessExitError
        && error.command === 'flock'
        && error.exitCode === 1
        && error.diagnostics.trim() === ''
      ) {
        throw new Error(`Astro build lock timed out after ${options.waitSeconds} seconds`)
      }
      throw error
    }
  }
}

function isBuilderRuntimeMode(value: string): value is BuilderRuntimeMode {
  return value === 'local' || value === 'serverless' || value === 'studio-production'
}
