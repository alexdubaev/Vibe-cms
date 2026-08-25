import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, posix, resolve, sep } from 'node:path'

import { parseStudioEnvironmentFile } from './studio-installation-config.mjs'

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const packageIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const postgresIdentifierPattern = /^[a-z_][a-z0-9_]{0,62}$/

export function validateStudioBackupConfig(source) {
  const installationSlug = required(source, 'INSTALLATION_SLUG')
  if (!slugPattern.test(installationSlug)) {
    throw new Error('INSTALLATION_SLUG must be a lowercase DNS-style slug')
  }
  const databaseName = `vibe_${installationSlug.replaceAll('-', '_')}`
  const databaseAdminUrl = postgresUrl(required(source, 'DATABASE_ADMIN_URL'), 'DATABASE_ADMIN_URL')
  if (decodeURIComponent(databaseAdminUrl.pathname.slice(1)) !== databaseName) {
    throw new Error(`DATABASE_ADMIN_URL database name must be ${databaseName}`)
  }
  const expectedOwner = `${databaseName}_owner`
  if (decodeURIComponent(databaseAdminUrl.username) !== expectedOwner) {
    throw new Error(`DATABASE_ADMIN_URL role must be exactly ${expectedOwner}`)
  }

  const sitePackageId = required(source, 'CMS_SITE_PACKAGE_ID')
  if (!packageIdPattern.test(sitePackageId)) {
    throw new Error('CMS_SITE_PACKAGE_ID must be a lowercase package slug')
  }

  const backupEndpoint = httpsUrl(required(source, 'STUDIO_BACKUP_ENDPOINT'), 'STUDIO_BACKUP_ENDPOINT')
  const backupRegion = required(source, 'STUDIO_BACKUP_REGION')
  const backupBucket = required(source, 'STUDIO_BACKUP_BUCKET')
  if (!backupBucket.includes(installationSlug)) {
    throw new Error('Studio backup bucket must include INSTALLATION_SLUG')
  }
  const expectedBackupScope = `bucket:${backupBucket}/${installationSlug}/*`
  if (required(source, 'STUDIO_BACKUP_S3_SCOPE') !== expectedBackupScope) {
    throw new Error(`STUDIO_BACKUP_S3_SCOPE must equal ${expectedBackupScope}`)
  }

  const privateStorageEndpoint = httpsUrl(
    required(source, 'PRIVATE_STORAGE_ENDPOINT'),
    'PRIVATE_STORAGE_ENDPOINT',
  )
  const privateStorageBucket = required(source, 'PRIVATE_STORAGE_BUCKET')
  if (!privateStorageBucket.includes(installationSlug)) {
    throw new Error('Private media bucket must include INSTALLATION_SLUG')
  }
  const expectedPrivateScope = `bucket:${privateStorageBucket}/*`
  if (required(source, 'PRIVATE_STORAGE_S3_SCOPE') !== expectedPrivateScope) {
    throw new Error(`PRIVATE_STORAGE_S3_SCOPE must equal ${expectedPrivateScope}`)
  }
  if (privateStorageBucket === backupBucket) {
    throw new Error('Private media and external backup buckets must be different')
  }

  const retentionDays = Number(required(source, 'STUDIO_BACKUP_RETENTION_DAYS'))
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new Error('STUDIO_BACKUP_RETENTION_DAYS must be an integer from 1 to 3650')
  }
  const ageRecipient = required(source, 'STUDIO_BACKUP_AGE_RECIPIENT')
  if (!/^age1[a-z0-9]{20,}$/.test(ageRecipient)) {
    throw new Error('STUDIO_BACKUP_AGE_RECIPIENT must be an age public recipient')
  }

  return Object.freeze({
    installationSlug,
    databaseName,
    databaseAdminUrl: databaseAdminUrl.toString(),
    sitePackageId,
    backupEndpoint: backupEndpoint.toString(),
    backupRegion,
    backupBucket,
    backupAccessKeyId: required(source, 'STUDIO_BACKUP_ACCESS_KEY_ID'),
    backupSecretAccessKey: required(source, 'STUDIO_BACKUP_SECRET_ACCESS_KEY'),
    backupRcloneCryptPassword: required(source, 'STUDIO_BACKUP_RCLONE_CRYPT_PASSWORD'),
    ageRecipient,
    retentionDays,
    privateStorageEndpoint: privateStorageEndpoint.toString(),
    privateStorageRegion: required(source, 'PRIVATE_STORAGE_REGION'),
    privateStorageBucket,
    privateStorageAccessKeyId: required(source, 'PRIVATE_STORAGE_ACCESS_KEY_ID'),
    privateStorageSecretAccessKey: required(source, 'PRIVATE_STORAGE_SECRET_ACCESS_KEY'),
  })
}

