# Vibe CMS Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an isolated, Russian-first CMS inside a client-specific Vibe checkout with safe drafts, frozen approvals, private preview, stable public media, and recoverable blue/green publication on Yandex Cloud.

**Architecture:** Hono and PostgreSQL own all mutable and private state. Publication materialises one immutable public-safe snapshot, wakes a single-flight controller through the existing transactional outbox, and sends a small command through Yandex Message Queue to a dedicated builder. Astro renders the snapshot into an inactive static slot; traffic changes only after direct and public marker verification.

**Tech Stack:** Bun 1.3.14, Hono/OpenAPI, Prisma 7.9.0/PostgreSQL 18, Zod 4, React 19, TanStack Query/Form/Router, Astro 7 with a compatible Node adapter, Tailwind 4, Yandex Object Storage/YMQ/Serverless Containers/ALB/CDN, Vibe task outbox.

**Spec:** `vibe-cms-module-design.md`

## Global constraints

- Execute this plan only in a new client-specific checkout of `di-sukharev/vibe`; do not implement it in the upstream repository or in the design-only folder containing this plan.
- Read the target checkout's `AGENTS.md`, `README.md`, `CHECKLIST.md`, `docs/ARCHITECTURE.md`, `docs/BACKGROUND_JOBS.md`, `docs/STORAGE.md`, `docs/WEB_SURFACES.md`, `docs/DEPLOYMENT.md`, `docs/YANDEX_CLOUD.md`, and `docs/TESTING.md` before editing.
- Complete `CHECKLIST.md` with the client's actual domains, Yandex folder, bucket names, owner seed, media limits, DNS owner, and deployment operator before feature code.
- Preserve upstream module boundaries. Cross-module backend imports go through `index.ts`; contracts stay framework-free.
- Keep Prisma at the checkout's pinned exact version until upstream changes it with evidence.
- Change `backend/prisma/schema.prisma`, then generate migrations with `bun run --cwd backend prisma:migrate -- --name add_cms_module`. Never handwrite migration SQL and never use `db push`.
- PostgreSQL IDs use the existing database-generated UUIDv7 convention.
- Keep `admin` only as a hidden Prisma compatibility value; new transport/domain roles are `user | editor | owner`.
- Do not put the website toolchain, database URL, static-publisher key, or promotion authority in the normal API/job image.
- Do not put backend credentials or raw media object keys in the builder command or public snapshot.
- New CMS mutation bodies are limited to 1 MiB and use a dedicated rate-limit configuration. Existing auth limits remain unchanged.
- Webapp unit tests belong under `webapp/tests`; website unit/build tests belong under `website/tests`; Playwright specs belong under `webapp/e2e/specs`.
- Every task that changes modules, contracts, platform code, or a new workspace runs `bun run architecture:check`.
- Do not stage or commit unless the user explicitly asks. The “checkpoint” at the end of each task is a review boundary, not a Git operation.

## File structure

| Area | Files | Responsibility |
|---|---|---|
| Contracts | `packages/contracts/src/cms/**` | Strict schemas, block catalogue, DTOs, errors |
| Roles | existing auth/users contracts, domain, repositories, routes, UI | `user/editor/owner`, legacy-admin mapping, owner-only user management |
| CMS backend | `backend/src/modules/cms/**` | Drafts, registries, validation, approvals, snapshots, redirects, audit |
| Media backend | `backend/src/modules/media/**` | Upload/finalise, metadata, usage, durable deletion |
| Publication backend | `backend/src/modules/publication/**` | Controller, YMQ command, callbacks, recovery |
| Builder | `website-builder/**` | Trigger HTTP server, Astro build, media copy, slot upload/promotion |
| Admin | `webapp/src/features/cms/**` | Routes, queries, forms, autosave, approval/publication UX |
| Website | `website/src/cms/**`, `website/src/pages/**` | Static snapshot renderer and protected preview |
| Yandex | `infra/yandex/**` | Blue/green slots, ALB/CDN, YMQ/DLQ, builder and preview containers |

---

## Task 1: Establish roles, capabilities, and shared CMS contracts

**Files:**

