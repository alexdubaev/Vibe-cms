import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  activeDeploymentCommitProblems,
  backendEnvironment,
  bootstrapStateMode,
  digestFromRepoDigests,
  executePromotionPipeline,
  githubRepositoryFromRemoteUrl,
  immutableReleaseBranch,
  nonImportableResourceProblem,
  importReleaseInputs,
  parseArguments,
  parseSimpleAssignments,
  planSafetyProblems,
  prepareBootstrapBackend,
  redactArguments,
  releaseGitProblems,
  renderBackendConfig,
  safeTerraformOutputs,
  safeYandexFoundationDestroyAddresses,
  safeYandexMigrationSeedDestroyAddresses,
  sanitizedBuildEnvironment,
  safeYandexSecretVersionDestroyAddresses,
  seedVariables,
  stateKeyForRoot,
  stateRecoveryOutputs,
  staticUploadSteps,
  yandexDatabaseRotationProblems,
} from './infra.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('Terraform configuration helpers', () => {
  test('reads only simple top-level tfvars without evaluating interpolation', () => {
    expect(
      parseSimpleAssignments(`
        # Durable project configuration.
        cloud_id = "cloud-id"
        git_branch = 'master' # trailing comment
        enable_cdn = false
        runtime_image_digest = null
        database_blue_password = "\${NOT_EXECUTED}"
        subnets = {
          ru-central1-a = "10.20.0.0/24"
        }
      `),
    ).toEqual({
      cloud_id: 'cloud-id',
      git_branch: 'master',
      enable_cdn: false,
      runtime_image_digest: null,
      database_blue_password: '${NOT_EXECUTED}',
    })
  })

  test('renders credential-free backend configuration for both providers', () => {
    const digitalocean = renderBackendConfig('digitalocean', {
      bucket: 'product-state',
      key: 'production/terraform.tfstate',
      region: 'fra1',
    })
    const yandex = renderBackendConfig('yandex', {
      bucket: 'product-state',
      key: 'production/terraform.tfstate',
      region: 'ru-central1',
    })

    expect(digitalocean).toContain('https://fra1.digitaloceanspaces.com')
    expect(digitalocean).toContain('region = "us-east-1"')
    expect(digitalocean).toContain('skip_s3_checksum')
    expect(yandex).toContain('https://storage.yandexcloud.net')
    expect(yandex).toContain('region = "ru-central1"')
    expect(yandex).toContain('skip_s3_checksum')
    expect(digitalocean.match(/skip_credentials_validation/g)).toHaveLength(1)
    expect(yandex.match(/skip_credentials_validation/g)).toHaveLength(1)
    expect(`${digitalocean}\n${yandex}`).not.toContain('secret')
    expect(`${digitalocean}\n${yandex}`).not.toContain('access_key')
  })

  test('keeps foundation state compatible while isolating release roots', () => {
    expect(stateKeyForRoot('bootstrap')).toBe('bootstrap/terraform.tfstate')
    expect(stateKeyForRoot('foundation')).toBe('production/terraform.tfstate')
    expect(stateKeyForRoot('migration')).toBe('migration/terraform.tfstate')
    expect(stateKeyForRoot('runtime')).toBe('runtime/terraform.tfstate')
    expect(stateKeyForRoot('static')).toBe('static/terraform.tfstate')
  })

  test('protects the database credential slot used by the live Yandex runtime', () => {
    const current = {
      fingerprints: { blue: 'blue-old', green: 'green-old', jwt: 'jwt-old' },
      versions: { blue: 1, green: 1 },
    }

    expect(
      yandexDatabaseRotationProblems({
        current,
        liveSlot: 'blue',
        desired: {
          activeSlot: 'green',
          fingerprints: {
            blue: 'blue-old',
            green: 'green-new',
            jwt: 'jwt-old',
          },
          versions: { blue: 1, green: 2 },
        },
      }),
    ).toEqual([])

    expect(
      yandexDatabaseRotationProblems({
        current: {
          fingerprints: {
            blue: 'blue-old',
            green: 'green-new',
            jwt: 'jwt-old',
          },
          versions: { blue: 1, green: 2 },
        },
        liveSlot: 'green',
        desired: {
          activeSlot: 'green',
          fingerprints: {
            blue: 'blue-new',
            green: 'green-new',
            jwt: 'jwt-old',
          },
          versions: { blue: 2, green: 2 },
        },
      }),
    ).toEqual([])

    expect(
      yandexDatabaseRotationProblems({
        current,
        liveSlot: 'blue',
        desired: {
          activeSlot: 'green',
          fingerprints: { blue: 'blue-new', green: 'green-new' },
          versions: { blue: 2, green: 2 },
        },
      }),
    ).toEqual([
      'database credential slot blue is still used by the live runtime; rotate only the inactive slot before switching',
    ])

    expect(
      yandexDatabaseRotationProblems({
        current: {
          fingerprints: {
            blue: 'blue-old',
            green: 'green-new',
            jwt: 'jwt-old',
          },
          versions: { blue: 1, green: 2 },
        },
        liveSlot: 'blue',
        desired: {
          activeSlot: 'green',
          fingerprints: {
            blue: 'blue-old',
            green: 'green-new',
            jwt: 'jwt-old',
          },
          versions: { blue: 1, green: 2 },
        },
      }),
    ).toEqual([])

    expect(
      yandexDatabaseRotationProblems({
        current: null,
        liveSlot: 'blue',
        desired: {
          activeSlot: 'green',
          fingerprints: {
            blue: 'blue-old',
            green: 'green-new',
            jwt: 'jwt-old',
          },
          versions: { blue: 1, green: 2 },
        },
      }),
    ).toEqual([
      'the live runtime reports database slot blue, but foundation rotation metadata is missing; import or reconcile state before changing credentials',
    ])

    expect(
      yandexDatabaseRotationProblems({
        current,
        liveSlot: 'blue',
        desired: {
          activeSlot: 'green',
          fingerprints: {
            blue: 'blue-old',
            green: 'green-old',
            jwt: 'jwt-new',
          },
          versions: { blue: 1, green: 1 },
        },
      }),
    ).toEqual([
      'JWT_SECRET is present in both persistent runtime slot versions; rotate it only after implementing an application key-overlap flow',
    ])
  })

  test('allows replacement only for non-live Yandex Lockbox versions', () => {
    expect(safeYandexSecretVersionDestroyAddresses('blue')).toEqual([
      'yandex_lockbox_secret_version_hashed.runtime["green"]',
      'yandex_lockbox_secret_version_hashed.migration_database',
    ])
    expect(safeYandexSecretVersionDestroyAddresses(null)).toEqual([
      'yandex_lockbox_secret_version_hashed.runtime["blue"]',
      'yandex_lockbox_secret_version_hashed.runtime["green"]',
      'yandex_lockbox_secret_version_hashed.migration_database',
    ])
  })

  test('allows only the known ephemeral Yandex cleanup deletes on restart', () => {
    const interruptedFoundationPlan = {
      resource_changes: [
        {
          address:
            'yandex_resourcemanager_folder_iam_member.storage_manager[0]',
          change: { actions: ['delete'] },
        },
      ],
    }
    const interruptedSeedCleanupPlan = {
      resource_changes: [
        {
          address: 'yandex_lockbox_secret.admin_seed[0]',
          change: { actions: ['delete'] },
        },
        {
          address:
            'yandex_lockbox_secret_version_hashed.admin_seed[0]',
          change: { actions: ['delete'] },
        },
        {
          address: 'yandex_lockbox_secret_iam_member.admin_seed[0]',
          change: { actions: ['delete'] },
        },
      ],
    }

    expect(
      planSafetyProblems(
        interruptedFoundationPlan,
        safeYandexFoundationDestroyAddresses(),
      ),
    ).toEqual([])
    expect(
      planSafetyProblems(
        interruptedSeedCleanupPlan,
        safeYandexMigrationSeedDestroyAddresses(),
      ),
    ).toEqual([])
    expect(safeYandexFoundationDestroyAddresses()).toEqual([
      'yandex_resourcemanager_folder_iam_member.storage_manager[0]',
    ])
    expect(safeYandexMigrationSeedDestroyAddresses()).toEqual([
      'yandex_lockbox_secret.admin_seed[0]',
      'yandex_lockbox_secret_version_hashed.admin_seed[0]',
      'yandex_lockbox_secret_iam_member.admin_seed[0]',
    ])
  })

  test('copyable production examples leave environment-injected secrets unassigned', () => {
    const digitalocean = parseSimpleAssignments(
      readFileSync(
        resolve(
          repoRoot,
          'infra/digitalocean/production/terraform.tfvars.example',
        ),
        'utf8',
      ),
    )
    const yandex = parseSimpleAssignments(
      readFileSync(
        resolve(repoRoot, 'infra/yandex/production/terraform.tfvars.example'),
        'utf8',
      ),
    )

    expect(digitalocean).not.toHaveProperty('jwt_secret')
    expect(digitalocean).not.toHaveProperty('extra_runtime_secret_env')
    expect(yandex).not.toHaveProperty('database_blue_password')
    expect(yandex).not.toHaveProperty('database_green_password')
    expect(yandex).not.toHaveProperty('database_owner_password')
    expect(yandex).not.toHaveProperty('jwt_secret')
  })

  test('resumes local-to-remote migration after an interrupted bootstrap', () => {
    expect(
      bootstrapStateMode({ hasStateEnvironment: false, hasLocalState: false }),
    ).toBe('ambiguous')
    expect(
      bootstrapStateMode({
        hasStateEnvironment: false,
        hasLocalState: false,
        newBootstrap: true,
      }),
    ).toBe('local')
    expect(
      bootstrapStateMode({ hasStateEnvironment: false, hasLocalState: true }),
    ).toBe('local')
    expect(
      bootstrapStateMode({ hasStateEnvironment: true, hasLocalState: true }),
    ).toBe('migrate')
    expect(
      bootstrapStateMode({ hasStateEnvironment: true, hasLocalState: false }),
    ).toBe('remote')
    expect(
      bootstrapStateMode({
        hasStateEnvironment: false,
        hasLocalState: false,
        recoverExisting: true,
      }),
    ).toBe('recover')
  })

  test('builds reattach configuration only from paired recovery signals', () => {
    expect(
      stateRecoveryOutputs(
        { bucket: 'existing-state', region: 'fra1' },
        {
          TF_STATE_RECOVERY_ACCESS_KEY_ID: 'temporary-id',
          TF_STATE_RECOVERY_SECRET_ACCESS_KEY: 'temporary-secret',
        },
      ),
    ).toEqual({
      state_bucket: 'existing-state',
      state_region: 'fra1',
      state_access_key_id: 'temporary-id',
      state_secret_access_key: 'temporary-secret',
    })
    expect(() =>
      stateRecoveryOutputs(
        { bucket: 'existing-state', region: 'fra1' },
        { TF_STATE_RECOVERY_ACCESS_KEY_ID: 'temporary-id' },
      ),
    ).toThrow('TF_STATE_RECOVERY_SECRET_ACCESS_KEY')
  })

  test('verifies migrated state before deleting local recovery state', () => {
    const events = []
    const outputs = {
      state_bucket: 'state-bucket',
      state_region: 'fra1',
      state_access_key_id: 'scoped-id',
      state_secret_access_key: 'scoped-secret',
    }

    prepareBootstrapBackend(
      {
        provider: 'digitalocean',
        paths: { bootstrapRoot: '/bootstrap', productionRoot: '/production' },
        stateMode: 'migrate',
        dryRun: false,
        remoteEnvironment: { AWS_ACCESS_KEY_ID: 'scoped-id' },
        expectedStateBucket: 'state-bucket',
      },
      {
        initialize: (_root, _env, args) => events.push(['init', ...args]),
        readOutputs: () => {
          events.push(['verify'])
          return outputs
        },
        removeLocalState: () => events.push(['remove-local-state']),
        writeArtifacts: () => events.push(['write-artifacts']),
      },
    )

    expect(events).toEqual([
      [
        'init',
        '-migrate-state',
        '-force-copy',
        '-backend-config=backend.backend.hcl',
      ],
      ['verify'],
      ['remove-local-state'],
      ['write-artifacts'],
    ])
  })

  test('keeps local state when remote migration verification fails', () => {
    const events = []

    expect(() =>
      prepareBootstrapBackend(
        {
          provider: 'yandex',
          paths: { bootstrapRoot: '/bootstrap', productionRoot: '/production' },
          stateMode: 'migrate',
          dryRun: false,
          remoteEnvironment: {},
          expectedStateBucket: 'expected-state-bucket',
        },
        {
          initialize: () => events.push('init'),
          readOutputs: () => ({
            state_bucket: 'wrong-state-bucket',
            state_region: 'ru-central1',
            state_access_key_id: 'scoped-id',
            state_secret_access_key: 'scoped-secret',
          }),
          removeLocalState: () => events.push('remove-local-state'),
          writeArtifacts: () => events.push('write-artifacts'),
        },
      ),
    ).toThrow('different state bucket')
    expect(events).toEqual(['init'])
  })

  test('refuses to plan against an empty remote bootstrap state', () => {
    expect(() =>
      prepareBootstrapBackend(
        {
          provider: 'digitalocean',
          paths: { bootstrapRoot: '/bootstrap', productionRoot: '/production' },
          stateMode: 'remote',
          dryRun: false,
          remoteEnvironment: {},
        },
        {
          initialize: () => {},
          readOutputs: () => ({}),
        },
      ),
    ).toThrow('required state outputs')
  })

  test('maps the scoped state key only to the S3 backend environment', () => {
    expect(
      backendEnvironment(
        {
          TF_STATE_ACCESS_KEY_ID: 'scoped-id',
          TF_STATE_SECRET_ACCESS_KEY: 'scoped-secret',
        },
        { KEEP_ME: 'yes' },
      ),
    ).toEqual({
      KEEP_ME: 'yes',
      AWS_ACCESS_KEY_ID: 'scoped-id',
      AWS_SECRET_ACCESS_KEY: 'scoped-secret',
    })
    expect(() =>
      backendEnvironment({ TF_STATE_ACCESS_KEY_ID: 'only-one' }),
    ).toThrow('state backend credentials')
  })
})

