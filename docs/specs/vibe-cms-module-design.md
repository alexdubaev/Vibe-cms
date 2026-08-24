# Vibe CMS Module Design

## Purpose

Build a reusable CMS module inside each client-specific Vibe project. Every client receives an isolated Vibe codebase, PostgreSQL database, object-storage bucket, users, and CMS admin area. The module manages public landing pages now and grows into a content website without adopting a separate CMS product or license.

## Product decisions

- Each client site is an independent Vibe project, not a multi-tenant central CMS.
- The solution has no CMS license or subscription fee. Normal production infrastructure costs for a Russian VPS, PostgreSQL, and S3-compatible storage are acceptable.
- The public audience and production data path are Russia-first and use Vibe's Yandex Cloud path.
- First release is Russian-only and does not model localisation.
- Client content is edited as a draft, previewed while signed in, and only then published.
- Preview links are not public or shareable. A signed-in admin user can open an authenticated preview only.
- Editors build pages from developer-approved blocks, may add/reorder/remove those blocks, and may not edit arbitrary HTML, CSS, or JavaScript.
- Content is split between page-local blocks and centrally reused collections.
- Owner and editor roles exist. Whether an editor can publish directly is a per-project owner setting.
- Analytics uses owner-only structured IDs for Yandex Metrica, Google Tag Manager, and pixels; arbitrary code injection is forbidden.
- The first release reserves the boundary for form leads but does not create a CRM or an inbox.
- Keep 20 published page versions. Restoring a version creates a new draft instead of mutating history.

## Architecture

```text
Signed-in owner/editor
        │
        ▼
webapp — React CMS admin
        │ authenticated, validated API requests
        ▼
backend — Hono modules + Prisma + PostgreSQL
  ├── private operational state, drafts, versions, permissions
  ├── public-safe published snapshot API
  ├── S3-compatible object storage for media
  └── durable outbox task for site rebuild
        │
        ▼
website — Astro
  ├── static public pages built from published content only
  └── authenticated SSR preview route using draft content
```

`webapp` owns all CMS administration. `backend` is the authoritative permission and content boundary. `website` owns SEO-facing output and never fetches draft data on public routes. This preserves the existing Vibe surface split.

