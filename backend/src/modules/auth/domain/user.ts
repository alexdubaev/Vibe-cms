import type { UserDto, UserRole } from '@web-app-demo/contracts'

export type AuthUserRecord = {
  id: string
  email: string
  passwordHash: string | null
  displayName: string | null
  role: UserRole
  createdAt: Date
}

export type AuthenticatedPrincipal = UserDto & {
  sessionId: string
}

type PersistedUser = Omit<AuthUserRecord, 'role'> & { role: string }

/**
 * Prisma keeps `admin` as a migration-only compatibility value. The domain and every transport
 * response expose the stable product role `owner`, so legacy rows cannot leak into new contracts.
 */
export function toDomainUserRole(role: string): UserRole {
  if (role === 'admin') return 'owner'
  if (role === 'user' || role === 'editor' || role === 'owner') return role
  throw new Error(`Unsupported persisted user role: ${role}`)
}

export function toAuthUserRecord(user: PersistedUser): AuthUserRecord {
  return {
    id: user.id,
    email: user.email,
    passwordHash: user.passwordHash,
    displayName: user.displayName,
    role: toDomainUserRole(user.role),
    createdAt: user.createdAt,
  }
}

export function toBaseUserDto(user: AuthUserRecord): UserDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  }
}

export function userDtoFromPrincipal(principal: AuthenticatedPrincipal): UserDto {
  const { sessionId: _sessionId, ...user } = principal
  return user
}
