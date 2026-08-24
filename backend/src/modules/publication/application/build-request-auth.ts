import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export type BuilderRequest = {
  method: string
  /** The exact path and query string covered by the signature. */
  path: string
  /** Unix timestamp in seconds. */
  timestamp: number
  nonce: string
  buildId: string
  body: string | Uint8Array
}

export type BuilderNonceStore = {
  /** Returns false when this nonce/build pair was already consumed. */
  reserve(input: { nonce: string; buildId: string; keyVersion: string; expiresAt: Date }): Promise<boolean>
}

export type BuilderRequestKeyVersion = 'active' | 'previous'

export type BuilderRequestVerifier = {
  verify(request: BuilderRequest, signature: string): Promise<{ keyVersion: BuilderRequestKeyVersion }>
}

export class BuilderRequestAuthError extends Error {
  constructor(
    readonly code: 'request' | 'timestamp' | 'signature' | 'replay',
    message: string,
  ) {
    super(message)
    this.name = 'BuilderRequestAuthError'
  }
}

export function signBuilderRequest(secret: string, request: BuilderRequest): string {
  return createHmac('sha256', secret).update(canonicalRequest(request)).digest('hex')
}

export function createBuilderRequestVerifier(options: {
  activeSecret: string
  previousSecret?: string
  nonceStore: BuilderNonceStore
  now?: () => Date
  windowSeconds?: number
}) {
  const now = options.now ?? (() => new Date())
  const windowSeconds = options.windowSeconds ?? 300

  const verifier: BuilderRequestVerifier = {
    async verify(request: BuilderRequest, signature: string): Promise<{ keyVersion: BuilderRequestKeyVersion }> {
      validateRequest(request)
      if (!Number.isSafeInteger(request.timestamp)) {
        throw new BuilderRequestAuthError('timestamp', 'Builder request timestamp is invalid')
      }

      const current = now()
      const ageSeconds = Math.abs(Math.floor(current.getTime() / 1_000) - request.timestamp)
      if (ageSeconds > windowSeconds) {
        throw new BuilderRequestAuthError('timestamp', 'Builder request timestamp is outside the allowed window')
      }

      const supplied = normaliseSignature(signature)
      if (!supplied) throw new BuilderRequestAuthError('signature', 'Builder request signature is invalid')

      const candidates: Array<{ keyVersion: BuilderRequestKeyVersion; secret: string }> = [
        { keyVersion: 'active', secret: options.activeSecret },
        ...(options.previousSecret ? [{ keyVersion: 'previous' as const, secret: options.previousSecret }] : []),
      ]
      const matched = candidates.find(({ secret }) => constantTimeHexEqual(supplied, signBuilderRequest(secret, request)))
      if (!matched) throw new BuilderRequestAuthError('signature', 'Builder request signature is invalid')

      const reserved = await options.nonceStore.reserve({
        nonce: request.nonce,
        buildId: request.buildId,
        keyVersion: matched.keyVersion,
        expiresAt: new Date(current.getTime() + windowSeconds * 1_000),
      })
      if (!reserved) throw new BuilderRequestAuthError('replay', 'Builder request nonce was already used')

      return { keyVersion: matched.keyVersion }
    },
  }
  return verifier
}

function canonicalRequest(request: BuilderRequest): string {
  return [
    request.method.trim().toUpperCase(),
    request.path,
    String(request.timestamp),
    request.nonce,
    createHash('sha256').update(request.body).digest('hex'),
    request.buildId,
  ].join('\n')
}

function validateRequest(request: BuilderRequest) {
  if (
    !request ||
    typeof request.method !== 'string' ||
    !/^[A-Za-z]+$/.test(request.method) ||
    typeof request.path !== 'string' ||
    !request.path.startsWith('/') ||
    /[\u0000-\u001f\u007f\r\n]/.test(request.path) ||
    typeof request.nonce !== 'string' ||
    request.nonce.length < 16 ||
    request.nonce.length > 200 ||
    /[\u0000-\u001f\u007f\r\n]/.test(request.nonce) ||
    typeof request.buildId !== 'string' ||
    request.buildId.length < 1 ||
    request.buildId.length > 200 ||
    typeof request.body !== 'string' && !(request.body instanceof Uint8Array)
  ) {
    throw new BuilderRequestAuthError('request', 'Builder request claims are invalid')
  }
}

function normaliseSignature(signature: string): string | null {
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return null
  return signature.toLowerCase()
}

function constantTimeHexEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'hex')
  const rightBytes = Buffer.from(right, 'hex')
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}
