import { capabilitiesForRole, type PreviewGrantResponse, type PreviewSessionResponse } from '@web-app-demo/contracts'

import type { CmsActor } from './cms-service'
import { CmsRepositoryError } from '../domain/errors'

export type PreviewGrantRecord = {
  id: string
  actorUserId: string
  pageId: string
  expiresAt: Date
}

export type PreviewStore = {
  createGrant(input: { codeHash: string; actorUserId: string; pageId: string; expiresAt: Date }): Promise<PreviewGrantRecord>
  consumeGrant(input: { codeHash: string; now: Date }): Promise<PreviewGrantRecord | null>
  createSession(input: { tokenHash: string; actorUserId: string; pageId: string; expiresAt: Date }): Promise<void>
}

type PreviewDependencies = {
  store: PreviewStore
  origin: string
  clock?: { now(): Date }
  randomToken?: () => string
  hashToken?: (token: string) => string
  ttlSeconds?: number
}

export class CmsPreviewService {
  private readonly clock: { now(): Date }
  private readonly randomToken: () => string
  private readonly hashToken: (token: string) => string
  private readonly ttlSeconds: number
  private readonly sessionTtlSeconds: number

  constructor(private readonly dependencies: PreviewDependencies) {
    this.clock = dependencies.clock ?? { now: () => new Date() }
    this.randomToken = dependencies.randomToken ?? (() => crypto.randomUUID() + crypto.randomUUID())
    this.hashToken = dependencies.hashToken ?? ((token) => token)
    this.ttlSeconds = dependencies.ttlSeconds ?? 60
    this.sessionTtlSeconds = 15 * 60
  }

  async issueGrant(actor: CmsActor, pageId: string): Promise<PreviewGrantResponse> {
    if (!capabilitiesForRole(actor.role, { editorCanPublish: false }).includes('cms:read')) {
      throw new CmsRepositoryError('You do not have permission to access this resource', 'FORBIDDEN')
    }
    const token = this.randomToken()
    const expiresAt = new Date(this.clock.now().getTime() + this.ttlSeconds * 1000)
    await this.dependencies.store.createGrant({
      codeHash: this.hashToken(token),
      actorUserId: actor.id,
      pageId,
      expiresAt,
    })
    const previewUrl = new URL(`/__preview/${encodeURIComponent(pageId)}`, this.dependencies.origin)
    previewUrl.searchParams.set('token', token)
    return { token, expiresAt: expiresAt.toISOString(), previewUrl: previewUrl.toString() }
  }

  async consumeGrant(token: string): Promise<PreviewGrantRecord> {
    const grant = await this.dependencies.store.consumeGrant({
      codeHash: this.hashToken(token),
      now: this.clock.now(),
    })
    if (!grant) throw new CmsRepositoryError('Preview grant is invalid or expired', 'CMS_PREVIEW_INVALID')
    return grant
  }

  async exchangeGrant(token: string): Promise<PreviewSessionResponse> {
    const grant = await this.consumeGrant(token)
    const sessionToken = this.randomToken()
    const expiresAt = new Date(this.clock.now().getTime() + this.sessionTtlSeconds * 1000)
    await this.dependencies.store.createSession({
      tokenHash: this.hashToken(sessionToken),
      actorUserId: grant.actorUserId,
      pageId: grant.pageId,
      expiresAt,
    })
    return { sessionToken, expiresAt: expiresAt.toISOString() }
  }
}
