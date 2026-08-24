import type { PublicationDispatcher } from './rebuild-controller'

export type YmqMessageSender = {
  sendMessage(input: { queueUrl: string; messageBody: string }): Promise<void>
}

/**
 * Provider-neutral YMQ adapter boundary. The backend never sends a snapshot through the queue;
 * the builder receives only the durable build id and loads the immutable artifact afterwards.
 */
export function createYmqPublicationDispatcher(options: {
  queueUrl: string
  sendMessage: YmqMessageSender['sendMessage']
}): PublicationDispatcher {
  return {
    async dispatch({ buildId }) {
      if (typeof buildId !== 'string' || buildId.trim().length === 0) {
        throw new Error('Publication queue dispatch requires a build id')
      }
      await options.sendMessage({
        queueUrl: options.queueUrl,
        messageBody: JSON.stringify({ buildId }),
      })
    },
  }
}
