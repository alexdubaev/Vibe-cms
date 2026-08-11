import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'bun:test'

import {
  allowedDrift,
  branchRangeDrift,
  counterpartRef,
  heldVersionDrift,
  heldVersions,
  installedPackageNames,
  installedVersionDrift,
  localTreeErrors,
  lockPackageNames,
  orphanedInstalls,
  readSharedManifests,
  resolvedVersions,
  sharedManifests,
} from './branch-dependency-drift.mjs'
import { repositoryRoot } from './repo-env.mjs'

const ourBranch = 'master'
const theirBranch = 'refs/heads/mobile'

function drift(ours, theirs) {
  return branchRangeDrift({ ours, theirs, ourBranch, theirBranch })
}

test('a package declared differently on the two branches is reported by name', () => {
  const errors = drift(
    { 'backend/package.json': { dependencies: { hono: '^4.12.31' } } },
    { 'backend/package.json': { dependencies: { hono: '^4.13.1' } } },
  )

  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain('hono')
  expect(errors[0]).toContain('^4.12.31')
  expect(errors[0]).toContain('^4.13.1')
})

test('a dependency only one branch has is not drift', () => {
  // `mobile` adding Expo, IAP and social auth packages is the entire point of the branch.
  const errors = drift(
    { 'backend/package.json': { dependencies: { hono: '^4.13.1' } } },
    { 'backend/package.json': { dependencies: { hono: '^4.13.1', 'google-auth-library': '^10.9.1' } } },
  )

  expect(errors).toEqual([])
})

test('a package that moved between dependencies and devDependencies is still compared', () => {
  // Comparing the sections separately would read this as "only one branch has it" and pass,
  // which is how a version difference hides behind a reorganisation.
  const errors = drift(
    { 'webapp/package.json': { dependencies: { vite: '^8.1.5' } } },
    { 'webapp/package.json': { devDependencies: { vite: '^8.2.0' } } },
  )

  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain('vite')
})

test('overrides are compared separately from dependencies', () => {
  // An override imposes a version on the whole tree; a dependency asks for one. A package
  // appearing as both must not be treated as agreeing with itself.
  expect(
    drift(
      { 'package.json': { overrides: { '@hono/node-server': '^1.19.14' } } },
      { 'package.json': { overrides: { '@hono/node-server': '^2.0.12' } } },
    ),
  ).toHaveLength(1)

  expect(
    drift(
      { 'package.json': { overrides: { hono: '^4.13.1' } } },
      { 'package.json': { dependencies: { hono: '^4.12.0' } } },
    ),
  ).toEqual([])
})

test('a documented exception is allowed, and only in the manifest it was granted for', () => {
  const errors = drift(
    {
      'website/package.json': { dependencies: { react: '^19.2.7' } },
      'webapp/package.json': { dependencies: { react: '^19.2.8' } },
    },
    {
      'website/package.json': { dependencies: { react: '19.2.3' } },
      'webapp/package.json': { dependencies: { react: '19.2.3' } },
    },
  )

  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain('webapp/package.json')
})

test('every exception and every hold carries a reason someone can check', () => {
  // A reason-less entry is indistinguishable from a forgotten downgrade, which is what both of
  // these looked like before anyone traced them to their cause.
  for (const entry of allowedDrift) {
    expect(sharedManifests).toContain(entry.manifest)
    expect(entry.packages.length).toBeGreaterThan(0)
    expect(entry.reason.length).toBeGreaterThan(30)
  }

  for (const entry of heldVersions) {
    expect(sharedManifests).toContain(entry.manifest)
    expect(entry.packages.length).toBeGreaterThan(0)
    expect(entry.reason.length).toBeGreaterThan(30)
  }
})

test('mobile-only manifests are outside the comparison', () => {
  expect(sharedManifests).not.toContain('mobile/package.json')
})

test('a held version that drifted back to a range is reported with its reason', () => {
  // The failure this prevents is silent: `bun update` moves the range, the install breaks in a
  // way that looks unrelated, and the reason lives only in a commit message nobody reads.
  const errors = heldVersionDrift({
    manifests: { 'backend/package.json': { dependencies: { prisma: '^7.9.0' } } },
  })

  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain('prisma')
  expect(errors[0]).toContain('7.9.0')
  expect(errors[0]).toContain('12 KB')
})

test('a held version still at its held value passes', () => {
  expect(
    heldVersionDrift({ manifests: { 'backend/package.json': { dependencies: { prisma: '7.9.0' } } } }),
  ).toEqual([])
})

