import { describe, expect, test } from 'bun:test'

import { createYmqPublicationDispatcher } from './queue-dispatcher'

describe('publication queue dispatcher', () => {
  test('sends only the build id as the queue message', async () => {
    const messages: unknown[] = []
    const dispatcher = createYmqPublicationDispatcher({
      queueUrl: 'https://message-queue.internal/cms-builds',
      sendMessage: async (message) => { messages.push(message) },
    })

    await dispatcher.dispatch({ buildId: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10' })

    expect(messages).toEqual([{
      queueUrl: 'https://message-queue.internal/cms-builds',
      messageBody: '{"buildId":"018f8c8d-5f34-7db2-8b98-2c7bf3d80a10"}',
    }])
  })

  test('does not accept an empty build id', async () => {
    const dispatcher = createYmqPublicationDispatcher({
      queueUrl: 'https://message-queue.internal/cms-builds',
      sendMessage: async () => undefined,
    })

    await expect(dispatcher.dispatch({ buildId: '' })).rejects.toThrow('build id')
  })
})
