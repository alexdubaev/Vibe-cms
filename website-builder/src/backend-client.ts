import { createHash, createHmac, randomBytes } from 'node:crypto'
import { publicationBuildInputSchema, type PublicationBuildInput } from '@web-app-demo/contracts'

export type BuildInput = PublicationBuildInput
export type BuildResult = { status: 'succeeded' | 'failed'; markerVerified: boolean; diagnostics?: string }

export class BuilderBackendError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'BuilderBackendError'
  }
}

export type BuilderBackendClient = {
  getBuildInput(buildId: string): Promise<BuildInput>
  heartbeat(buildId: string): Promise<void>
  result(buildId: string, input: BuildResult): Promise<void>
}

export type FetchLike = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>

export function createBuilderBackendClient(options: {
  baseUrl: string
  hmacSecret: string
  fetchImpl?: FetchLike
  now?: () => Date
  nonce?: () => string
}): BuilderBackendClient {
  const baseUrl = options.baseUrl.replace(/\/$/, '')
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? (() => new Date())
  const nonce = options.nonce ?? (() => randomBytes(18).toString('base64url'))

  return {
    getBuildInput: async (buildId) => request(`/builds/${buildId}/input`, buildId).then((value) => publicationBuildInputSchema.parse(value)),
    heartbeat: async (buildId) => { await request(`/builds/${buildId}/heartbeat`, buildId) },
    result: async (buildId, input) => { await request(`/builds/${buildId}/result`, buildId, input) },
  }

  async function request(path: string, buildId: string, body: unknown = {}) {
    const rawBody = JSON.stringify(body)
    const timestamp = Math.floor(now().getTime() / 1_000)
    const request = {
      method: 'POST',
      path,
      timestamp,
      nonce: nonce(),
      buildId,
      body: rawBody,
    }
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cms-builder-timestamp': String(timestamp),
        'x-cms-builder-nonce': request.nonce,
        'x-cms-builder-signature': signRequest(options.hmacSecret, request),
      },
      body: rawBody,
    })
    if (!response.ok) {
      const message = (await response.text()).slice(0, 500)
      throw new BuilderBackendError(response.status, message || `Builder backend returned ${response.status}`)
    }
    return response.status === 204 ? null : response.json()
  }
}

function signRequest(secret: string, request: { method: string; path: string; timestamp: number; nonce: string; buildId: string; body: string }) {
  const canonical = [
    request.method.toUpperCase(),
    request.path,
    String(request.timestamp),
    request.nonce,
    createHash('sha256').update(request.body).digest('hex'),
    request.buildId,
  ].join('\n')
  return createHmac('sha256', secret).update(canonical).digest('hex')
}