- Create: `packages/contracts/src/cms/index.ts`
- Create: `packages/contracts/src/cms/content.ts`
- Create: `packages/contracts/src/cms/media.ts`
- Create: `packages/contracts/src/cms/publication.ts`
- Create: `packages/contracts/src/cms/preview.ts`
- Create: `packages/contracts/src/cms.test.ts`
- Modify: `packages/contracts/src/auth.ts`
- Modify: `packages/contracts/src/users.ts`
- Modify: `packages/contracts/src/errors.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `backend/src/modules/auth/domain/user.ts`
- Modify: `backend/src/modules/auth/transport/middleware.ts`
- Modify: `backend/src/modules/users/application/users-service.ts`
- Modify: `backend/src/modules/users/infrastructure/users-repository.ts`
- Modify: `backend/src/modules/users/infrastructure/admin-bootstrap.ts`
- Modify: `backend/src/modules/users/transport/routes.ts`
- Modify: `backend/src/modules/users/users.integration.test.ts`
- Modify: `webapp/src/features/navigation/model.ts`
- Modify: `webapp/src/pages.tsx`
- Modify: `webapp/src/components/WorkspaceShell.tsx`
- Test: `packages/contracts/src/cms.test.ts`, `packages/contracts/src/users.test.ts`, `backend/src/modules/users/users.integration.test.ts`, `webapp/tests/navigation.test.ts`, `webapp/e2e/specs/rbac.spec.ts`

**Interfaces:**

- Produces `UserRole = 'user' | 'editor' | 'owner'` at transport/domain boundaries.
- Produces `CmsCapability`, `capabilitiesForRole(role, policy)`, strict content schemas, `cmsConflictSchema`, `publicationSnapshotSchema`, and `previewGrantResponseSchema`.
- Infrastructure accepts Prisma's legacy `admin` and maps it to domain `owner`; new writes never create `admin`.

- [ ] **Step 1: Add failing role and contract tests**

Cover strict unknown-field rejection, unsafe URLs, reserved paths, structured-text limits, every block default/schema, public snapshot leakage, and the role matrix. Add an integration case proving a legacy Prisma `admin` receives owner capabilities but API responses say `owner`.

```ts
expect(userRoleSchema.options).toEqual(['user', 'editor', 'owner'])
expect(capabilitiesForRole('editor', { editorCanPublish: false })).not.toContain('cms:publish')
expect(publicationSnapshotSchema.safeParse({ revision: 1, pages: [], objectKey: 'secret' }).success).toBe(false)
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `bun test packages/contracts/src/cms.test.ts packages/contracts/src/users.test.ts`

Expected: failure because CMS schemas and new roles do not exist.

- [ ] **Step 3: Implement contracts and capability mapping**

Use discriminated unions for structured text, links, block data, collection data, publication states, and typed errors. Export all CMS contracts from `packages/contracts/src/index.ts`. Extend the central API error-code schema with `CMS_CONFLICT`, `CMS_MEDIA_IN_USE`, `CMS_APPROVAL_STALE`, `CMS_PUBLICATION_FAILED`, and `CMS_PREVIEW_INVALID`.

- [ ] **Step 4: Adapt existing auth/users behavior**

Replace exact admin decisions with owner capability checks while retaining `/api/admin/*` URLs. Count both Prisma `owner` and legacy `admin` when enforcing the last-owner rule. Seed `owner`, allow owner-managed role changes among `user/editor/owner`, revoke affected sessions as upstream already does, and make navigation route both owner and editor into `/admin`.

- [ ] **Step 5: Run focused validation**

Run:

```bash
bun run test:contracts
bun run test:backend:integration
bun run test:webapp
bun run typecheck
bun run architecture:check
```

Expected: role, contract, navigation, and legacy compatibility tests pass; no `admin` label is rendered in new UI output.

- [ ] **Checkpoint:** review the public role surface and strict schema catalogue before persistence work.

## Task 2: Add the CMS persistence model and repository primitives

**Files:**

- Modify: `backend/prisma/schema.prisma`
- Generate: `backend/prisma/migrations/<generated_timestamp>_add_cms_module/migration.sql`
- Create: `backend/src/modules/cms/application/ports.ts`
- Create: `backend/src/modules/cms/domain/errors.ts`
- Create: `backend/src/modules/cms/domain/path-policy.ts`
- Create: `backend/src/modules/cms/domain/registry.ts`
- Create: `backend/src/modules/cms/infrastructure/cms-repository.ts`
- Create: `backend/src/modules/cms/infrastructure/cms-repository.integration.test.ts`
- Create: `backend/src/modules/cms/index.ts`

**Interfaces:**

- Produces Prisma models listed in the design: settings, policy, pages/revisions, entries/revisions, menus/revisions, media/usage, approvals, publications and artifact state, redirects, controller/builds, preview grants/sessions, builder nonces, and audit events.
- Produces `CmsRepository`, `CmsTransaction`, and optimistic update methods returning `{ updated: true, revision } | { updated: false, conflict }`.

- [x] **Step 1: Write failing repository integration tests**

Test UUIDv7 creation, singleton policy/controller constraints, page-path uniqueness, immutable revision rejection, optimistic zero-row conflicts, media/content usage replacement, publication revision monotonicity, and cascade/restrict behavior.

- [x] **Step 2: Start the isolated test database**

Run: `docker compose up -d postgres_test`

Expected: PostgreSQL 18 test service reports ready.

- [x] **Step 3: Extend the Prisma schema**

Use enums for aggregate/build/approval states and indexed relational usage tables. Keep payloads in JSON only where the strict registry owns their shape. Add unique constraints for normalised page paths, menu location, publication revision, controller singleton, `(assetId, ownerType, ownerId, scope)`, and outbox dedupe compatibility.

- [x] **Step 4: Generate and apply the migration**

Run:

```bash
bun run --cwd backend prisma:migrate -- --name add_cms_module
bun run --cwd backend prisma:generate
```

Expected: Prisma generates and applies a migration without a reset prompt. If Prisma asks to reset a non-disposable database, stop and use the isolated test/development database; do not approve data loss.

- [x] **Step 5: Implement repository primitives**

Keep transactions short. Use conditional Prisma updates on `(id, draftRevision)`, replace usage rows in the same transaction as each draft, and use `runWithJobLock` only to claim reconciliation work—not while building or calling Yandex.

- [x] **Step 6: Verify persistence**

Run:

```bash
bun test backend/src/modules/cms/infrastructure/cms-repository.integration.test.ts
bun run --cwd backend prisma:validate
bun run typecheck:backend
bun run architecture:check
```

