import type { FetchLike } from './backend-client'

export type PublicationPromotionPort = {
  verifyInactiveMarker(input: { slot: 'blue' | 'green'; revision: number }): Promise<boolean>
  switchActiveSlot(slot: 'blue' | 'green'): Promise<void>
  purgePublicPaths(input: { paths: string[]; revision: number }): Promise<void>
  verifyPublicMarker(revision: number): Promise<boolean>
}

export type PublicationPromotionOptions = {
  maxPollAttempts?: number
  pollIntervalMs?: number
  sleep?: (milliseconds: number) => Promise<void>
}

export async function promotePublication(
  port: PublicationPromotionPort,
  input: { slot: 'blue' | 'green'; revision: number },
  options: PublicationPromotionOptions = {},
) {
  const maxPollAttempts = options.maxPollAttempts ?? 30
  const pollIntervalMs = options.pollIntervalMs ?? 1_000
  if (!Number.isSafeInteger(maxPollAttempts) || maxPollAttempts < 1) throw new Error('Publication marker poll attempts must be positive')
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 0) throw new Error('Publication marker poll interval must be non-negative')

  if (!(await port.verifyInactiveMarker(input))) throw new Error('Inactive slot marker verification failed')
  let switchCompleted = false
  try {
    await port.switchActiveSlot(input.slot)
    switchCompleted = true
    await port.purgePublicPaths({ paths: ['/*'], revision: input.revision })

    const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))

    for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
      if (await port.verifyPublicMarker(input.revision)) return
      if (attempt + 1 < maxPollAttempts) await sleep(pollIntervalMs)
    }

    throw new Error('Public publication marker verification failed')
  } catch (error) {
    if (switchCompleted) {
      const previousSlot = input.slot === 'green' ? 'blue' : 'green'
      try {
        await port.switchActiveSlot(previousSlot)
      } catch (rollbackError) {
        throw new Error('Publication promotion failed and rollback failed', { cause: rollbackError })
      }
    }
    throw error
  }
}

export type PublicationObjectStoragePort = {
  readObject(key: string): Promise<Uint8Array | null>
  headObject(key: string): Promise<boolean>
}

export function createHttpPublicationPromotion(options: {
  storage: PublicationObjectStoragePort
  publicOrigin: string
  selectorUrl: string
  purgeUrl: string
  authToken: string
  fetcher?: FetchLike
}): PublicationPromotionPort {
  const publicOrigin = safeOrigin(options.publicOrigin, 'Public website origin')
  const selectorUrl = safeEndpoint(options.selectorUrl, 'Publication selector URL')
  const purgeUrl = safeEndpoint(options.purgeUrl, 'CDN purge URL')
  if (!options.authToken.trim()) throw new Error('Publication control token is required')
  const fetcher = options.fetcher ?? globalThis.fetch
  if (typeof fetcher !== 'function') throw new Error('Publication fetcher is required')

  return {
    async verifyInactiveMarker(input) {
      const [marker, index] = await Promise.all([
        options.storage.readObject(`${input.slot}/__publication_revision.txt`),
        options.storage.headObject(`${input.slot}/index.html`),
      ])
      if (!marker || !index) return false
      return new TextDecoder().decode(marker).trim() === `vibe-publication:${input.revision}`
    },

    async switchActiveSlot(slot) {
      await controlRequest(selectorUrl, { slot })
    },

    async purgePublicPaths(input) {
      await controlRequest(purgeUrl, input)
    },

    async verifyPublicMarker(revision) {
      const url = new URL('/__publication_revision.txt', publicOrigin)
      url.searchParams.set('publication_revision', String(revision))
      try {
        const response = await fetcher(url.toString(), {
          method: 'GET',
          headers: { Accept: 'text/plain', 'Cache-Control': 'no-store' },
          redirect: 'error',
        })
        if (!response.ok) return false
        return (await response.text()).trim() === `vibe-publication:${revision}`
      } catch {
        return false
      }
    },
  }

  async function controlRequest(url: string, body: unknown) {
    const response = await fetcher(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${options.authToken}`,
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      redirect: 'error',
    })
    if (response.ok) return
    throw new Error(`Publication control request failed with HTTP ${response.status}`)
  }
}

function safeOrigin(value: string, label: string) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must be a credential-free HTTP(S) origin`)
  }
  if (url.pathname !== '/' && url.pathname !== '') throw new Error(`${label} must not contain a path`)
  return url
}

function safeEndpoint(value: string, label: string) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error(`${label} must be a credential-free HTTPS URL`)
  }
  return url.toString()
}
