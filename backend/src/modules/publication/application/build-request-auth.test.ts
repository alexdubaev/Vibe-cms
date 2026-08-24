import { describe, expect, test } from 'bun:test'

import {
  BuilderRequestAuthError,
  createBuilderRequestVerifier,
  signBuilderRequest,
  type BuilderRequest,
  type BuilderNonceStore,
} from './build-request-auth'

const request: BuilderRequest = {
  method: 'POST',
  path: '/api/internal/cms/builds/build-1/result',
  timestamp: 1_724_488_800,
  nonce: 'nonce-0000000001',
  buildId: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10',
  body: '{"status":"succeeded"}',
}

class MemoryNonceStore implements BuilderNonceStore {
  private readonly nonces = new Set<string>()

  async reserve(input: { nonce: string; buildId: string; keyVersion: string; expiresAt: Date }) {
    const key = `${input.keyVersion}:${input.nonce}:${input.buildId}`
    if (this.nonces.has(key)) return false
    this.nonces.add(key)
    return true
  }
}

describe('builder request authentication', () => {
  test('signs and verifies the canonical request with the active secret', async () => {
    const verifier = createBuilderRequestVerifier({
      activeSecret: 'active-secret',
      nonceStore: new MemoryNonceStore(),
      now: () => new Date(request.timestamp * 1_000),
    })

    const signature = signBuilderRequest('active-secret', request)

    await expect(verifier.verify(request, signature)).resolves.toEqual({ keyVersion: 'active' })
  })

  test('rejects a changed claim, malformed signature, and replayed nonce', async () => {
    const verifier = createBuilderRequestVerifier({
      activeSecret: 'active-secret',
      nonceStore: new MemoryNonceStore(),
      now: () => new Date(request.timestamp * 1_000),
    })
    const signature = signBuilderRequest('active-secret', request)

    await expect(verifier.verify({ ...request, path: '/different' }, signature)).rejects.toBeInstanceOf(BuilderRequestAuthError)
    await expect(verifier.verify(request, 'not-a-hex-signature')).rejects.toMatchObject({ code: 'signature' })
    await expect(verifier.verify(request, signature)).resolves.toEqual({ keyVersion: 'active' })
    await expect(verifier.verify(request, signature)).rejects.toMatchObject({ code: 'replay' })
  })

  test('accepts the previous secret only inside the clock window', async () => {
    const verifier = createBuilderRequestVerifier({
      activeSecret: 'active-secret',
      previousSecret: 'previous-secret',
      nonceStore: new MemoryNonceStore(),
      now: () => new Date(request.timestamp * 1_000 + 299_000),
    })

    await expect(verifier.verify(request, signBuilderRequest('previous-secret', request))).resolves.toEqual({ keyVersion: 'previous' })
    await expect(verifier.verify({ ...request, nonce: 'nonce-0000000002', timestamp: request.timestamp - 301 }, signBuilderRequest('active-secret', { ...request, nonce: 'nonce-0000000002', timestamp: request.timestamp - 301 }))).rejects.toMatchObject({ code: 'timestamp' })
  })
})
