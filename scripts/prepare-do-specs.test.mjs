import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';

const repoRoot = resolve(import.meta.dirname, '..');
const backendSpecPath = resolve(repoRoot, '.scratch/deploy/backend-app.yaml');

describe('prepare-do-specs', () => {
  test('requires strong bootstrap admin credentials only for the initial backend deployment', () => {
    const missing = runPrepareSpecs({}, { target: 'backend-initial' });
    expect(missing.status).not.toBe(0);
    expect(`${missing.stdout}\n${missing.stderr}`).toContain('ADMIN_SEED_EMAIL');

    const weak = runPrepareSpecs(
      {
        ADMIN_SEED_EMAIL: 'admin@example.com',
        ADMIN_SEED_PASSWORD: 'password123',
      },
      { target: 'backend-initial' },
    );
    expect(weak.status).not.toBe(0);
    expect(`${weak.stdout}\n${weak.stderr}`).toContain('at least 12 characters');

    for (const password of ['            ', 'aaaaaaaaaaaa', 'adminadminadmin']) {
      const degenerate = runPrepareSpecs(
        {
          ADMIN_SEED_EMAIL: 'admin@example.com',
          ADMIN_SEED_PASSWORD: password,
        },
        { target: 'backend-initial' },
      );
      expect(degenerate.status).not.toBe(0);
      expect(`${degenerate.stdout}\n${degenerate.stderr}`).toContain('ADMIN_SEED_PASSWORD');
    }

    const invalidEmail = runPrepareSpecs(
      {
        ADMIN_SEED_EMAIL: 'a..b@example.com',
        ADMIN_SEED_PASSWORD: 'a-strong-initial-password',
      },
      { target: 'backend-initial' },
    );
    expect(invalidEmail.status).not.toBe(0);

    const whitespaceSensitivePassword = '  whitespace-sensitive-password  ';
    const whitespacePassword = runPrepareSpecs(
      {
        ADMIN_SEED_EMAIL: 'admin@example.com',
        ADMIN_SEED_PASSWORD: whitespaceSensitivePassword,
      },
      { target: 'backend-initial' },
    );
    expect(whitespacePassword.status).toBe(0);
    expect(readFileSync(backendSpecPath, 'utf8')).toContain(
      JSON.stringify(whitespaceSensitivePassword),
    );

    const complete = runPrepareSpecs(
      {
        ADMIN_SEED_EMAIL: 'admin@example.com',
        ADMIN_SEED_PASSWORD: 'a-strong-initial-password',
      },
      { target: 'backend-initial' },
    );
    expect(complete.status).toBe(0);

    const initialSpec = readFileSync(backendSpecPath, 'utf8');
    const [servicesSection, jobsSection = ''] = initialSpec.split('\njobs:\n');
    expect(servicesSection).not.toContain('ADMIN_SEED_PASSWORD');
    expect(jobsSection).toContain('run_command: bun run db:deploy');
    expect(jobsSection).toContain('key: ADMIN_SEED_EMAIL');
    expect(jobsSection).toContain('key: ADMIN_SEED_PASSWORD');
    expect(jobsSection).toContain('type: SECRET');

    const final = runPrepareSpecs();
    expect(final.status).toBe(0);
    const finalSpec = readFileSync(backendSpecPath, 'utf8');
    expect(finalSpec).toContain('run_command: bun run db:deploy');
    expect(finalSpec).not.toContain('ADMIN_SEED_EMAIL');
    expect(finalSpec).not.toContain('ADMIN_SEED_PASSWORD');
  });

  test('rejects placeholder and obviously weak production JWT secrets', () => {
    for (const jwtSecret of [
      'replace-with-at-least-32-random-characters',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ]) {
      const result = runPrepareSpecs({ JWT_SECRET: jwtSecret });

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain('JWT_SECRET');
    }
  });

  test('accepts the scheduler as a worker component', () => {
    // An install that sends email needs exactly this component, because DigitalOcean's scheduled
    // jobs floor at 15 minutes and a password-reset email cannot wait that long.
    const result = runPrepareSpecs({
      DO_BACKEND_WORKER_ENABLED: 'true',
      DO_BACKEND_WORKER_NAME: 'scheduler',
      DO_BACKEND_WORKER_RUN_COMMAND: 'bun run start:scheduler',
    });

    expect(result.status).toBe(0);
    expect(readFileSync(backendSpecPath, 'utf8')).toContain(
      'run_command: "bun run start:scheduler"',
    );
  });

  test('emits the email group into every backend component, or the install sends nothing', () => {
    // The API mints the token, but the drain is what sends. A group on the API alone would
    // deploy a worker that accepts work and silently delivers none of it.
    const result = runPrepareSpecs({
      EMAIL_DELIVERY: 'resend',
      EMAIL_FROM: 'Example <no-reply@example.com>',
      EMAIL_RESEND_API_KEY: 're_live_key',
      DO_BACKEND_WORKER_ENABLED: 'true',
      DO_BACKEND_WORKER_NAME: 'scheduler',
      DO_BACKEND_WORKER_RUN_COMMAND: 'bun run start:scheduler',
      DO_BACKEND_CRON_NAME: 'session-cleanup',
      DO_BACKEND_CRON_TASK: 'auth:sessions:cleanup',
      DO_BACKEND_CRON_SCHEDULE: '0 3 * * *',
    });

    expect(result.status).toBe(0);
    const spec = readFileSync(backendSpecPath, 'utf8');

    // Three components, so three copies of the driver key and of the origin the links use.
    expect(spec.match(/key: EMAIL_DELIVERY/g)).toHaveLength(3);
    expect(spec.match(/key: WEBAPP_ORIGIN/g)).toHaveLength(3);
    // The credential is a secret; the sender address is not.
    expect(spec).toContain('key: EMAIL_RESEND_API_KEY');
    expect(spec).toMatch(/key: EMAIL_RESEND_API_KEY\n\s+value: "re_live_key"\n\s+scope: RUN_TIME\n\s+type: SECRET/);
    expect(spec).toMatch(/key: EMAIL_FROM\n\s+value: "Example <no-reply@example.com>"\n\s+scope: RUN_TIME\n\s+type: GENERAL/);
  });

  test('an install with no email provider gets no email keys at all', () => {
    const result = runPrepareSpecs({});

    expect(result.status).toBe(0);
    expect(readFileSync(backendSpecPath, 'utf8')).not.toContain('key: EMAIL_');
  });

  test('refuses a half-configured email group instead of deploying a silent install', () => {
    // Without the API key the backend would refuse to start; without this check the operator
    // discovers that from a crash loop after the migration job has already run.
    const result = runPrepareSpecs({
      EMAIL_DELIVERY: 'resend',
      EMAIL_FROM: 'no-reply@example.com',
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('EMAIL_RESEND_API_KEY');
  });

  test('refuses provider credentials that no driver would read', () => {
    const result = runPrepareSpecs({ EMAIL_RESEND_API_KEY: 're_live_key' });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('EMAIL_DELIVERY');
  });

  test('refuses an email group the backend would reject at boot', () => {
    // Presence is not enough. A spec that applies and then crash-loops every container is worse
    // than one that never generates, because the PRE_DEPLOY migration has already run by then.
    const base = {
      EMAIL_DELIVERY: 'postbox',
      EMAIL_FROM: 'no-reply@example.com',
      EMAIL_POSTBOX_ACCESS_KEY_ID: 'YCAJEtest',
      EMAIL_POSTBOX_SECRET_ACCESS_KEY: 'YCPtest',
    };

    const malformedSender = runPrepareSpecs({ ...base, EMAIL_FROM: 'Example App' });
    expect(malformedSender.status).not.toBe(0);
    expect(`${malformedSender.stdout}\n${malformedSender.stderr}`).toContain('EMAIL_FROM');

    // The scheme-less form a console copy-paste produces.
    const schemeless = runPrepareSpecs({
      ...base,
      EMAIL_POSTBOX_ENDPOINT: 'postbox.cloud.yandex.net',
    });
    expect(schemeless.status).not.toBe(0);
    expect(`${schemeless.stdout}\n${schemeless.stderr}`).toContain('EMAIL_POSTBOX_ENDPOINT');

    const withPath = runPrepareSpecs({
      ...base,
      EMAIL_POSTBOX_ENDPOINT: 'https://postbox.cloud.yandex.net/v2/email',
    });
    expect(withPath.status).not.toBe(0);
    expect(`${withPath.stdout}\n${withPath.stderr}`).toContain('origin only');

    // The optional keys are validated too: they are emitted into the spec, and the backend
    // refuses them by name at boot exactly like the required ones.
    const badReplyTo = runPrepareSpecs({ ...base, EMAIL_REPLY_TO: 'Support Desk' });
    expect(badReplyTo.status).not.toBe(0);
    expect(`${badReplyTo.stdout}\n${badReplyTo.stderr}`).toContain('EMAIL_REPLY_TO');

    // Above the schema ceiling, which is pinned below the outbox's per-attempt deadline.
    const longTimeout = runPrepareSpecs({ ...base, EMAIL_REQUEST_TIMEOUT_MS: '30000' });
    expect(longTimeout.status).not.toBe(0);
    expect(`${longTimeout.stdout}\n${longTimeout.stderr}`).toContain('EMAIL_REQUEST_TIMEOUT_MS');

    // A credential belonging to the other provider is refused rather than dropped in silence.
    const foreign = runPrepareSpecs({ ...base, EMAIL_RESEND_API_KEY: 're_live_key' });
    expect(foreign.status).not.toBe(0);
    expect(`${foreign.stdout}\n${foreign.stderr}`).toContain('EMAIL_RESEND_API_KEY');

    // But the other provider's *endpoint and region* are not refused, because the backend does
    // not refuse them either - they carry schema defaults, so it cannot tell a set one from a
    // defaulted one. backend/.env.example ships both non-empty, so refusing here would block any
    // operator whose shell has their backend env loaded, with an error blaming the backend.
    const inheritedDefaults = runPrepareSpecs({
      EMAIL_DELIVERY: 'resend',
      EMAIL_FROM: 'no-reply@example.com',
      EMAIL_RESEND_API_KEY: 're_live_key',
      EMAIL_POSTBOX_ENDPOINT: 'https://postbox.cloud.yandex.net',
      EMAIL_POSTBOX_REGION: 'ru-central1',
    });
    expect(inheritedDefaults.status).toBe(0);
    // And they do not leak into the Resend spec.
    expect(readFileSync(backendSpecPath, 'utf8')).not.toContain('EMAIL_POSTBOX_ENDPOINT');

    // And the well-formed versions still generate.
    expect(runPrepareSpecs({ ...base, EMAIL_FROM: 'Example App <no-reply@example.com>' }).status).toBe(0);
    expect(
      runPrepareSpecs({ ...base, EMAIL_REPLY_TO: 'support@example.com', EMAIL_REQUEST_TIMEOUT_MS: '8000' })
        .status,
    ).toBe(0);
  });

  test('refuses the console sink, which prints instead of sending', () => {
    const result = runPrepareSpecs({ EMAIL_DELIVERY: 'console' });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('console');
  });

  test('rejects a scheduled job whose name is not in the registry', () => {
    // Shape validation alone let a typo through: the component deploys, runs nightly, and fails
    // every tick. The name has to exist in backend/src/jobs.ts.
    const typo = runPrepareSpecs({
      DO_BACKEND_CRON_NAME: 'auth-session-cleanup',
      DO_BACKEND_CRON_TASK: 'auth:session:cleanup',
      DO_BACKEND_CRON_SCHEDULE: '0 3 * * *',
    });

    expect(typo.status).not.toBe(0);
    expect(`${typo.stdout}\n${typo.stderr}`).toContain('auth:sessions:cleanup');

    const registered = runPrepareSpecs({
      DO_BACKEND_CRON_NAME: 'auth-session-cleanup',
      DO_BACKEND_CRON_TASK: 'auth:sessions:cleanup',
      DO_BACKEND_CRON_SCHEDULE: '0 3 * * *',
    });

    expect(registered.status).toBe(0);
    expect(readFileSync(backendSpecPath, 'utf8')).toContain(
      'bun run start:cron -- auth:sessions:cleanup',
    );
  });

  test('accepts a worker command that runs something of its own', () => {
    const result = runPrepareSpecs({
      DO_BACKEND_WORKER_ENABLED: 'true',
      DO_BACKEND_WORKER_NAME: 'worker',
      DO_BACKEND_WORKER_RUN_COMMAND: 'bun run start:worker:orders',
    });

    expect(result.status).toBe(0);
    expect(readFileSync(backendSpecPath, 'utf8')).toContain(
      'run_command: "bun run start:worker:orders"',
    );
  });

  test('rejects component names that collide after normalization', () => {
    const serviceCollision = runPrepareSpecs({
      DO_BACKEND_WORKER_ENABLED: 'true',
      DO_BACKEND_WORKER_NAME: 'API',
      DO_BACKEND_WORKER_RUN_COMMAND: 'bun run start:worker:notifications',
    });
    expect(serviceCollision.status).not.toBe(0);
    expect(`${serviceCollision.stdout}\n${serviceCollision.stderr}`).toContain(
      'component name "api" conflicts with API service',
    );

    const optionalCollision = runPrepareSpecs({
      DO_BACKEND_WORKER_ENABLED: 'true',
      DO_BACKEND_WORKER_NAME: 'maintenance',
      DO_BACKEND_WORKER_RUN_COMMAND: 'bun run start:worker:notifications',
      DO_BACKEND_CRON_NAME: 'maintenance',
      DO_BACKEND_CRON_TASK: 'db:ping',
      DO_BACKEND_CRON_SCHEDULE: '0 3 * * *',
    });
    expect(optionalCollision.status).not.toBe(0);
    expect(`${optionalCollision.stdout}\n${optionalCollision.stderr}`).toContain(
      'component name "maintenance" conflicts with backend worker',
    );
  });

  test('rejects App Platform component names shorter than two characters', () => {
    const result = runPrepareSpecs({ DO_DB_COMPONENT_NAME: 'x' });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'DO_DB_COMPONENT_NAME must normalize to an App Platform component name with 2 to 32 characters',
    );
  });

  test('rejects invalid backend cron schedules before writing deploy specs', () => {
    const result = runPrepareSpecs({
      DO_BACKEND_CRON_NAME: 'daily-maintenance',
      DO_BACKEND_CRON_TASK: 'db:ping',
      DO_BACKEND_CRON_SCHEDULE: '0 3 nope * *',
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('day-of-month field');
  });

  test('rejects unsupported App Platform instance size slugs', () => {
    const result = runPrepareSpecs({
      DO_API_INSTANCE_SIZE_SLUG: 'expensive-surprise',
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'DO_API_INSTANCE_SIZE_SLUG must be one of:',
    );
  });

  test('rejects deployment spec generation from a different checkout branch', () => {
    const result = runPrepareSpecs(
      {
        DO_GIT_BRANCH: 'codex-deploy-branch-mismatch-test',
      },
      { skipReleaseGitCheck: false },
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('Deployment branch mismatch');
  });

  test('generates explicit backend worker and cron job blocks', () => {
    const result = runPrepareSpecs({
      DO_BACKEND_WORKER_ENABLED: 'true',
      DO_BACKEND_WORKER_NAME: 'notifications',
      DO_BACKEND_WORKER_RUN_COMMAND: 'bun run start:worker:notifications',
      DO_BACKEND_CRON_NAME: 'daily-maintenance',
      DO_BACKEND_CRON_TASK: 'db:ping',
      DO_BACKEND_CRON_SCHEDULE: '0 3 * * *',
      DO_BACKEND_CRON_TIME_ZONE: 'Europe/Moscow',
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    const spec = readFileSync(backendSpecPath, 'utf8');
    expect(spec).toContain('workers:');
    expect(spec).toContain('  - name: notifications');
    expect(spec).toContain('run_command: "bun run start:worker:notifications"');
    expect(spec).toContain('kind: SCHEDULED');
    expect(spec).toContain('run_command: "bun run start:cron -- db:ping"');
    expect(spec).toContain('time_zone: "Europe/Moscow"');
    expect(spec).toContain(`    http_port: 8080
    instance_size_slug: apps-s-1vcpu-1gb
    instance_count: 1`);
    expect(spec).toContain(`      - key: TRUSTED_PROXY_CLIENT_IP_HEADER
        value: "do-connecting-ip"`);
    expect(spec).toContain('    version: "18"');
    expect(spec).not.toContain('REPLACE_WITH_');
  });

  test('generates explicit backend API instance sizing overrides', () => {
    const result = runPrepareSpecs({
      DO_API_INSTANCE_SIZE_SLUG: 'apps-s-1vcpu-2gb',
      DO_API_INSTANCE_COUNT: '2',
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    const spec = readFileSync(backendSpecPath, 'utf8');
    expect(spec).toContain(`    http_port: 8080
    instance_size_slug: apps-s-1vcpu-2gb
    instance_count: 2`);
    expect(spec).not.toContain('REPLACE_WITH_');
  });

  test('adds explicitly configured browser origins to backend CORS', () => {
    const result = runPrepareSpecs({
      DO_ADDITIONAL_CORS_ORIGINS: 'https://website.example.com,https://admin.example.com',
    });

    expect(result.status).toBe(0);
    const spec = readFileSync(backendSpecPath, 'utf8');
    expect(spec).toContain(
      'value: "https://webapp.example.com,https://website.example.com,https://admin.example.com"',
    );
  });

  test('rejects independent App Platform default domains for production browser auth', () => {
    const result = runPrepareSpecs({
      DO_AUTH_SITE_DOMAIN: 'ondigitalocean.app',
      DO_BACKEND_URL: 'https://api-abc.ondigitalocean.app',
      DO_WEBAPP_URL: 'https://webapp-xyz.ondigitalocean.app',
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'Independent *.ondigitalocean.app domains are not supported for browser auth',
    );
  });

  test('requires backend and webapp custom domains to share the declared auth site', () => {
    const result = runPrepareSpecs({
      DO_AUTH_SITE_DOMAIN: 'example.com',
      DO_BACKEND_URL: 'https://api.example.com',
      DO_WEBAPP_URL: 'https://webapp.other.example',
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('DO_WEBAPP_URL hostname must belong to DO_AUTH_SITE_DOMAIN');
  });

  test('rejects ICANN and private public suffixes as the declared auth site', () => {
    for (const publicSuffix of ['co.uk', 'pages.dev']) {
      const result = runPrepareSpecs({
        DO_AUTH_SITE_DOMAIN: publicSuffix,
        DO_BACKEND_URL: `https://api.${publicSuffix}`,
        DO_WEBAPP_URL: `https://webapp.${publicSuffix}`,
      });

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        'DO_AUTH_SITE_DOMAIN must be a registrable domain, not a public suffix',
      );
    }
  });

  test('rejects credentialed additional browser origins outside the declared auth site', () => {
    const result = runPrepareSpecs({
      DO_ADDITIONAL_CORS_ORIGINS: 'https://admin.other.example',
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'DO_ADDITIONAL_CORS_ORIGINS hostname must belong to DO_AUTH_SITE_DOMAIN',
    );
  });

  test('writes secret-bearing backend specs with owner-only permissions', () => {
    const result = runPrepareSpecs();

    expect(result.status).toBe(0);
    expect(statSync(backendSpecPath).mode & 0o777).toBe(0o600);
  });

  test('rejects project slugs that overflow suffixed App Platform names', () => {
    const result = runPrepareSpecs({
      DO_PROJECT_SLUG: 'a-project-name-that-is-too-long',
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('DO_PROJECT_SLUG');
  });

  test('rejects invalid plain-scalar deployment identifiers before writing YAML', () => {
    const invalidBranch = runPrepareSpecs({ DO_GIT_BRANCH: 'main\nservices: []' });
    expect(invalidBranch.status).not.toBe(0);
    expect(`${invalidBranch.stdout}\n${invalidBranch.stderr}`).toContain('DO_GIT_BRANCH');

    const invalidDatabase = runPrepareSpecs({ DO_DB_NAME: 'defaultdb\nenvs: []' });
    expect(invalidDatabase.status).not.toBe(0);
    expect(`${invalidDatabase.stdout}\n${invalidDatabase.stderr}`).toContain('DO_DB_NAME');
  });

  test('generates a standalone website without requiring a webapp URL', () => {
    const result = runPrepareSpecs(
      { DO_WEBAPP_URL: undefined },
      { target: 'website' },
    );

    expect(result.status).toBe(0);
    const spec = readFileSync(resolve(repoRoot, '.scratch/deploy/website-static-app.yaml'), 'utf8');
    expect(spec).not.toContain('PUBLIC_WEBAPP_URL');
  });

  test('requires complete storage settings and marks credentials as secrets', () => {
    const incomplete = runPrepareSpecs(
      { PRIVATE_STORAGE_BUCKET: 'uploads' },
      { omitStorage: true },
    );
    expect(incomplete.status).not.toBe(0);
    expect(`${incomplete.stdout}\n${incomplete.stderr}`).toContain('PRIVATE_STORAGE_REGION');

    // No storage at all is refused too: the deployed backend cannot boot without a bucket, so a
    // spec generated without one would crash-loop after the migration job already succeeded.
    const absent = runPrepareSpecs({}, { omitStorage: true });
    expect(absent.status).not.toBe(0);
    expect(`${absent.stdout}\n${absent.stderr}`).toContain('PRIVATE_STORAGE_REGION');

    const complete = runPrepareSpecs();
    expect(complete.status).toBe(0);
    const spec = readFileSync(backendSpecPath, 'utf8');
    expect(spec).toContain('key: PRIVATE_STORAGE_ACCESS_KEY_ID');
    expect(spec).toContain('key: PRIVATE_STORAGE_SECRET_ACCESS_KEY');
    expect(spec.match(/type: SECRET/g)?.length).toBeGreaterThanOrEqual(3);
  });

  test('deploys the s3 driver and opens the remote-endpoint gate explicitly', () => {
    // The backend is fail-closed on both: it refuses the filesystem driver in production, and
    // refuses a non-loopback endpoint until the gate is opened deliberately. A generated spec
    // has to state both, or the deployed app will not start.
    const complete = runPrepareSpecs({
      PRIVATE_STORAGE_REGION: 'ru-central1',
      PRIVATE_STORAGE_ENDPOINT: 'https://storage.yandexcloud.net',
    });

    expect(complete.status).toBe(0);
    const spec = readFileSync(backendSpecPath, 'utf8');
    expect(spec).toContain('key: PRIVATE_STORAGE_DRIVER');
    expect(spec).toContain('value: "s3"');
    expect(spec).toContain('key: PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT');
  });

  test('refuses to deploy a spec pointing at the local development container', () => {
    const loopback = runPrepareSpecs({
      PRIVATE_STORAGE_BUCKET: 'local-private-storage',
      PRIVATE_STORAGE_ENDPOINT: 'http://127.0.0.1:24331',
    });

    expect(loopback.status).not.toBe(0);
    expect(`${loopback.stdout}\n${loopback.stderr}`).toContain('PRIVATE_STORAGE_ENDPOINT');
  });
});

// A deployed backend refuses to boot without durable storage, so this is required input now.
const completeStorageEnv = {
  PRIVATE_STORAGE_REGION: 'nyc3',
  PRIVATE_STORAGE_BUCKET: 'uploads',
  PRIVATE_STORAGE_ENDPOINT: 'https://nyc3.digitaloceanspaces.com',
  PRIVATE_STORAGE_ACCESS_KEY_ID: 'access-key',
  PRIVATE_STORAGE_SECRET_ACCESS_KEY: 'secret-key',
};

function runPrepareSpecs(
  extraEnv = {},
  { skipReleaseGitCheck = true, target = 'backend-final', omitStorage = false } = {},
) {
  const testOnlyEnv = skipReleaseGitCheck
    ? {
        NODE_ENV: 'test',
        DO_SKIP_RELEASE_GIT_CHECK_FOR_TESTS: '1',
      }
    : {};

  return spawnSync(process.execPath, ['scripts/prepare-do-specs.mjs', target], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      ...testOnlyEnv,
      DO_PROJECT_SLUG: 'vibecoding-template-test',
      DO_GITHUB_REPO: 'owner/repo',
      DO_GIT_BRANCH: 'main',
      JWT_SECRET: '0123456789abcdef'.repeat(4),
      DO_AUTH_SITE_DOMAIN: 'example.com',
      DO_BACKEND_URL: 'https://api.example.com',
      DO_WEBAPP_URL: 'https://webapp.example.com',
      ...(omitStorage ? {} : completeStorageEnv),
      ...extraEnv,
    },
  });
}
