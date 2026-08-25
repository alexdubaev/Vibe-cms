# Vibe CMS Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a reusable, Russian-first CMS module inside an individual Vibe project so owners and editors can safely manage and publish content sites.

**Architecture:** The backend owns authorisation, draft/published data, immutable revisions, media metadata, and an outbox-backed publication controller. The React `webapp` is a human-language CMS admin; the Astro `website` renders published snapshots statically and one signed-in SSR preview route. The developer-owned block registry is the contract joining the backend, UI, and Astro renderers.

**Tech Stack:** Bun, Hono/OpenAPI, Prisma 7/PostgreSQL, Zod 4, React 19, TanStack Query/Form/Router, Astro 7, Tailwind 4, S3-compatible storage, Vibe task outbox, Yandex Cloud.

**Spec:** `docs/superpowers/specs/2026-08-24-vibe-cms-module-design.md`

## Global Constraints

- The target is a new client-specific checkout of `di-sukharev/vibe`; do not modify the upstream template repository.
- Use the exact package versions locked by the target checkout and consult current official documentation before adding framework-specific code.
- All ordinary UI text is Russian, action-oriented, and free of database IDs, JSON, API paths, object keys, and raw provider diagnostics.
- Only code-registered blocks are supported; user-authored HTML, CSS, JavaScript, iframes, and analytics snippets are rejected.
- Public Astro output consumes only published, allowlisted DTOs; drafts and private metadata never reach a public route or static artifact.
- `owner` and `editor` capabilities are enforced on the backend; hiding a control in React is not authorisation.
- Keep public pages static; only authenticated preview uses Astro SSR. Production media uses S3-compatible storage, never a container filesystem.
- Run the smallest focused test after every task, then the affected workspace typecheck/test before its commit.

---

## File Structure

| Area | Files | Responsibility |
|---|---|---|
| Shared contracts | `packages/contracts/src/cms.ts`, `packages/contracts/src/index.ts` | Zod schemas and public TypeScript DTOs used by all surfaces |
| Database | `backend/prisma/schema.prisma`, `backend/prisma/migrations/*` | Roles, CMS tables, constraints, indexes |
| CMS backend | `backend/src/modules/cms/**` | Content rules, repositories, transport, revisions, publication |
| CMS media | `backend/src/modules/media/**` | Media records, upload/finalize lifecycle, usage checks |
| Backend wiring | `backend/src/app.ts`, `backend/src/outbox/handlers.ts`, `backend/src/jobs.ts` | Routes, security, task handlers, recovery schedule |
| Admin UI | `webapp/src/features/cms/**`, `webapp/src/routes.tsx`, `webapp/src/features/navigation/model.ts` | Content-first forms, queries, routes, role-aware navigation |
| Public website | `website/src/cms/**`, `website/src/pages/**`, `website/astro.config.mjs` | Block rendering, published API client, static paths, protected preview |
| Release integration | `backend/src/modules/publication/**`, `infra/yandex/**`, `docs/YANDEX_CLOUD.md` | Single-flight rebuild controller and dedicated authenticated builder |

## Task 1: Establish CMS roles, schema, and contracts

