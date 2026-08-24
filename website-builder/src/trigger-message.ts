import { z } from 'zod'

const buildCommandSchema = z.object({ buildId: z.uuid() }).strict()

export type BuildCommand = z.infer<typeof buildCommandSchema>

export class BuilderMessageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BuilderMessageError'
  }
}

/**
 * YMQ delivers a batch envelope, but the builder deliberately processes each id sequentially.
 * Duplicates in one batch are removed without reordering the first occurrence.
 */
export function parseBuildCommands(input: unknown): BuildCommand[] {
  if (!isRecord(input) || !Array.isArray(input.messages) || input.messages.length === 0) {
    throw new BuilderMessageError('YMQ trigger envelope must contain at least one message')
  }

  const seen = new Set<string>()
  const commands: BuildCommand[] = []
  for (const [index, message] of input.messages.entries()) {
    const body = messageBody(message)
    if (body === null) {
      throw new BuilderMessageError(`YMQ message ${index} does not contain a string body`)
    }
    let decoded: unknown
    try {
      decoded = JSON.parse(body) as unknown
    } catch {
      throw new BuilderMessageError(`YMQ message ${index} body is not valid JSON`)
    }
    const result = buildCommandSchema.safeParse(decoded)
    if (!result.success) {
      throw new BuilderMessageError(`YMQ message ${index} is not a valid build command`)
    }
    if (!seen.has(result.data.buildId)) {
      seen.add(result.data.buildId)
      commands.push(result.data)
    }
  }
  return commands
}

function messageBody(message: unknown): string | null {
  if (!isRecord(message)) return null
  if (typeof message.body === 'string') return message.body
  const details = message.details
  if (!isRecord(details) || !isRecord(details.message) || typeof details.message.body !== 'string') return null
  return details.message.body
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
