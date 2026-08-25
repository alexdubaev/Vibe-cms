import { describe, expect, test } from 'bun:test'

import {
  createYmqQueueConsumer,
  ymqQueueConsumerOptionsFromEnvironment,
} from '../src/queue-consumer'

const queueUrl = 'https://message-queue.example/customer/client-auto'
const endpoint = 'https://message-queue.example'
const buildId = '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10'

describe('private YMQ builder queue consumer', () => {
  test('receives one signed message, delivers the builder envelope, then deletes its receipt', async () => {
    const requests: Array<{ url: string; body: URLSearchParams; headers: Headers }> = []
    const delivered: unknown[] = []
    const consumer = createYmqQueueConsumer({
      queueUrl,
      endpoint,
      region: 'ru-central1',
      accessKeyId: 'consumer-access-key',
      secretAccessKey: 'consumer-secret-key',
      now: () => new Date('2026-08-25T10:00:00.000Z'),
      fetcher: async (input, init) => {
        const body = new URLSearchParams(String(init?.body))
        requests.push({ url: String(input), body, headers: new Headers(init?.headers) })
        if (body.get('Action') === 'ReceiveMessage') {
          return new Response(`
            <ReceiveMessageResponse>
              <ReceiveMessageResult>
                <Message>
                  <MessageId>message-1</MessageId>
                  <ReceiptHandle>receipt&#38;token</ReceiptHandle>
                  <Body>{&quot;buildId&quot;:&quot;${buildId}&quot;}</Body>
                </Message>
              </ReceiveMessageResult>
            </ReceiveMessageResponse>
          `)
        }
        return new Response('<DeleteMessageResponse/>')
      },
      processTrigger: async (input) => { delivered.push(input) },
    })

    expect(await consumer.pollOnce()).toBe('processed')
    expect(delivered).toEqual([{ messages: [{ body: JSON.stringify({ buildId }) }] }])
    expect(requests).toHaveLength(2)
    expect(requests[0].url).toBe(`${endpoint}/`)
    expect(Object.fromEntries(requests[0].body)).toEqual({
      Action: 'ReceiveMessage',
      Version: '2012-11-05',
      QueueUrl: queueUrl,
      MaxNumberOfMessages: '1',
      WaitTimeSeconds: '20',
      VisibilityTimeout: '900',
    })
    expect(requests[0].headers.get('authorization')).toMatch(
      /^AWS4-HMAC-SHA256 Credential=consumer-access-key\//,
    )
    expect(Object.fromEntries(requests[1].body)).toEqual({
      Action: 'DeleteMessage',
      Version: '2012-11-05',
      QueueUrl: queueUrl,
      ReceiptHandle: 'receipt&token',
    })
  })

  test('leaves a failed builder trigger on the queue for visibility-timeout retry', async () => {
    const actions: string[] = []
    const consumer = createYmqQueueConsumer({
      queueUrl,
      endpoint,
      region: 'ru-central1',
      accessKeyId: 'consumer-access-key',
      secretAccessKey: 'consumer-secret-key',
      fetcher: async (_input, init) => {
        actions.push(new URLSearchParams(String(init?.body)).get('Action') ?? '')
        return new Response(`
          <ReceiveMessageResponse><ReceiveMessageResult><Message>
            <ReceiptHandle>retry-receipt</ReceiptHandle>
            <Body>{&quot;buildId&quot;:&quot;${buildId}&quot;}</Body>
          </Message></ReceiveMessageResult></ReceiveMessageResponse>
        `)
      },
      processTrigger: async () => { throw new Error('build failed') },
    })

    await expect(consumer.pollOnce()).rejects.toThrow('build failed')
    expect(actions).toEqual(['ReceiveMessage'])
  })

  test('treats an empty long poll as idle without invoking the builder', async () => {
    let deliveries = 0
    const consumer = createYmqQueueConsumer({
      queueUrl,
      endpoint,
      region: 'ru-central1',
      accessKeyId: 'consumer-access-key',
      secretAccessKey: 'consumer-secret-key',
      fetcher: async () => new Response('<ReceiveMessageResponse><ReceiveMessageResult/></ReceiveMessageResponse>'),
      processTrigger: async () => { deliveries += 1 },
    })

    expect(await consumer.pollOnce()).toBe('empty')
    expect(deliveries).toBe(0)
  })

  test('runs one poll at a time and stops after cancellation', async () => {
    const cancellation = new AbortController()
    let polls = 0
    const consumer = createYmqQueueConsumer({
      queueUrl,
      endpoint,
      region: 'ru-central1',
      accessKeyId: 'consumer-access-key',
      secretAccessKey: 'consumer-secret-key',
      fetcher: async () => {
        polls += 1
        cancellation.abort()
        return new Response('<ReceiveMessageResponse><ReceiveMessageResult/></ReceiveMessageResponse>')
      },
      processTrigger: async () => {},
    })

    await consumer.run(cancellation.signal)
    expect(polls).toBe(1)
  })

  test('requires a complete consume-only credential group in studio production', () => {
    const source = {
      CMS_BUILDER_QUEUE_URL: queueUrl,
      CMS_BUILDER_YMQ_ENDPOINT: endpoint,
      CMS_BUILDER_YMQ_REGION: 'ru-central1',
      CMS_BUILDER_YMQ_CONSUMER_ACCESS_KEY_ID: 'consumer-access-key',
      CMS_BUILDER_YMQ_CONSUMER_SECRET_ACCESS_KEY: 'consumer-secret-key',
    }
    expect(ymqQueueConsumerOptionsFromEnvironment(source, true)).toEqual({
      queueUrl,
      endpoint,
      region: 'ru-central1',
      accessKeyId: 'consumer-access-key',
      secretAccessKey: 'consumer-secret-key',
    })
    expect(ymqQueueConsumerOptionsFromEnvironment({}, false)).toBeUndefined()
    expect(() => ymqQueueConsumerOptionsFromEnvironment({
      ...source,
      CMS_BUILDER_YMQ_CONSUMER_SECRET_ACCESS_KEY: '',
    }, true)).toThrow('CMS_BUILDER_YMQ_CONSUMER_SECRET_ACCESS_KEY')
  })
})