**Files:**
- Create: `packages/contracts/src/cms.ts`, `packages/contracts/src/cms.test.ts`
- Modify: `packages/contracts/src/auth.ts`, `packages/contracts/src/index.ts`
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_add_cms_module/migration.sql`
- Modify: `backend/src/modules/users/domain/admin-seed-config.ts`, `backend/src/modules/users/users.integration.test.ts`

**Interfaces:**
- Produces `CmsRole = 'owner' | 'editor'`, `cmsCapabilitySchema`, `pageDraftSchema`, `publishedPageSchema`, `publicationStatusSchema`, and `apiErrorSchema`-compatible conflict responses.
- Produces Prisma models `SiteSettings`, `Page`, `PageRevision`, `ContentEntry`, `Menu`, `MenuItem`, `Redirect`, `Publication`, `MediaAsset`, and `CmsAuditEvent`.

- [ ] **Step 1: Write failing contract tests**

```ts
test('published page excludes draft-only fields', () => {
  expect(publishedPageSchema.safeParse({ id: 'x', blocks: [], revision: 1 }).success).toBe(true)
  expect(publishedPageSchema.safeParse({ id: 'x', draft: {}, blocks: [] }).success).toBe(false)
})
```

- [ ] **Step 2: Run the contract test**

Run: `bun test packages/contracts/src/cms.test.ts`

Expected: FAIL because the CMS contracts do not exist.

- [ ] **Step 3: Define the shared schemas**

Implement stable public DTOs and strict Zod schemas. Use internal UUIDs only in transport DTOs, never display DTOs. Include `expectedRevision: z.number().int().nonnegative()` on every draft write.

- [ ] **Step 4: Add database schema and migration**

Add `owner` and `editor` to `UserRole`, migrate the seeded administrator to `owner`, and create CMS models with UUIDv7 IDs, foreign keys, unique normalized page paths, revision counters, and indexes for `(status, updatedAt)`, publication state, and media usage lookup.

- [ ] **Step 5: Run migration and tests**

Run: `bun run --cwd backend prisma:generate; bun run --cwd backend prisma:deploy; bun test packages/contracts/src/cms.test.ts backend/src/modules/users/users.integration.test.ts`

Expected: PASS; the seed creates an owner and no normal user gains CMS permissions.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts backend/prisma backend/src/modules/users
git commit -m "feat(cms): add roles and content schema"
```

## Task 2: Build the block registry and CMS application layer

**Files:**
- Create: `backend/src/modules/cms/domain/block-registry.ts`, `backend/src/modules/cms/domain/errors.ts`
- Create: `backend/src/modules/cms/application/cms-service.ts`, `backend/src/modules/cms/application/ports.ts`
- Create: `backend/src/modules/cms/infrastructure/cms-repository.ts`, `backend/src/modules/cms/index.ts`
- Create: `backend/src/modules/cms/**/*.test.ts`

**Interfaces:**
- Consumes `pageDraftSchema` and Prisma CMS models from Task 1.
- Produces `CmsService.savePageDraft(actor, pageId, input)`, `CmsService.publishPage(actor, pageId, expectedRevision)`, `CmsService.restoreRevision(actor, revisionId)`, and `CmsService.listPublishedPages()`.

- [ ] **Step 1: Write failing registry tests**

```ts
test('rejects an unregistered block type', () => {
  expect(() => registry.parse({ type: 'raw-html', data: {} })).toThrow('Unsupported block')
})
```

- [ ] **Step 2: Implement code-owned block definitions**

Add Hero, text/image, benefits, service selection, case selection, testimonial selection, FAQ, gallery, CTA, contacts/map, and form-placeholder definitions. Each definition includes Russian labels/hints, defaults, a Zod schema, and a `toPublic()` mapper.

- [ ] **Step 3: Write failing application tests**

Cover owner/editor capability checks, expected-revision conflict, page-local block validation, central-entry reference validation, and restoring a publication into a new draft.

- [ ] **Step 4: Implement service and repository**

Use an interactive Prisma transaction to validate the full draft, update only when `expectedRevision` matches, increment revision, and write an audit record. Return a typed conflict rather than overwriting another editor.

- [ ] **Step 5: Verify module tests**

