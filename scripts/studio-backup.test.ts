import { afterEach, describe, expect, test } from 'bun:test'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  createRestoreVerificationPlan,
  createStudioBackupPlan,
  executeStudioBackup,
  requireStudioOperationConfirmation,
  selectExpiredBackupObjects,
  validateStudioBackupConfig,
} from './studio-backup.mjs'

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })))
})

const source = {
  INSTALLATION_SLUG: 'client-auto',
  DATABASE_ADMIN_URL: 'postgresql://vibe_client_auto_owner:owner-pass@postgres:5432/vibe_client_auto?schema=public&sslmode=require',
  CMS_SITE_PACKAGE_ID: 'auto-service',
  STUDIO_BACKUP_ENDPOINT: 'https://backup.example',
  STUDIO_BACKUP_REGION: 'ru-central1',
  STUDIO_BACKUP_BUCKET: 'client-auto-external-backups',
  STUDIO_BACKUP_ACCESS_KEY_ID: 'backup-client-auto-key',
  STUDIO_BACKUP_SECRET_ACCESS_KEY: 'backup-client-auto-secret-key-value',
  STUDIO_BACKUP_S3_SCOPE: 'bucket:client-auto-external-backups/client-auto/*',
  STUDIO_BACKUP_AGE_RECIPIENT: 'age1testrecipient000000000000000000000000000000000000000000000000000',
  STUDIO_BACKUP_RCLONE_CRYPT_PASSWORD: 'fake-rclone-crypt-password-for-tests',
  STUDIO_BACKUP_RETENTION_DAYS: '35',
  PRIVATE_STORAGE_ENDPOINT: 'https://media.example',
  PRIVATE_STORAGE_REGION: 'ru-central1',
  PRIVATE_STORAGE_BUCKET: 'client-auto-private-media',
  PRIVATE_STORAGE_ACCESS_KEY_ID: 'media-client-auto-key',
  PRIVATE_STORAGE_SECRET_ACCESS_KEY: 'media-client-auto-secret-key-value',
  PRIVATE_STORAGE_S3_SCOPE: 'bucket:client-auto-private-media/*',
}

