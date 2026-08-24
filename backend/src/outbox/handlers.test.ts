import { describe, expect, test } from 'bun:test'

import { TerminalTaskError } from './errors'
import { isTaskType, requireTaskHandler, taskHandlers, taskTypeNames } from './handlers'
import type { TaskHandlerRegistry } from './handlers'

const registry = { 'test:work': { run: async () => undefined } } satisfies TaskHandlerRegistry

describe('the task type registry', () => {
  test('rejects Object.prototype keys instead of queueing a row nothing can run', () => {
    // `'constructor' in registry` is true. Enqueueing it would write a row that every drain
    // skips forever while the caller believes the work was accepted.
    for (const inherited of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(isTaskType(inherited, registry)).toBe(false)
      expect(() => requireTaskHandler(inherited, registry)).toThrow(`Unknown task type "${inherited}"`)
    }
  })

  test('an unknown type fails at the call site, naming the ones that exist', () => {
    expect(() => requireTaskHandler('test:typo', registry)).toThrow(
      'Unknown task type "test:typo". Available types: test:work',
    )
  })

  test('a registered type resolves to its entry', () => {
    expect(isTaskType('test:work', registry)).toBe(true)
    expect(requireTaskHandler('test:work', registry)).toBe(registry['test:work'])
  })

  test('an empty registry says so rather than printing a bare list', () => {
    expect(() => requireTaskHandler('anything', {})).toThrow('Available types: none')
  })
})

describe('a task payload that cannot be used', () => {
  test('is terminal, because retrying it four more times changes nothing', async () => {
    const runtime = {} as never

    for (const payload of [{}, { email: '' }, { email: 42 }, null, 'not an object']) {
      await expect(
        taskHandlers['auth:password-reset']!.run(
          { attempt: 1, finalAttempt: false, now: new Date(), payload, signal: new AbortController().signal },
          runtime,
        ),
      ).rejects.toThrow(TerminalTaskError)
    }
  })
})

describe('publication wake-up task', () => {
  test('runs one short reconcile pass and does not wait for the builder', async () => {
    let calls = 0
    await taskHandlers['website:rebuild:wakeup']!.run(
      { attempt: 1, finalAttempt: false, now: new Date(), payload: { revision: 4 }, signal: new AbortController().signal },
      { publicationRebuild: { reconcile: async () => { calls += 1; return { kind: 'dispatched' } } } } as never,
    )
    expect(calls).toBe(1)
  })

  test('rejects a malformed wake-up permanently and retries provider failures', async () => {
    await expect(taskHandlers['website:rebuild:wakeup']!.run(
      { attempt: 1, finalAttempt: false, now: new Date(), payload: {}, signal: new AbortController().signal },
      {} as never,
    )).rejects.toThrow(TerminalTaskError)
    await expect(taskHandlers['website:rebuild:wakeup']!.run(
      { attempt: 1, finalAttempt: false, now: new Date(), payload: { revision: 4 }, signal: new AbortController().signal },
      {} as never,
    )).rejects.toThrow('not configured')
  })
})
