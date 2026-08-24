export type PublicationSlot = 'blue' | 'green'
export type PublicationControllerStatus = 'queued' | 'building' | 'published' | 'failed'
export type PublicationBuildState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export type PublicationControllerRecord = {
  key: string
  desiredRevision: number | null
  publishedRevision: number | null
  activeBuildId: string | null
  activeSlot: PublicationSlot
  status: PublicationControllerStatus
  heartbeatAt: Date | null
  updatedAt: Date
  lastError: string | null
}

export type PublicationBuildRecord = {
  id: string
  publicationRevision: number
  slot: PublicationSlot
  state: PublicationBuildState
}

export type PublicationRepository = {
  /** Reads the singleton controller. A missing row means that no publication is queued yet. */
  getController(): Promise<PublicationControllerRecord | null>
  /** Atomically claims the controller and creates one queued build, or returns null on a race. */
  claimBuild(input: {
    publicationRevision: number
    slot: PublicationSlot
    now: Date
  }): Promise<PublicationBuildRecord | null>
  /** Clears a build that could not be handed to the queue, keeping it retryable by reconcile. */
  markDispatchFailed(buildId: string, message: string): Promise<void>
  /** Marks an abandoned build failed and clears the controller's active build. */
  markStale(buildId: string, message: string): Promise<void>
}

export type PublicationCallbackRepository = PublicationRepository & {
  /** Returns the build envelope used by a builder to load its immutable input artifact. */
  getBuildForInput(buildId: string): Promise<{
    id: string
    publicationRevision: number
    slot: PublicationSlot
    state: PublicationBuildState
  } | null>
  heartbeat(buildId: string, heartbeatAt: Date): Promise<boolean>
  recordResult(input: {
    buildId: string
    status: 'succeeded' | 'failed'
    markerVerified: boolean
    diagnostics?: string
    now: Date
  }): Promise<'accepted' | 'stale'>
}

export type PublicationDispatcher = {
  /** The queue message is intentionally tiny; the builder loads the immutable snapshot later. */
  dispatch(input: { buildId: string }): Promise<void>
}

export type PublicationArtifactPreparer = {
  ensureArtifact(revision: number): Promise<unknown>
}

export type ReconcileResult =
  | { kind: 'idle' }
  | { kind: 'active'; buildId: string }
  | { kind: 'race-lost' }
  | { kind: 'dispatched'; buildId: string; revision: number; slot: PublicationSlot }
  | { kind: 'dispatch-failed'; buildId: string; revision: number }

const DEFAULT_STALE_AFTER_MS = 120_000

export class PublicationRebuildController {
  constructor(
    private readonly repository: PublicationRepository,
    private readonly dispatcher: PublicationDispatcher,
    private readonly clock: { now(): Date } = { now: () => new Date() },
    private readonly staleAfterMs = DEFAULT_STALE_AFTER_MS,
    private readonly artifact?: PublicationArtifactPreparer,
  ) {}

  async reconcile(): Promise<ReconcileResult> {
    const controller = await this.repository.getController()
    if (!controller?.desiredRevision || controller.desiredRevision <= (controller.publishedRevision ?? 0)) {
      return { kind: 'idle' }
    }

    if (controller.activeBuildId) {
      const heartbeat = controller.heartbeatAt ?? controller.updatedAt
      if (this.clock.now().getTime() - heartbeat.getTime() < this.staleAfterMs) {
        return { kind: 'active', buildId: controller.activeBuildId }
      }

      await this.repository.markStale(controller.activeBuildId, 'Builder heartbeat expired')
    }

    const revision = controller.desiredRevision
    const slot = inactiveSlot(controller.activeSlot)
    const build = await this.repository.claimBuild({
      publicationRevision: revision,
      slot,
      now: this.clock.now(),
    })
    if (!build) return { kind: 'race-lost' }

    try {
      if (this.artifact) await this.artifact.ensureArtifact(revision)
      await this.dispatcher.dispatch({ buildId: build.id })
    } catch (error) {
      await this.repository.markDispatchFailed(build.id, safeErrorMessage(error))
      return { kind: 'dispatch-failed', buildId: build.id, revision, }
    }

    return { kind: 'dispatched', buildId: build.id, revision, slot }
  }
}

function inactiveSlot(activeSlot: PublicationSlot): PublicationSlot {
  return activeSlot === 'blue' ? 'green' : 'blue'
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Publication queue dispatch failed'
  return message.trim().slice(0, 500) || 'Publication queue dispatch failed'
}