describe('studio backup orchestration', () => {
  test('plans one encrypted off-host backup without exposing database or storage credentials', () => {
    const config = validateStudioBackupConfig(source)
    const plan = createStudioBackupPlan(config, {
      now: new Date('2026-08-25T12:00:00.000Z'),
      temporaryRoot: '/var/tmp/vibe-cms-backup',
    })

    expect(plan).toMatchObject({
      installationSlug: 'client-auto',
      encrypted: true,
      retentionDays: 35,
      remoteArchiveKey: 'client-auto/2026/08/25/client-auto-20260825T120000Z.dump.age',
      remoteMetadataKey: 'client-auto/2026/08/25/client-auto-20260825T120000Z.metadata.json',
      temporaryDirectory: '/var/tmp/vibe-cms-backup/client-auto-20260825T120000Z',
    })
    expect(plan.commands.map((command) => command.program)).toEqual([
      'pg_dump',
      'age',
      'rclone',
      'aws',
      'aws',
    ])
    expect(plan.commands[0].display).toContain('PG* environment')
    expect(plan.commands[1].display).toContain('.dump.age')
    expect(plan.commands[2].display).toContain('client-auto-private-media')
    expect(plan.commands[2].display).toContain('studio-backup-crypt:media')
    expect(plan.commands[2].args[0]).toBe('copy')
    expect(plan.commands[2].display).not.toContain(' sync ')
    expect(plan.commands[3].display).toContain('s3://client-auto-external-backups/client-auto/')

    const visible = JSON.stringify(plan)
    expect(visible).not.toContain(source.DATABASE_ADMIN_URL)
    expect(visible).not.toContain('owner-pass')
    expect(visible).not.toContain(source.STUDIO_BACKUP_SECRET_ACCESS_KEY)
    expect(visible).not.toContain(source.STUDIO_BACKUP_ACCESS_KEY_ID)
    expect(visible).not.toContain(source.PRIVATE_STORAGE_SECRET_ACCESS_KEY)
    expect(visible).not.toContain(source.STUDIO_BACKUP_RCLONE_CRYPT_PASSWORD)
  })

  test('rejects a backup bucket or scope that is not confined to this installation', () => {
    expect(() => validateStudioBackupConfig({
      ...source,
      STUDIO_BACKUP_BUCKET: 'shared-backups',
      STUDIO_BACKUP_S3_SCOPE: 'bucket:shared-backups/*',
    })).toThrow('backup bucket must include INSTALLATION_SLUG')

    expect(() => validateStudioBackupConfig({
      ...source,
      STUDIO_BACKUP_S3_SCOPE: 'bucket:client-auto-external-backups/*',
    })).toThrow('must equal bucket:client-auto-external-backups/client-auto/*')

    expect(() => validateStudioBackupConfig({
      ...source,
      STUDIO_BACKUP_RCLONE_CRYPT_PASSWORD: '',
    })).toThrow('STUDIO_BACKUP_RCLONE_CRYPT_PASSWORD is required')
  })

  test('plans restore verification only for the exact disposable installation database', () => {
    const config = validateStudioBackupConfig(source)
    const plan = createRestoreVerificationPlan(config, {
      encryptedArchivePath: '/safe/backups/client-auto.dump.age',
      temporaryRoot: '/var/tmp/vibe-cms-restore',
    })

    expect(plan.restoreDatabaseName).toBe('vibe_client_auto_restore_test')
    expect(plan.commands.map((command) => command.program)).toEqual([
      'createdb',
      'age',
      'pg_restore',
      'psql',
      'dropdb',
    ])
    expect(plan.commands.at(-1)?.display).toBe('dropdb --if-exists vibe_client_auto_restore_test (PG* environment)')
    expect(JSON.stringify(plan)).not.toContain(source.DATABASE_ADMIN_URL)

    expect(() => createRestoreVerificationPlan(config, {
      encryptedArchivePath: '/safe/backups/client-auto.dump.age',
      temporaryRoot: '/var/tmp/vibe-cms-restore',
      restoreDatabaseName: 'vibe_client_auto',
    })).toThrow('Restore verification database must be exactly vibe_client_auto_restore_test')
    expect(() => createRestoreVerificationPlan(config, {
      encryptedArchivePath: '/safe/backups/client-auto.dump.age',
      temporaryRoot: '/var/tmp/vibe-cms-restore',
      restoreDatabaseName: 'another_customer_restore_test',
    })).toThrow('Restore verification database must be exactly vibe_client_auto_restore_test')
  })

  test('rejects unsafe retention and temporary-directory inputs before command creation', () => {
    expect(() => validateStudioBackupConfig({
      ...source,
      STUDIO_BACKUP_RETENTION_DAYS: '0',
    })).toThrow('STUDIO_BACKUP_RETENTION_DAYS must be an integer from 1 to 3650')

    const config = validateStudioBackupConfig(source)
    expect(() => createStudioBackupPlan(config, {
      temporaryRoot: 'relative/backups',
    })).toThrow('Backup temporary root must be an absolute path')
  })

  test('records encrypted archive metadata and removes only its owned temporary directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibe-backup-execution-test-'))
    temporaryDirectories.push(root)
    const config = validateStudioBackupConfig(source)
    const plan = createStudioBackupPlan(config, {
      now: new Date('2026-08-25T12:00:00.000Z'),
      temporaryRoot: join(root, 'new-backup-root'),
    })
    const programs = []
    let pgSslMode

    const metadata = await executeStudioBackup(config, plan, {
      now: new Date('2026-08-25T12:00:00.000Z'),
      run: async (command, options) => {
        programs.push(command.program)
        if (command.program === 'pg_dump') pgSslMode = options.env.PGSSLMODE
        if (command.program === 'pg_dump') await writeFile(plan.dumpPath, 'fake-dump')
        if (command.program === 'age') await writeFile(plan.encryptedArchivePath, 'fake-encrypted-dump')
        return { stdout: '', stderr: '', exitCode: 0 }
      },
    })

    expect(programs).toEqual(['pg_dump', 'age', 'rclone', 'aws', 'aws'])
    expect(pgSslMode).toBe('require')
    expect(metadata).toMatchObject({
      installationSlug: 'client-auto',
      encryptedArchive: 'client-auto-20260825T120000Z.dump.age',
      byteSize: 19,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      retentionDays: 35,
    })
    await expect(access(plan.temporaryDirectory)).rejects.toThrow()
    await expect(access(root)).resolves.toBeNull()
  })

  test('retention selects only expired objects under the validated installation prefix', () => {
    expect(selectExpiredBackupObjects([
      { key: 'client-auto/old.dump.age', lastModified: '2026-06-01T00:00:00.000Z' },
      { key: 'client-auto/recent.dump.age', lastModified: '2026-08-20T00:00:00.000Z' },
      { key: 'other-customer/old.dump.age', lastModified: '2026-01-01T00:00:00.000Z' },
    ], {
      installationSlug: 'client-auto',
      retentionDays: 35,
      now: new Date('2026-08-25T12:00:00.000Z'),
    })).toEqual(['client-auto/old.dump.age'])
  })

  test('requires an operation-specific exact confirmation before backup or restore execution', () => {
    expect(() => requireStudioOperationConfirmation('restore-verify', 'client-auto', ['--execute']))
      .toThrow('requires --execute --confirm=restore-verify:client-auto')
    expect(() => requireStudioOperationConfirmation('backup', 'client-auto', [
      '--execute',
      '--confirm=restore-verify:client-auto',
    ])).toThrow('requires --execute --confirm=backup:client-auto')
    expect(requireStudioOperationConfirmation('restore-verify', 'client-auto', [
      '--execute',
      '--confirm=restore-verify:client-auto',
    ])).toBeUndefined()
  })
})