Run: `bun test backend/src/modules/cms`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/cms packages/contracts/src/cms.ts
git commit -m "feat(cms): add validated draft content service"
```

## Task 3: Add CMS API routes and backend authorisation

**Files:**
- Create: `backend/src/modules/cms/transport/routes.ts`, `backend/src/modules/cms/transport/errors.ts`, `backend/src/modules/cms/cms.integration.test.ts`
- Modify: `backend/src/app.ts`, `backend/src/modules/auth/transport/middleware.ts`
- Modify: `backend/src/http/security.ts`, `backend/.env.example`

**Interfaces:**
- Produces editor routes under `/api/cms`: pages, revisions, collections, menus, settings, preview session, and publication records.
- Produces anonymous public routes under `/api/public/site` and `/api/public/pages/{path}` containing `publishedPageSchema` only.

- [ ] **Step 1: Write failing integration tests**

Test that anonymous callers cannot reach `/api/cms/*`; editors can edit content but receive 403 for settings/analytics/users; owners can perform all CMS actions; public routes never serialise drafts, author emails, or raw object keys.

- [ ] **Step 2: Implement `requireCmsCapability` middleware**

Extend the existing JWT user context with the new role and map request capabilities explicitly. Keep `requireAdmin` for unrelated legacy admin operations; do not silently broaden it.

- [ ] **Step 3: Implement OpenAPI routes**

Use `OpenAPIHono`, `createRoute`, shared Zod schemas, `requireAuth`, and capability middleware. Mount the module with `app.route('/api/cms', cms.routes)` and put CMS traffic under the existing authenticated body/rate-limit policy in `backend/src/app.ts`.

- [ ] **Step 4: Add public response cache headers and tests**

Make only public published endpoints cacheable. Preview/editor responses use `private, no-store`. Test headers and error envelopes.

- [ ] **Step 5: Run integration suite and OpenAPI check**

Run: `bun test backend/src/modules/cms/cms.integration.test.ts; bun run typecheck:backend`

Expected: PASS and `/openapi.json` includes every documented CMS route.

- [ ] **Step 6: Commit**

```bash
git add backend/src/app.ts backend/src/modules/cms backend/src/modules/auth backend/src/http backend/.env.example
git commit -m "feat(cms): expose authorised content API"
```

## Task 4: Implement media library on the existing storage port

**Files:**
- Create: `backend/src/modules/media/application/media-service.ts`, `backend/src/modules/media/infrastructure/media-repository.ts`, `backend/src/modules/media/transport/routes.ts`, `backend/src/modules/media/index.ts`
- Create: `backend/src/modules/media/**/*.test.ts`
- Modify: `backend/src/storage/object-keys.ts`, `backend/src/app.ts`, `packages/contracts/src/cms.ts`

**Interfaces:**
- Produces `POST /api/cms/media/uploads`, `POST /api/cms/media/{id}/finalize`, `GET /api/cms/media`, `PATCH /api/cms/media/{id}`, and `DELETE /api/cms/media/{id}`.
- Produces safe `MediaAssetDto { id, url, width, height, byteSize, altText }` for the editor and public mapper.

- [ ] **Step 1: Write failing media lifecycle tests**

Cover signed upload creation, rejected MIME/size, finalisation, alt text update, listing, and a delete request rejected when a published page or draft references the asset.

- [ ] **Step 2: Implement media metadata and object keys**

Create opaque CMS media object keys. Reuse the existing signed upload/finalize semantics rather than exposing S3 credentials. Store dimensions and generated derivative metadata only after successful finalisation.

- [ ] **Step 3: Implement reference-aware deletion**

Repository deletion must query page drafts, revisions, settings, and central entries before deleting the database row or storage object. Return a typed `media_in_use` error with a human-safe usage count.

- [ ] **Step 4: Wire routes and public delivery**

Mount the media routes under `/api/cms`. Add production configuration for derivative/CDN origin and ensure `STORAGE_DRIVER=filesystem` remains development-only.

- [ ] **Step 5: Verify focused suite**

Run: `bun test backend/src/modules/media; bun run typecheck:backend`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/media backend/src/storage backend/src/app.ts packages/contracts
git commit -m "feat(cms): add safe media library"
```

## Task 5: Build publications, redirects, and the Yandex rebuild controller

**Files:**
- Create: `backend/src/modules/publication/application/publication-service.ts`, `backend/src/modules/publication/infrastructure/publication-repository.ts`, `backend/src/modules/publication/infrastructure/yandex-builder.ts`, `backend/src/modules/publication/index.ts`
- Create: `backend/src/modules/publication/**/*.test.ts`
- Modify: `backend/src/outbox/handlers.ts`, `backend/src/jobs.ts`, `backend/src/job-schedules.json`, `backend/src/app.ts`
- Modify: `infra/yandex/**`, `docs/YANDEX_CLOUD.md`, `docs/DEPLOYMENT.md`

**Interfaces:**
- Produces `PublicationService.publish()` and `PublicationService.reconcileRebuild()`.
- Produces persistent controller fields `desiredRevision`, `publishedRevision`, `activeDeploymentId`, `status`, and `lastError`.

- [ ] **Step 1: Write publication transaction tests**

Verify publishing creates immutable page/settings/entry snapshots, writes an audit event, advances `desiredRevision`, and enqueues exactly one deduplicated rebuild wake-up. Verify a validation or transaction failure changes none of those records.

- [ ] **Step 2: Implement revision pruning and redirects**

In the publication transaction create a redirect when a path changes, reject path collisions, preserve the previous published output on later failures, and prune only revisions older than the most recent 20.

