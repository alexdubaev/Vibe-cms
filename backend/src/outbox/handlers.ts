import { TerminalTaskError } from './errors'
import type { TaskHandlerEntry } from './types'

export type TaskHandlerRegistry = Record<string, TaskHandlerEntry>

/**
 * Every kind of durable one-off work this backend knows how to do.
 *
 * Not a second job registry. `jobs.ts` answers "what recurring work exists"; this answers "what
 * kinds of queued work exist". A task type is never scheduled - one job, `outbox:drain`, runs
 * every type.
 *
 * **Do not statically import `../modules/*` or `../generated/*` here.** The API process imports
 * this registry to validate a task type at enqueue time, and a top-level module import would
 * drag that module's SDKs into every process that can enqueue. Handlers reach their module with
 * `await import()` inside `run`, which also keeps a module out of the runs that do not use it.
 */
export const taskHandlers = {
  /**
   * The account-dependent half of a password reset: look the address up, mint a token, send it.
   *
   * Five attempts, because the first retry has to clear the 60-second per-account cooldown and
   * still leave room for a provider outage to pass.
   */
  'auth:password-reset': {
    maxAttempts: 5,
    run: async ({ finalAttempt, now, payload, signal }, runtime) => {
      // Validate before building anything: a payload that will never work should fail on its own
      // terms, not from somewhere deep inside a module it had no business constructing.
      const input = emailPayload(payload)
      const { createAuthTasks } = await import('../modules/auth')

      return createAuthTasks(runtime).deliverPasswordReset(input, { finalAttempt, now, signal })
    },
  },
  /** Tells someone their password changed. Nothing to compensate for if it never arrives. */
  'auth:password-changed': {
    maxAttempts: 3,
    run: async ({ payload, signal }, runtime) => {
      const input = emailPayload(payload)
      const { createAuthTasks } = await import('../modules/auth')
      await createAuthTasks(runtime).deliverPasswordChanged(input, signal)
    },
  },
  'media:delete-object': {
    maxAttempts: 5,
    run: async ({ payload }, runtime) => {
      const input = mediaDeletePayload(payload)
      await runtime.privateStorage.storage.deleteObject(input.objectKey)
      await runtime.prisma.cmsMediaAsset.deleteMany({ where: { id: input.assetId, state: 'deleting' } })
    },
  },
  /**
   * A publication only wakes the durable controller. This attempt never waits for the builder;
   * it claims at most one build, prepares its immutable input, and sends a tiny queue command.
   * The recurring reconcile job retries the same state machine after a lost wake-up or provider
   * outage.
   */
  'website:rebuild:wakeup': {
    maxAttempts: 3,
    deadlineMs: 15_000,
    run: async ({ payload }, runtime) => {
      publicationWakeupPayload(payload)
      if (!runtime.publicationRebuild) {
        throw new Error('Publication rebuild controller is not configured')
      }
      const result = await runtime.publicationRebuild.reconcile()
      if (result.kind === 'dispatch-failed') {
        throw new Error('Publication rebuild dispatch failed; reconciliation will retry')
      }
    },
  },
} satisfies TaskHandlerRegistry

/**
 * A payload is whatever JSON the enqueuing code wrote, so every handler validates its own. A
 * payload that will never be valid is terminal: retrying it four more times changes nothing.
 */
function emailPayload(payload: unknown): { email: string } {
  const email = (payload as { email?: unknown })?.email

  if (typeof email !== 'string' || email.length === 0) {
    throw new TerminalTaskError('Task payload is missing a usable email address')
  }

  return { email }
}

function mediaDeletePayload(payload: unknown): { assetId: string; objectKey: string } {
  const value = payload as { assetId?: unknown; objectKey?: unknown }
  if (typeof value?.assetId !== 'string' || typeof value.objectKey !== 'string') {
    throw new TerminalTaskError('Media deletion payload is missing an asset id or object key')
  }
  return { assetId: value.assetId, objectKey: value.objectKey }
}

function publicationWakeupPayload(payload: unknown): { revision: number } {
  const revision = (payload as { revision?: unknown })?.revision
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) {
    throw new TerminalTaskError('Publication wake-up payload is missing a valid revision')
  }
  return { revision }
}

export function taskTypeNames(registry: TaskHandlerRegistry = taskHandlers): string[] {
  return Object.keys(registry)
}

export function isTaskType(value: string, registry: TaskHandlerRegistry = taskHandlers) {
  // `value in registry` would also accept 'constructor', 'toString' and the rest of
  // Object.prototype. Enqueueing one of those would write a row no handler can ever run.
  return Object.hasOwn(registry, value)
}

export function requireTaskHandler(
  value: string,
  registry: TaskHandlerRegistry = taskHandlers,
): TaskHandlerEntry {
  if (!isTaskType(value, registry)) {
    throw new Error(
      `Unknown task type "${value}". Available types: ${taskTypeNames(registry).join(', ') || 'none'}`,
    )
  }

  return registry[value] as TaskHandlerEntry
}
