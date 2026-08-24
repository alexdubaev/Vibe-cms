# Vibe CMS Module Design

**Status:** implementation-ready baseline  
**Target:** a new client-specific checkout of `di-sukharev/vibe` at or after commit `9234bca8ffe2b6f98507c1d05a40f2a4e6c2e98d`  
**Language and hosting:** Russian-first, Yandex Cloud production path

## Purpose

Build a reusable CMS module inside each client-specific Vibe project. Every client receives an isolated codebase, PostgreSQL database, media storage, users, admin area, publication history, and static website deployment. This is not a central multi-tenant SaaS and has no separate CMS licence or subscription.

The first release lets a small-business owner or editor change known website content safely, preview an exact draft, submit or publish a site-wide change set, and keep the previously published website live if a build fails.

## Fixed product decisions

- The CMS is single-project and single-site. Tenant IDs are not stored.
- Public content is Russian-only. Localisation and locale routes are not modelled.
- Application roles are `user`, `editor`, and `owner`. `user` has no CMS access.
- The upstream database value `admin` may remain temporarily as a hidden compatibility value. Infrastructure maps it to owner capabilities and migrates it to `owner`; it is never accepted by new API requests or displayed in the UI.
- Publications are site-wide immutable snapshots. A publication never assembles pages from independently changing “current” endpoints.
- Drafts remain editable after submission. An approval request freezes the exact draft revision map that the owner reviews.
- `editorCanPublish` is an immediate owner-controlled security policy, not public website content. Changing it does not require a website rebuild.
- Owners can publish the current draft or approve a frozen editor submission. Editors publish directly only when the policy allows it; otherwise they submit for approval.
- Preview is private, short-lived, and non-shareable in normal use. It uses a one-time code followed by an HttpOnly preview session, not a durable bearer URL.
- Editors compose pages from developer-registered blocks. Arbitrary HTML, CSS, JavaScript, iframe markup, analytics snippets, and user-defined block types are forbidden.
- Public originals are not exposed directly from the private media bucket. Only assets referenced by a publication are copied into the inactive static-site slot under stable, content-addressed public keys.
- Keep the newest 20 published revisions per page. Restoring creates a new draft revision; published history is never edited.
- Publication is atomic at the site level through blue/green static origins. In-place synchronization of the live bucket is not an acceptable promotion mechanism.
- Forms, CRM, multilingual content, commerce, manual image cropping, and arbitrary embeds are outside the first release.

## System architecture

```text
owner/editor
    │
    ▼
React webapp (/admin/*)
    │ authenticated API
    ▼
Hono backend
    ├── PostgreSQL: drafts, policies, approvals, snapshots, audit, build state
    ├── private Object Storage: validated media originals
    ├── task_outbox: durable rebuild wake-up
    └── Yandex Message Queue: build command containing buildId only
                                      │
                                      ▼
                         dedicated builder container
                         ├── download signed immutable snapshot artifact
                         ├── Astro static build
                         ├── server-side copy published media
                         ├── upload and verify inactive slot
                         └── promote blue/green origin
                                      │
                                      ▼
                         ALB + CDN → active website bucket

React webapp ── one-time preview grant ──► Astro Node preview container
                                                │ server-to-server
                                                ▼
                                         private draft API
```

The existing backend runtime never carries the website source tree, build toolchain, static-publisher credential, or ALB/CDN promotion authority. The builder never receives a database credential. Builder-to-backend requests use a rotated HMAC secret from Lockbox, a timestamp, build ID, and replay-protected nonce. The backend returns a short-lived signed GET for an immutable snapshot artifact in private Object Storage instead of returning a potentially oversized Serverless Containers response.

## Module boundaries

### Shared contracts

`packages/contracts/src/cms/` owns strict Zod transport schemas and framework-free types. It includes block data, structured text, page drafts, collection entries, media DTOs, approval/publication state, preview grants, public snapshots, and typed API errors.

