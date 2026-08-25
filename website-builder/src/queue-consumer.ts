import { createHash, createHmac } from 'node:crypto'

type FetchLike = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>

export type YmqQueueConsumerEnvironment = Record<string, string | undefined>

export type YmqQueueConsumerOptions = {
  queueUrl: string
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  processTrigger: (input: unknown) => Promise<void>
  fetcher?: FetchLike
  now?: () => Date
  onPollError?: (error: unknown) => void
}

export type YmqQueueConsumer = {
  pollOnce(): Promise<'empty' | 'processed'>
  run(signal?: AbortSignal): Promise<void>
}

const environmentNames = [
  'CMS_BUILDER_QUEUE_URL',
  'CMS_BUILDER_YMQ_ENDPOINT',
  'CMS_BUILDER_YMQ_REGION',
  'CMS_BUILDER_YMQ_CONSUMER_ACCESS_KEY_ID',
  'CMS_BUILDER_YMQ_CONSUMER_SECRET_ACCESS_KEY',
] as const

const queryApiVersion = '2012-11-05'
const receiveWaitSeconds = 20
const visibilityTimeoutSeconds = 900
const maximumResponseCharacters = 256 * 1024

export function ymqQueueConsumerOptionsFromEnvironment(
  environment: YmqQueueConsumerEnvironment,
  required: boolean,
): Omit<YmqQueueConsumerOptions, 'processTrigger'> | undefined {
  const values = Object.fromEntries(
    environmentNames.map((name) => [name, environment[name]?.trim() ?? '']),
  ) as Record<typeof environmentNames[number], string>
  const configured = environmentNames.some((name) => values[name] !== '')
  if (!configured && !required) return undefined
  const missing = environmentNames.filter((name) => !values[name])
  if (missing.length > 0) {
    throw new Error(`Required website builder queue environment is missing: ${missing.join(', ')}`)
  }
  return {
    queueUrl: values.CMS_BUILDER_QUEUE_URL,
    endpoint: values.CMS_BUILDER_YMQ_ENDPOINT,
    region: values.CMS_BUILDER_YMQ_REGION,
    accessKeyId: values.CMS_BUILDER_YMQ_CONSUMER_ACCESS_KEY_ID,
    secretAccessKey: values.CMS_BUILDER_YMQ_CONSUMER_SECRET_ACCESS_KEY,
  }
}

export function createYmqQueueConsumer(options: YmqQueueConsumerOptions): YmqQueueConsumer {
  const endpoint = parseHttpsOrigin(options.endpoint, 'YMQ consumer endpoint')
  const queueUrl = parseHttpsUrl(options.queueUrl, 'YMQ consumer queue URL').toString()
  if (!options.region.trim()) throw new Error('YMQ consumer region is required')
  if (!options.accessKeyId.trim()) throw new Error('YMQ consumer access key is required')
  if (!options.secretAccessKey.trim()) throw new Error('YMQ consumer secret key is required')
  const fetcher = options.fetcher ?? globalThis.fetch
  const now = options.now ?? (() => new Date())
  const onPollError = options.onPollError ?? ((error) => console.error('Website builder queue poll failed.', error))

  const pollOnce = async (): Promise<'empty' | 'processed'> => {
    const response = await query({
      Action: 'ReceiveMessage',
      Version: queryApiVersion,
      QueueUrl: queueUrl,
      MaxNumberOfMessages: '1',
      WaitTimeSeconds: String(receiveWaitSeconds),
      VisibilityTimeout: String(visibilityTimeoutSeconds),
    })
    const message = parseReceiveMessage(await boundedText(response))
    if (!message) return 'empty'
    await options.processTrigger({ messages: [{ body: message.body }] })
    await query({
      Action: 'DeleteMessage',
      Version: queryApiVersion,
      QueueUrl: queueUrl,
      ReceiptHandle: message.receiptHandle,
    })
    return 'processed'
  }

  return {
    pollOnce,
    async run(signal) {
      while (!signal?.aborted) {
        try {
          await pollOnce()
        } catch (error) {
          if (signal?.aborted) return
          onPollError(error)
          await abortableDelay(1_000, signal)
        }
      }
    },
  }

  async function query(parameters: Record<string, string>) {
    const body = new URLSearchParams(parameters).toString()
    const timestamp = awsTimestamp(now())
    const date = timestamp.slice(0, 8)
    const headers = {
      'content-type': 'application/x-www-form-urlencoded',
      host: endpoint.host,
      'x-amz-date': timestamp,
    }
    const authorization = signV4({
      method: 'POST',
      path: endpoint.pathname || '/',
      body,
      headers,
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      region: options.region,
      date,
      timestamp,
    })
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: { ...headers, authorization },
      body,
    })
    if (!response.ok) throw new Error(`YMQ ${parameters.Action} failed with HTTP ${response.status}`)
    return response
  }
}

function parseReceiveMessage(document: string): { receiptHandle: string; body: string } | null {
  const messages = [...document.matchAll(/<Message>([\s\S]*?)<\/Message>/g)]
  if (messages.length === 0) return null
  if (messages.length !== 1) throw new Error('YMQ ReceiveMessage returned more than one message')
  const receiptHandle = xmlTag(messages[0][1], 'ReceiptHandle')
  const body = xmlTag(messages[0][1], 'Body')
  if (receiptHandle === null || body === null) {
    throw new Error('YMQ ReceiveMessage returned a message without body or receipt handle')
  }
  return { receiptHandle, body }
}

function xmlTag(document: string, name: string): string | null {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(document)
  if (!match) return null
  return decodeXml(match[1])
}

function decodeXml(value: string) {
  return value.replace(/&#(x[0-9a-f]+|\d+);|&(quot|apos|lt|gt|amp);/gi, (entity, numeric, named) => {
    if (numeric) {
      const codePoint = numeric[0].toLowerCase() === 'x'
        ? Number.parseInt(numeric.slice(1), 16)
        : Number.parseInt(numeric, 10)
      if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        throw new Error('YMQ response contains an invalid XML entity')
      }
      return String.fromCodePoint(codePoint)
    }
    return ({ quot: '"', apos: "'", lt: '<', gt: '>', amp: '&' } as Record<string, string>)[String(named).toLowerCase()]
  })
}

async function boundedText(response: Response) {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maximumResponseCharacters) {
    throw new Error('YMQ response exceeds the configured size limit')
  }
  const document = await response.text()
  if (document.length > maximumResponseCharacters) {
    throw new Error('YMQ response exceeds the configured size limit')
  }
  return document
}

function parseHttpsOrigin(value: string, name: string) {
  const url = parseHttpsUrl(value, name)
  if (url.pathname !== '/' || url.search || url.hash) throw new Error(`${name} must be an HTTPS origin only`)
  return url
}

function parseHttpsUrl(value: string, name: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL`)
  }
  if (url.protocol !== 'https:') throw new Error(`${name} must use HTTPS`)
  if (url.username || url.password || url.hash) throw new Error(`${name} must not contain credentials or a fragment`)
  return url
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
  const signature = hmac(signingKey, stringToSign).toString('hex')
  return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

function awsTimestamp(value: Date) {
  if (Number.isNaN(value.getTime())) throw new Error('YMQ signing date is invalid')
  return value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key: string | Uint8Array, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest()
}

function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(done, milliseconds)
    signal?.addEventListener('abort', done, { once: true })
    function done() {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', done)
      resolve()
    }
  })
}