- [ ] **Step 3: Implement single-flight rebuild reconciliation**

Add `website:rebuild` outbox handler and `website:rebuild:reconcile` recurring job. The reconciler starts one builder deployment at a time, records its ID, polls it in later passes, verifies an immutable build revision marker, and starts one follow-up if `desiredRevision` advanced.

- [ ] **Step 4: Add a dedicated Yandex builder**

Provision a separately authenticated builder/container with only website build and deployment permissions. It receives an immutable published revision, builds the Astro output, writes revisioned artifacts, and atomically promotes them. Do not put a website toolchain or broad storage credential in the normal backend runtime container.

- [ ] **Step 5: Test recovery and failure semantics**

Use a fake builder port to test duplicate wake-ups, a deployment longer than one outbox lease, restart recovery, provider failure, stale result rejection, and retry UI state. Run: `bun test backend/src/modules/publication backend/src/outbox`

- [ ] **Step 6: Update operations documentation and commit**

```bash
git add backend/src/modules/publication backend/src/outbox backend/src/jobs.ts backend/src/job-schedules.json infra/yandex docs
git commit -m "feat(cms): publish revisions through rebuild controller"
```

## Task 6: Render the published website and protected preview

**Files:**
- Create: `website/src/cms/api.ts`, `website/src/cms/block-registry.ts`, `website/src/cms/render-page.astro`, `website/src/pages/[...slug].astro`, `website/src/pages/__preview/[pageId].astro`
- Create: `website/src/cms/**/*.test.ts`, `website/tests/cms-pages.test.ts`
- Modify: `website/astro.config.mjs`, `website/package.json`, `website/src/layouts/BaseLayout.astro`, `website/src/pages/index.astro`, `website/.env.example`

**Interfaces:**
- Consumes published DTOs from `/api/public/*`; consumes authenticated preview DTOs only through a server-side protected request.
- Produces static HTML for published paths and one `prerender = false` preview route.

- [ ] **Step 1: Write failing renderer tests**

Test every initial registered block renders its SEO-critical copy in server HTML, rejects an unregistered block before rendering, and turns no-index/canonical/social-image settings into the expected metadata.

- [ ] **Step 2: Implement public API client and registry**

Parse every backend response using shared contracts. Map registered block data to Astro components; do not use `set:html` for CMS values.

- [ ] **Step 3: Implement dynamic static page generation**

Use `getStaticPaths()` from published pages, render root and nested slugs, emit sitemap/robots from published data, and implement redirects from the published redirect map.

- [ ] **Step 4: Implement authenticated SSR preview**

Install the Astro Node adapter with a compatible Astro peer range, set a standalone adapter, set `export const prerender = false` only on the preview route, and verify its backend access token/session server-side. Return 401/403 without leaking page existence.

- [ ] **Step 5: Build and test website**

Run: `bun run --cwd website typecheck; bun run --cwd website test; bun run --cwd website build`

Expected: PASS; public output contains no draft marker or private DTO field.

- [ ] **Step 6: Commit**

```bash
git add website packages/contracts
git commit -m "feat(cms): render published pages and preview"
```

## Task 7: Build the human-centred CMS admin

**Files:**
- Create: `webapp/src/features/cms/api.ts`, `queries.ts`, `model.ts`, `pages.tsx`, `components/PageList.tsx`, `components/PageEditor.tsx`, `components/BlockEditor.tsx`, `components/MediaPicker.tsx`, `components/PublicationStatus.tsx`, `components/SeoPanel.tsx`, `components/RevisionHistory.tsx`
- Create: `webapp/src/features/cms/**/*.test.tsx`
- Modify: `webapp/src/routes.tsx`, `webapp/src/features/navigation/model.ts`, `webapp/src/pages.tsx`, `webapp/src/components/WorkspaceShell.tsx`

**Interfaces:**
- Consumes the CMS editor DTOs and mutations from Task 3.
- Produces `/admin/pages`, `/admin/pages/$pageId`, `/admin/media`, `/admin/content/$type`, `/admin/menu`, and owner-only `/admin/site-settings` routes.

- [ ] **Step 1: Write failing component tests for human language**

Assert that Page Editor labels include “Содержание страницы”, “Добавить раздел”, “Посмотреть черновик”, and “Опубликовать изменения”; assert no DOM text contains `objectKey`, JSON, API path, or raw backend error code.