Expected: migration, constraints, optimistic updates, and repository boundaries pass.

- [x] **Checkpoint:** inspect the generated SQL and Prisma diff for destructive operations; do not edit the SQL by hand.

## Task 3: Implement drafts, registries, approvals, preview grants, and CMS APIs

> Progress note: the authenticated draft/approval/preview slice, safe page/publication/approval summaries and mutation responses, private CMS routes, and snapshot-free approval/publication transport are implemented and covered by unit/route/integration tests. Full cross-reference materialisation, signed builder callbacks, and the public publication pipeline remain in Tasks 5–6.

**Files:**

- Create: `backend/src/modules/cms/application/cms-service.ts`
- Create: `backend/src/modules/cms/application/snapshot-service.ts`
- Create: `backend/src/modules/cms/application/preview-service.ts`
- Create: `backend/src/modules/cms/domain/materialise-snapshot.ts`
- Create: `backend/src/modules/cms/transport/routes.ts`
- Create: `backend/src/modules/cms/transport/errors.ts`
- Create: `backend/src/modules/cms/cms.test.ts`
- Create: `backend/src/modules/cms/cms.integration.test.ts`
- Modify: `backend/src/modules/cms/index.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/http/security.ts`
- Modify: `backend/src/env.ts`
- Modify: `backend/.env.example`

**Interfaces:**

```ts
interface CmsService {
  savePage(actor: CmsActor, pageId: string, input: SavePageDraft): Promise<PageEditorDto>
  saveEntry(actor: CmsActor, entryId: string, input: SaveEntryDraft): Promise<EntryEditorDto>
  saveMenu(actor: CmsActor, menuId: string, input: SaveMenuDraft): Promise<MenuEditorDto>
  saveSettings(actor: CmsActor, input: SaveSiteSettingsDraft): Promise<SiteSettingsEditorDto>
  submitForApproval(actor: CmsActor): Promise<ApprovalDto>
  approve(actor: CmsActor, approvalId: string): Promise<PublicationDto>
  reject(actor: CmsActor, approvalId: string, note: string): Promise<ApprovalDto>
  publishCurrent(actor: CmsActor): Promise<PublicationDto>
  restorePage(actor: CmsActor, pageRevisionId: string): Promise<PageEditorDto>
}
```

- Produces authenticated `/api/cms/*` and signed `/api/internal/cms/builds/*` routes. The builder input route returns short-lived artifact and preview-media URLs, never a large snapshot body or raw object key.

- [ ] **Step 1: Write failing domain and integration tests**

Cover every capability, complete-aggregate validation, path and redirect collisions, stale expected revisions, exact frozen approval behavior, one-time preview consumption, public snapshot allowlisting, and cache headers.

- [ ] **Step 2: Implement registries and materialisation**

Resolve page, content, menu, settings, and media references against the captured draft revision map. Reject missing/archived references, absent alt text for meaningful images, redirect loops, no homepage, multiple homepages, and any unregistered type. Return a single value accepted by `publicationSnapshotSchema`.

- [ ] **Step 3: Implement application services**

Recheck capabilities inside every service. A direct editor publish reads `CmsPolicy` in the publication transaction. Submission stores the complete revision map and materialised candidate. Approval publishes the stored candidate even when newer drafts exist. Restoration copies immutable source data into a new draft revision.

- [ ] **Step 4: Add routes and dedicated request policy**

Mount authenticated routes with `app.route('/api/cms', cms.routes)` and internal signed routes separately. Add `CMS_BODY_LIMIT_BYTES=1048576`, `CMS_MUTATION_RATE_LIMIT_MAX=120`, and `CMS_MUTATION_RATE_LIMIT_WINDOW_SECONDS=60` to validated environment configuration. Editor, preview, and internal responses use `private, no-store`; no anonymous CMS snapshot endpoint is created.

- [ ] **Step 5: Verify CMS APIs**

Run:

```bash
bun test backend/src/modules/cms/cms.test.ts
bun test backend/src/modules/cms/cms.integration.test.ts
bun run typecheck:backend
bun run architecture:check
```

Expected: permissions, frozen approval, preview grant, concurrency, public leakage, and OpenAPI route tests pass.

- [ ] **Checkpoint:** inspect `/openapi.json` and representative owner/editor/public responses.

## Task 4: Implement the media library and durable deletion

> Progress note: the private media upload/finalise/list/alt/deletion foundation and `media:delete-object` outbox handler are implemented. Image dimension extraction and provider-side publication copy remain intentionally pending.

**Files:**

- Create: `backend/src/modules/media/application/media-service.ts`
- Create: `backend/src/modules/media/application/ports.ts`
- Create: `backend/src/modules/media/domain/file-signatures.ts`
- Create: `backend/src/modules/media/domain/errors.ts`
- Create: `backend/src/modules/media/infrastructure/media-repository.ts`
- Create: `backend/src/modules/media/transport/routes.ts`
- Create: `backend/src/modules/media/media.test.ts`
- Create: `backend/src/modules/media/media.integration.test.ts`
- Create: `backend/src/modules/media/index.ts`
- Modify: `backend/src/storage/object-keys.ts`
- Modify: `backend/src/outbox/handlers.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/package.json`

**Interfaces:**

