import { describe, expect, test } from 'bun:test'

import { CmsPathPolicyError } from './errors'
import { assertDistinctCmsPath, normalizeCmsPath } from './path-policy'

describe('CMS path policy', () => {
  test('normalizes casing, missing slashes, and duplicate separators', () => {
    expect(normalizeCmsPath('about')).toBe('/about')
    expect(normalizeCmsPath('About//')).toBe('/about')
    expect(normalizeCmsPath('/Contacts/')).toBe('/contacts')
  })

  test('rejects paths that could escape or abuse the public URL space', () => {
    const rejected = [
      '',
      'https://evil.example',
      '/media/secret', // reserved prefix
      '/a/../b', // dot segments
      '/a%2Fb', // encoded path separator
      '/a?query',
      `/${'x'.repeat(200)}`, // over the length cap
    ]
    for (const path of rejected) {
      expect(() => normalizeCmsPath(path)).toThrow(CmsPathPolicyError)
    }
  })

  test('detects duplicate paths only after normalization', () => {
    expect(() =>
      assertDistinctCmsPath('/ABOUT', ['/about//']),
    ).toThrow(CmsPathPolicyError)
    // The same policy must accept a genuinely new path.
    expect(() => assertDistinctCmsPath('/about', ['/contacts', '/'])).not.toThrow()
  })
})
