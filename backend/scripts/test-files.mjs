import { Glob } from 'bun'

/**
 * Splits the backend test files between the three runners, by filename.
 *
 * A test that needs the database is named `*.integration.test.ts`; a test that needs a service no
 * runner starts for it - the local S3 container, or an email provider - is named
 * `*.live.test.ts`; everything else runs with nothing installed. That third category is why
 * `bun run test` stays runnable on a machine with no Docker daemon: a live test landing in the
 * unit set would fail for everyone who has not started a container, which is the fastest way to
 * teach people to ignore a red suite.
 */
export function backendTestFiles(backendRoot) {
  const all = [...new Glob('{src,scripts}/**/*.test.{ts,mjs}').scanSync(backendRoot)].sort()

  return {
    all,
    unit: all.filter(
      (file) => !file.includes('.integration.test.') && !file.includes('.live.test.'),
    ),
    integration: all.filter((file) => file.includes('.integration.test.')),
    live: all.filter((file) => file.includes('.live.test.')),
  }
}
