import { createHash, createHmac } from 'node:crypto'

import type { YmqMessageSender } from '../application/queue-dispatcher'

/**
 * Yandex Message Queue exposes the AWS Query/SQS protocol. Keeping the small signer here avoids
 * bringing an SQS client into the API image while still producing a normal authenticated
 * `SendMessage` request. The application layer only sees `YmqMessageSender`.
 */
export function createYmqHttpMessageSender(options: {
  endpoint?: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  fetchImpl?: (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>
  now?: () => Date
}): YmqMessageSender {
  const endpoint = new URL(options.endpoint ?? 'https://message-queue.api.cloud.yandex.net')
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? (() => new Date())

  return {
    async sendMessage(input) {
      const queue = new URL(input.queueUrl)
      if (queue.protocol !== 'https:') throw new Error('YMQ queue URL must use HTTPS')
      const target = new URL(queue.pathname + queue.search, endpoint)
      const body = new URLSearchParams({
        Action: 'SendMessage',
        MessageBody: input.messageBody,
        QueueUrl: input.queueUrl,
      }).toString()
      const timestamp = awsTimestamp(now())
      const date = timestamp.slice(0, 8)
      const headers = {
        'content-type': 'application/x-www-form-urlencoded',
        host: target.host,
        'x-amz-date': timestamp,
      }
      const signature = signV4({
        method: 'POST',
        path: target.pathname || '/',
        body,
        headers,
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        region: options.region,
        date,
        timestamp,
      })
      const response = await fetchImpl(target, {
        method: 'POST',
        headers: { ...headers, authorization: signature },
        body,
      })
      if (!response.ok) throw new Error(`YMQ SendMessage failed with HTTP ${response.status}`)
    },
  }
}

function signV4(input: {
  method: string
  path: string
  body: string
  headers: Record<string, string>
  accessKeyId: string
  secretAccessKey: string
  region: string
  date: string
  timestamp: string
}) {
  const service = 'sqs'
  const signedHeaders = 'content-type;host;x-amz-date'
  const canonicalHeaders = `content-type:${input.headers['content-type']}\nhost:${input.headers.host}\nx-amz-date:${input.headers['x-amz-date']}\n`
  const canonicalRequest = [
    input.method,
    input.path,
    '',
    canonicalHeaders,
    signedHeaders,
    sha256(input.body),
  ].join('\n')
  const scope = `${input.date}/${input.region}/${service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', input.timestamp, scope, sha256(canonicalRequest)].join('\n')
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, input.date), input.region), service),
    'aws4_request',
  )
  const signature = hmac(signingKey, stringToSign)
  return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

function awsTimestamp(value: Date) {
  return value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key: string | Uint8Array, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest()
}
