import type {
  AdminUserSummary,
  AdminUsersQuery,
  UserRole,
} from '@web-app-demo/contracts'
import { ADMIN_USERS_MAX_PAGE } from '@web-app-demo/contracts'

import {
  acquireUserAuthenticationAuthorityLock,
  acquireUserRoleMutationLock,
  type DbClient,
  userAuthorityTransitionTransactionOptions,
} from '../../../db'
import type {
  AdminDashboardReader,
  AdminUsersReader,
  ProfileWriter,
  UserRoleUpdater,
} from '../application/ports'
import { UsersFailure } from '../domain/errors'

const userSummarySelect = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  createdAt: true,
} as const

type UsersRepository =
  & ProfileWriter
  & AdminDashboardReader
  & AdminUsersReader
  & UserRoleUpdater

export function createPrismaUsersRepository(db: DbClient): UsersRepository {
  return {
    async updateProfile(userId, displayName) {
      const user = await db.user.update({
        where: { id: userId },
        data: { displayName },
        select: userSummarySelect,
      })
      return {
        ...user,
        role: toDomainRole(user.role),
      }
    },

    async dashboard(createdAfter) {
      const [totalUsers, totalAdmins, newUsersLast7Days] = await db.$transaction([
        db.user.count(),
        db.user.count({ where: { role: { in: ['owner', 'admin'] } } }),
        db.user.count({ where: { createdAt: { gte: createdAfter } } }),
      ])
      return { totalUsers, totalAdmins, newUsersLast7Days }
    },

    async listUsers({ page, pageSize, q }: AdminUsersQuery) {
      const where = q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' as const } },
              { displayName: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}
      const [total, users] = await db.$transaction([
        db.user.count({ where }),
        db.user.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: userSummarySelect,
        }),
      ])
      return {
        items: users.map(toAdminUserSummary),
        page,
        pageSize,
        total,
        hasNext: page < ADMIN_USERS_MAX_PAGE && page * pageSize < total,
      }
    },

    updateRole(input) {
      return db.$transaction(async (tx) => {
        await acquireUserRoleMutationLock(tx)
        await acquireUserAuthenticationAuthorityLock(tx, input.targetUserId)

        const actor = await tx.user.findUnique({
          where: { id: input.actorUserId },
          select: { id: true, role: true },
        })
        if (actor?.role !== 'owner' && actor?.role !== 'admin') {
          throw new UsersFailure('forbidden', 'Administrator access is required')
        }

        const target = await tx.user.findUnique({
          where: { id: input.targetUserId },
          select: userSummarySelect,
        })
        if (!target) {
          throw new UsersFailure('not_found', 'User not found')
        }
        const targetRole = toDomainRole(target.role)
        if (targetRole === input.role) {
          return toAdminUserSummary(target)
        }
        if (target.id === actor.id && input.role !== 'owner') {
          throw new UsersFailure('role_conflict', 'You cannot remove your own administrator role')
        }

        if ((target.role === 'admin' || target.role === 'owner') && input.role !== 'owner') {
          const adminCount = await tx.user.count({ where: { role: { in: ['owner', 'admin'] } } })
          if (adminCount <= 1) {
            throw new UsersFailure('role_conflict', 'At least one administrator must remain')
          }
        }

        const updated = await tx.user.update({
          where: { id: target.id },
          data: { role: input.role },
          select: userSummarySelect,
        })
        await tx.authSession.updateMany({
          where: { userId: target.id, revokedAt: null },
          data: { revokedAt: input.now },
        })
        await tx.passwordResetToken.updateMany({
          where: { userId: target.id, usedAt: null },
          data: { usedAt: input.now },
        })
        return toAdminUserSummary(updated)
      }, userAuthorityTransitionTransactionOptions)
    },
  }
}

function toAdminUserSummary(user: {
  id: string
  email: string
  displayName: string | null
  role: string
  createdAt: Date
}): AdminUserSummary {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: toDomainRole(user.role),
    createdAt: user.createdAt.toISOString(),
  }
}

function toDomainRole(role: string): UserRole {
  if (role === 'admin') return 'owner'
  if (role === 'user' || role === 'editor' || role === 'owner') return role
  throw new Error(`Unsupported persisted user role: ${role}`)
}