- Produces `POST /api/cms/media/uploads`, `POST /api/cms/media/:id/finalize`, `GET /api/cms/media`, `PATCH /api/cms/media/:id`, and `DELETE /api/cms/media/:id`.
- Produces `media:delete-object` durable task and `MediaAssetDto` without private keys.

- [ ] **Step 1: Write failing lifecycle tests**

Cover the exact MIME/size allowlist, declared-vs-actual length, magic-byte spoofing, immutable content-version and ETag recording, image dimensions, write-once retry, search/listing, alt text, draft/approval/publication usage, and idempotent deletion retries.

- [ ] **Step 2: Implement upload and finalisation**

Follow the existing avatar upload pattern: opaque object keys, signed direct PUT, `headObject`, bounded `readRange`, and finalisation. Add `sharp` as a direct backend dependency for supported image metadata; do not rely only on the root override. Reject SVG and all unknown/scriptable formats.

- [ ] **Step 3: Implement reference-aware deletion**

Read `MediaUsage` rather than scanning JSON. In one database transaction mark an unused asset `deleting` and enqueue `media:delete-object`; the handler deletes storage first and then marks/removes the row idempotently. A referenced asset returns `CMS_MEDIA_IN_USE` with a human-safe count.

- [ ] **Step 4: Wire routes and security**

Reuse `PRIVATE_STORAGE_DRIVER`, signed-ticket settings, and the existing storage port. Do not introduce `STORAGE_DRIVER`. Preview media always uses the session-protected proxy, so do not add the preview origin to private-bucket CORS.

- [ ] **Step 5: Verify media behavior**

Run:

```bash
bun test backend/src/modules/media
bun test backend/src/outbox
bun run typecheck:backend
bun run architecture:check
```

Expected: upload, finalise, usage, and deletion recovery tests pass.

- [ ] **Checkpoint:** verify no DTO or log exposes `objectKey` or a signed URL beyond its intended response.

## Task 5: Implement transactional publication and the single-flight controller

> Progress note: publication creation now atomically advances the durable controller desired revision and inserts a deduplicated `website:rebuild:wakeup` outbox row. The single-flight controller/repository claims one inactive blue/green build, materialises the immutable artifact before dispatch, rejects concurrent claims, expires stale heartbeats, and records recoverable dispatch failures. Builder HMAC signing/verifying, durable nonce replay protection, provider-neutral `{ buildId }` queue dispatch, signed input/heartbeat/result routes, immutable snapshot artifact materialization, write-once private storage, the short wake-up handler, recurring reconciliation, Yandex Query/SQS SigV4 sending, and runtime composition are now in place. Promotion, public marker verification, and backend-owned publication promotion wiring remain pending.

**Files:**

- Create: `backend/src/modules/publication/application/publication-service.ts`
- Create: `backend/src/modules/publication/application/rebuild-controller.ts`
- Create: `backend/src/modules/publication/application/ports.ts`
- Create: `backend/src/modules/publication/infrastructure/publication-repository.ts`
- Create: `backend/src/modules/publication/infrastructure/yandex-queue.ts`
- Create: `backend/src/modules/publication/infrastructure/build-request-auth.ts`
- Create: `backend/src/modules/publication/transport/internal-routes.ts`
- Create: `backend/src/modules/publication/publication.test.ts`
- Create: `backend/src/modules/publication/publication.integration.test.ts`
- Create: `backend/src/modules/publication/index.ts`
- Modify: `backend/src/storage/port.ts`
- Modify: `backend/src/storage/filesystem-storage.ts`
- Modify: `backend/src/storage/s3-storage.ts`
- Modify: `backend/src/storage/object-keys.ts`
- Modify: `backend/src/outbox/handlers.ts`
- Modify: `backend/src/jobs.ts`
- Modify: `backend/src/job-schedules.json`
- Modify: `backend/src/runtime.ts`
- Modify: `backend/src/env.ts`
- Modify: `backend/.env.example`

**Interfaces:**

```ts
interface WebsiteBuildQueue {
  enqueue(command: { buildId: string }): Promise<void>
}

interface RebuildController {
  reconcile(now: Date): Promise<'idle' | 'enqueued' | 'recovered'>
  heartbeat(input: SignedBuildHeartbeat): Promise<void>
  complete(input: SignedBuildResult): Promise<void>
}
```

- Produces task type `website:rebuild:wakeup`, recurring job `website:rebuild:reconcile`, reproducible private snapshot artifact, queue command `{ buildId }`, and idempotent signed input/heartbeat/result routes.

- [ ] **Step 1: Write failing transaction/controller tests**

Test all-or-nothing snapshot/outbox creation, duplicate wake-ups, latest-revision coalescing, one active build, stale callback rejection, five-minute HMAC window, nonce replay rejection, heartbeat expiry, failed build, successful public marker, and one follow-up for a newer desired revision.

- [ ] **Step 2: Implement publication transaction**

Create immutable revisions and `Publication`, redirects, usage rows, audit events, controller desired revision, and one outbox row in the same Prisma transaction. Prune page revisions only after the new publication is durable and never remove source data still referenced by an approval or retained snapshot.

- [ ] **Step 3: Implement short outbox and recurring reconciliation**

The outbox handler calls `reconcile()` and returns; it never waits for a build. Reconciliation claims a build under a short database lock, assigns the inactive slot, persists `PublicationBuild`, serialises the authoritative database snapshot to a private write-once artifact when its recorded ETag is missing, and sends `{ buildId }`. Artifact and queue failures leave recoverable state for the recurring job.