export function createStudioBackupPlan(
  config,
  { now = new Date(), temporaryRoot = defaultTemporaryRoot() } = {},
) {
  requireAbsoluteRoot(temporaryRoot, 'Backup temporary root')
  const stamp = compactTimestamp(now)
  const dayPrefix = `${config.installationSlug}/${now.getUTCFullYear()}/${pad(now.getUTCMonth() + 1)}/${pad(now.getUTCDate())}`
  const basename = `${config.installationSlug}-${stamp}`
  const temporaryDirectory = joinPortable(temporaryRoot, basename)
  const dumpPath = joinPortable(temporaryDirectory, `${basename}.dump`)
  const encryptedArchivePath = `${dumpPath}.age`
  const metadataPath = joinPortable(temporaryDirectory, `${basename}.metadata.json`)
  const remoteArchiveKey = `${dayPrefix}/${basename}.dump.age`
  const remoteMetadataKey = `${dayPrefix}/${basename}.metadata.json`
  const remoteMediaPrefix = `${config.installationSlug}/media/`

  return Object.freeze({
    installationSlug: config.installationSlug,
    encrypted: true,
    retentionDays: config.retentionDays,
    temporaryDirectory,
    dumpPath,
    encryptedArchivePath,
    metadataPath,
    remoteArchiveKey,
    remoteMetadataKey,
    remoteMediaPrefix,
    commands: Object.freeze([
      command('pg_dump', ['--format=custom', '--no-owner', '--no-acl', `--file=${dumpPath}`, config.databaseName],
        `pg_dump --format=custom --no-owner --no-acl --file=${dumpPath} ${config.databaseName} (PG* environment)`),
      command('age', ['--recipient', config.ageRecipient, '--output', encryptedArchivePath, dumpPath],
        `age --recipient ${config.ageRecipient} --output ${encryptedArchivePath} ${dumpPath}`),
      command('rclone', [
        'copy',
        `studio-media:${config.privateStorageBucket}`,
        'studio-backup-crypt:media',
        '--immutable',
      ], `rclone copy studio-media:${config.privateStorageBucket} studio-backup-crypt:media --immutable (encrypted remote; credentials in environment)`),
      command('aws', ['s3', 'cp', encryptedArchivePath, `s3://${config.backupBucket}/${remoteArchiveKey}`, '--endpoint-url', config.backupEndpoint],
        `aws s3 cp ${encryptedArchivePath} s3://${config.backupBucket}/${remoteArchiveKey} --endpoint-url ${config.backupEndpoint}`),
      command('aws', ['s3', 'cp', metadataPath, `s3://${config.backupBucket}/${remoteMetadataKey}`, '--endpoint-url', config.backupEndpoint],
        `aws s3 cp ${metadataPath} s3://${config.backupBucket}/${remoteMetadataKey} --endpoint-url ${config.backupEndpoint}`),
    ]),
  })
}

