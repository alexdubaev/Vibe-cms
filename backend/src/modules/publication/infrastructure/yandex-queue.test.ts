import { describe, expect, test } from 'bun:test'

import { createYmqHttpMessageSender } from './yandex-queue'

describe('Yandex Message Queue sender', () => {
  test('sends an AWS SigV4 SendMessage request containing only the build command', async () => {
    let request: { url: string; init?: RequestInit } | undefined
    const sender = createYmqHttpMessageSender({
      region: 'ru-central1',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
      now: () => new Date('2026-08-24T10:00:00.000Z'),
      fetchImpl: async (input, init) => {
        new Headers(init?.headers)
        request = { url: String(input), init }
        return new Response('<SendMessageResponse/>', { status: 200 })
      },
    })

    await sender.sendMessage({
      queueUrl: 'https://message-queue.api.cloud.yandex.net/ru-central1/b1abc/queue1',
      messageBody: JSON.stringify({ buildId: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10' }),
    })

    expect(request?.url).toBe('https://message-queue.api.cloud.yandex.net/')
    expect(request?.init?.headers).toMatchObject({
      'content-type': 'application/x-www-form-urlencoded',
      'x-amz-date': '20260824T100000Z',
    })
    expect(String((request?.init?.headers as Record<string, string>).authorization)).toMatch(/^AWS4-HMAC-SHA256 Credential=access-key\//)
    expect(String(request?.init?.body)).toContain('Action=SendMessage')
    expect(String(request?.init?.body)).toContain('Version=2012-11-05')
    expect(String(request?.init?.body)).toContain('MessageBody=%7B%22buildId%22%3A%22018f8c8d-5f34-7db2-8b98-2c7bf3d80a10%22%7D')
    expect(String(request?.init?.body)).not.toContain('DATABASE_URL')
  })
})