Contracts do not import React, Astro, Hono, Prisma, provider SDKs, or environment configuration. All object schemas reject unknown fields. Public schemas are explicit allowlists and are tested against draft/private field leakage.

The machine block catalogue and field descriptors may live in contracts because they are inert data and Zod schemas. Astro renderers and backend persistence remain in their respective surfaces.

### CMS backend

`backend/src/modules/cms` owns draft validation, optimistic concurrency, page and collection rules, menus, settings, redirects, approval requests, restoration, audit events, and public snapshot creation.

Follow the upstream DDD-lite boundary:

- `domain/`: pure registries, normalisation, capabilities, errors;
- `application/`: use cases and ports;
- `infrastructure/`: Prisma repositories and provider adapters;
- `transport/`: OpenAPI routes and error mapping;
- `index.ts`: the only cross-module import boundary.

### Media backend

`backend/src/modules/media` owns signed upload tickets, finalisation, file validation, metadata, usage references, and safe deletion. It reuses the backend-wide private storage port.

### Publication backend

`backend/src/modules/publication` owns the single-flight controller, reproducible private snapshot artifact, outbox wake-up, YMQ command, signed builder callbacks, heartbeat recovery, retry, and public marker verification. Provider code is behind a port.

### Admin webapp

`webapp/src/features/cms` owns CMS routes, API adapters, React Query state, TanStack Form state, autosave sequencing, conflict recovery, and human-language UI. It may hide unavailable actions but never makes an authorization decision.

### Public website and preview

`website/src/cms` validates one immutable publication snapshot and renders only registered blocks. Public routes are static. A separate Astro Node build exposes only `__preview` routes and fetches drafts server-to-server.

## Roles and capabilities

| Capability | Owner | Editor | User |
|---|---:|---:|---:|
| Read/edit page, collection, menu, SEO, and media drafts | Yes | Yes | No |
| Open authenticated preview | Yes | Yes | No |
| Submit a frozen change set for approval | Yes | Yes | No |
| Publish current draft | Yes | Policy-controlled | No |
| Approve/reject editor submissions | Yes | No | No |
| Restore a published page revision into draft | Yes | No | No |
| Manage redirects, analytics, publishing policy, and CMS roles | Yes | No | No |

Capabilities are mapped explicitly in the backend. Existing `requireAdmin` exact-role middleware is not reused for CMS. Legacy `/api/admin/*` user-management routes become owner-only while retaining their URL for compatibility.

The JWT continues to omit role information. Every authenticated request uses the existing active-session and database lookup, so role and policy changes take effect immediately.

## Content contracts

### Structured text

CMS text is a small JSON AST, never HTML or unrestricted Markdown:

- document: 1–80 blocks;
- blocks: paragraph, heading level 2 or 3, bullet list, numbered list, quote;
- inline spans: text with optional `bold` and `italic` marks;
- links: internal page reference plus optional safe anchor, or an external `https:` URL;
- maximum 10,000 visible characters per document, 2,000 per block, and 200 per link label.

Empty nodes, control characters, nested links, raw URLs with credentials, and unknown node/mark types are rejected.

### Page draft

A page draft contains:

- `title`: 1–120 characters;
- `path`: normalised path, maximum 180 characters;
- `navigationLabel`: optional, 1–60 characters;
- `seo`: title up to 70, description up to 200, social image, canonical mode `self | custom`, optional custom HTTPS URL, and `noIndex`;
- `blocks`: 1–60 ordered `{ id, type, data }` items;
- `expectedRevision`: non-negative integer on every mutation.

Exactly one published page has path `/`. Normalisation performs Unicode NFC, trims whitespace, decodes safe percent encodings, ensures a leading slash, collapses repeated slashes, removes a trailing slash except for `/`, lowercases the result, and rejects dot segments, query strings, fragments, backslashes, control characters, and encoded path separators.

