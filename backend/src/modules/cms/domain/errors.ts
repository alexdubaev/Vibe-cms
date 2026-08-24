export class CmsRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'CmsRepositoryError'
  }
}

export class CmsConflictError extends CmsRepositoryError {
  constructor(
    readonly aggregateId: string,
    readonly currentRevision?: number,
  ) {
    super(`CMS aggregate ${aggregateId} changed before this write completed`, 'CMS_CONFLICT')
    this.name = 'CmsConflictError'
  }
}

export class CmsImmutableRevisionError extends CmsRepositoryError {
  constructor(readonly revisionId: string) {
    super(`CMS revision ${revisionId} is immutable`, 'CMS_CONFLICT')
    this.name = 'CmsImmutableRevisionError'
  }
}

export class CmsPublicationConflictError extends CmsRepositoryError {
  constructor(readonly revision: number, readonly latestRevision?: number) {
    super(`CMS publication revision ${revision} is not newer than the latest publication`, 'CMS_CONFLICT')
    this.name = 'CmsPublicationConflictError'
  }
}

export class CmsPathPolicyError extends CmsRepositoryError {
  constructor(path: string, cause?: unknown) {
    super(`CMS path is invalid: ${path}`, 'BAD_REQUEST', { cause })
    this.name = 'CmsPathPolicyError'
  }
}