- [ ] **Step 4: Implement signed builder API**

Sign `method + path + timestamp + nonce + sha256(body) + buildId` with HMAC-SHA-256. Internal input returns a short-lived signed snapshot-artifact URL and slot-specific upload/promotion configuration; separate routes accept heartbeats and terminal results. Store used nonces until the clock window expires and accept active plus previous key versions during rotation.

- [ ] **Step 5: Register jobs and environment**

Add the handler through `backend/src/outbox/handlers.ts`, register the recurring job once in `jobs.ts`, and put its provider-neutral schedule in `job-schedules.json`. Extend the provider-neutral storage port with server-side `putObject` and signed read support for snapshot artifacts. Validate YMQ endpoint/queue credentials, `CMS_BUILDER_HMAC_ACTIVE_SECRET`, optional `CMS_BUILDER_HMAC_PREVIOUS_SECRET`, public website URL, 30-second heartbeat interval, 120-second stale-heartbeat threshold, marker timeout, and retry limits in `env.ts`.

- [ ] **Step 6: Verify publication recovery**

Run:

```bash
bun test backend/src/modules/publication
bun test backend/src/outbox
bun run typecheck:backend
bun run architecture:check
```

Expected: transaction, deduplication, at-least-once delivery, heartbeat, and follow-up tests pass without holding an outbox lease during a build.

- [ ] **Checkpoint:** review the state machine and every transition that can advance `publishedRevision`.

## Task 6: Build the dedicated website-builder workspace

> Progress note: the isolated `website-builder` workspace now parses YMQ envelopes, deduplicates and sequentially processes build ids, signs backend input/heartbeat/result calls, validates immutable snapshot artifacts, runs Astro in a temporary output directory, collects static output with cache policy, validates all slot keys before destructive work, uploads the inactive slot with a last-written marker, and provides a tested Yandex S3/SigV4 storage adapter with bounded signed-URL media copy. Promotion wiring and full snapshot-aware Astro block renderer remain pending.

**Files:**

- Create: `website-builder/package.json`
- Create: `website-builder/tsconfig.json`
- Create: `website-builder/Dockerfile`
- Create: `website-builder/src/index.ts`
- Create: `website-builder/src/trigger-message.ts`
- Create: `website-builder/src/backend-client.ts`
- Create: `website-builder/src/build-site.ts`
- Create: `website-builder/src/media-copy.ts`
- Create: `website-builder/src/static-upload.ts`
- Create: `website-builder/src/yandex-promotion.ts`
- Create: `website-builder/tests/*.test.ts`
- Modify: `package.json`
- Modify: `scripts/architecture-check.mjs`

**Interfaces:**

- Consumes a YMQ Serverless Container trigger envelope and extracts one or more `{ buildId }` commands, processing them sequentially with idempotent backend claims.
- Produces heartbeats and one terminal result per claimed build.

- [ ] **Step 1: Write failing builder tests**

Use fake backend, storage, promoter, and process runner ports. Cover malformed envelopes, duplicate build IDs, snapshot schema failure, Astro failure, server-side media copy, cache headers, redirect metadata, inactive marker verification, failed promotion, CDN purge, public marker verification, and retry-safe callbacks.

- [ ] **Step 2: Add the workspace and dependency-safe image**

Add `website-builder` to root workspaces and root typecheck/test scripts. The Docker image copies the immutable release source and performs `bun install --frozen-lockfile` at image-build time. Runtime uses the baked website dependencies and writes only build output below `/tmp`, staying below the Yandex 512 MB temporary-file limit.

- [ ] **Step 3: Implement snapshot build**

Fetch the signed artifact URL, download and validate the assigned publication snapshot once, write it to a private temporary file, and run Astro with `CMS_SNAPSHOT_FILE`, `CMS_PUBLICATION_REVISION`, `PUBLIC_WEBSITE_URL`, and an isolated output directory. With the Node adapter installed, upload only `dist/client`; the builder discards `dist/server`. Do not let individual Astro pages call changing “current content” endpoints.

- [ ] **Step 4: Implement static upload and media copy**

Use S3 `CopyObject` from the private media bucket to `/media/<assetId>/<contentVersion>/<safe-name>` in the inactive slot. Upload immutable assets first, then HTML/XML/redirect objects, then the marker last. Redirect objects are zero-byte objects with `WebsiteRedirectLocation` metadata. Delete stale objects only from the assigned inactive bucket.

- [ ] **Step 5: Implement promotion and verification**

Verify the inactive marker and representative HTML directly. Switch the pre-created ALB selector, purge mutable CDN paths, and poll the public marker with a revision query parameter and `no-store`. Report success only after the marker matches.

- [ ] **Step 6: Verify the builder**

Run:

```bash
bun run --cwd website-builder test
bun run --cwd website-builder typecheck
bun run architecture:check
docker build -f website-builder/Dockerfile -t vibe-cms-builder-test .
```

Expected: unit tests, typecheck, architecture check, and image build pass without injecting backend/database credentials.

- [ ] **Checkpoint:** inspect image layers and environment declarations for secrets and unexpected build context.

## Task 7: Provision Yandex blue/green publication and preview infrastructure

**Files:**

