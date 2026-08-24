import { describe, expect, test } from 'bun:test'

import { toAuthUserRecord, toDomainUserRole } from './user'

describe('persisted user role compatibility', () => {
  test('maps the legacy admin value to owner at the domain boundary', () => {
    expect(toDomainUserRole('admin')).toBe('owner')
    expect(toDomainUserRole('editor')).toBe('editor')
    expect(toDomainUserRole('owner')).toBe('owner')
    expect(() => toDomainUserRole('unknown')).toThrow()
  })

  test('serializes a legacy record without exposing its Prisma role', () => {
    expect(
      toAuthUserRecord({
        id: '019c0000-0000-7000-8000-000000000001',
        email: 'owner@example.com',
        passwordHash: null,
        displayName: 'Owner',
        role: 'admin',
        createdAt: new Date('2026-08-24T00:00:00.000Z'),
      }),
    ).toMatchObject({ role: 'owner' })
  })
})