test('resolvedVersions reads hoisted entries and ignores nested ones', () => {
  const lock = `{
  "packages": {
    "hono": ["hono@4.13.1", "", {}, "sha512-abc=="],
    "@prisma/client": ["@prisma/client@7.9.0", "", { "dependencies": {} }, "sha512-def=="],
    "@aws-sdk/core/@smithy/core": ["@smithy/core@3.29.5", "", {}, "sha512-ghi=="],
  }
}`

  const versions = resolvedVersions(lock)

  expect(versions.hono).toBe('4.13.1')
  expect(versions['@prisma/client']).toBe('7.9.0')
  // A nested entry must not overwrite the hoisted package's version.
  expect(versions['@smithy/core']).toBeUndefined()
})

test('lockPackageNames collects nested entries too, or every transitive looks orphaned', () => {
  const lock = `{
  "packages": {
    "hono": ["hono@4.13.1", "", {}, "sha512-abc=="],
    "@aws-sdk/core/@smithy/core": ["@smithy/core@3.29.5", "", {}, "sha512-ghi=="],
    "shadcn/tar": ["tar@7.5.1", "", {}, "sha512-jkl=="],
  }
}`

  const names = lockPackageNames(lock)

  expect(names.has('hono')).toBe(true)
  expect(names.has('@smithy/core')).toBe(true)
  expect(names.has('tar')).toBe(true)
})

test('a package on disk that the lockfile never mentions is reported', () => {
  // The condition the whole script exists for: `bun install` never prunes, so switching branches
  // leaves the other branch's tree behind while every shared package sits at the right version.
  const errors = orphanedInstalls({
    lockNames: new Set(['hono']),
    installedNames: ['hono', 'expo', '@apple/app-store-server-library'],
  })

  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain('2 packages')
  expect(errors[0]).toContain('expo')
  expect(errors[0]).toContain('bun install')
})

test('a tree with nothing extra reports nothing', () => {
  expect(orphanedInstalls({ lockNames: new Set(['hono']), installedNames: ['hono'] })).toEqual([])
})

test('an installed version that disagrees with the lockfile names the fix', () => {
  const errors = installedVersionDrift({
    manifests: { 'backend/package.json': { dependencies: { '@prisma/client': '7.9.0' } } },
    resolved: { '@prisma/client': '7.9.0' },
    installedVersion: () => '7.9.1',
  })

  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain('@prisma/client')
  expect(errors[0]).toContain('bun install')
})

test('a dependency that is not installed at all is left to the package manager', () => {
  // An optional or platform-specific package legitimately may not be on disk.
  expect(
    installedVersionDrift({
      manifests: { 'backend/package.json': { dependencies: { fsevents: '^2.3.3' } } },
      resolved: { fsevents: '2.3.3' },
      installedVersion: () => undefined,
    }),
  ).toEqual([])
})

test('the counterpart is a local branch first, because an installed project deletes origin', () => {
  // AGENTS.md tells every installed project to `git remote remove origin`, so resolving only
  // through remote-tracking refs would disable this check in exactly the projects using it.
  const localOnly = (ref) => ref.startsWith('refs/heads/')

  expect(counterpartRef({ branch: 'master', refExists: localOnly })).toBe('refs/heads/mobile')
  expect(counterpartRef({ branch: 'mobile', refExists: localOnly })).toBe('refs/heads/master')
  expect(counterpartRef({ branch: 'master', refExists: (ref) => ref === 'origin/mobile' })).toBe(
    'origin/mobile',
  )
})

test('no counterpart is guessed for a detached HEAD or a feature branch', () => {
  // Comparing a mobile commit against `mobile` compares it with itself and always passes, which
  // reads as a green check while checking nothing.
  expect(counterpartRef({ branch: '', refExists: () => true })).toBeNull()
  expect(counterpartRef({ branch: 'spike/foo', refExists: () => true })).toBeNull()
})

test('a project that kept only one line is not failed for the branch it never had', () => {
  expect(counterpartRef({ branch: 'master', refExists: () => false })).toBeNull()
})

test('this checkout has no dependency it did not install from its own lockfile', () => {
  // Runs against the real tree, the way repo-env.test.mjs asserts the smithy copy count. This is
  // what makes `bun run test` catch a stale tree on either branch, rather than only during a
  // mobile release - and a stale tree makes every other assertion in the suite meaningless.
  const errors = localTreeErrors({
    manifests: readSharedManifests(),
    lockContents: readFileSync(resolve(repositoryRoot, 'bun.lock'), 'utf8'),
  })

  expect(errors).toEqual([])
})

test('installedPackageNames reads scoped and unscoped packages from a real tree', () => {
  const names = installedPackageNames()

  expect(names).toContain('hono')
  expect(names.some((name) => name.startsWith('@prisma/'))).toBe(true)
  expect(names.every((name) => !name.startsWith('.'))).toBe(true)
})