- Create: `infra/yandex/production/cms-publication.tf`
- Create: `infra/yandex/runtime/cms-publication.tf`
- Create: `infra/yandex/runtime/tests/cms-publication.tftest.hcl`
- Modify: `infra/yandex/production/storage.tf`
- Modify: `infra/yandex/production/runtime-inputs.tf`
- Modify: `infra/yandex/production/secrets.tf`
- Modify: `infra/yandex/production/variables.tf`
- Modify: `infra/yandex/production/outputs.tf`
- Modify: `infra/yandex/runtime/containers.tf`
- Modify: `infra/yandex/runtime/ingress.tf`
- Modify: `infra/yandex/runtime/variables.tf`
- Modify: `infra/yandex/runtime/outputs.tf`
- Modify: `infra/yandex/static.Dockerfile`
- Modify: `scripts/infra.mjs`
- Modify: `scripts/infra.test.mjs`

**Interfaces:**

- Produces blue/green website buckets, ALB/CDN selector, YMQ and DLQ, builder and preview containers, least-privilege identities, Lockbox bindings, and Terraform outputs consumed by backend and builder configuration.

- [ ] **Step 1: Write failing Terraform/script tests**

Assert two protected website slots, no public private-media bucket, mandatory CMS CDN topology, queue batch size one, DLQ, builder timeout and resources, separate identities, no builder database secret, no API static-publisher secret, preview domain/route, and active-selector drift protection.

- [ ] **Step 2: Extend the foundation**

Provision two versioned website buckets with public website reads, one private media bucket, YMQ/DLQ, service accounts for queue sender, queue trigger, builder runtime, preview runtime, and promotion. Scope bucket policies to exact slots/prefixes and credentials. Put HMAC and S3 keys in separate Lockbox secrets.

- [ ] **Step 3: Add ALB/CDN blue/green topology**

Follow Yandex's documented Object Storage blue/green pattern. Both slots are created by Terraform; runtime promotion changes only the active backend weights. Add a narrowly targeted lifecycle ignore for those weights and document the operational ownership so Terraform continues to manage every other field.

- [ ] **Step 4: Add builder and preview containers**

Deploy the builder image with YMQ trigger invocation, batch size one, concurrency one, 2,048 MB RAM, one full CPU, and a 600-second execution timeout. Configure a DLQ after five failed receives. Deploy the Astro Node preview image separately and route `preview.<website-domain>` through API Gateway to it. Neither container is publicly invokable except through its intended trigger or gateway.

- [ ] **Step 5: Update release tooling**

The normal guarded release builds and pushes both backend and builder/preview images, applies database migrations before compatible runtime promotion, and seeds both website slots on the first release. It does not use the CMS builder for the webapp surface. Existing manual release marker verification remains for webapp and is extended to the active CMS website marker.

- [ ] **Step 6: Validate infrastructure**

Run:

```bash
bun run test:infra
bun run test:terraform
bun run infra:plan -- yandex
```

Expected: script and Terraform tests pass; the plan shows additive CMS resources and no destruction of PostgreSQL, media, state, or existing certificates.

- [ ] **Checkpoint:** review IAM, Lockbox, bucket policies, active-slot ownership, quotas, and recurring cost before apply.

## Task 8: Render immutable public pages and the protected Astro preview

> Progress note: the website has a snapshot loader, closed block registry, immutable page/path renderer, snapshot-backed `robots.txt`/`sitemap.xml`, and a fallback to the original template landing page when no CMS snapshot is supplied. The request-time preview runtime is now implemented with a compatible Astro Node adapter, server-side one-time exchange, current-role/session/page revalidation, private draft DTOs, authorized server-side media proxy, and `private, no-store`/`X-Robots-Tag` headers. Because Astro ignores leading-underscore page directories, external `/__preview/*` requests rewrite to internal `src/pages/preview/*` routes. Full block-specific component coverage and runtime/public marker integration remain separate follow-up work.

**Files:**

- Create: `website/src/cms/snapshot.ts`
- Create: `website/src/cms/block-registry.ts`
- Create: `website/src/cms/render-page.astro`
- Create: `website/src/cms/components/*.astro`
- Create: `website/src/pages/[...slug].astro`
- Create: `website/src/pages/robots.txt.ts`
- Create: `website/src/pages/sitemap.xml.ts`
- Create: `website/src/pages/preview/exchange.ts` (external `/__preview/exchange` via middleware rewrite)
- Create: `website/src/pages/preview/[pageId].astro` (external `/__preview/:pageId` via middleware rewrite)
- Create: `website/src/pages/preview/media/[assetId].ts` (external `/__preview/media/:assetId` via middleware rewrite)
- Create: `website/src/middleware.ts`
- Create: `website/Dockerfile.preview`
- Create: `website/.env.example`
- Create: `website/tests/cms-rendering.test.ts`
- Create: `website/tests/cms-preview.test.ts`
- Modify: `website/src/pages/index.astro`
- Modify: `website/src/layouts/BaseLayout.astro`
- Modify: `website/astro.config.mjs`
- Modify: `website/package.json`
- Modify: `website/README.md`

**Interfaces:**

- Static build consumes exactly one local file accepted by `publicationSnapshotSchema`.
- Preview exchanges an opaque one-time grant, stores only an HttpOnly session cookie, and fetches a private draft DTO server-to-server.

- [ ] **Step 1: Write failing renderer and preview tests**

