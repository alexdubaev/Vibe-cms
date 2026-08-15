import { expect, test } from 'bun:test'

import { createPrisma } from '../src/db'
import {
  assertMigrationSchemaOwnership,
  grantRuntimeDatabaseAccess,
  transferMigrationSchemaOwnership,
} from './deploy-database'

test('runtime database grants allow current and future DML without schema DDL', async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')

  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1))
  const suffix = `${process.pid}_${Date.now()}`
  const username = `runtime_grant_${suffix}`
  const existingTable = `runtime_existing_${suffix}`
  const futureTable = `runtime_future_${suffix}`
  const db = createPrisma(databaseUrl)

  try {
    await db.$executeRawUnsafe(`CREATE ROLE "${username}" NOLOGIN`)
    await db.$executeRawUnsafe(
      `CREATE TABLE public."${existingTable}" (id serial PRIMARY KEY, value text NOT NULL)`,
    )
    await db.$executeRawUnsafe(
      `GRANT CREATE ON SCHEMA public TO "${username}"`,
    )
    await db.$executeRawUnsafe(
      `GRANT ALL PRIVILEGES ON TABLE public."${existingTable}" TO "${username}"`,
    )
    await db.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO "${username}"`,
    )
    await db.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO "${username}"`,
    )

    await grantRuntimeDatabaseAccess(db, { databaseName, username })

    // This object is deliberately created after the grant to prove the owner's default ACL.
    await db.$executeRawUnsafe(
      `CREATE TABLE public."${futureTable}" (id serial PRIMARY KEY, value text NOT NULL)`,
    )

    const [privileges] = await db.$queryRawUnsafe<
      Array<{
        can_connect: boolean
        can_create: boolean
        existing_dml: boolean
        existing_sequence: boolean
        future_dml: boolean
        future_sequence: boolean
        can_truncate: boolean
        future_can_truncate: boolean
      }>
    >(
      `SELECT
        has_database_privilege($1, current_database(), 'CONNECT') AS can_connect,
        has_schema_privilege($1, 'public', 'CREATE') AS can_create,
        has_table_privilege($1, $2, 'SELECT,INSERT,UPDATE,DELETE') AS existing_dml,
        has_sequence_privilege($1, $3, 'USAGE,SELECT,UPDATE') AS existing_sequence,
        has_table_privilege($1, $4, 'SELECT,INSERT,UPDATE,DELETE') AS future_dml,
        has_sequence_privilege($1, $5, 'USAGE,SELECT,UPDATE') AS future_sequence,
        has_table_privilege($1, $2, 'TRUNCATE') AS can_truncate,
        has_table_privilege($1, $4, 'TRUNCATE') AS future_can_truncate`,
      username,
      `public.${existingTable}`,
      `public.${existingTable}_id_seq`,
      `public.${futureTable}`,
      `public.${futureTable}_id_seq`,
    )

    expect(privileges).toEqual({
      can_connect: true,
      can_create: false,
      existing_dml: true,
      existing_sequence: true,
      future_dml: true,
      future_sequence: true,
      can_truncate: false,
      future_can_truncate: false,
    })
  } finally {
    await db.$executeRawUnsafe(`DROP TABLE IF EXISTS public."${futureTable}"`)
    await db.$executeRawUnsafe(`DROP TABLE IF EXISTS public."${existingTable}"`)
    await db.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM "${username}"`,
    )
    await db.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM "${username}"`,
    )
    await db.$executeRawUnsafe(`DROP OWNED BY "${username}"`)
    await db.$executeRawUnsafe(`DROP ROLE IF EXISTS "${username}"`)
    await db.$disconnect()
  }
})

test('runtime database reconciliation refuses inherited roles', async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')

  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1))
  const suffix = `${process.pid}_${Date.now()}`
  const username = `runtime_member_${suffix}`
  const inheritedRole = `runtime_parent_${suffix}`
  const db = createPrisma(databaseUrl)

  try {
    await db.$executeRawUnsafe(`CREATE ROLE "${username}" NOLOGIN`)
    await db.$executeRawUnsafe(`CREATE ROLE "${inheritedRole}" NOLOGIN`)
    await db.$executeRawUnsafe(`GRANT "${inheritedRole}" TO "${username}"`)

    await expect(
      grantRuntimeDatabaseAccess(db, { databaseName, username }),
    ).rejects.toThrow('inherits role')
  } finally {
    await db.$executeRawUnsafe(
      `REVOKE "${inheritedRole}" FROM "${username}"`,
    )
    await db.$executeRawUnsafe(`DROP ROLE IF EXISTS "${username}"`)
    await db.$executeRawUnsafe(`DROP ROLE IF EXISTS "${inheritedRole}"`)
    await db.$disconnect()
  }
})

test('legacy public schema ownership is inventoried and transferred explicitly', async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')

  const suffix = `${process.pid}_${Date.now()}`
  const legacyOwner = `legacy_owner_${suffix}`
  const migrationOwner = decodeURIComponent(new URL(databaseUrl).username)
  const tableName = `legacy_table_${suffix}`
  const typeName = `legacy_enum_${suffix}`
  const db = createPrisma(databaseUrl)

  try {
    await db.$executeRawUnsafe(`CREATE ROLE "${legacyOwner}" NOLOGIN`)
    await db.$executeRawUnsafe(
      `CREATE TABLE public."${tableName}" (id bigint PRIMARY KEY)`,
    )
    await db.$executeRawUnsafe(
      `CREATE TYPE public."${typeName}" AS ENUM ('active')`,
    )
    await db.$executeRawUnsafe(
      `ALTER TABLE public."${tableName}" OWNER TO "${legacyOwner}"`,
    )
    await db.$executeRawUnsafe(
      `ALTER TYPE public."${typeName}" OWNER TO "${legacyOwner}"`,
    )

    await expect(
      assertMigrationSchemaOwnership(db, {
        expectedOwner: migrationOwner,
      }),
    ).rejects.toThrow(legacyOwner)

    await transferMigrationSchemaOwnership(db, {
      legacyOwner,
      migrationOwner,
    })
    await assertMigrationSchemaOwnership(db, {
      expectedOwner: migrationOwner,
    })
  } finally {
    await db.$executeRawUnsafe(`DROP TABLE IF EXISTS public."${tableName}"`)
    await db.$executeRawUnsafe(`DROP TYPE IF EXISTS public."${typeName}"`)
    await db.$executeRawUnsafe(`DROP OWNED BY "${legacyOwner}"`)
    await db.$executeRawUnsafe(`DROP ROLE IF EXISTS "${legacyOwner}"`)
    await db.$disconnect()
  }
})