Public page data is retrieved while building static Astro output. A single preview route opts out of prerendering and runs with an Astro Node adapter; Astro documents `export const prerender = false` for this route-level upgrade and requires an adapter for on-demand rendering. Public pages remain static; the preview route is not a public content route. Sources: [Astro data fetching](https://docs.astro.build/en/guides/data-fetching/), [Astro on-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/).

The CMS backend is a dedicated Vibe module with application, domain, infrastructure, and transport layers, matching existing auth and uploads modules. It exposes a separately mounted Hono route group at `/api/cms`; Hono supports mounting modular route instances with `app.route()`. Source: [Hono routing](https://hono.dev/docs/api/routing).

## Module boundaries

### `packages/contracts`

Own public API DTOs and Zod schemas: page summaries, editable drafts, block payloads, SEO input, collection entries, media records, publication state, role/capability DTOs, and error envelopes. A schema registered by a block is the contract shared by the backend, admin UI, and Astro renderer.

### `backend/src/modules/cms`

Own content authorisation, validation, persistence, revisions, redirects, publication orchestration, and public read models. The module must not render HTML or call the public website directly from a request handler.

### `backend/src/modules/media`

Own media metadata and upload lifecycle. Reuse the existing storage port and signed upload pattern rather than adding a second storage client. Public derivative URLs are returned only for published assets; raw object keys are never returned to the client.

### `webapp/src/features/cms`

Own human-readable admin screens, React Query calls, draft state, autosave indicators, and conflict-resolution UI. It contains no permission decisions beyond hiding unavailable actions; the backend remains authoritative.

### `website/src/cms`

Own the read-only block registry and Astro renderers. Each block maps an approved block type and validated public data to the matching Astro component. No arbitrary user HTML is rendered.

## Content model

### Site configuration

`SiteSettings` has independent draft and published snapshots. Its editable fields are company name, logo, contacts, address, business hours, social links, default SEO, selected analytics IDs, and the `editorCanPublish` setting. Owner-only fields are excluded from all editor response DTOs.

### Pages and versions

`Page` holds the stable identity, current URL slug, visibility status, revision counter, current draft, and reference to the current published revision. `PageRevision` is immutable and stores the page title, URL, SEO, ordered block list, author, creation date, and publication date. Keep the most recent 20 published revisions per page; prune older revisions in the same transactional maintenance operation after a successful publication.

Draft updates use the current revision counter as an optimistic-concurrency precondition. If the stored counter differs, the server returns a conflict DTO containing the current save time and editor name. The UI tells the user that someone else has saved changes and provides reload/review actions; it never silently overwrites content.

### Blocks

Every block definition is code-registered and has:

- a stable machine key used only internally, such as `hero` or `testimonials`;
- a Russian display name and plain-language description used by the UI;
- a Zod input schema and explicit default values;
- an Astro renderer;
- a form descriptor containing only labels, hints, choice text, help examples, and visibility rules;
- a public output mapper that strips draft-only and private fields.

The stored page payload is an ordered array of `{ id, type, data }`. `type` is checked against the registry and `data` is parsed with that block's schema before every draft save and publish. Block IDs exist solely for stable ordering and references and are never shown to users.

The initial block catalogue is: first screen, text/image, benefits, service selection, case selection, testimonial selection, FAQ, gallery, CTA, contacts/map, and form placeholder. Adding a new block requires a developer-created definition, renderer, tests, and a migration only if its persisted data needs conversion.

### Central content

`ContentEntry` stores approved collection types: services, reviews, team members, FAQ, and cases. Each type uses its own registered schema and has draft/published data. Page blocks store references to published central entries. Publishing a changed entry schedules a whole-site rebuild so every page that uses it stays consistent.

### Navigation, redirects, and SEO

`Menu` and `MenuItem` represent header and footer navigation. A menu item can link to a page or an externally validated HTTPS URL. One nested level is allowed. The UI displays page titles and destination labels, not record IDs.

`Redirect` stores a normalised old path and a destination page or current URL. When a published page URL changes, the backend creates a redirect transactionally and rejects collisions with a live page or another redirect.

Per-page SEO is titled in the UI as “Как страница выглядит в поиске и соцсетях.” It contains search title, description, path, social image, canonical choice, and an index/no-index toggle. The website generates canonical tags, Open Graph tags, `robots.txt`, and `sitemap.xml` from published content.

### Media

`MediaAsset` records original upload metadata, safe public derivatives, alt text, creation/update times, and usage references. The database owns media authorisation and reference checks; object storage is not the source of truth. The UI supports drag-and-drop upload, collection browsing, searching, reuse, descriptive alt text, and deletion only when no draft or published content uses the asset.

Production media lives in private S3-compatible object storage with controlled public derivative delivery. No production uploads are stored on a container filesystem. The local driver stays available for development.

### Reserved leads boundary

`FormSubmission` is defined only after a form implementation is scheduled. The initial CMS module includes a form block definition that can render existing contact methods, but no endpoint, notifications, or CRM list. Later form work must be specified and implemented as a separate capability.

## Permissions

| Capability | Owner | Editor |
|---|---:|---:|
| Edit pages, collections, menus, media, SEO | Yes | Yes |
| View authenticated preview | Yes | Yes |
| Publish if direct publishing is enabled | Yes | Yes |
| Send content for owner approval | Yes | Yes |
| Publish when approval is required | Yes | No |
| Restore revisions | Yes | No |
| Manage users and project permissions | Yes | No |
| Manage analytics IDs, redirects, system settings | Yes | No |

The template's initial `admin` role becomes `owner`; the existing regular `user` role remains non-CMS. Add `editor` as a distinct role rather than treating all authenticated users as editors. All capabilities are enforced by backend middleware and application services. The web app hides unavailable controls but does not rely on hiding them for security.

## Publication and freshness

1. An editor changes content; the admin saves a draft automatically after validation and shows “Сохранено” or a field-specific correction.
2. The user opens the authenticated preview, which renders the page with draft content.
3. The user selects “Опубликовать изменения.” If approval is required and the user is an editor, the action is “Отправить на согласование.”
4. The backend revalidates complete content, creates immutable revisions and the published snapshot in one Prisma transaction, writes publication history, and enqueues one deduplicated `website:rebuild` outbox task.
5. The worker requests the configured release pipeline. The publication record moves through `В очереди`, `Сайт обновляется`, `Опубликовано`, or a human-readable failure state.
6. A successful static build deploys public content. A failed build leaves the prior public site live and exposes “Повторить публикацию” to the owner.

Use Prisma transactions for the state change that creates a published snapshot and enqueues its outbox task. Prisma documents interactive `$transaction` callbacks and transaction isolation options. Source: [Prisma transactions](https://www.prisma.io/docs/orm/prisma-client/queries/transactions).

No public request reads a draft. A static output build reads only the public-safe published API. Rebuild deduplication is site-wide: several quick publications can produce one current rebuild, never a queue of stale deploys.

## Human-centred UI specification

### Product character

The admin is a calm, professional control room for a small business owner, not a developer console. Its central job is: change known site content safely and understand what will happen next. It uses a restrained light interface, forest-green action colour, strong readable contrast, clear spacing, and one primary action per screen.

### Vocabulary and visibility

- Use nouns users recognise: “Страницы”, “Услуги”, “Отзывы”, “Изображения”, “Меню сайта”, “Настройки”.
- Use direct actions: “Добавить раздел”, “Сохранить изменения”, “Посмотреть черновик”, “Опубликовать изменения”, “Восстановить эту версию”.
- Never show JSON, database IDs, block keys, API paths, object keys, build IDs, raw status codes, or a generic “error”.
- Explain failures next to the relevant field, with the required correction. Example: “Добавьте изображение для первого экрана.”
- Show visible save state, conflict state, and publication state in ordinary language.

### Screen map

- **Страницы:** page cards with title, path, draft/published state, last change, and primary “Изменить” action.
- **Редактор страницы:** ordered content blocks, simple descriptions, “Добавить раздел,” edit/remove/reorder controls, and a persistent publish action. The sidebar has only human-facing page status and search/social preview fields.
- **Редактор блока:** a focused form with labels, examples, inline validation, image picker, and no implementation fields.
- **Изображения:** responsive thumbnail grid, upload, search, alt text, usage message, and safe delete state.
- **Как страница выглядит в поиске и соцсетях:** search/social preview and only the five selected SEO controls.
- **История публикаций:** dated human descriptions and “Восстановить в черновик,” never a direct destructive restore.
- **Настройки:** grouped business contacts, social links, branding, analytics IDs, and publishing rule. Owner-only sections are not rendered for editors.

### Interaction and accessibility

- Every field has a visible label; placeholders never replace labels.
- Colour never is the only status indicator. State includes text and, where useful, an icon.
- Keyboard order follows the visual order; all interactive elements retain visible focus.
- Icon-only buttons have Russian accessible names.
- Touch targets are at least 44×44 CSS pixels.
- Body text is at least 16px on narrow screens; desktop navigation folds into an accessible menu on mobile.
- Responsive designs are checked at 375px, 768px, 1024px, and 1440px without horizontal scrolling.
- Meaningful images require alt text; decorative images are marked decorative in rendering.
- Loading buttons prevent duplicate requests and tell the user what is in progress.
- Motion is limited to 150–300ms opacity/transform transitions and respects `prefers-reduced-motion`.

The user-approved interactive concept is published at https://vibe-cms-interface-preview.alexdubaev.chatgpt.site. It demonstrates the intended vocabulary, page editor hierarchy, responsive sidebar behaviour, visible draft/published state, and content-first block controls. It is a design reference, not production source code.

## Security rules

- Parse every request with a shared Zod contract; reject unknown block types and fields.
- Enforce `owner`/`editor` capabilities in the backend before data access or mutation.
- Do not accept executable HTML, CSS, JavaScript, iframe markup, analytics snippets, redirect hostnames, or unapproved external embeds from content fields.
- Validate and normalise page paths and external menu URLs; permit `https:` URLs only for external links.
- Use signed upload tickets and content-type/byte-size checks. Scan or transform media before exposing it publicly if the chosen image pipeline provides that capability.
- Make public API DTOs an explicit allowlist; drafts, authors' private data, user accounts, raw media metadata, and publication diagnostics are never serialised into static output.
- Audit publication, restore, role, analytics, redirect, and user-management actions with actor, target, timestamp, and human-readable summary.
- Rate-limit sign-in and mutation endpoints using the existing backend policy.

## Testing and acceptance criteria

### Backend and contracts

- Unit-test every block schema, defaults, public mapper, and renderer registry lookup.
- Integration-test permissions for both roles on every CMS endpoint.
- Integration-test optimistic-concurrency rejection, draft-only isolation, revision retention, redirect collision rejection, and media deletion protection.
- Integration-test publication transaction: published snapshot and rebuild outbox task either both commit or neither does.
- Contract-test the public API against the Astro consumer and ensure drafts cannot be returned by it.

### Admin UI

- Component-test labels, inline validation, accessible names, save states, owner-only controls, conflict state, and reorder/add/remove workflows.
- Playwright-test an editor's primary scenario: sign in, edit a block, autosave, preview, submit/publish according to the configured setting, and see the publication status.
- Playwright-test that an editor cannot reach owner routes through direct navigation.
- Check the primary pages at 375px, 768px, 1024px, and 1440px.

### Website and release

- Build the Astro site with a known published snapshot and assert SEO-critical content appears in initial HTML.
- Verify that a failed rebuild retains the previous public deployment.
- Verify that a URL change returns the generated redirect after publication.
- Verify that the preview route rejects anonymous access and renders draft data only for an authorised CMS user.

## Explicitly out of scope

- CRM, lead inbox, lead notifications, and external form integrations.
- Multilingual content, translation workflows, and locale routes.
- Public or shareable preview links.
- Manual image cropping.
- Arbitrary HTML, CSS, JavaScript, embeds, or custom code blocks.
- A generic user-built block type or free-form page builder.
- Payments, accounts, e-commerce, and customer portals.

## Delivery sequence

1. Establish CMS contracts, roles, Prisma schema, migrations, and permission middleware.
2. Build public published-content read models and the initial code-defined block registry.
3. Build drafts, revisions, publication/outbox orchestration, redirects, and preview authentication.
4. Implement the content-first admin screens and reusable form controls following this UI specification.
5. Add the media library and public derivative delivery.
6. Connect static Astro builds to published snapshots, then add protected SSR preview.
7. Add end-to-end tests, release monitoring, documentation, and the project setup checklist entries.

Each stage must leave the project deployable and testable; no stage relies on an unvalidated future placeholder.
