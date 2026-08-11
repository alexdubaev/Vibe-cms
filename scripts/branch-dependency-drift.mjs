import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { repositoryRoot } from './repo-env.mjs'

/**
 * Keeps `master` and `mobile` declaring the same versions, and keeps `node_modules` matching the
 * branch you are actually on.
 *
 * Both halves exist because of the same incident. A workspace-wide dependency sweep landed on
 * `mobile` alone and was never mirrored; every sync since runs master -> mobile, so the drift was
 * one-way and self-perpetuating. It went unnoticed for eight days because the evidence is
 * invisible: Prisma's generated client is git-ignored, so a version regression produces a
 * zero-line diff, and this repository deliberately has no hosted CI to catch it.
 *
 * The second half is subtler and cost a whole afternoon: switching branches without reinstalling
 * leaves the previous branch's `node_modules` in place, and every check then reports on
 * dependencies the branch does not declare. That produces confident green runs that mean nothing.
 */

/** Manifests both branches own. `mobile/package.json` is deliberately absent - it is mobile-only. */
export const sharedManifests = [
  'package.json',
  'backend/package.json',
  'webapp/package.json',
  'website/package.json',
  'packages/contracts/package.json',
]

/**
 * Where the branches are allowed to disagree, and why.
 *
 * Each entry needs a reason a reader can check. An exception without one is how a forgotten
 * downgrade starts looking like a deliberate constraint - which is exactly what these two looked
 * like before anyone traced them back to Expo.
 */
export const allowedDrift = [
  {
    manifest: 'website/package.json',
    packages: ['react', 'react-dom'],
    reason:
      'React Native 0.86 in the mobile workspace forces one React across the monorepo, so `mobile` holds an older exact version than `master` can use.',
  },
]

function isAllowed(manifest, name) {
  return allowedDrift.some((entry) => entry.manifest === manifest && entry.packages.includes(name))
}

/**
 * `dependencies` and `devDependencies` are one namespace here on purpose: a package that moved
 * between them across branches is still the same package at two versions, and comparing the
 * sections separately would read that as "only one branch has it" and pass. `overrides` stays
 * apart because it means something different - a version imposed on the whole tree.
 */
function declaredRanges(manifest) {
  return {
    dependencies: { ...manifest.dependencies, ...manifest.devDependencies },
    overrides: { ...manifest.overrides },
  }
}

/**
 * Ranges declared for the same package on both branches must match.
 *
 * Only packages present in *both* manifests are compared: `mobile` adding a dependency `master`
 * has never heard of is the whole point of the branch, not drift.
 */
export function branchRangeDrift({ ours, theirs, ourBranch, theirBranch }) {
  const errors = []

  for (const manifest of sharedManifests) {
    if (!ours[manifest] || !theirs[manifest]) continue

    const mine = declaredRanges(ours[manifest])
    const other = declaredRanges(theirs[manifest])

    for (const section of Object.keys(mine)) {
      for (const [name, range] of Object.entries(mine[section])) {
        const theirRange = other[section][name]
        if (theirRange === undefined || theirRange === range || isAllowed(manifest, name)) continue

        errors.push(
          `${manifest} declares ${name} as ${range} on ${ourBranch} and ${theirRange} on ${theirBranch}. Align them, or add the package to allowedDrift in scripts/branch-dependency-drift.mjs with the reason.`,
        )
      }
    }
  }

  return errors
}

/**
 * Versions this repository holds away from the newest release, and why.
 *
 * The same idea as `allowedDrift`, pointed at time instead of at the other branch. A hold that
 * lives only in a commit message is a hold the next `bun update` silently undoes - and the reason
 * is rarely rediscoverable, because the symptom shows up somewhere else entirely.
 */
export const heldVersions = [
  {
    manifest: 'backend/package.json',
    packages: ['prisma', '@prisma/client', '@prisma/adapter-pg'],
    range: '7.9.0',
    reason:
      '7.9.1 cannot be installed: `bun add @prisma/client@7.9.1` in an empty directory yields 12 KB and three files instead of 78 MB and seventeen, with an empty `runtime/`, so the generated client\'s `@prisma/client/runtime/client` import does not resolve and every Prisma type collapses. The published tarball is intact, so this is an install-side failure. Revisit when 7.9.2 ships.',
  },
]