describe('release safety', () => {
  test('normalizes supported GitHub remote URLs to the App Platform repository form', () => {
    expect(
      githubRepositoryFromRemoteUrl('git@github.com:Owner/Repository.git'),
    ).toBe('owner/repository')
    expect(
      githubRepositoryFromRemoteUrl('https://github.com/Owner/Repository.git'),
    ).toBe('owner/repository')
    expect(
      githubRepositoryFromRemoteUrl(
        'ssh://git@github.com/Owner/Repository.git',
      ),
    ).toBe('owner/repository')
    expect(
      githubRepositoryFromRemoteUrl('git@gitlab.com:owner/repository.git'),
    ).toBeNull()
  })

  test('refuses a dirty, detached, unpushed, wrong-ref, or wrong-repository release source', () => {
    expect(
      releaseGitProblems({
        currentBranch: 'master',
        configuredBranch: 'production',
        upstreamRef: 'origin/other',
        headCommit: 'local-commit',
        upstreamCommit: 'remote-commit',
        configuredGithubRepo: 'owner/product',
        upstreamGithubRepo: 'someone/else',
        dirtyLines: [' M backend/src/index.ts'],
      }),
    ).toHaveLength(5)

    expect(
      releaseGitProblems({
        currentBranch: 'master',
        configuredBranch: 'master',
        upstreamRef: 'origin/master',
        headCommit: 'same-commit',
        upstreamCommit: 'same-commit',
        configuredGithubRepo: 'owner/product',
        upstreamGithubRepo: 'owner/product',
        dirtyLines: [],
      }),
    ).toEqual([])

    expect(
      releaseGitProblems({
        currentBranch: 'master',
        configuredBranch: 'master',
        upstreamRef: 'origin/master',
        headCommit: 'new-commit',
        upstreamCommit: 'new-commit',
        expectedCommit: 'captured-commit',
        configuredGithubRepo: 'owner/product',
        upstreamGithubRepo: 'owner/product',
        dirtyLines: [],
      }),
    ).toEqual([
      'release source changed after preflight: expected captured-commit, found new-commit',
    ])
  })

  test('shows only explicitly safe Terraform outputs', () => {
    expect(
      safeTerraformOutputs('yandex', {
        api_url: 'https://api.example.com',
        database_credential_slot: 'green',
        required_dns_records: { api: { value: 'gateway.example' } },
        static_publisher_access_key_id: 'public-but-operationally-secret',
        static_publisher_secret_access_key: 'secret',
      }),
    ).toEqual({
      api_url: 'https://api.example.com',
      database_credential_slot: 'green',
      required_dns_records: { api: { value: 'gateway.example' } },
    })
  })

  test('allows creates and updates, but requires exact opt-in for ordinary deletes', () => {
    const plan = {
      resource_changes: [
        { address: 'digitalocean_app.api[0]', change: { actions: ['update'] } },
        {
          address: 'digitalocean_app.website[0]',
          change: { actions: ['delete'] },
        },
      ],
    }

    expect(planSafetyProblems(plan, [])).toEqual([
      'digitalocean_app.website[0] would be deleted; pass --allow-destroy=digitalocean_app.website[0] only after reviewing that exact resource',
    ])
    expect(planSafetyProblems(plan, ['digitalocean_app.website[0]'])).toEqual(
      [],
    )
  })

  test('never accepts deletion or replacement of protected stateful resources', () => {
    const plan = {
      resource_changes: [
        {
          address: 'yandex_mdb_postgresql_cluster.production',
          change: { actions: ['delete', 'create'] },
        },
        {
          address: 'yandex_storage_bucket.media',
          change: { actions: ['delete'] },
        },
        {
          address:
            'yandex_iam_service_account_static_access_key.terraform_state',
          change: { actions: ['delete', 'create'] },
        },
      ],
    }

    const problems = planSafetyProblems(plan, [
      'yandex_mdb_postgresql_cluster.production',
      'yandex_storage_bucket.media',
      'yandex_iam_service_account_static_access_key.terraform_state',
    ])
    expect(problems).toHaveLength(3)
    expect(problems.every((problem) => problem.includes('protected'))).toBe(
      true,
    )
  })

  test('executes provider phases in migration-gated order', async () => {
    const digitaloceanEvents = []
    await executePromotionPipeline('digitalocean', {
      deployRuntime: async () => {
        digitaloceanEvents.push('runtime-with-pre-deploy-migration')
        return { api_app_id: 'app-id' }
      },
      tightenFoundation: async () =>
        digitaloceanEvents.push('tighten-firewall'),
      deployStatic: async () => {
        digitaloceanEvents.push('static')
        return { release_revision: 'commit' }
      },
      verify: async () => digitaloceanEvents.push('verify'),
    })
    expect(digitaloceanEvents).toEqual([
      'runtime-with-pre-deploy-migration',
      'tighten-firewall',
      'static',
      'verify',
    ])

    const yandexEvents = []
    await expect(
      executePromotionPipeline('yandex', {
        deployMigration: async () => {
          yandexEvents.push('migration-revision')
          return { url: 'migration-url' }
        },
        invokeMigration: async () => {
          yandexEvents.push('invoke-migration')
          throw new Error('migration failed')
        },
        removeMigrationSeed: async () => yandexEvents.push('remove-seed'),
        deployRuntime: async () => yandexEvents.push('runtime'),
        publishStatic: async () => yandexEvents.push('static'),
        verify: async () => yandexEvents.push('verify'),
      }),
    ).rejects.toThrow('migration failed')
    expect(yandexEvents).toEqual(['migration-revision', 'invoke-migration'])

    const successfulYandexEvents = []
    await executePromotionPipeline('yandex', {
      deployMigration: async () => {
        successfulYandexEvents.push('migration-revision')
        return { url: 'migration-url' }
      },
      invokeMigration: async () => successfulYandexEvents.push('migration-ok'),
      removeMigrationSeed: async () =>
        successfulYandexEvents.push('remove-seed'),
      deployRuntime: async () => {
        successfulYandexEvents.push('runtime')
        return { api_url: 'https://api.example.com' }
      },
      publishStatic: async () => successfulYandexEvents.push('static'),
      verify: async () => successfulYandexEvents.push('verify'),
    })
    expect(successfulYandexEvents).toEqual([
      'migration-revision',
      'migration-ok',
      'remove-seed',
      'runtime',
      'static',
      'verify',
    ])
  })

  test('pins DigitalOcean static source to one immutable commit branch', () => {
    const commit = '0123456789abcdef0123456789abcdef01234567'
    expect(immutableReleaseBranch(commit)).toBe(`infra-release/${commit}`)
    expect(() => immutableReleaseBranch('short')).toThrow('40-character')

    expect(
      activeDeploymentCommitProblems(
        [
          {
            phase: 'ACTIVE',
            static_sites: [{ name: 'webapp', source_commit_hash: commit }],
          },
        ],
        commit,
        'webapp',
      ),
    ).toEqual([])
    expect(
      activeDeploymentCommitProblems(
        {
          deployments: [
            {
              phase: 'ACTIVE',
              static_sites: [
                { name: 'website', source_commit_hash: 'wrong-commit' },
              ],
            },
          ],
        },
        commit,
        'website',
      ),
    ).toEqual([`website deployed wrong-commit, expected ${commit}`])
  })

  test('requires adoption inputs that materialize conditional release roots', () => {
    const digest = `sha256:${'a'.repeat(64)}`
    const commit = '0123456789abcdef0123456789abcdef01234567'
    expect(
      importReleaseInputs('digitalocean', 'runtime', {
        runtimeImageDigest: digest,
      }),
    ).toMatchObject({ runtime_image_digest: digest })
    expect(
      importReleaseInputs('digitalocean', 'static', {
        releaseRevision: commit,
        sourceBranch: `infra-release/${commit}`,
      }),
    ).toEqual({
      release_revision: commit,
      source_branch: `infra-release/${commit}`,
    })
    expect(
      importReleaseInputs('yandex', 'migration', {
        runtimeImageDigest: digest,
      }),
    ).toMatchObject({ migration_image_digest: digest })
    expect(() => importReleaseInputs('yandex', 'runtime', {})).toThrow(
      '--runtime-image-digest',
    )
  })

  test('rejects provider access keys that cannot be imported or recover secrets', () => {
    expect(
      nonImportableResourceProblem(
        'digitalocean',
        'digitalocean_spaces_key.media',
      ),
    ).toContain('create a new Terraform-owned key')
    expect(
      nonImportableResourceProblem(
        'yandex',
        'yandex_iam_service_account_static_access_key.static_publisher',
      ),
    ).toContain('create a new Terraform-owned key')
    expect(
      nonImportableResourceProblem(
        'yandex',
        'yandex_storage_bucket.media',
      ),
    ).toBeNull()
  })

  test('parses explicit import roots and adoption values', () => {
    const commit = '0123456789abcdef0123456789abcdef01234567'
    expect(
      parseArguments([
        'import',
        'digitalocean',
        'static',
        'digitalocean_app.webapp',
        'app-id',
        `--release-revision=${commit}`,
        `--source-branch=infra-release/${commit}`,
      ]),
    ).toMatchObject({
      provider: 'digitalocean',
      rootName: 'static',
      resourceAddress: 'digitalocean_app.webapp',
      resourceId: 'app-id',
      releaseRevision: commit,
      sourceBranch: `infra-release/${commit}`,
    })
  })

  test('requires explicit and unambiguous bootstrap creation or recovery flags', () => {
    expect(parseArguments(['bootstrap', 'yandex', '--new'])).toMatchObject({
      newBootstrap: true,
    })
    expect(
      parseArguments([
        'bootstrap',
        'digitalocean',
        '--recover-state-bucket=existing-state',
        '--recover-state-region=fra1',
      ]),
    ).toMatchObject({
      recoverStateBucket: 'existing-state',
      recoverStateRegion: 'fra1',
    })
    expect(() =>
      parseArguments([
        'bootstrap',
        'yandex',
        '--recover-state-bucket=existing-state',
      ]),
    ).toThrow('both --recover-state-bucket and --recover-state-region')
    expect(() =>
      parseArguments([
        'bootstrap',
        'yandex',
        '--new',
        '--recover-state-bucket=existing-state',
        '--recover-state-region=ru-central1',
      ]),
    ).toThrow('mutually exclusive')
  })

  test('extracts only a digest belonging to the pushed repository', () => {
    const digest = 'sha256:d'.padEnd(71, 'd')
    expect(
      digestFromRepoDigests(
        [
          'registry.example/other@sha256:eeee',
          `registry.example/product/backend@${digest}`,
        ],
        'registry.example/product/backend',
      ),
    ).toBe(digest)
    expect(() =>
      digestFromRepoDigests([], 'registry.example/product/backend'),
    ).toThrow('immutable digest')
  })

  test('redacts credential-shaped arguments before logging commands', () => {
    const rendered = redactArguments([
      'plan',
      '-var',
      'jwt_secret=super-secret',
      '--header',
      'Authorization: Bearer token-value',
      '--normal',
      'visible',
    ]).join(' ')

    expect(rendered).not.toContain('super-secret')
    expect(rendered).not.toContain('token-value')
    expect(rendered).toContain('visible')
    expect(rendered).toContain('[REDACTED]')
  })

  test('does not expose cloud or Terraform secrets to frontend build processes', () => {
    expect(
      sanitizedBuildEnvironment({
        PATH: '/tools',
        HOME: '/home/builder',
        TF_VAR_database_blue_password: 'blue-database-secret',
        TF_VAR_database_green_password: 'green-database-secret',
        DIGITALOCEAN_TOKEN: 'do-secret',
        SPACES_SECRET_ACCESS_KEY: 'spaces-secret',
        AWS_SECRET_ACCESS_KEY: 'aws-secret',
        YC_TOKEN: 'yc-secret',
        ADMIN_SEED_PASSWORD: 'seed-secret',
        DATABASE_URL: 'database-url',
        JWT_SECRET: 'jwt-secret',
      }),
    ).toEqual({ PATH: '/tools', HOME: '/home/builder' })
  })

  test('accepts an administrator bootstrap pair but refuses a partial secret', () => {
    expect(
      seedVariables({
        ADMIN_SEED_EMAIL: ' owner@example.com ',
        ADMIN_SEED_PASSWORD: 'one-time-password',
      }),
    ).toEqual({
      admin_seed_email: 'owner@example.com',
      admin_seed_password: 'one-time-password',
    })
    expect(seedVariables({})).toBeNull()
    expect(() =>
      seedVariables({ ADMIN_SEED_EMAIL: 'owner@example.com' }),
    ).toThrow('must be supplied together')
  })
})

describe('Yandex static publishing', () => {
  test('keeps old immutable assets but deletes stale mutable routes', () => {
    const steps = staticUploadSteps({
      distDirectory: '/repo/webapp/dist',
      bucket: 'app.example.com',
      immutableDirectory: 'assets',
    })

    expect(steps).toHaveLength(2)
    expect(steps[0].args.join(' ')).toContain('--include assets/*')
    expect(steps[0].args.join(' ')).toContain('immutable')
    expect(steps[0].args).not.toContain('--delete')
    expect(steps[1].args.join(' ')).toContain('--exclude assets/*')
    expect(steps[1].args).toContain('--delete')
  })
})