Test all 11 block renderers, structured text escaping, internal/external links, root/nested paths, canonical/Open Graph/no-index output, sitemap/robots consistency, unknown block rejection, missing snapshot failure, one-time grant consumption, identical unauthorized 404 responses, and no-store/noindex headers.

- [ ] **Step 2: Implement snapshot-only static rendering**

Load and parse `CMS_SNAPSHOT_FILE` once per build. `index.astro` renders the `/` page; `[...slug].astro` returns only non-root paths from the same object. Generate sitemap and robots endpoints from that object. Never use `set:html` for CMS content.

- [ ] **Step 3: Implement exhaustive renderer registry**

Use a compile-time exhaustive map equivalent to `satisfies Record<CmsBlockType, AstroRenderer>`. Resolve media URLs and central entry selections from the already materialised public block data. Renderer code does not query the backend.

- [x] **Step 4: Add the compatible Node adapter and preview flow**

Install the current `@astrojs/node` version whose peer range covers the pinned Astro version. Keep default output static and mark only preview routes `prerender = false`. Exchange the one-time code server-to-server, set the scoped preview cookie, revalidate capability on every render, proxy authorised preview media, and return `private, no-store` plus `X-Robots-Tag: noindex, nofollow`.

- [x] **Step 5: Verify public and preview builds**

Run:

```bash
bun run test:website
bun run typecheck:website
bun run build:website
docker build -f website/Dockerfile.preview -t vibe-cms-preview-test .
```

Expected: static HTML contains SEO-critical fixture content; preview tests and website build pass; no draft/private marker appears in `website/dist`. The Docker smoke build reached dependency installation but was blocked by external Bun tarball integrity/extraction failures.

- [ ] **Checkpoint:** inspect generated root, nested page, robots, sitemap, redirect manifest, and preview response headers.

## Task 9: Build the human-centred CMS admin

> Progress note: the admin foundation now includes Russian page/publication/media navigation for editor and owner roles, authenticated contract-validated CMS queries, safe page/draft summaries, a schema-validated page editor for core fields/SEO/block ordering, structured text editing for text-image, bounded benefits item editing, optional Hero/CTA actions, Contacts/FormPlaceholder fields, media pickers for Hero/TextImage/Gallery, and collection selection pickers backed by a safe active-entry list, collection entry CRUD, serialized autosave with optimistic revisions and conflict preservation, publication status, submit/approve/reject actions, a safe page revision history with scoped restore, and a media library with search, signed-ticket upload/finalisation, alt-text editing, and owner-only durable deletion. Production publication wiring remains pending.

**Files:**

- Create: `webapp/src/features/cms/index.ts`
- Create: `webapp/src/features/cms/api.ts`
- Create: `webapp/src/features/cms/queries.ts`
- Create: `webapp/src/features/cms/model.ts`
- Create: `webapp/src/features/cms/pages.tsx`
- Create: `webapp/src/features/cms/components/PageList.tsx`
- Create: `webapp/src/features/cms/components/PageEditor.tsx`
- Create: `webapp/src/features/cms/components/BlockEditor.tsx`
- Create: `webapp/src/features/cms/components/StructuredTextEditor.tsx`
- Create: `webapp/src/features/cms/components/MediaLibrary.tsx`
- Create: `webapp/src/features/cms/components/MediaPicker.tsx`
- Create: `webapp/src/features/cms/components/SeoPanel.tsx`
- Create: `webapp/src/features/cms/components/ApprovalPanel.tsx`
- Create: `webapp/src/features/cms/components/PublicationStatus.tsx`
- Create: `webapp/src/features/cms/components/RevisionHistory.tsx`
- Create: `webapp/tests/cms-model.test.ts`
- Create: `webapp/tests/cms-pages.test.tsx`
- Create: `webapp/tests/cms-autosave.test.tsx`
- Modify: `webapp/src/routes.tsx`
- Modify: `webapp/src/pages.tsx`
- Modify: `webapp/src/features/navigation/model.ts`
- Modify: `webapp/src/components/WorkspaceShell.tsx`

**Interfaces:**

- Produces `/admin/pages`, `/admin/pages/$pageId`, `/admin/content/$type`, `/admin/media`, `/admin/menu`, `/admin/publications`, and owner-only `/admin/site-settings` and `/admin/access` routes.
- Autosave consumes `expectedRevision` and serialises writes per aggregate.

- [ ] **Step 1: Write failing model/component tests**

Assert Russian labels, role-aware navigation, route guards, schema-driven fields, field-level validation, 44px controls, accessible icon names, keyboard reorder, autosave serialization, conflict preservation, owner-only policy/analytics, frozen approval status, and absence of JSON/UUID/object-key/API/build-ID text.

- [ ] **Step 2: Implement route and query foundations**

Add CMS query keys below `['session', 'cms']`, validate every response with shared schemas, invalidate only affected aggregates and publication summaries, and rely on the existing authenticated transport refresh behavior. Workspace guards accept both owner and editor while owner-only child routes check capabilities.

- [ ] **Step 3: Implement page and structured-content editors**

Render the shared field descriptor catalogue in Russian. Provide paragraphs, headings, lists, quotes, bold, italic, and safe links without exposing JSON. Add explicit move up/down controls in addition to pointer drag-and-drop, remove confirmation, visible local/save/conflict state, and debounced serialized autosave.