/** A held version that quietly drifted back to a range is the hold undone. */
export function heldVersionDrift({ manifests }) {
  const errors = []

  for (const held of heldVersions) {
    const manifest = manifests[held.manifest]
    if (!manifest) continue

    const declared = { ...manifest.dependencies, ...manifest.devDependencies }

    for (const name of held.packages) {
      if (!(name in declared) || declared[name] === held.range) continue

      errors.push(
        `${held.manifest} declares ${name} as ${declared[name]}, but it is held at ${held.range} in heldVersions in scripts/branch-dependency-drift.mjs. ${held.reason}`,
      )
    }
  }

  return errors
}

/**
 * Every directly declared dependency must be installed at the version this branch's lockfile
 * resolved. Anything else means `node_modules` belongs to another branch, and every check run
 * against it is answering a question nobody asked.
 */
export function installedVersionDrift({ manifests, resolved, installedVersion }) {
  const errors = []
  const seen = new Set()

  for (const manifest of Object.values(manifests)) {
    for (const section of ['dependencies', 'devDependencies']) {
      for (const name of Object.keys(manifest[section] ?? {})) {
        if (seen.has(name)) continue
        seen.add(name)

        const expected = resolved[name]
        if (!expected) continue

        const actual = installedVersion(name)
        if (actual === undefined || actual === expected) continue

        errors.push(
          `${name} is installed at ${actual} but this branch's lockfile resolves ${expected}. Run \`bun install\` - node_modules is left over from another branch, and every check is reporting on the wrong dependencies.`,
        )
      }
    }
  }

  return errors
}

/**
 * Packages sitting in `node_modules` that this branch's lockfile never mentions.
 *
 * This is the half that actually catches a tree from the other branch, and the version comparison
 * above cannot: `bun install` adds and updates but does not prune, so switching from `mobile` to
 * `master` leaves the entire Expo tree behind - measured at 484 packages - while every shared
 * package sits at the right version and every check runs green. Code can then import something
 * that is on disk and absent from the lockfile, pass locally, and fail in the image, where
 * `backend/Dockerfile` installs with `--frozen-lockfile`.
 */
export function orphanedInstalls({ lockNames, installedNames }) {
  const orphans = installedNames.filter((name) => !lockNames.has(name)).sort()
  if (orphans.length === 0) return []

  const shown = orphans.slice(0, 5).join(', ')

  return [
    `${orphans.length} package${orphans.length === 1 ? '' : 's'} in node_modules ${orphans.length === 1 ? 'is' : 'are'} absent from this branch's lockfile (${shown}${orphans.length > 5 ? ', …' : ''}). Run \`rm -rf node_modules && bun install\` - this tree is left over from another branch, so every check is reporting on dependencies this branch does not have, and code importing one of these would pass here and fail in a --frozen-lockfile build.`,
  ]
}

/** Resolved versions from a `bun.lock`, keyed by package name. Hoisted entries only. */
export function resolvedVersions(lockContents) {
  const versions = {}

  for (const [, name, version] of lockContents.matchAll(
    /"((?:@[^"/]+\/)?[^"@/][^"]*)": \["\1@(\d[^"]*)"/g,
  )) {
    versions[name] = version
  }

  return versions
}

/**
 * Every package name the lockfile mentions, hoisted or nested.
 *
 * Bun keys a nested resolution by its path - `@aws-sdk/core/@smithy/core` - so the package name
 * is the trailing segment, two segments when it is scoped. `resolvedVersions` above deliberately
 * ignores those; this needs them, or every transitive dependency would look orphaned.
 */
export function lockPackageNames(lockContents) {
  const names = new Set()

  for (const [, key] of lockContents.matchAll(/"([^"]+)": \[/g)) {
    const parts = key.split('/')
    const scoped = parts.length >= 2 && parts[parts.length - 2].startsWith('@')
    names.add(scoped ? parts.slice(-2).join('/') : parts[parts.length - 1])
  }

  return names
}

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' })
  if (result.status !== 0) {
    if (allowFailure) return null
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }

  return result.stdout
}

