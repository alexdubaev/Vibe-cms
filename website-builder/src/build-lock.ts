import { isAbsolute } from 'node:path'

import { BuildProcessExitError, type BuildProcessRunner } from './build-site'

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
