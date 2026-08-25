import { describe, expect, test } from 'bun:test'

import { assertBackendStartupFailedClosed } from './docker-smoke-site-package-config'

describe('selected Site Package Docker smoke', () => {
  test('accepts the backend refusing to serve before its startup database gate succeeds', () => {
    expect(() => assertBackendStartupFailedClosed(
      { Running: false, ExitCode: 1 },
      'PrismaClientKnownRequestError: P1001: Can\'t reach database server',
    )).not.toThrow()
  })

  test('rejects a backend that serves or exits successfully without passing its startup database gate', () => {
    expect(() => assertBackendStartupFailedClosed({ Running: true, ExitCode: 0 }, '')).toThrow('still running')
    expect(() => assertBackendStartupFailedClosed({ Running: false, ExitCode: 0 }, '')).toThrow('exit successfully')
    expect(() => assertBackendStartupFailedClosed({ Running: false, ExitCode: 1 }, 'bad config')).toThrow(
      'database startup gate',
    )
  })
})