- [ ] **Step 4: Implement collections, media, menus, SEO, settings, and history**

Reuse page primitives where schemas overlap. Media upload follows the existing avatar transfer semantics. Editors never receive owner-only settings DTO fields. Restoration always says “Восстановить в черновик” and never mutates history.

- [ ] **Step 5: Implement preview and approval/publication UX**

Request a one-time preview URL only after pending autosaves settle, then open it in a new tab. Show “Опубликовать изменения” when allowed and “Отправить на согласование” otherwise. Owners see the frozen candidate timestamp/revisions and approve or reject it explicitly. Poll publication summaries while queued/building and stop on terminal state.

- [ ] **Step 6: Verify admin UI**

Run:

```bash
bun run test:webapp
bun run typecheck:webapp
bun run lint
bun run architecture:check
```

Expected: unit/component tests, typecheck, lint, route boundaries, and accessibility assertions pass.

- [ ] **Checkpoint:** manually inspect primary flows at 375, 768, 1024, and 1440 CSS pixels before E2E.

## Task 10: Complete E2E, operational documentation, and full verification

**Files:**

- Create: `webapp/e2e/specs/cms.spec.ts`
- Create: `backend/src/modules/cms/cms-e2e-seed.ts`
- Create: `website-builder/tests/fixtures/publication-snapshot.json`
- Modify: `webapp/e2e/global-setup.ts`
- Modify: `webapp/playwright.config.ts`
- Modify: `CHECKLIST.md`
- Modify: `README.md`
- Modify: `backend/README.md`
- Modify: `webapp/README.md`
- Modify: `website/README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/BACKGROUND_JOBS.md`
- Modify: `docs/STORAGE.md`
- Modify: `docs/WEB_SURFACES.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/YANDEX_CLOUD.md`
- Modify: `docs/TESTING.md`

**Interfaces:**

- Produces deterministic local fixtures, a fake builder/promotion mode for Playwright, complete operations guidance, and evidence that the acceptance criteria pass.

- [ ] **Step 1: Add deterministic E2E fixtures**

Seed one owner, editor, and regular user; a published homepage and nested page; newer draft edits; one frozen approval; referenced and unused media; a redirect; and fake build states. Keep fixture credentials confined to local/test environment variables.

- [ ] **Step 2: Implement Playwright journeys**

Cover:

```text
editor edits → serialized autosave → private preview changes → public fixture unchanged
editor submits while direct publish is disabled → owner approves exact frozen candidate
editor publishes directly when policy is enabled → fake build verifies → public revision advances
newer draft after submission does not leak into approved publication
editor direct-navigation to owner routes returns safe redirect/403 without owner data
owner changes a path → published old path returns 3xx to final live path
used media cannot be deleted → unused media deletion completes through durable task
builder failure → prior marker remains active → owner retry succeeds
concurrent edit → 409 explanation preserves local input
```

- [ ] **Step 3: Document local and production operation**

Document CMS environment variables, local filesystem media, fake builder mode, preview domain/cookie behavior, generated migration workflow, YMQ/DLQ inspection, heartbeat recovery, manual retry, blue/green rollback, CDN purge, HMAC rotation, legacy-admin adoption, and the rule that Terraform does not own the live active weight after bootstrap.

- [ ] **Step 4: Complete the project checklist**

Record active backend/webapp/website/preview/builder surfaces, public build-time data, automatic rebuild capability, Yandex provider, PostgreSQL 18, private media, blue/green buckets, CDN/ALB, queue/DLQ, owner seed, domains, certificates, DNS owner, IAM operator, and measured builder resource limits.

- [ ] **Step 5: Run the full local gate**

Run:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run architecture:check
bun run build
bun run e2e:webapp
bun run test:terraform
```

Expected: every command passes. The checked static HTML contains the expected title, description, canonical, Open Graph data, and public media URL; it contains no drafts, private keys, users, approval notes, or build diagnostics.

- [ ] **Step 6: Run the Yandex pre-apply gate**

Run: `bun run infra:plan -- yandex`

Expected: the plan contains only intended CMS additions/updates, preserves protected database/media/state resources, and shows separate API, builder, trigger, preview, and promotion identities.

- [ ] **Checkpoint:** hand the test output, Terraform plan, IAM review, cost review, and rollback procedure to the deployment owner before production apply.

## Plan self-review

- **Spec coverage:** roles and contracts are Task 1; persistence is Task 2; drafts, approvals, preview grants, snapshot materialisation, and APIs are Task 3; media is Task 4; publication state and recovery are Task 5; the isolated builder is Task 6; atomic Yandex topology is Task 7; Astro public/preview rendering is Task 8; the human admin is Task 9; acceptance and operations are Task 10.
- **No unresolved implementation choices:** role compatibility, approval granularity, snapshot consistency, text format, initial block fields, media formats/limits, redirect delivery, preview session, queue semantics, builder status, slot promotion, and Terraform drift ownership are fixed in the specification.
- **Command/path consistency:** migrations use `prisma:migrate`; storage uses `PRIVATE_STORAGE_DRIVER`; webapp/website/Playwright tests are in directories executed by their real scripts; the root E2E command is `e2e:webapp`; architecture validation is present throughout.
- **Security consistency:** public DTOs never contain object keys or private state; the normal backend cannot build/promote; the builder has no database credential; preview codes are one-time; all provider delivery is retry-safe and idempotent.
