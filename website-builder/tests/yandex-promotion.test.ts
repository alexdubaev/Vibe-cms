import { describe, expect, test } from 'bun:test'

import {
  createHttpPublicationPromotion,
  promotePublication,
} from '../src/yandex-promotion'

const revision = 4
const slot = 'green' as const

describe('website publication promotion', () => {
  test('verifies inactive marker and HTML, switches, purges, then polls the public marker', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    let publicChecks = 0
    const promotion = createHttpPublicationPromotion({
      storage: {
        readObject: async (key) => key === `${slot}/__publication_revision.txt`
          ? new TextEncoder().encode(`vibe-publication:${revision}`)
          : null,
        headObject: async (key) => key === `${slot}/index.html`,
      },
      publicOrigin: 'https://www.example.test/',
      selectorUrl: 'https://control.example.test/selector',
      purgeUrl: 'https://cdn.example.test/purge',
      authToken: 'promotion-token',
      fetcher: async (input, init) => {
        const url = String(input)
        calls.push({ url, init })
        if (url.startsWith('https://www.example.test/')) {
          publicChecks += 1
          return new Response(publicChecks === 1 ? 'vibe-publication:3' : 'vibe-publication:4', { status: 200 })
        }
        return new Response(null, { status: 202 })
      },
    })

    await promotePublication(promotion, { slot, revision }, { maxPollAttempts: 2, sleep: async () => undefined })

    expect(calls.map((call) => call.url)).toEqual([
      'https://control.example.test/selector',
      'https://cdn.example.test/purge',
      'https://www.example.test/__publication_revision.txt?publication_revision=4',
      'https://www.example.test/__publication_revision.txt?publication_revision=4',
    ])
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe('Bearer promotion-token')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ slot })
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ paths: ['/*'], revision })
    expect(new Headers(calls[2]?.init?.headers).get('cache-control')).toBe('no-store')
  })

  test('rolls back to the previous slot when public marker verification fails', async () => {
    const calls: string[] = []
    await expect(promotePublication({
      verifyInactiveMarker: async () => true,
      switchActiveSlot: async (slot) => { calls.push(`select:${slot}`) },
      purgePublicPaths: async () => { calls.push('purge') },
      verifyPublicMarker: async () => false,
    }, { slot: 'green', revision: 8 }, { maxPollAttempts: 1 })).rejects.toThrow('Public publication marker verification failed')

    expect(calls).toEqual(['select:green', 'purge', 'select:blue'])
  })

  test('refuses to switch when the inactive release is incomplete or has the wrong marker', async () => {
    const fetchCalls: string[] = []
    const promotion = createHttpPublicationPromotion({
      storage: {
        readObject: async () => new TextEncoder().encode('vibe-publication:3'),
        headObject: async () => true,
      },
      publicOrigin: 'https://www.example.test',
      selectorUrl: 'https://control.example.test/selector',
      purgeUrl: 'https://cdn.example.test/purge',
      authToken: 'promotion-token',
      fetcher: async () => { fetchCalls.push('fetch'); return new Response(null, { status: 202 }) },
    })

    await expect(promotePublication(promotion, { slot, revision }, { sleep: async () => undefined })).rejects.toThrow('Inactive slot marker')
    expect(fetchCalls).toEqual([])
  })

  test('fails closed when the public marker never converges', async () => {
    const calls: string[] = []
    const promotion = createHttpPublicationPromotion({
      storage: {
        readObject: async () => new TextEncoder().encode(`vibe-publication:${revision}`),
        headObject: async () => true,
      },
      publicOrigin: 'https://www.example.test',
      selectorUrl: 'https://control.example.test/selector',
      purgeUrl: 'https://cdn.example.test/purge',
      authToken: 'promotion-token',
      fetcher: async (input) => {
        calls.push(String(input))
        return new Response('vibe-publication:3', { status: 200 })
      },
    })

    await expect(promotePublication(promotion, { slot, revision }, { maxPollAttempts: 3, sleep: async () => undefined })).rejects.toThrow('Public publication marker')
    expect(calls).toHaveLength(6)
  })
})