function parse(contents) {
  return contents === null ? null : JSON.parse(contents)
}

function readManifests(ref) {
  const manifests = {}
  for (const path of sharedManifests) {
    const contents = ref
      ? git(['show', `${ref}:${path}`], { allowFailure: true })
      : readFileSync(resolve(repositoryRoot, path), 'utf8')
    const parsed = parse(contents)
    if (parsed) manifests[path] = parsed
  }

  return manifests
}

function installedVersionFromDisk(name) {
  try {
    return JSON.parse(
      readFileSync(resolve(repositoryRoot, 'node_modules', name, 'package.json'), 'utf8'),
    ).version
  } catch {
    return undefined
  }
}

/** Top-level package names physically present in the root `node_modules`. */
export function installedPackageNames(root = resolve(repositoryRoot, 'node_modules')) {
  const names = []

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue

    if (entry.name.startsWith('@')) {
      for (const scoped of readdirSync(resolve(root, entry.name), { withFileTypes: true })) {
        if (scoped.isDirectory()) names.push(`${entry.name}/${scoped.name}`)
      }
      continue
    }

    names.push(entry.name)
  }

  return names
}

/**
 * The half that needs no other branch, so it can run everywhere and always.
 *
 * Kept separate from the range comparison because that one is legitimately red in the window
 * between updating `master` and merging into `mobile` - wiring it into `bun run test` would make
 * a normal step in the workflow look like a failure.
 */
export function localTreeErrors({ manifests, lockContents }) {
  return [
    ...heldVersionDrift({ manifests }),
    ...installedVersionDrift({
      manifests,
      resolved: resolvedVersions(lockContents),
      installedVersion: installedVersionFromDisk,
    }),
    ...orphanedInstalls({
      lockNames: lockPackageNames(lockContents),
      installedNames: installedPackageNames(),
    }),
  ]
}

export function readSharedManifests(ref = null) {
  return readManifests(ref)
}

/**
 * The branch this checkout is on, and the branch it should agree with.
 *
 * Local refs come first: an installed project is told to `git remote remove origin`, so
 * `origin/master` is exactly the ref that will not exist there. A detached HEAD has no
 * counterpart worth guessing at - comparing a mobile commit against `mobile` compares it with
 * itself and always passes, which is worse than skipping.
 */
export function counterpartRef({ branch, refExists }) {
  if (branch !== 'master' && branch !== 'mobile') return null

  const wanted = branch === 'mobile' ? 'master' : 'mobile'

  for (const candidate of [`refs/heads/${wanted}`, `origin/${wanted}`]) {
    if (refExists(candidate)) return candidate
  }

  return null
}

if (import.meta.main) {
  const installedOnly = process.argv.includes('--installed-only')
  const branch = git(['branch', '--show-current']).trim()
  const ours = readManifests(null)
  const lockContents = readFileSync(resolve(repositoryRoot, 'bun.lock'), 'utf8')
  const errors = localTreeErrors({ manifests: ours, lockContents })

  if (!installedOnly) {
    const counterpart = counterpartRef({
      branch,
      refExists: (ref) => Boolean(git(['rev-parse', '--verify', ref], { allowFailure: true })),
    })

    if (counterpart) {
      errors.push(
        ...branchRangeDrift({
          ours,
          theirs: readManifests(counterpart),
          ourBranch: branch,
          theirBranch: counterpart,
        }),
      )
    } else {
      console.log(
        branch === 'master' || branch === 'mobile'
          ? `No counterpart branch for ${branch} in this checkout, so only the local tree is checked.`
          : `On ${branch || 'a detached HEAD'}, which is neither master nor mobile, so only the local tree is checked.`,
      )
    }
  }

  if (errors.length > 0) {
    console.error(`Dependency drift check failed:\n- ${errors.join('\n- ')}`)
    process.exit(1)
  }

  console.log('Dependency drift check passed.')
}
