import { describe, expect, test } from 'bun:test'

import { BuilderMessageError, parseBuildCommands } from '../src/trigger-message'

const first = '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10'
const second = '018f8c8d-5f34-7db2-8b98-2c7bf3d80a11'

describe('YMQ trigger messages', () => {
  test('extracts unique build ids in envelope order', () => {
    expect(parseBuildCommands({ messages: [
      { body: JSON.stringify({ buildId: first }) },
      { body: JSON.stringify({ buildId: first }) },
      { details: { message: { body: JSON.stringify({ buildId: second }) } } },
    ] })).toEqual([{ buildId: first }, { buildId: second }])
  })

  test('rejects malformed messages before any build starts', () => {
    expect(() => parseBuildCommands({ messages: [{ body: '{"buildId":"bad"}' }] })).toThrow(BuilderMessageError)
    expect(() => parseBuildCommands({ messages: [] })).toThrow('at least one message')
  })
})
