# Install Checklist

This file is the intake record for this repository. The installing agent fills it in during first-run setup and keeps it current afterwards.

**For the agent:** ask the questions below in the user's language, in product terms, and write the answers into this file as you go. Do not start feature work until everything through _First-version capabilities_ and every conditional section activated by those answers is completed. Never ask the user anything under _Decided by the agent_ - make those calls yourself and explain them in product terms.

**For the product owner:** this is the record of what was decided about your project. If something here is wrong, say so - the agent treats this file as the source of truth for what your product needs.

Answer cells hold `_unanswered_` until the question is asked, and `n/a` when the question cannot apply to this project. Answers are written in the product owner's language, but the section headings and the capability-ledger state words stay in English: other documents refer to them by those exact names. Keep every section heading, even when its rows are all `n/a`.

**When working on the template itself** (not installing it for a project), there is nothing to record: leave every answer cell at `_unanswered_` and every checkbox unchecked - those would otherwise ship to each future install. The capability ledger is the exception: it always describes the current branch, so keep it current when template work adds or removes a capability.

**Install status:** `in progress`
<!-- Set to: not started | in progress | completed YYYY-MM-DD -->

---

## 1. Project identity

| Question                                                        | Answer       |
| --------------------------------------------------------------- | ------------ |
| New project from this template, or work on the template itself? | Новый клиентский проект CMS на основе Vibe |
| Project name / slug                                             | Vibe CMS / `vibe-cms` |
| Your own GitHub repository URL, if you have one                 | n/a — публикация проекта пока не настроена |

If no GitHub destination is chosen, the repository is left without `origin` and publishing stays unconfigured. The template remote is detached during setup unless this checkout is explicitly for improving the template.

## 2. Product

| Question                                                  | Answer       |
| --------------------------------------------------------- | ------------ |
| What product do you want to build first?                  | Русскоязычная CMS для редактирования страниц, меню, коллекций и медиа небольшого сайта |
| What is the first user journey that must work end to end? | Владелец или редактор входит в admin, меняет черновик страницы, сохраняет его, просматривает preview и безопасно публикует сайт целиком |

## 3. Active surfaces

Mark what is active now, and set the install status to `in progress` as soon as this section is answered. From then on, everything unmarked is deferred and must be left alone: no features, no setup, no test flows. While the status is still `not started` nothing has been decided yet, so unmarked boxes mean "not asked", not "forbidden".

- [x] `backend` - API, database, auth
- [x] `webapp` - browser screens behind sign-in (no SEO)
- [x] `website` - public pages that must rank in search or preview when shared
- [ ] `mobile` - Expo app (lives on the `mobile` branch; switch branches before setup)

| Question                                                                                                             | Answer       |
| -------------------------------------------------------------------------------------------------------------------- | ------------ |
| Why the unmarked surfaces are deferred, if it needs explaining                                                       | Мобильное приложение не входит в первую версию CMS; сначала нужен браузерный admin и публичный сайт |
| If `mobile` is active: are Expo/EAS builds, Expo Push, and Maestro E2E needed now, or left unconfigured until later? | n/a |

The split between `webapp` and `website` is the agent's call, not the user's; `README.md` explains how to route a feature between them.

## 4. First-version capabilities

Ask about product needs, not implementations. Mark what the first version actually needs, then fill the row below even when nothing was ticked, so a later session can tell "asked, and the answer was no" from "not asked yet".

- [x] Accounts / sign-in
- [x] Saved data that survives a restart
- [x] File, image, or media uploads → also answer _Files, images, and media_
- [ ] Paid subscriptions or one-off payments → also answer _Payments_
- [x] Admin tools or roles
- [ ] External integrations (which: Yandex Cloud publication infrastructure is deferred until deployment setup)
- [ ] Real-time chat, presence, collaboration, or live updates

| Question                                                                                          | Answer       |
| ------------------------------------------------------------------------------------------------- | ------------ |
| What the first version explicitly should NOT do (write "nothing ruled out" if that is the answer) | Не нужны мобильное приложение, платежи, real-time collaboration, multi-tenant SaaS и произвольный пользовательский HTML/JS |

## 5. Files, images, and media

This project ships private file storage with user avatars, so answer these for the files your product adds on top; otherwise mark the rows `n/a`. Keep the section either way - `docs/STORAGE.md` sends the agent here when uploads are added later.