Reserved prefixes are `/api`, `/admin`, `/app`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/__preview`, `/.well-known`, `/_astro`, and `/media`.

### Initial blocks

All limits are part of the Zod schemas.

| Type | Russian name | Persisted fields |
|---|---|---|
| `hero` | Первый экран | eyebrow, title, text, primary action, optional secondary action, optional media ID |
| `textImage` | Текст и изображение | optional title, structured text, optional media ID, image side |
| `benefits` | Преимущества | optional title, 2–8 items with title, text, and approved icon key |
| `serviceSelection` | Услуги | title, 1–12 service entry IDs |
| `caseSelection` | Проекты | title, 1–12 case entry IDs |
| `testimonialSelection` | Отзывы | title, 1–12 review entry IDs |
| `faqSelection` | Вопросы и ответы | title, 1–20 FAQ entry IDs |
| `gallery` | Галерея | optional title, 1–20 media IDs |
| `cta` | Призыв к действию | title, optional text, primary action, optional secondary action |
| `contacts` | Контакты и карта | title and booleans selecting address, hours, contacts, socials, and map from site settings |
| `formPlaceholder` | Связаться с нами | title, explanatory text, and one existing contact method; no submission endpoint |

Actions are internal page references or external HTTPS URLs. Phone and email actions are generated only from validated site contact fields.

### Central collections

- `service`: name, summary, structured description, optional image, optional price label, optional action;
- `review`: author name, optional role/company, text, optional 1–5 rating, optional portrait;
- `teamMember`: name, role, short biography, optional portrait;
- `faq`: question and structured answer;
- `case`: title, summary, structured description, cover image, up to 20 gallery images, and up to 8 labelled metrics.

Each entry has its own draft revision. Selection blocks store entry IDs in editable source data. A publication resolves those IDs into public entry data, so old publication snapshots never change when a collection entry is edited later.

### Site settings and policy

Public site settings contain company name, logo, contacts, address, business hours, social links, optional numeric map coordinates, default SEO, and owner-managed analytics identifiers. The first release accepts only a numeric Yandex Metrica counter ID and a Google Tag Manager ID matching `GTM-[A-Z0-9]+`; script bodies and other pixels are not accepted.

`editorCanPublish` lives in a separate `CmsPolicy` row and is returned only in owner/editor capability DTOs. It is not copied into public snapshots.

### Menus and redirects

Header and footer menus allow one nested level. Destinations are page IDs, safe same-page anchors, or external HTTPS URLs. The public snapshot resolves page IDs to the paths frozen in that publication.

When a published path changes, publication creates a redirect from the previous path. A redirect cannot collide with any live page path, reserved prefix, or other redirect source, and chains are flattened to the final live path. Loops are rejected.

The builder uploads redirect objects with `X-Amz-Website-Redirect-Location`; it does not consume the bucket-wide limit of 50 conditional routing rules.

## Persistence model

All IDs use the upstream PostgreSQL 18 UUIDv7 database default. JSON columns contain only values already parsed by strict contracts.

- `SiteSettings`: one draft payload and `draftRevision`.
- `CmsPolicy`: `editorCanPublish`, updater, and timestamp.
- `Page`: stable identity, draft payload, `draftRevision`, current published revision pointer, timestamps, and soft archive state.
- `PageRevision`: immutable editable source payload, materialised public payload, source draft revision, author, and publication metadata.
- `ContentEntry`: collection type, draft payload, `draftRevision`, published pointer, archive state.
- `ContentEntryRevision`: immutable source and public payloads.
- `Menu`: location, draft payload, `draftRevision`, and published pointer.
- `MenuRevision`: immutable source and resolved public payload.
- `MediaAsset`: private object key, immutable content-version UUID, storage ETag, MIME type, byte size, image dimensions, nullable video duration, alt text, state, and timestamps. Video duration is not extracted in the first release.
- `MediaUsage`: normalised `(assetId, ownerType, ownerId, scope)` references rebuilt transactionally on every draft save and publication.
- `ContentUsage`: normalised references from blocks/menus to central entries and pages.
- `ApprovalRequest`: immutable draft revision map plus materialised candidate snapshot, requester, status, reviewer, decision note, and timestamps.
- `Publication`: monotonic revision, immutable public-safe snapshot JSON, reproducible private artifact state/object key/ETag, source approval ID when present, actor, and timestamps. The database snapshot is authoritative; a missing artifact is regenerated before a build is queued.
- `Redirect`: normalised source path, final destination path, originating publication, and active state.
- `PublicationController`: singleton desired revision, published revision, active build ID, active slot, status, heartbeat, and human-safe last error.
- `PublicationBuild`: build ID, target publication revision, slot, attempts, state, heartbeat, marker verification, and diagnostics unavailable to editors.
- `PreviewGrant`: hashed one-time code, actor, page, expiry, and consumed timestamp.
- `PreviewSession`: hashed opaque session token, actor, page, expiry, and revocation timestamp.
- `BuilderRequestNonce`: HMAC key version, nonce, build ID, and expiry, unique for replay protection.
- `CmsAuditEvent`: actor, action key, target type/ID, timestamp, and human-safe summary without content dumps or secrets.

Publication snapshots include resolved settings, pages, blocks, collections used by those blocks, menus, redirects, and public media descriptors. They exclude drafts, object keys, user identifiers, approval notes, build diagnostics, and analytics secrets beyond the approved public IDs.

## Draft concurrency and autosave

Every mutable aggregate has an integer `draftRevision`. The application updates it with an optimistic condition equivalent to `WHERE id = ? AND draftRevision = expectedRevision`, increments it exactly once, refreshes usage rows, and writes an audit event in one short transaction.

A zero-row update returns HTTP 409 with a typed conflict payload containing aggregate ID, current revision, current save time, and editor display name. It never returns their email. The webapp serialises autosaves per aggregate, cancels obsolete scheduled saves, and never retries a conflict automatically. Local unsaved input remains visible while the user chooses “Загрузить сохранённую версию” or reviews their changes.

## Approval and publication

1. Draft writes validate the complete affected aggregate and its references.
2. Preview renders current draft state and never changes publication state.
3. “Отправить на согласование” captures a site-wide revision map and materialises an immutable candidate snapshot.
4. An owner approves exactly that candidate. Later draft edits remain unpublished.
5. Direct publication captures the current revision map and materialises the same snapshot shape.
6. In one Prisma transaction, the backend creates immutable revisions and `Publication`, advances `desiredRevision`, updates redirects and usage, writes audit events, and inserts one deduplicated `website:rebuild:wakeup` outbox task.
7. The outbox handler is short: it asks the single-flight reconciler to ensure the immutable private snapshot artifact exists, enqueue the newest required build in YMQ, and return. Artifact upload is retryable derivation; the database snapshot remains authoritative.
8. The builder sends heartbeats, requests a short-lived signed artifact URL, validates the downloaded snapshot, builds the assigned inactive slot, verifies its direct marker and representative pages, promotes the slot, purges mutable CDN paths, and verifies the public marker.
9. Only after public verification does the controller advance `publishedRevision`. Failure leaves the old active slot and published revision unchanged.
10. If `desiredRevision` advanced during a build, reconciliation starts one follow-up build for the newest revision, skipping intermediate stale builds.

The recurring `website:rebuild:reconcile` job repairs lost outbox wake-ups, expired heartbeats, duplicate queue delivery, process restarts, and a completed build whose callback was interrupted. Queue delivery and callbacks are at-least-once; all state transitions are idempotent.

Human states are “Ожидает согласования”, “В очереди”, “Сайт обновляется”, “Опубликовано”, and a corrective failure message. Raw provider IDs and errors remain owner diagnostics or logs, not normal UI copy.

## Blue/green Yandex deployment

Terraform provisions two website buckets, an Application Load Balancer origin switch, mandatory CDN for the CMS website, builder and queue identities, YMQ with a dead-letter queue, Lockbox bindings, and an Astro preview Serverless Container behind API Gateway at `preview.<website-domain>`.

The active origin selector is deliberately operational state after bootstrap. Terraform declares both slots and ignores only the active weight changed by the promoter, preventing the next infrastructure plan from silently reverting a successful CMS publication.

Builder authority is limited to:

- read immutable snapshot through the signed internal API;
- read source media objects;
- write/delete objects only in the assigned inactive website bucket;
- update the pre-created active-origin selector;
- purge the configured CDN resource;
- call signed build heartbeat/result endpoints.

The builder uploads hashed `/_astro` and `/media/<assetId>/<contentVersion>/<safe-name>` objects with one-year immutable caching. A media byte payload is write-once, so its content-version UUID never identifies different bytes. HTML, XML, JSON, redirect objects, and `/.well-known/publication-revision` use `max-age=0,must-revalidate`. The inactive slot is fully built and verified before traffic changes. The previous slot remains intact for rollback until the next successful build reuses it.

## Media lifecycle

Initial allowlist and limits:

- JPEG, PNG, WebP, and AVIF images: 100 bytes–15 MB;
- MP4 video: 1 KB–100 MB;
- PDF: 100 bytes–25 MB;
- SVG, HTML, scriptable documents, archives, and unknown types are rejected.

The browser uploads directly with the existing signed `PUT` ticket and write-once condition. Finalisation verifies actual length, declared type, magic bytes, and storage ETag before marking the immutable asset ready. Images record dimensions; video duration remains null in the first release. Missing required alt text blocks publication of meaningful images, while explicitly decorative usage renders an empty alt attribute.

Deletion is allowed only when no draft, approval candidate, retained publication, menu, settings record, or central entry references the asset. Database deletion and object deletion use a durable deletion task so a provider failure cannot silently orphan state.

## Preview security

1. The authenticated webapp requests a page-specific preview grant.
2. The backend stores only a hash of a cryptographically random one-time code with a 60-second expiry and returns the preview URL.
3. The preview container exchanges and consumes the code server-to-server, sets a 15-minute HttpOnly, Secure, SameSite=Lax cookie scoped to `/__preview`, then redirects to a clean URL without credentials.
4. Every preview render revalidates the preview session and current CMS capability through the backend. Revoked roles stop working immediately.
5. Responses use `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow`, and no canonical URL. Invalid and unauthorized requests return the same 404 response so page existence is not disclosed.
6. Preview media is streamed through a session-protected preview proxy and never exposes raw object keys or adds the preview origin to private-bucket CORS.

Public pages remain static. Astro's Node adapter is installed only because the preview build contains on-demand routes; it is deployed separately from the public static artifact.

## Human-centred admin

Primary navigation uses “Страницы”, “Услуги”, “Отзывы”, “Команда”, “Вопросы”, “Проекты”, “Изображения”, “Меню сайта”, “История публикаций”, and “Настройки”. Editors do not see owner-only items.

The page editor shows ordered content sections, Russian schema-driven forms, keyboard-accessible move up/down controls, a media picker, inline validation, a persistent save/publication area, and the SEO panel titled “Как страница выглядит в поиске и соцсетях.” It never displays JSON, UUIDs, block keys, object keys, API paths, build IDs, or raw error codes.

All fields have visible labels. Touch targets are at least 44×44 CSS pixels, body text is at least 16px on narrow screens, status never relies on colour alone, focus remains visible, icon-only buttons have Russian accessible names, and motion respects `prefers-reduced-motion`. Validate layouts at 375, 768, 1024, and 1440 CSS pixels.

## Security and privacy rules

- Parse every request and provider callback with strict schemas.
- Recheck capabilities inside application services, not only middleware.
- Use explicit public mappers and contract tests that inject forbidden fields.
- Never render CMS values through `set:html`.
- Allow external links only over HTTPS; block credentials, control characters, unsafe redirects, and unapproved hosts for analytics.
- Use dedicated body and rate limits for CMS mutations; the upstream 64 KB auth body limit must not accidentally cap rich page drafts. The initial CMS JSON limit is 1 MB.
- Sign builder calls with HMAC-SHA-256 over method, path, timestamp, nonce, body hash, and build ID; accept a five-minute clock window and store nonces until expiry. `CMS_BUILDER_HMAC_ACTIVE_SECRET` is required and `CMS_BUILDER_HMAC_PREVIOUS_SECRET` is accepted only during rotation.
- Keep private storage credentials, builder credentials, and preview secrets in separate Lockbox bindings.
- Audit publication, approval, restore, role, policy, analytics, redirect, and media-delete actions.
- Do not log content payloads, signed URLs, preview codes, cookies, HMAC headers, or secrets.

## Acceptance criteria

### Contracts and backend

- Every schema rejects unknown fields and unsafe URLs.
- Every block default, validator, public mapper, and registry lookup is tested.
- Owner/editor/user permissions are integration-tested for each endpoint group.
- Optimistic conflicts preserve the newer stored draft.
- Approval publishes the frozen candidate, not later edits.
- Snapshot and outbox insertion commit or roll back together.
- Public APIs cannot serialise draft data, raw media metadata, authors, diagnostics, or object keys.
- Used media cannot be deleted; failed provider deletion is recoverable.

### Publication and operations

- Duplicate outbox tasks, queue messages, callbacks, and reconciler runs are idempotent.
- A build longer than one outbox lease is safe because the outbox handler does not perform the build.
- A failed build or promotion leaves the old public marker and HTML live.
- The inactive slot is verified before promotion and the public marker after promotion.
- A newer desired revision causes exactly one follow-up build.
- Redirect objects return a 3xx response to the final live path.

### Admin and website

- The editor journey covers edit → autosave → preview → submit/publish → visible status.
- Direct navigation cannot expose owner routes or data to an editor.
- SEO-critical content is in initial static HTML.
- `robots.txt`, `sitemap.xml`, canonical, Open Graph, and no-index output come from the same snapshot.
- Preview rejects anonymous/revoked users and never becomes cacheable or indexable.
- Responsive and keyboard checks pass at the required viewports.

## Authoritative implementation references

- [Vibe source baseline](https://github.com/di-sukharev/vibe/commit/9234bca8ffe2b6f98507c1d05a40f2a4e6c2e98d)
- [Astro on-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/)
- [Astro Node adapter](https://docs.astro.build/en/guides/integrations-guide/node/)
- [Prisma optimistic concurrency and transactions](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)
- [Prisma migration commands](https://docs.prisma.io/docs/cli/migrate)
- [Yandex Message Queue trigger for Serverless Containers](https://yandex.cloud/en/docs/serverless-containers/concepts/trigger/ymq-trigger)
- [Yandex Serverless Containers limits](https://yandex.cloud/en/docs/serverless-containers/concepts/limits)
- [Yandex Object Storage CopyObject](https://yandex.cloud/en/docs/storage/s3/api-ref/object/copy)
- [Yandex static-object redirects](https://yandex.cloud/en/docs/storage/concepts/presigned-post-forms)
- [Yandex blue/green Object Storage deployment](https://yandex.cloud/en/docs/tutorials/web/blue-green-canary-deployment)

## Delivery boundaries

The implementation must be performed in a client-specific Vibe checkout, not in the upstream template repository and not in this design-only folder. Before feature code, complete that checkout's `CHECKLIST.md`, copy this specification and its plan into the checkout, and record the chosen domains, bucket names, owner seed, media limits, Yandex folder, DNS ownership, and deployment operator.

Each implementation stage must leave the checkout type-safe and its relevant tests passing. Database migrations are generated through the repository's Prisma workflow; migration SQL is not handwritten. Git staging or commits happen only when the user explicitly requests them.
