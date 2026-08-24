import type { DbClient } from '../../../db'

import type { BuilderNonceStore } from '../application/build-request-auth'

export function createBuilderNonceStore(db: DbClient): BuilderNonceStore {
  return {
    async reserve(input) {
      const result = await db.cmsBuilderRequestNonce.createMany({
        data: [{
          nonce: input.nonce,
          keyVersion: input.keyVersion,
          buildId: input.buildId,
          expiresAt: input.expiresAt,
        }],
        // The nonce is the replay boundary. skipDuplicates keeps a duplicate callback from
        // aborting a larger transaction if a caller chooses to reserve inside one.
        skipDuplicates: true,
      })
      return result.count === 1
    },
  }
}