| Question                                                                                      | Answer       |
| --------------------------------------------------------------------------------------------- | ------------ |
| What do users upload?                                                                         | Изображения, видео и PDF для страниц и коллекций сайта |
| Public, private, shared with selected people, or mixed?                                       | Исходники private; в опубликованный сайт копируются только используемые неизменяемые версии |
| Who can upload, view, replace, and delete?                                                    | Owner и editor могут загружать и использовать; удаление разрешено только owner при отсутствии ссылок |
| Maximum file size and allowed file types                                                      | JPEG/PNG/WebP/AVIF 100 B–15 MB; MP4 1 KB–100 MB; PDF 100 B–25 MB; SVG, HTML, архивы и неизвестные типы запрещены |
| Do images need thumbnails, resizing, format conversion, compression, cropping, or moderation? | В первой версии нужны проверка типа/размера/магических байтов и размеры; ресайз и модерация отложены |
| How long do files live after the owning record is deleted?                                    | Пока не останется ни одной ссылки в черновиках, approval или публикациях; удаление выполняется durable task |
| Should filenames be visible to users, or opaque?                                              | В UI показывается безопасное исходное имя, storage-ключи остаются opaque и никогда не выдаются клиенту |

## 6. Website data and freshness

Answer these when `website` is active; otherwise mark the rows `n/a`. Keep product choices here and
follow the implementation contract in `docs/WEB_SURFACES.md`.

| Question                                                                                    | Answer       |
| ------------------------------------------------------------------------------------------- | ------------ |
| Which public product or content data comes from the backend/database at website build time? | Site settings, pages, blocks, collections, menus, redirects and referenced public media from one immutable publication snapshot |
| How soon after that data changes must the public website show the change?                   | После успешной публикации; предыдущий сайт остаётся live до полной проверки нового |
| Which changes require an automatic rebuild/redeploy rather than a manual release?           | Каждая site-wide публикация запускает один reconciliation/build; policy и права доступа website не перестраивают |

The default is Astro SSG. Database-backed public data is fetched while building static output. If
published database changes must appear automatically, implement the documented `website:rebuild`
outbox path. SSR or request-time rendering is an exception recorded here only when the required
freshness or personalization cannot be met by rebuild/redeploy.

## 7. Payments

Answer these only when payments are active above; otherwise mark the rows `n/a`. Keep the section either way, and replace the `n/a` answers if payments are added later.

| Question                                                                                                                    | Answer       |
| --------------------------------------------------------------------------------------------------------------------------- | ------------ |
| What exactly do users pay for?                                                                                              | n/a |
| Recurring subscription, one-off purchase, or both?                                                                          | n/a |
| Does the public website need a local cart or offer selection before registration/sign-in?                                   | n/a |
| Which active surfaces need payment: browser checkout, App Store / Google Play, native card entry, Apple Pay, or Google Pay? | n/a |
| What stops working when someone does not pay?                                                                               | n/a |

Whatever this project ends up with, the ledger below is what states it. Read `docs/WEB_SURFACES.md`
before implementing any payment surface. Browser checkout is built in authenticated `webapp` plus
the backend; `website` may pass a local cart but never owns a second payment flow. The `mobile`
template line ships App Store and Google Play subscriptions as working code that is switched off,
and may independently add policy-compliant card, Apple Pay, or Google Pay flows when the product
needs them. Declining a shipped payment capability means deleting its code during setup and
recording it as `removed`. Payments are never half-present and are never reintroduced on a guess.

## 8. Deployment

| Question                                                                                     | Answer       |
| -------------------------------------------------------------------------------------------- | ------------ |
| Is deployment needed now, or local-only for the moment?                                      | Локальная реализация и тесты; production deployment после согласования доменов и облачного аккаунта |
| Where are your users, and must the data stay in Russia?                                      | Пока не задано; production-провайдер не выбирается в этой итерации |
| Hosting, picked by the agent from the answer above: DigitalOcean / Yandex Cloud / own server | n/a до получения production-требований |
| Production domains / URLs for API, webapp, and website; is Yandex CDN needed now?            | n/a — используются только localhost-адреса |
| Which surfaces are released first                                                            | n/a — release не выполняется до отдельной настройки deployment |

**Ask the audience question, not the provider question.** A product owner knows where their users
are and whether data must stay in Russia; they should not be asked to compare clouds. The agent
picks the hosting from that answer:

| Hosting      | Chosen when                                                                        | What the template gives you                                                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DigitalOcean | Default for an audience outside Russia.                                            | Terraform creates App Platform API/static sites, a scheduler worker, migration gate, Managed PostgreSQL, DOCR, private media Spaces, and remote state. Release everything with `bun run release -- digitalocean`. |
| Yandex Cloud | Users in Russia, or data must stay there.                                          | Terraform creates Serverless Containers/timers, Managed PostgreSQL, API Gateway, static and private media Object Storage, remote state, and opt-in CDN. Release everything with `bun run release -- yandex`.      |
| Own server   | Full control wanted, no vendor lock-in, and someone is willing to run the machine. | The same Docker image plus the in-repo scheduler, with a short runbook in the "Own Server" section of `docs/DEPLOYMENT.md`. No release script: you own TLS, backups, updates, and monitoring.                     |

Pick exactly one and record it above. In an installed project, delete the unused provider directory
under `infra/` and its provider runbook rather than keeping a second possible production state.
Keep `scripts/infra.mjs` and `docs/DEPLOYMENT.md`: they own the shared safety/release contract. An
own-server project deletes both provider directories and runbooks. Local development never requires
cloud credentials regardless of the choice.

Deployment is often deferred at install time, which leaves these rows `_unanswered_`. When the user later asks to deploy, ask the unanswered questions then and write the answers back here before following `docs/DEPLOYMENT.md`.

## 9. Decided by the agent - do not ask the user

The user is a product owner, not an engineer. These are engineering decisions the agent owns, makes, and explains only in product terms:

- Which browser surface a feature belongs to (`website` for SEO/public, `webapp` for behind-login).
- Which email provider the recorded hosting implies: Yandex Cloud means Postbox, anything else means Resend. Ask where the users are, not which mail service the owner prefers.
- SSG plus build-time backend data and rebuild/redeploy for public product information unless a recorded freshness or personalization need requires runtime rendering.
- One browser checkout in authenticated `webapp`; `website` may hand off a local cart but never owns payment. Mobile payment UI stays native and separate.
- Monolithic backend; no microservices during setup.
- Docker Compose for local PostgreSQL on every OS; never a native install unless the user insists.
- Astro for `website`; Next.js only if Vercel-style ISR is a stated product requirement.
- The selected Terraform launch profile, machine sizes, serverless/static shape, and when an HA or CDN upgrade is justified.
- Which hosting the recorded audience implies: Russia means Yandex Cloud, elsewhere means DigitalOcean, and an explicit wish for full control means an own server. Explain the pick in product terms; never ask the owner to compare providers.
- Managed Redis-compatible Pub/Sub only when real-time needs to scale across instances.
- Test boundaries: E2E for important user journeys, integration for API/auth/persistence, unit for pure rules.
- Libraries, file layout, naming, refactors, and validation scope.

## 10. Capability ledger

What this project actually contains. The agent updates it whenever a capability is added or removed. Every row carries exactly one state:

- `included` - present and expected to work.
- `available` - partly there but not usable yet; the note says exactly what is still missing, which may be configuration, routes, or UI.
- `absent` - not part of this project. Build it only after the product owner asks.
- `removed` - deliberately deleted during setup. **Do not re-add it.** A leftover reference, migration, or doc mention is not a product requirement; ask the product owner first.

A capability with no row is `absent` by default. Add the row instead of assuming. The State column always holds one of the four states above - never `_unanswered_` or `n/a`.