export function createRestoreVerificationPlan(
  config,
  {
    encryptedArchivePath,
    temporaryRoot = defaultTemporaryRoot('restore'),
    restoreDatabaseName = `${config.databaseName}_restore_test`,
    ageIdentityFile = process.env.STUDIO_BACKUP_AGE_IDENTITY_FILE || '<age-identity-file>',
  },
) {
  requireAbsoluteRoot(temporaryRoot, 'Restore temporary root')
  if (!isAbsolute(encryptedArchivePath)) {
    throw new Error('Encrypted restore archive path must be absolute')
  }
  const expectedRestoreDatabase = `${config.databaseName}_restore_test`
  if (restoreDatabaseName !== expectedRestoreDatabase || !postgresIdentifierPattern.test(restoreDatabaseName)) {
    throw new Error(`Restore verification database must be exactly ${expectedRestoreDatabase}`)
  }
  const temporaryDirectory = joinPortable(temporaryRoot, restoreDatabaseName)
  const decryptedDumpPath = joinPortable(temporaryDirectory, `${config.installationSlug}.dump`)
  const validationSql = `SELECT package_id || ':' || package_version || ':' || schema_version FROM cms_site_package_state WHERE key = 'default' AND package_id = '${config.sitePackageId}'`

  return Object.freeze({
    installationSlug: config.installationSlug,
    restoreDatabaseName,
    temporaryDirectory,
    decryptedDumpPath,
    encryptedArchivePath,
    commands: Object.freeze([
      command('createdb', [restoreDatabaseName], `createdb ${restoreDatabaseName} (PG* environment)`),
      command('age', ['--decrypt', '--identity', ageIdentityFile, '--output', decryptedDumpPath, encryptedArchivePath],
        `age --decrypt --identity <age-identity-file> --output ${decryptedDumpPath} ${encryptedArchivePath}`),
      command('pg_restore', ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', restoreDatabaseName, decryptedDumpPath],
        `pg_restore --exit-on-error --no-owner --no-acl --dbname ${restoreDatabaseName} ${decryptedDumpPath} (PG* environment)`),
      command('psql', ['--dbname', restoreDatabaseName, '--tuples-only', '--no-align', '--command', validationSql],
        `psql --dbname ${restoreDatabaseName} --tuples-only --no-align --command <package-state-validation> (PG* environment)`),
      command('dropdb', ['--if-exists', restoreDatabaseName], `dropdb --if-exists ${restoreDatabaseName} (PG* environment)`),
    ]),
  })
}

