import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { previewRewriteTarget } from '../src/cms/preview-routing'

describe('preview middleware routing', () => {
  test('sends a product grant through the one-time exchange before rendering the clean preview URL', () => {
    const grant = new URL('http://127.0.0.1:4321/__preview/018f8c8d-5f34-7db2-8b98-2c7bf3d80a10?token=' + 'a'.repeat(43))
    const exchange = previewRewriteTarget(grant)

    assert.equal(exchange?.pathname, '/preview/exchange')
    assert.equal(exchange?.searchParams.get('grant'), grant.toString())
    assert.equal(
      previewRewriteTarget(new URL('http://127.0.0.1:4321/__preview/018f8c8d-5f34-7db2-8b98-2c7bf3d80a10'))?.pathname,
      '/preview/018f8c8d-5f34-7db2-8b98-2c7bf3d80a10',
    )
  })
})