| Capability                      | State    | Note                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth (email + password)         | included | Template baseline.                                                                                                                                                                                                                                                                                                                                                                                                   |
| Admin roles                     | included | Roles and seeding in `backend`; admin UI in `webapp`.                                                                                                                                                                                                                                                                                                                                                                |
| Password reset email delivery   | included | Two providers behind one port, Yandex Cloud Postbox and Resend, selected by `EMAIL_DELIVERY`. It defaults to `disabled`, so a fresh install sends nothing and queues nothing; `console` prints messages locally. Delivery is durable: a request queues a `task_outbox` row and the shipped scheduler drains it every minute. Production needs an account with a provider and a deployed runner. See `docs/EMAIL.md`. |
| File/media storage              | included | Private uploads end to end, with user avatars as the worked example. Stores on local disk by default and on any S3-compatible bucket via `PRIVATE_STORAGE_*`, with no code change between them. See `docs/STORAGE.md`.                                                                                                                                                                                               |
| Infrastructure as code          | included | Provider-specific Terraform bootstrap, foundation, migration/runtime, and static roots cover DigitalOcean and Yandex Cloud, with remote state, guarded plan/apply, migration-gated immutable releases, media storage, static hosting, and jobs. `scripts/infra.mjs` is the one operations entry point. See `infra/README.md` and `docs/DEPLOYMENT.md`.                                                               |
| Static asset precompression     | included | `bun run static:precompress` writes `.br` and `.gz` next to the text assets in `webapp/dist` and `website/dist`, using `node:zlib` and no dependency. It is own-server tooling: hosted releases do not upload those sidecars and use their edge/runtime compression when available.                                                                                                                                  |
| Website build-time backend data | included | `website-builder` fetches one immutable publication snapshot; Astro renders pages, collections, redirects, SEO metadata and only safe public media paths.                                                                                                                                                                                                                                                          |
| Automatic SSG rebuild           | available | Backend desired/published revision state, single-flight reconciliation, inactive-slot upload, marker verification, selector/purge adapters and provider-side media copy are implemented. Yandex Terraform now declares the opt-in builder/preview runtimes, queue/DLQ, IAM, Lockbox bindings, and slot-scoped storage policy; real domains, control-plane endpoints, `infra:plan`, and acceptance remain deployment-gated. See `docs/WEB_SURFACES.md`. |
| Website cart handoff            | absent   | No local cart or cross-origin handoff exists on the default branch. When activated, it feeds the one authenticated browser checkout defined in `docs/WEB_SURFACES.md`.                                                                                                                                                                                                                                               |
| Browser checkout / payments     | absent   | No browser checkout or payment code exists. Build it in `webapp` plus the backend, never in `website`. Store subscriptions come from the mobile template line.                                                                                                                                                                                                                                                       |
| Push notifications              | absent   | No push code here. Expo Push comes from the mobile template line.                                                                                                                                                                                                                                                                                                                                                    |
| Social sign-in (Apple / Google) | absent   | No social auth here. It comes from the mobile template line.                                                                                                                                                                                                                                                                                                                                                         |
| Real-time / WebSockets          | absent   | Requires an explicit product need.                                                                                                                                                                                                                                                                                                                                                                                   |
| Background jobs                 | included | Jobs live in `backend/src/jobs.ts`. The shared scheduler runs `outbox:drain` every minute, upload cleanup hourly at minute 15, and auth cleanup daily at 03:00 UTC. Terraform deploys that scheduler as a DigitalOcean worker and the same executor in Yandex HTTP job containers/timer triggers; own servers run it under a supervisor. `workerLoops` stays empty. See `docs/BACKGROUND_JOBS.md`.                              |
| Durable task outbox             | included | `task_outbox` in PostgreSQL with handlers in `backend/src/outbox/handlers.ts`, drained by `outbox:drain`. Ships with the password-reset emails as its only producers, and stays empty until something enqueues. Adding a task type is a code change, never a migration.                                                                                                                                              |
| CMS draft editing and approvals | included | Page/entry/menu/settings saves, optimistic conflicts, frozen approvals, owner policy checks, private preview grants, public snapshot materialisation, publication retry and CMS UI are implemented under `backend/src/modules/cms` and `webapp/src/features/cms`. |
| CMS media library               | included | Private upload/finalise/list/alt/deletion flows, signature checks, usage protection, dimensions, safe signed preview URLs and provider-side copy into the inactive public slot are implemented under `backend/src/modules/media` and `website-builder`. |

## 11. Environment checks

Verified by the agent during setup, not asked.

- [x] `docker compose version` and `docker info` succeed (needed for backend/API, uploads, or DB-backed validation)
- [x] `git remote -v` inspected; template remote detached unless contributing to the template
- [ ] App-local `.env` files created from `.env.example`, with a locally generated `JWT_SECRET` (never committed)
- [x] Smallest meaningful validation run for the active surfaces

## 12. After setup

- [ ] Durable answers above filled in, install status set to `completed YYYY-MM-DD`
- [x] Validation scope recorded for this project (which suites run before a change is called done): focused contracts/backend/webapp/website tests, typecheck, architecture check; full suite before release
- [ ] Project renamed from the template identifiers (`web_app_demo`, `web-app-demo`, `vibecoding-template`), `bun.lock` regenerated
- [x] Deferred-surface notes added to the READMEs of surfaces that are not active
- [ ] `Bootstrap-Only Instructions` blocks deleted from `AGENTS.md` and `CLAUDE.md`
- [x] Local URLs, commands run, and anything the user must authorize manually reported back to the user

Validation note: canonical Compose test database `web_app_demo_test` has been reset with explicit consent and all Prisma migrations apply cleanly. `web_app_cms_test` is retained only as an extra clean validation database; it is not the canonical test target.

`README.md`, `AGENTS.md`, `CLAUDE.md`, and some `docs/` runbooks route agents into this file by section name, so renaming a heading breaks those pointers silently. Add rows and sections a project needs, and cross-reference sections by name rather than by number so renumbering stays harmless.