- [ ] **Step 2: Implement CMS navigation and page list**

Add owner/editor navigation using real business nouns. Make page cards show title, address, visible draft/published state, and one primary “Изменить” action.

- [ ] **Step 3: Implement schema-driven block forms**

Render only each registry form descriptor's Russian labels, hints, examples, and allowed fields. Add keyboard-accessible reorder controls, add/remove block confirmations, 44px touch targets, visible focus, inline field errors, and debounced autosave with a plain-language save state.

- [ ] **Step 4: Implement media, SEO, menus, collections, and settings flows**

Build a reusable media picker and library. Use the named SEO panel “Как страница выглядит в поиске и соцсетях.” Render analytics IDs and publication-setting controls only for owners.

- [ ] **Step 5: Implement publication, conflicts, and history UX**

Show only “Сохранено”, “Есть изменения”, “Ожидает согласования”, “Сайт обновляется”, “Опубликовано”, and corrective failure messages. On a conflict, preserve local draft input, explain who saved newer changes, and offer reload/review; never overwrite automatically.

- [ ] **Step 6: Verify UI tests and accessibility**

Run: `bun test webapp/src/features/cms; bun run typecheck:webapp`

Expected: PASS. Verify focus order, labelled inputs, icon labels, colour-independent statuses, and 375px responsive layout in automated tests.

- [ ] **Step 7: Commit**

```bash
git add webapp/src/features/cms webapp/src/routes.tsx webapp/src/features/navigation webapp/src/pages.tsx webapp/src/components
git commit -m "feat(cms): add content-first admin interface"
```

## Task 8: End-to-end validation, project setup, and operational handoff

**Files:**
- Create: `webapp/e2e/cms.spec.ts`, `backend/src/modules/cms/cms.e2e.seed.ts`
- Modify: `docs/TESTING.md`, `CHECKLIST.md`, `backend/README.md`, `webapp/README.md`, `website/README.md`, `docs/YANDEX_CLOUD.md`

**Interfaces:**
- Validates the full owner/editor/public visitor flow against the APIs and release controller delivered by Tasks 1–7.

- [ ] **Step 1: Write failing Playwright scenarios**

Implement tests for:

```text
editor edits a block → draft saves → authenticated preview shows draft → public site is unchanged
editor publishes when allowed → rebuild reaches published → public site shows the new revision
editor cannot reach owner settings even by direct URL
owner changes URL → prior URL redirects after publication
used media cannot be deleted → unused media can be deleted
failed builder deployment → prior public revision remains live → owner can retry
```

- [ ] **Step 2: Add deterministic fixtures**

Seed one owner, one editor, a published page, a pending draft, a referenced image, an unused image, and a fake builder state without exposing fixture passwords outside local/test environment.

- [ ] **Step 3: Run full validation**

Run:

```bash
bun run typecheck
bun run test
bun run e2e
bun run build:website
```

Expected: all checks pass and the checked public HTML includes the expected title, description, canonical URL, and Open Graph fields.

- [ ] **Step 4: Record deployment prerequisites**

Update `CHECKLIST.md` with active website/webapp/backend surfaces, S3 media, Yandex builder, owner seed, CMS capability ledger, website URL, webapp URL, and deployment ownership. Document the manual production authorisations: Yandex account, DNS, Object Storage bucket/CDN, PostgreSQL, builder identity, and analytics IDs.

- [ ] **Step 5: Commit**

```bash
git add webapp/e2e backend/src/modules/cms docs CHECKLIST.md backend/README.md webapp/README.md website/README.md
git commit -m "test(cms): cover publishing workflow end to end"
```

## Plan Self-Review

- Spec coverage: Tasks 1–2 cover data, roles, blocks, drafts, revisions, collections, menus, redirects, and audit; Tasks 3–5 cover API, security, publication, and Russia-first rebuilds; Tasks 4 and 7 cover media and human UI; Task 6 covers Astro static/SSR rendering and SEO; Task 8 covers acceptance flows and operations.
- No-placeholder review: every task names its files, interfaces, validation command, and completion condition.
- Interface consistency: `CmsService`, shared contracts, public DTOs, CMS route prefix, task names, role names, and publication controller state use the same names in every task.