export async function executeStudioBackup(config, plan, { run = runCommand, now = new Date() } = {}) {
  assertOwnedTemporaryDirectory(plan.temporaryDirectory, config.installationSlug)
  await mkdir(dirname(plan.temporaryDirectory), { recursive: true, mode: 0o700 })
  await mkdir(plan.temporaryDirectory, { recursive: false, mode: 0o700 })
  try {
    await run(plan.commands[0], { env: postgresEnvironment(config.databaseAdminUrl) })
    await run(plan.commands[1], { env: process.env })
    const archive = await readFile(plan.encryptedArchivePath)
    const metadata = {
      formatVersion: 1,
      installationSlug: config.installationSlug,
      sitePackageId: config.sitePackageId,
      createdAt: now.toISOString(),
      encryptedArchive: plan.encryptedArchivePath.split(/[\\/]/).at(-1),
      sha256: createHash('sha256').update(archive).digest('hex'),
      byteSize: (await stat(plan.encryptedArchivePath)).size,
      retentionDays: config.retentionDays,
    }
    await writeFile(plan.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    await chmod(plan.metadataPath, 0o600)
    await run(plan.commands[2], { env: rcloneEnvironment(config) })
    await run(plan.commands[3], { env: awsEnvironment(config) })
    await run(plan.commands[4], { env: awsEnvironment(config) })
    return metadata
  } finally {
    await rm(plan.temporaryDirectory, { recursive: true, force: true })
  }
}

export async function executeRestoreVerification(config, plan, { run = runCommand } = {}) {
  assertOwnedRestoreDatabase(config, plan.restoreDatabaseName)
  assertOwnedTemporaryDirectory(plan.temporaryDirectory, plan.restoreDatabaseName)
  await mkdir(dirname(plan.temporaryDirectory), { recursive: true, mode: 0o700 })
  await mkdir(plan.temporaryDirectory, { recursive: false, mode: 0o700 })
  let verified = false
  try {
    const pgEnvironment = postgresEnvironment(config.databaseAdminUrl)
    await run(plan.commands[0], { env: pgEnvironment })
    await run(plan.commands[1], { env: process.env })
    await run(plan.commands[2], { env: pgEnvironment })
    const validation = await run(plan.commands[3], { env: pgEnvironment })
    if (!validation.stdout.trim().startsWith(`${config.sitePackageId}:`)) {
      throw new Error('Restored database Site Package state did not validate')
    }
    await run(plan.commands[4], { env: pgEnvironment })
    verified = true
    return { restoreDatabaseName: plan.restoreDatabaseName, verified: true }
  } finally {
    await rm(plan.temporaryDirectory, { recursive: true, force: true })
    if (!verified) {
      process.stderr.write(`Restore verification failed; validated test database ${plan.restoreDatabaseName} was not dropped automatically. Inspect it before explicit cleanup.\n`)
    }
  }
}

export function selectExpiredBackupObjects(objects, { installationSlug, retentionDays, now = new Date() }) {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000
  const prefix = `${installationSlug}/`
  return objects
    .filter((object) => typeof object.key === 'string' && object.key.startsWith(prefix))
    .filter((object) => new Date(object.lastModified).getTime() < cutoff)
    .map((object) => object.key)
}

export function requireStudioOperationConfirmation(action, installationSlug, argv) {
  const expected = `--confirm=${action}:${installationSlug}`
  if (!argv.includes('--execute') || !argv.includes(expected)) {
    throw new Error(`${action} requires --execute ${expected}`)
  }
}

function command(program, args, display) {
  return Object.freeze({ program, args: Object.freeze(args), display })
}

async function runCommand(commandSpec, { env }) {
  const child = Bun.spawn([commandSpec.program, ...commandSpec.args], {
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(`${commandSpec.program} failed: ${stderr.trim() || `exit ${exitCode}`}`)
  return { stdout, stderr, exitCode }
}

function postgresEnvironment(databaseUrl) {
  const url = new URL(databaseUrl)
  const environment = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
  }
  for (const [parameter, environmentName] of [
    ['sslmode', 'PGSSLMODE'],
    ['sslrootcert', 'PGSSLROOTCERT'],
    ['sslcert', 'PGSSLCERT'],
    ['sslkey', 'PGSSLKEY'],
  ]) {
    const value = url.searchParams.get(parameter)
    if (value) environment[environmentName] = value
  }
  return environment
}

function awsEnvironment(config) {
  return {
    ...process.env,
    AWS_ACCESS_KEY_ID: config.backupAccessKeyId,
    AWS_SECRET_ACCESS_KEY: config.backupSecretAccessKey,
    AWS_DEFAULT_REGION: config.backupRegion,
  }
}

function rcloneEnvironment(config) {
  return {
    ...process.env,
    RCLONE_CONFIG_STUDIO_MEDIA_TYPE: 's3',
    RCLONE_CONFIG_STUDIO_MEDIA_PROVIDER: 'Other',
    RCLONE_CONFIG_STUDIO_MEDIA_ENDPOINT: config.privateStorageEndpoint,
    RCLONE_CONFIG_STUDIO_MEDIA_REGION: config.privateStorageRegion,
    RCLONE_CONFIG_STUDIO_MEDIA_ACCESS_KEY_ID: config.privateStorageAccessKeyId,
    RCLONE_CONFIG_STUDIO_MEDIA_SECRET_ACCESS_KEY: config.privateStorageSecretAccessKey,
    RCLONE_CONFIG_STUDIO_BACKUP_TYPE: 's3',
    RCLONE_CONFIG_STUDIO_BACKUP_PROVIDER: 'Other',
    RCLONE_CONFIG_STUDIO_BACKUP_ENDPOINT: config.backupEndpoint,
    RCLONE_CONFIG_STUDIO_BACKUP_REGION: config.backupRegion,
    RCLONE_CONFIG_STUDIO_BACKUP_ACCESS_KEY_ID: config.backupAccessKeyId,
    RCLONE_CONFIG_STUDIO_BACKUP_SECRET_ACCESS_KEY: config.backupSecretAccessKey,
    RCLONE_CONFIG_STUDIO_BACKUP_CRYPT_TYPE: 'crypt',
    RCLONE_CONFIG_STUDIO_BACKUP_CRYPT_REMOTE: `studio-backup:${config.backupBucket}/${config.installationSlug}`,
    RCLONE_CONFIG_STUDIO_BACKUP_CRYPT_FILENAME_ENCRYPTION: 'standard',
    RCLONE_CONFIG_STUDIO_BACKUP_CRYPT_DIRECTORY_NAME_ENCRYPTION: 'true',
    RCLONE_CONFIG_STUDIO_BACKUP_CRYPT_PASSWORD: config.backupRcloneCryptPassword,
  }
}

function assertOwnedRestoreDatabase(config, databaseName) {
  if (databaseName !== `${config.databaseName}_restore_test`) {
    throw new Error(`Restore verification database must be exactly ${config.databaseName}_restore_test`)
  }
}

function assertOwnedTemporaryDirectory(directory, expectedLeaf) {
  const normalized = resolve(directory)
  const leaf = normalized.split(/[\\/]/).at(-1)
  if (!leaf?.startsWith(expectedLeaf) || normalized === resolve(sep)) {
    throw new Error('Refusing to operate on an unvalidated temporary directory')
  }
}

function requireAbsoluteRoot(root, label) {
  if (!isAbsolute(root)) throw new Error(`${label} must be an absolute path`)
}

function joinPortable(root, leaf) {
  return root.includes('/') && !root.includes('\\') ? posix.join(root, leaf) : join(root, leaf)
}

function defaultTemporaryRoot(kind = 'backup') {
  return resolve('.scratch', `studio-${kind}`)
}

function compactTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function required(source, name) {
  const value = source[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function httpsUrl(value, name) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL`)
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(`${name} must be a credential-free HTTPS URL`)
  }
  return url
}

function postgresUrl(value, name) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL URL`)
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.password) {
    throw new Error(`${name} must include PostgreSQL host, role, password, and database`)
  }
  return url
}

async function main(argv) {
  if (argv.length < 3 || argv[1] !== '--env') {
    throw new Error('Usage: bun scripts/studio-backup.mjs <plan|backup|restore-plan|restore-verify> --env <customer.env> [options]')
  }
  const action = argv[0]
  const envFile = argv[2]
  const source = parseStudioEnvironmentFile(await Bun.file(envFile).text())
  const config = validateStudioBackupConfig(source)

  if (action === 'plan') {
    const plan = createStudioBackupPlan(config)
    process.stdout.write(`${plan.commands.map(({ display }) => display).join('\n')}\n`)
    process.stdout.write(`Retention: ${plan.retentionDays} days under ${config.installationSlug}/ only\n`)
    return
  }
  if (action === 'restore-plan' || action === 'restore-verify') {
    const archiveIndex = argv.indexOf('--archive')
    if (archiveIndex === -1 || !argv[archiveIndex + 1]) throw new Error('--archive <absolute-path> is required')
    const encryptedArchivePath = resolve(argv[archiveIndex + 1])
    const ageIdentityFile = process.env.STUDIO_BACKUP_AGE_IDENTITY_FILE
    const plan = createRestoreVerificationPlan(config, {
      encryptedArchivePath,
      ageIdentityFile: ageIdentityFile || '<age-identity-file>',
    })
    if (action === 'restore-plan') {
      process.stdout.write(`${plan.commands.map(({ display }) => display).join('\n')}\n`)
      return
    }
    requireStudioOperationConfirmation('restore-verify', config.installationSlug, argv)
    if (!ageIdentityFile || !isAbsolute(ageIdentityFile)) {
      throw new Error('STUDIO_BACKUP_AGE_IDENTITY_FILE must be an absolute path for restore verification')
    }
    const result = await executeRestoreVerification(config, plan)
    process.stdout.write(`Restore verified in and removed ${result.restoreDatabaseName}.\n`)
    return
  }
  if (action === 'backup') {
    requireStudioOperationConfirmation('backup', config.installationSlug, argv)
    const plan = createStudioBackupPlan(config)
    const metadata = await executeStudioBackup(config, plan)
    process.stdout.write(`Encrypted backup uploaded for ${metadata.installationSlug}; SHA-256 ${metadata.sha256}; ${metadata.byteSize} bytes.\n`)
    return
  }
  throw new Error('Action must be plan, backup, restore-plan, or restore-verify')
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
